// ── Xenia Engine — Paper / Live runner ─────────────────────────────────────
//
// The existing xenia bots fire on a 15s timer against a rolling array of close
// prices. That has three problems this module fixes:
//
//   1. It signals on the FORMING bar. A 15s poll inside a 4h candle sees a bar
//      that has not closed, so the entry it takes is one that would not have
//      existed at close. Every backtest number is therefore unreachable in live.
//      Here, signals only fire on CLOSED bars, once per bar, ever.
//   2. It has no cost model, so it will happily take trades whose expected move
//      is smaller than the round trip.
//   3. It has no kill switches. A bot with a broken feed can trade all night.
//
// Paper and live share this exact code path. The only difference is which broker
// is attached. If paper and live diverge, the bug is in the broker, not the
// strategy — which is the point.

import { Features } from './features';
import { evaluateSpec } from './strategy';
import { fetchHistory, INTERVAL_MS, Source } from './market';
import {
  ExitReason, RunConfig, Side, StrategySpec, Trade,
  liqDistance, roundTripCostEquity,
} from './types';

export type RunnerMode = 'paper' | 'live';
export type RunnerState = 'idle' | 'running' | 'halted';

export interface OpenPosition {
  id: string;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  riskDist: number;
  marginUsd: number;
  notionalUsd: number;
  openedAt: number;
  entryBarTime: number;
  barsHeld: number;
  beDone: boolean;
  reason: string;
  regime: string;
}

export interface Broker {
  readonly name: string;
  readonly isLive: boolean;
  getEquity(): Promise<number>;
  open(o: {
    symbol: string; side: Side; marginUsd: number; leverage: number;
    entryHint: number; stop: number; target: number;
  }): Promise<{ ok: boolean; fillPrice: number; error?: string }>;
  close(o: {
    symbol: string; side: Side; notionalUsd: number; exitHint: number;
  }): Promise<{ ok: boolean; fillPrice: number; error?: string }>;
}

// ── Paper broker ───────────────────────────────────────────────────────────
// Fills at the bar close with the same slippage assumption the backtest used, so
// paper results are directly comparable to backtest results. Any drift between
// them is a real finding, not noise.

export class PaperBroker implements Broker {
  readonly name = 'paper';
  readonly isLive = false;
  equity: number;
  constructor(startEquity: number, private slippagePct: number) {
    this.equity = startEquity;
  }
  async getEquity() { return this.equity; }
  async open(o: Parameters<Broker['open']>[0]) {
    const slip = (this.slippagePct / 100) * o.side;   // pay the spread on entry
    return { ok: true, fillPrice: o.entryHint * (1 + slip) };
  }
  async close(o: Parameters<Broker['close']>[0]) {
    const slip = (this.slippagePct / 100) * -o.side;  // and again on exit
    return { ok: true, fillPrice: o.exitHint * (1 + slip) };
  }
}

// ── Live broker stub ───────────────────────────────────────────────────────
// Deliberately not wired to an exchange in this file. Live keys belong in a
// Supabase edge function, never in the browser bundle — a key shipped to the
// client is a key that is public. Implement `placeOrder` server-side and have
// this call it.

export class EdgeFunctionBroker implements Broker {
  readonly name = 'live';
  readonly isLive = true;
  constructor(private endpoint: string, private authToken: () => string | null) {}

  private async call(action: string, payload: Record<string, unknown>) {
    const token = this.authToken();
    if (!token) return { ok: false, fillPrice: 0, error: 'not authenticated' };
    const r = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.error) return { ok: false, fillPrice: 0, error: j?.error ?? `http ${r.status}` };
    return { ok: true, fillPrice: Number(j.fillPrice ?? 0) };
  }

  async getEquity() {
    const token = this.authToken();
    if (!token) return 0;
    const r = await fetch(`${this.endpoint}?action=equity`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => ({}));
    return Number(j?.equity ?? 0);
  }
  async open(o: Parameters<Broker['open']>[0]) { return this.call('open', o); }
  async close(o: Parameters<Broker['close']>[0]) { return this.call('close', o); }
}

