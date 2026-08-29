// ── Xenia — Pump.fun pipeline: scoring, reputation, risk, orchestration ────
//
// Nine stages, per the repository. Cheap filters run before expensive ones, so a
// fraction of a percent of the stream ever reaches the strong model.
//
//   1.   monitor            code    WebSocket + basic filter
//   1.5  creator memory     code    own closed-trade log
//   2.   analyzer           code    REST x3, veto on concentration
//   3-5. auditor/narrative/timing   Grok fast model
//   6.   scoring matrix     code    four weighted components
//   7.   checker            Grok strong model, adversarial
//   8.   risk gate          code    five limits + four exit rules
//   9.   execution          mock: no transaction / live: signed by the user

import {
  AuditVerdict, CheckerVerdict, LogRecord, NarrativeVerdict, PumpConfig,
  PumpToken, ScoreBreakdown, SkipStage, TimingVerdict, TokenMetrics,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 6 — SCORING MATRIX
// ═══════════════════════════════════════════════════════════════════════════
//
// Four components, weights normalised so any scale works (write 0.5/0.5/0.5/0.5
// and the proportions hold, the result stays in 0..1).
//
// This replaces the article's five-key version, which cannot produce a non-zero
// score — see types.ts for why. It is also structurally better: each component
// scores ONE source's verdict, so an agent's outputs cannot be silently dropped
// by a key-name mismatch, which is what happened to virality/community/timing.

export function computeScore(
  cfg: PumpConfig, audit: AuditVerdict, narrative: NarrativeVerdict,
  timing: TimingVerdict, metrics: TokenMetrics,
): ScoreBreakdown {
  // Hard flags zero the audit component outright rather than being averaged
  // away — a confirmed wash-trading flag is not something a good narrative
  // should be able to outvote.
  const auditScore = (audit.coordinatedBuys || audit.washTrading)
    ? 0
    : audit.organicScore * (1 - audit.creatorDumpRisk);

  const narrativeScore =
    (narrative.narrativeFit + narrative.virality + narrative.community + narrative.timing) / 4;

  const timingScore = timing.timingScore;

  // riskScore is 1-10 where HIGHER IS WORSE, so it must be inverted. The
  // article's weight key was called risk_inverse but the analyzer only ever
  // produced risk_score, so even with dict access fixed the sign was wrong.
  const riskInverse = Math.min(Math.max(1 - (metrics.riskScore - 1) / 9, 0), 1);
  const metricsScore =
    riskInverse * 0.4 + metrics.curveHealth * 0.3 +
    metrics.socialSignal * 0.15 + metrics.walletDiversity * 0.15;

  const w = cfg.scoring;
  const sum = w.auditWeight + w.narrativeWeight + w.timingWeight + w.metricsWeight;
  const norm = sum > 0 ? sum : 1;

  const total =
    (auditScore * w.auditWeight + narrativeScore * w.narrativeWeight +
     timingScore * w.timingWeight + metricsScore * w.metricsWeight) / norm;

  return {
    audit: auditScore, narrative: narrativeScore,
    timing: timingScore, metrics: metricsScore,
    total: Math.min(Math.max(total, 0), 1),
  };
}

/** Which component dragged the score down. Goes into the skip log. */
export function weakestComponent(b: ScoreBreakdown): string {
  const parts: [string, number][] = [
    ['audit', b.audit], ['narrative', b.narrative],
    ['timing', b.timing], ['metrics', b.metrics],
  ];
  return parts.sort((x, y) => x[1] - y[1])[0][0];
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 1 — BASIC FILTER
// ═══════════════════════════════════════════════════════════════════════════
//
// DEVIATION, and the reason the article's pipeline never trades.
//
// The filter demands age > 2 min and >= 5 buyers. subscribeNewToken fires at
// CREATION, when both are zero, and the article's `async for token in stream`
// never revisits a token. Every token fails, forever.
//
// Fix: tokens that fail only on age or buyer count go into a pending set and are
// re-checked as later trade events arrive. Tokens that fail on metadata or curve
// position are rejected outright, since those do not improve with time.
//
// This changes NO threshold. It makes the thresholds reachable.

export interface FilterResult { pass: boolean; retry: boolean; reason: string }

export function passesBasicFilter(cfg: PumpConfig, t: PumpToken): FilterResult {
  const f = cfg.filter;
  if (f.requireMetadata && !t.hasMetadata) {
    return { pass: false, retry: false, reason: 'no metadata' };
  }
  if (t.bondingCurvePct >= f.maxBondingCurvePct) {
    return { pass: false, retry: false, reason: `curve ${t.bondingCurvePct}% >= ${f.maxBondingCurvePct}%` };
  }
  if (t.ageMinutes <= f.minAgeMinutes) {
    return { pass: false, retry: true, reason: `age ${t.ageMinutes}m, waiting for ${f.minAgeMinutes}m` };
  }
  if (t.uniqueBuyers < f.minUniqueBuyers) {
    return { pass: false, retry: true, reason: `${t.uniqueBuyers} buyers, need ${f.minUniqueBuyers}` };
  }
  return { pass: true, retry: false, reason: 'ok' };
}

/** Unconditional vetoes — repo only, absent from the article. */
export function concentrationVeto(cfg: PumpConfig, m: TokenMetrics): string | null {
  if (m.creatorPct * 100 >= cfg.filter.vetoCreatorPct) {
    return `creator holds ${(m.creatorPct * 100).toFixed(0)}% (veto at ${cfg.filter.vetoCreatorPct}%)`;
  }
  if (m.insiderPct * 100 >= cfg.filter.vetoTop5Pct) {
    return `top-5 hold ${(m.insiderPct * 100).toFixed(0)}% (veto at ${cfg.filter.vetoTop5Pct}%)`;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 1.5 — CREATOR REPUTATION
// ═══════════════════════════════════════════════════════════════════════════
//
// The pipeline judges each launch from scratch, so the same deployer can rug you
// three times and be "new" every time. The auditor cannot help — it sees one
// token, not an address's history.
//
// This book is built from OUR OWN closed trades. Not a list from the internet,
// not a heuristic: a fact from our own log. Clean addresses are forgotten after
// forgetCreatorsAfterDays; addresses with rugs are never forgotten, because that
// is the entire value of the book.

export interface CreatorRecord {
  address: string;
  rugs: number;
  trades: number;
  lastSeen: number;
  totalPnlSol: number;
}

export class CreatorReputation {
  private book = new Map<string, CreatorRecord>();

  constructor(private cfg: PumpConfig['reputation']) {}

  load(records: CreatorRecord[]) {
    for (const r of records) this.book.set(r.address, r);
  }
  export(): CreatorRecord[] { return [...this.book.values()]; }

  isBlocked(address: string): string | null {
    const r = this.book.get(address);
    if (!r) return null;
    if (r.rugs >= this.cfg.blockCreatorAfterRugs) {
      return `creator has ${r.rugs} prior rugs in our own log`;
    }
    return null;
  }

  /** Called on every close. A loss worse than rugLossPct counts as a rug. */
  recordClose(address: string, pnlPct: number, pnlSol: number) {
    const r = this.book.get(address) ?? {
      address, rugs: 0, trades: 0, lastSeen: 0, totalPnlSol: 0,
    };
    r.trades++;
    r.lastSeen = Date.now();
    r.totalPnlSol += pnlSol;
    if (pnlPct <= -this.cfg.rugLossPct) r.rugs++;
    this.book.set(address, r);
  }

  /** Clean addresses expire. Addresses with rugs never do. */
  prune() {
    const cutoff = Date.now() - this.cfg.forgetCreatorsAfterDays * 86400000;
    for (const [addr, r] of this.book) {
      if (r.rugs === 0 && r.lastSeen < cutoff) this.book.delete(addr);
    }
  }

  get size() { return this.book.size; }
  get blockedCount() {
    return [...this.book.values()].filter(r => r.rugs >= this.cfg.blockCreatorAfterRugs).length;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 8 — RISK GATE
// ═══════════════════════════════════════════════════════════════════════════

export interface OpenPosition {
  token: string;
  creator: string;
  entryPrice: number;
  peakPrice: number;
  amountSol: number;
  openedAt: number;
  score: number;
}

export type ExitReason = 'stop_loss' | 'take_profit' | 'trailing_stop' | 'max_hold';

export class RiskManager {
  todayLossSol = 0;
  todayTrades = 0;
  positions = new Map<string, OpenPosition>();
  private dayKey = Math.floor(Date.now() / 86400000);

  constructor(private cfg: PumpConfig['risk'], private rep: PumpConfig['reputation']) {}

  private rollDay() {
    const d = Math.floor(Date.now() / 86400000);
    if (d !== this.dayKey) { this.dayKey = d; this.todayLossSol = 0; this.todayTrades = 0; }
  }

  canTrade(creator?: string): string | null {
    this.rollDay();
    if (this.todayLossSol >= this.cfg.dailyLossLimitSol) {
      return `daily loss limit reached (${this.todayLossSol.toFixed(3)}/${this.cfg.dailyLossLimitSol} SOL)`;
    }
    if (this.todayTrades >= this.cfg.maxDailyTrades) {
      return `daily trade limit reached (${this.todayTrades}/${this.cfg.maxDailyTrades})`;
    }
    if (this.positions.size >= this.cfg.maxOpenPositions) {
      return `max open positions (${this.positions.size}/${this.cfg.maxOpenPositions})`;
    }
    // Two tokens from one deployer is one bet, not two — they usually dump together.
    if (this.rep.onePositionPerCreator && creator) {
      for (const p of this.positions.values()) {
        if (p.creator === creator) return 'already holding a token from this creator';
      }
    }
    return null;
  }

  /** Proportional to score, capped twice — by the ceiling and by 30% of what is
   *  left of the daily loss budget. Bets shrink as the day goes against you. */
  positionSize(score: number): number {
    const base = this.cfg.maxSolPerTrade * Math.min(score, 1);
    const remaining = Math.max(this.cfg.dailyLossLimitSol - this.todayLossSol, 0);
    return Math.max(Math.min(base, remaining * 0.3), 0);
  }

  open(p: OpenPosition) { this.positions.set(p.token, p); }

  close(token: string, pnlSol: number) {
    this.positions.delete(token);
    if (pnlSol < 0) this.todayLossSol += Math.abs(pnlSol);
    this.todayTrades++;
  }

  /**
   * Four exit rules, in priority order. Trailing only applies ABOVE entry —
   * below it the stop-loss owns the drawdown, otherwise the two rules argue over
   * the same move. Zero in any of the three disables that rule.
   */
  checkExit(p: OpenPosition, price: number): ExitReason | null {
    const changePct = ((price - p.entryPrice) / p.entryPrice) * 100;
    if (this.cfg.stopLossPct > 0 && changePct <= -this.cfg.stopLossPct) return 'stop_loss';
    if (this.cfg.takeProfitPct > 0 && changePct >= this.cfg.takeProfitPct) return 'take_profit';
    if (this.cfg.trailingStopPct > 0 && p.peakPrice > p.entryPrice) {
      const fromPeak = ((price - p.peakPrice) / p.peakPrice) * 100;
      if (fromPeak <= -this.cfg.trailingStopPct) return 'trailing_stop';
    }
    if (this.cfg.maxHoldSeconds > 0 &&
        (Date.now() - p.openedAt) / 1000 >= this.cfg.maxHoldSeconds) return 'max_hold';
    return null;
  }

  /** Peak survives restart via state, so trailing does not restart from spot. */
  updatePeak(token: string, price: number) {
    const p = this.positions.get(token);
    if (p && price > p.peakPrice) p.peakPrice = price;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGGING — JSONL, three record types
// ═══════════════════════════════════════════════════════════════════════════

export class TradeLog {
  private records: LogRecord[] = [];
  constructor(private maxRecords = 5000, private sink?: (r: LogRecord) => void) {}

  private write(r: LogRecord) {
    this.records.push(r);
    if (this.records.length > this.maxRecords) this.records.shift();
    this.sink?.(r);
  }

  skip(token: PumpToken, stage: SkipStage, detail?: unknown, breakdown?: ScoreBreakdown) {
    this.write({
      timestamp: new Date().toISOString(), action: 'skip',
      token: token.address, name: token.name, reason: stage, detail, breakdown,
    });
  }

  buy(o: {
    token: PumpToken; mode: PumpConfig['mode']; amountSol: number; entryPrice: number;
    txHash: string; breakdown: ScoreBreakdown; audit: AuditVerdict;
    narrative: NarrativeVerdict; timing: TimingVerdict; checker: CheckerVerdict;
    metrics: TokenMetrics;
  }) {
    this.write({
      timestamp: new Date().toISOString(), action: 'buy',
      token: o.token.address, name: o.token.name, mode: o.mode,
      score: o.breakdown.total, breakdown: o.breakdown,
      audit: o.audit, narrative: o.narrative, timing: o.timing,
      checker: o.checker, metrics: o.metrics,
      amountSol: o.amountSol, entryPrice: o.entryPrice, txHash: o.txHash,
    });
  }

  close(o: {
    token: string; exitPrice: number; pnlSol: number; pnlPct: number;
    holdSeconds: number; reason: ExitReason; mode: PumpConfig['mode'];
  }) {
    this.write({
      timestamp: new Date().toISOString(), action: 'close',
      token: o.token, exitPrice: o.exitPrice, pnlSol: o.pnlSol,
      pnlPct: o.pnlPct, holdSeconds: o.holdSeconds, reason: o.reason, mode: o.mode,
    });
  }

  all(): LogRecord[] { return this.records; }
  toJsonl(): string { return this.records.map(r => JSON.stringify(r)).join('\n'); }

  /** What replay.py reports. Skip reasons by stage are the useful part. */
  summary() {
    const buys = this.records.filter(r => r.action === 'buy');
    const closes = this.records.filter(r => r.action === 'close');
    const skips = this.records.filter(r => r.action === 'skip');
    const bySkipReason: Record<string, number> = {};
    for (const s of skips) bySkipReason[s.reason ?? '?'] = (bySkipReason[s.reason ?? '?'] ?? 0) + 1;
    const byExit: Record<string, number> = {};
    for (const c of closes) byExit[c.reason ?? '?'] = (byExit[c.reason ?? '?'] ?? 0) + 1;

    const pnl = closes.reduce((a, c) => a + (c.pnlSol ?? 0), 0);
    const wins = closes.filter(c => (c.pnlSol ?? 0) > 0).length;

    return {
      considered: skips.length + buys.length,
      bought: buys.length,
      closed: closes.length,
      bySkipReason,
      byExit,
      pnlSol: pnl,
      winRate: closes.length ? (wins / closes.length) * 100 : 0,
      avgHoldSeconds: closes.length
        ? closes.reduce((a, c) => a + (c.holdSeconds ?? 0), 0) / closes.length : 0,
      /** The repo prints this warning itself, and it is the honest part. */
      warning: closes.length < 30
        ? `Only ${closes.length} closed trades. Below ~30 this table is fitting noise, `
          + `not tuning. And the log cannot know how a token filtered out by the threshold `
          + `would have ended — it describes what happened, not future income.`
        : null,
    };
  }
}