// ── Risk manager ───────────────────────────────────────────────────────────

export interface RiskLimits {
  maxDailyLossPct: number;        // halt if equity drops this % in a UTC day
  maxConsecutiveLosses: number;
  maxOpenPositions: number;
  minEquityUsd: number;
  maxFundingPctPer8h: number;     // refuse to open when funding is extreme
  maxApiErrorRate: number;        // 0..1 over the last 20 calls
  requirePaperDays: number;       // live refuses until paper has run this long
}

export const DEFAULT_LIMITS: RiskLimits = {
  maxDailyLossPct: 20,
  maxConsecutiveLosses: 4,
  maxOpenPositions: 1,
  minEquityUsd: 5,
  maxFundingPctPer8h: 0.05,
  maxApiErrorRate: 0.05,
  requirePaperDays: 30,
};

export interface RiskState {
  dayKey: number;
  dayStartEquity: number;
  consecutiveLosses: number;
  apiCalls: boolean[];
  paperStartedAt: number | null;
  haltReason: string | null;
}

export class RiskManager {
  state: RiskState;
  constructor(public limits: RiskLimits = DEFAULT_LIMITS, startEquity = 0) {
    this.state = {
      dayKey: Math.floor(Date.now() / 86400000),
      dayStartEquity: startEquity,
      consecutiveLosses: 0,
      apiCalls: [],
      paperStartedAt: null,
      haltReason: null,
    };
  }

  rollDay(equity: number) {
    const k = Math.floor(Date.now() / 86400000);
    if (k !== this.state.dayKey) {
      this.state.dayKey = k;
      this.state.dayStartEquity = equity;
    }
  }

  recordApi(ok: boolean) {
    this.state.apiCalls.push(ok);
    if (this.state.apiCalls.length > 20) this.state.apiCalls.shift();
  }

  recordTrade(equityReturn: number) {
    if (equityReturn <= 0) this.state.consecutiveLosses++;
    else this.state.consecutiveLosses = 0;
  }

  /** Returns a halt reason, or null when it is safe to open a new position. */
  check(o: {
    equity: number; openPositions: number; mode: RunnerMode;
    fundingPctPer8h?: number;
  }): string | null {
    if (this.state.haltReason) return this.state.haltReason;
    const L = this.limits;
    this.rollDay(o.equity);

    if (o.equity < L.minEquityUsd) return `equity $${o.equity.toFixed(2)} below minimum`;
    if (o.openPositions >= L.maxOpenPositions) return null; // not a halt, just no room

    const dayLoss = this.state.dayStartEquity > 0
      ? (this.state.dayStartEquity - o.equity) / this.state.dayStartEquity * 100 : 0;
    if (dayLoss >= L.maxDailyLossPct) {
      return this.halt(`daily loss ${dayLoss.toFixed(1)}% >= ${L.maxDailyLossPct}%`);
    }
    if (this.state.consecutiveLosses >= L.maxConsecutiveLosses) {
      return this.halt(`${this.state.consecutiveLosses} consecutive losses`);
    }
    const calls = this.state.apiCalls;
    if (calls.length >= 10) {
      const errRate = calls.filter(c => !c).length / calls.length;
      if (errRate > L.maxApiErrorRate) return this.halt(`API error rate ${(errRate * 100).toFixed(0)}%`);
    }
    if (o.fundingPctPer8h !== undefined && Math.abs(o.fundingPctPer8h) > L.maxFundingPctPer8h) {
      return `funding ${o.fundingPctPer8h.toFixed(3)}% per 8h is extreme — standing down`;
    }
    if (o.mode === 'live' && L.requirePaperDays > 0) {
      const started = this.state.paperStartedAt;
      if (!started) return 'live blocked: no paper history recorded';
      const days = (Date.now() - started) / 86400000;
      if (days < L.requirePaperDays) {
        return `live blocked: ${days.toFixed(1)} of ${L.requirePaperDays} paper days completed`;
      }
    }
    return null;
  }

  halt(reason: string): string {
    this.state.haltReason = reason;
    return reason;
  }

  resume() { this.state.haltReason = null; this.state.consecutiveLosses = 0; }
}

// ── Runner ─────────────────────────────────────────────────────────────────

export interface RunnerEvents {
  onLog?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  onOpen?: (p: OpenPosition) => void;
  onClose?: (t: Trade) => void;
  onTick?: (info: { equity: number; lastBarTime: number; position: OpenPosition | null }) => void;
  onHalt?: (reason: string) => void;
}

export interface RunnerOptions {
  spec: StrategySpec;
  symbol: string;
  interval: string;
  source?: Source;
  mode: RunnerMode;
  cfg: RunConfig;
  broker: Broker;
  risk?: RiskManager;
  events?: RunnerEvents;
  historyBars?: number;
}

export class Runner {
  state: RunnerState = 'idle';
  position: OpenPosition | null = null;
  trades: Trade[] = [];
  equity: number;
  private candles: import('./types').Candle[] = [];
  private lastProcessedBar = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private risk: RiskManager;

  constructor(private opts: RunnerOptions) {
    this.equity = opts.cfg.startEquity;
    this.risk = opts.risk ?? new RiskManager(DEFAULT_LIMITS, opts.cfg.startEquity);
    if (opts.mode === 'paper' && !this.risk.state.paperStartedAt) {
      this.risk.state.paperStartedAt = Date.now();
    }
  }

  private log(m: string, level: 'info' | 'warn' | 'error' = 'info') {
    this.opts.events?.onLog?.(m, level);
  }

  async start() {
    if (this.state === 'running') return;
    this.state = 'running';
    this.log(`runner starting — ${this.opts.mode.toUpperCase()} on ${this.opts.symbol} ${this.opts.interval} @ ${this.opts.cfg.leverage}x`);
    this.equity = await this.opts.broker.getEquity().catch(() => this.equity) || this.equity;
    await this.tick();
    this.schedule();
  }

  stop() {
    this.state = 'idle';
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.log('runner stopped');
  }

  /**
   * Wake shortly after each bar closes rather than on a fixed short interval.
   * There is nothing to decide mid-bar, and polling every 15s inside a 4h candle
   * is how you end up acting on data that has not settled.
   */
  private schedule() {
    if (this.state !== 'running') return;
    const ms = INTERVAL_MS[this.opts.interval] ?? 14_400_000;
    const now = Date.now();
    const nextClose = Math.ceil(now / ms) * ms;
    const delay = Math.max(nextClose - now + 5_000, 10_000);
    this.timer = setTimeout(async () => {
      await this.tick();
      this.schedule();
    }, delay);
  }

  async tick() {
    try {
      const hist = await fetchHistory({
        symbol: this.opts.symbol,
        interval: this.opts.interval,
        bars: this.opts.historyBars ?? 600,
        source: this.opts.source,
      });
      this.risk.recordApi(hist.candles.length > 0);
      if (hist.candles.length < 200) {
        this.log(`not enough history (${hist.candles.length} bars)`, 'warn');
        return;
      }

      // Drop the final bar: it is still forming. Signals fire on CLOSED bars only.
      this.candles = hist.candles.slice(0, -1);
      const f = new Features(this.candles, { tfHours: this.opts.cfg.tfHours });
      const i = f.n - 1;
      const barTime = f.time[i];

      if (barTime === this.lastProcessedBar) {
        this.opts.events?.onTick?.({ equity: this.equity, lastBarTime: barTime, position: this.position });
        return;
      }
      this.lastProcessedBar = barTime;

      if (this.position) await this.managePosition(f, i);
      if (!this.position) await this.maybeOpen(f, i);

      this.opts.events?.onTick?.({ equity: this.equity, lastBarTime: barTime, position: this.position });
    } catch (e) {
      this.risk.recordApi(false);
      this.log(`tick failed: ${(e as Error).message}`, 'error');
    }
  }

  private async managePosition(f: Features, i: number) {
    const p = this.position!;
    const cfg = this.opts.cfg;
    const liq = liqDistance(cfg.leverage, cfg.costs.maintMarginPct);
    const liqPx = p.side > 0 ? p.entry * (1 - liq) : p.entry * (1 + liq);
    p.barsHeld++;

    // Exits resolve against levels that existed BEFORE this bar — same rule as
    // the backtest. Anything else and live will not match the tested numbers.
    let exitHint: number | null = null;
    let reason: ExitReason | null = null;
    if (p.side > 0) {
      if (f.l[i] <= liqPx && (f.l[i] > p.stop || liqPx >= p.stop)) { exitHint = liqPx; reason = 'liquidation'; }
      else if (f.l[i] <= p.stop) { exitHint = p.stop; reason = 'stop'; }
      else if (f.h[i] >= p.target) { exitHint = p.target; reason = 'target'; }
    } else {
      if (f.h[i] >= liqPx && (f.h[i] < p.stop || liqPx <= p.stop)) { exitHint = liqPx; reason = 'liquidation'; }
      else if (f.h[i] >= p.stop) { exitHint = p.stop; reason = 'stop'; }
      else if (f.l[i] <= p.target) { exitHint = p.target; reason = 'target'; }
    }
    if (exitHint === null && p.barsHeld >= this.opts.spec.params.maxHoldBars) {
      exitHint = f.c[i]; reason = 'timeout';
    }

    if (exitHint !== null && reason !== null) {
      const res = await this.opts.broker.close({
        symbol: this.opts.symbol, side: p.side,
        notionalUsd: p.notionalUsd, exitHint,
      });
      this.risk.recordApi(res.ok);
      if (!res.ok) { this.log(`close failed: ${res.error}`, 'error'); return; }

      const fill = res.fillPrice || exitHint;
      const raw = p.side > 0 ? (fill - p.entry) / p.entry : (p.entry - fill) / p.entry;
      const onMargin = reason === 'liquidation' ? -1 : raw * cfg.leverage;
      const costEq = roundTripCostEquity(cfg);
      const funding = (cfg.costs.fundingPctPer8h / 100) * cfg.leverage
        * cfg.marginFraction * (cfg.tfHours / 8) * p.barsHeld;
      const eqRet = Math.max(onMargin * cfg.marginFraction - costEq - funding, -cfg.marginFraction);

      this.equity = Math.max(this.equity + this.equity * eqRet, 0);
      if (this.opts.broker instanceof PaperBroker) this.opts.broker.equity = this.equity;

      const t: Trade = {
        entryBar: 0, exitBar: i, entryTime: p.entryBarTime, exitTime: f.time[i],
        side: p.side, entry: p.entry, exit: fill, reason,
        rMultiple: (raw * p.entry) / p.riskDist,
        equityReturn: eqRet, regime: p.regime as Trade['regime'], barsHeld: p.barsHeld,
        riskDistPct: p.riskDist / p.entry,
      };
      this.trades.push(t);
      this.risk.recordTrade(eqRet);
      this.position = null;
      this.log(`CLOSE ${reason} @ ${fill.toFixed(4)} — ${(eqRet * 100).toFixed(2)}% equity, now $${this.equity.toFixed(2)}`);
      this.opts.events?.onClose?.(t);
      return;
    }

    // Level updates take effect from the NEXT bar.
    const rNow = ((p.side > 0 ? f.c[i] - p.entry : p.entry - f.c[i])) / p.riskDist;
    if (cfg.beAtR !== null && rNow >= cfg.beAtR && !p.beDone) {
      p.stop = p.entry; p.beDone = true;
      this.log(`stop to break-even at ${rNow.toFixed(2)}R`);
    }
    if (cfg.trailAtr !== null && rNow >= 1.5 && Number.isFinite(f.atr[i])) {
      const t = f.c[i] - p.side * cfg.trailAtr * f.atr[i];
      p.stop = p.side > 0 ? Math.max(p.stop, t) : Math.min(p.stop, t);
    }
  }

  private async maybeOpen(f: Features, i: number) {
    const cfg = this.opts.cfg;
    const halt = this.risk.check({
      equity: this.equity, openPositions: this.position ? 1 : 0, mode: this.opts.mode,
    });
    if (halt) {
      if (this.risk.state.haltReason) {
        this.state = 'halted';
        if (this.timer) clearTimeout(this.timer);
        this.log(`HALTED — ${halt}`, 'error');
        this.opts.events?.onHalt?.(halt);
      } else {
        this.log(`standing down — ${halt}`, 'warn');
      }
      return;
    }

    const sig = evaluateSpec(this.opts.spec, f, i);
    if (!sig) return;

    const liq = liqDistance(cfg.leverage, cfg.costs.maintMarginPct);
    if (sig.riskDist / sig.entry >= liq) {
      this.log(`skipped — stop ${(sig.riskDist / sig.entry * 100).toFixed(2)}% is outside `
        + `liquidation ${(liq * 100).toFixed(2)}% at ${cfg.leverage}x`, 'warn');
      return;
    }

    const marginUsd = this.equity * cfg.marginFraction;
    const notionalUsd = marginUsd * cfg.leverage;
    const res = await this.opts.broker.open({
      symbol: this.opts.symbol, side: sig.side, marginUsd,
      leverage: cfg.leverage, entryHint: sig.entry, stop: sig.stop, target: sig.target,
    });
    this.risk.recordApi(res.ok);
    if (!res.ok) { this.log(`open failed: ${res.error}`, 'error'); return; }

    const fill = res.fillPrice || sig.entry;
    const drift = sig.side > 0 ? fill - sig.entry : sig.entry - fill;
    this.position = {
      id: `${Date.now()}`,
      side: sig.side, entry: fill,
      stop: sig.stop, target: sig.target, riskDist: sig.riskDist,
      marginUsd, notionalUsd,
      openedAt: Date.now(), entryBarTime: f.time[i],
      barsHeld: 0, beDone: false, reason: sig.reason, regime: sig.regime,
    };
    this.log(`OPEN ${sig.side > 0 ? 'LONG' : 'SHORT'} @ ${fill.toFixed(4)} `
      + `stop ${sig.stop.toFixed(4)} target ${sig.target.toFixed(4)} `
      + `margin $${marginUsd.toFixed(2)} — ${sig.reason}`);
    if (Math.abs(drift / sig.entry) > 0.002) {
      this.log(`fill drifted ${(drift / sig.entry * 100).toFixed(2)}% from the close — `
        + `if this persists, the modelled slippage is too optimistic`, 'warn');
    }
    this.opts.events?.onOpen?.(this.position);
  }

  /**
   * Compare realised paper/live slippage to the modelled assumption. If realised
   * cost exceeds the model by more than 50% over 20 trades, the backtest is
   * lying and everything needs re-costing.
   */
  reconcile(): { modelled: number; realisedProxy: number; drift: number; ok: boolean } {
    const modelled = roundTripCostEquity(this.opts.cfg);
    const n = Math.min(this.trades.length, 20);
    if (n < 5) return { modelled, realisedProxy: modelled, drift: 0, ok: true };
    const recent = this.trades.slice(-n);
    const avgR = recent.reduce((a, t) => a + t.rMultiple, 0) / n;
    const avgEq = recent.reduce((a, t) => a + t.equityReturn, 0) / n;
    const impliedCost = avgR * this.opts.cfg.leverage * this.opts.cfg.marginFraction
      * (recent[0].riskDistPct ?? 0.02) - avgEq;
    const realisedProxy = Number.isFinite(impliedCost) ? Math.abs(impliedCost) : modelled;
    const drift = modelled > 0 ? (realisedProxy - modelled) / modelled : 0;
    return { modelled, realisedProxy, drift, ok: drift < 0.5 };
  }
}
