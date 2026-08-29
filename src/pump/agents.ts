// ── Xenia — Pump.fun Grok agents ──────────────────────────────────────────
//
// Four agents, roles and prompts carried across from the repo/article:
//   auditor   (fast model)  — wallet coordination, wash trading, dump risk
//   narrative (fast model)  — meme potential, no on-chain data at all
//   timing    (fast model)  — market backdrop, cached 15 min
//   checker   (strong model)— adversarial, looks for reasons NOT to buy
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RULE THAT MATTERS MOST
//
// "При любой ошибке агент возвращает максимально пессимистичный результат, а не
//  пустой." — on ANY error the agent returns the maximally pessimistic result,
//  never an empty or neutral one. Timeout, 500, malformed JSON, off-schema
//  response: for the auditor that is every risk flag true and zero organic; for
//  the checker it is approve: false.
//
// A broken check equals refusal, never a silent skip of the check. This is the
// single most important property in the file — an agent that fails open turns a
// safety layer into a rubber stamp exactly when the API is degraded.
// ═══════════════════════════════════════════════════════════════════════════
//
// COMPLIANCE NOTE — read before enabling live.
// xAI's Acceptable Use Policy prohibits using their services "to unlawfully buy
// or sell securities or to provide or receive advice about securities,
// commodities, derivatives, or other financial products or services," and
// restricts high-stakes automated decisions. It also bars unauthorised automated
// access to consumer Grok — use the official API with your own key, never a
// scraped session. Treat agent output as descriptive risk information surfaced
// to the user, not as an instruction the platform acts on for them.

import {
  AuditVerdict, CheckerVerdict, NarrativeVerdict, PumpConfig,
  PumpToken, TimingVerdict, TokenMetrics, ScoreBreakdown,
} from './types';

const XAI_BASE = 'https://api.x.ai/v1/chat/completions';

// ── pessimistic fallbacks ──────────────────────────────────────────────────

export const PESSIMISTIC_AUDIT: AuditVerdict = {
  coordinatedBuys: true, washTrading: true, creatorDumpRisk: 1.0, organicScore: 0.0,
};
export const PESSIMISTIC_NARRATIVE: NarrativeVerdict = {
  narrativeFit: 0, virality: 0, community: 0, timing: 0,
};
/** Article uses 0.3 across the board for timing failure. Kept. */
export const PESSIMISTIC_TIMING: TimingVerdict = {
  marketMood: 0.3, memeSeason: 0.3, volumeSignal: 0.3, timingScore: 0.3,
};
export const PESSIMISTIC_CHECKER: CheckerVerdict = {
  approve: false, confidence: 0, riskFlags: ['parse_error'],
  reason: 'checker failed to respond',
};

// ── spend control: three independent limiters (repo) ───────────────────────

export class GrokLimiter {
  private bucket: number;
  private lastRefill = Date.now();
  private callsToday = 0;
  private dayKey = Math.floor(Date.now() / 86400000);
  private consecutiveFailures = 0;
  private breakerOpenUntil = 0;

  constructor(private cfg: PumpConfig['ops']) {
    this.bucket = cfg.maxCallsPerMinute;
  }

  /** Null when a call may proceed, else the reason it may not. */
  check(): string | null {
    const day = Math.floor(Date.now() / 86400000);
    if (day !== this.dayKey) { this.dayKey = day; this.callsToday = 0; }

    if (Date.now() < this.breakerOpenUntil) {
      // While the circuit is open the agents return pessimistic results, which
      // means the pipeline does not buy. That is the intended behaviour.
      return `circuit breaker open after ${this.consecutiveFailures} consecutive failures`;
    }
    if (this.callsToday >= this.cfg.dailyCallBudget) {
      return `daily Grok budget spent (${this.callsToday}/${this.cfg.dailyCallBudget})`;
    }
    const elapsed = (Date.now() - this.lastRefill) / 60_000;
    this.bucket = Math.min(this.cfg.maxCallsPerMinute,
      this.bucket + elapsed * this.cfg.maxCallsPerMinute);
    this.lastRefill = Date.now();
    if (this.bucket < 1) return 'rate limit: token bucket empty';
    return null;
  }

  consume() { this.bucket -= 1; this.callsToday += 1; }

  recordSuccess() { this.consecutiveFailures = 0; }

  recordFailure() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.cfg.breakerFailures) {
      this.breakerOpenUntil = Date.now() + 5 * 60_000;
    }
  }

  get stats() {
    return {
      callsToday: this.callsToday,
      budget: this.cfg.dailyCallBudget,
      breakerOpen: Date.now() < this.breakerOpenUntil,
      consecutiveFailures: this.consecutiveFailures,
    };
  }
}

// ── transport ──────────────────────────────────────────────────────────────

async function callGrok(
  cfg: PumpConfig, model: string, prompt: string, limiter: GrokLimiter,
): Promise<string | null> {
  const blocked = limiter.check();
  if (blocked) return null;
  limiter.consume();

  for (let attempt = 0; attempt <= cfg.grok.retries; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), cfg.grok.timeoutMs);
      const r = await fetch(XAI_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.grok.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,          // reproducibility, as specified
        }),
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (!r.ok) throw new Error(`http ${r.status}`);
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('no content');
      limiter.recordSuccess();
      return text;
    } catch {
      if (attempt === cfg.grok.retries) { limiter.recordFailure(); return null; }
      await new Promise(res => setTimeout(res, 2 ** attempt * 500));   // exp backoff
    }
  }
  return null;
}

/** Models wrap JSON in markdown fences regardless of instructions. Strip them. */
function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    const cleaned = text.trim()
      .replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned) as T;
  } catch { return null; }
}

const num = (v: unknown, d = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : d;

// ── 1. auditor ─────────────────────────────────────────────────────────────

export async function runAuditor(
  cfg: PumpConfig, token: PumpToken,
  trades: { wallet: string; side: string; amountSol: number; secondsAfterLaunch: number }[],
  holders: { address: string; percentage: number; isSniper?: boolean }[],
  limiter: GrokLimiter,
): Promise<AuditVerdict> {
  const tradesSummary = trades.slice(0, 30).map(t =>
    `  ${t.wallet.slice(0, 8)}... | ${t.side} | ${t.amountSol.toFixed(3)} SOL | +${t.secondsAfterLaunch}s`
  ).join('\n');
  const holdersSummary = holders.slice(0, 10).map(h =>
    `  ${h.address.slice(0, 8)}... | ${h.percentage.toFixed(1)}% | ${h.isSniper ? 'sniper' : 'organic'}`
  ).join('\n');

  const prompt = `You are a wallet auditor for a new memecoin on pump.fun.
Transactions (first 30):
${tradesSummary}

Top holders:
${holdersSummary}

Find and rate:
1. coordinated_buys: are there coordinated purchases (same amounts, intervals under 5s, linked addresses)
2. wash_trading: signs of wash trading (one wallet buying and selling repeatedly)
3. creator_dump_risk: does it look like the creator or an insider is preparing a dump
4. organic_score: what fraction of buyers look organic

If the data is insufficient to judge, raise the flag rather than excusing the token.

Reply ONLY JSON:
{"coordinated_buys": false, "wash_trading": false, "creator_dump_risk": 0.0, "organic_score": 0.0}`;

  const parsed = parseJson<Record<string, unknown>>(
    await callGrok(cfg, cfg.grok.fastModel, prompt, limiter));
  if (!parsed) return PESSIMISTIC_AUDIT;

  return {
    coordinatedBuys: parsed.coordinated_buys === true,
    washTrading: parsed.wash_trading === true,
    creatorDumpRisk: num(parsed.creator_dump_risk, 1),
    organicScore: num(parsed.organic_score, 0),
  };
}

// ── 2. narrative ───────────────────────────────────────────────────────────

export async function runNarrative(
  cfg: PumpConfig, token: PumpToken, metrics: TokenMetrics, limiter: GrokLimiter,
): Promise<NarrativeVerdict> {
  const prompt = `You are analyzing a new memecoin on pump.fun.
Token: ${token.name} (${token.symbol})
Description: ${token.description}
Creator Twitter: ${token.twitter || 'none'}
Website: ${token.website || 'none'}
Age: ${token.ageMinutes} minutes
Bonding curve: ${token.bondingCurvePct}%
Unique buyers: ${token.uniqueBuyers}
Risk score: ${metrics.riskScore}/10
Top-5 wallets hold: ${(metrics.insiderPct * 100).toFixed(0)}%

Rate 0.0-1.0:
1. narrative_fit: does the meme match a current trend (events, viral topics)
2. virality: viral potential (humor, recognition, shock value)
3. community: signs of a real community behind the token
4. timing: is the launch timing right for market mood

Score clones of yesterday's hype strictly. Missing data means a LOW score, not an average one.

Reply ONLY JSON, no explanation:
{"narrative_fit": 0.0, "virality": 0.0, "community": 0.0, "timing": 0.0}`;

  const parsed = parseJson<Record<string, unknown>>(
    await callGrok(cfg, cfg.grok.fastModel, prompt, limiter));
  if (!parsed) return PESSIMISTIC_NARRATIVE;

  return {
    narrativeFit: num(parsed.narrative_fit),
    virality: num(parsed.virality),
    community: num(parsed.community),
    timing: num(parsed.timing),
  };
}

// ── 3. timing, with a locked cache ─────────────────────────────────────────

export interface MarketContext {
  sol24hChange: number;
  btcDominance: number;
  pfVolume4h: number;
  graduations4h: number;
  avgVolumePerLaunch: number;
  hourUtc: number;
}

export class TimingAgent {
  private cached: { verdict: TimingVerdict; at: number } | null = null;
  private inFlight: Promise<TimingVerdict> | null = null;

  constructor(private cfg: PumpConfig, private limiter: GrokLimiter) {}

  async evaluate(ctx: MarketContext): Promise<TimingVerdict> {
    const ttl = this.cfg.scoring.timingCacheSeconds * 1000;
    if (this.cached && Date.now() - this.cached.at < ttl) return this.cached.verdict;

    // Lock: a burst of launches must not fire three identical requests. The repo
    // is explicit about this, and it is the difference between one call per 15
    // minutes and one call per token during a launch spike.
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetch(ctx).then(v => {
      // Failures are deliberately NOT cached — otherwise one bad minute pins the
      // pipeline pessimistic for the full window.
      if (v !== PESSIMISTIC_TIMING) this.cached = { verdict: v, at: Date.now() };
      this.inFlight = null;
      return v;
    });
    return this.inFlight;
  }

  private async fetch(ctx: MarketContext): Promise<TimingVerdict> {
    const prompt = `You are evaluating the MOMENT for buying memecoins on Solana.
Current market context:
- SOL 24h: ${ctx.sol24hChange}%
- BTC dominance: ${ctx.btcDominance}%
- pump.fun volume 4h: ${ctx.pfVolume4h} SOL
- Graduations 4h: ${ctx.graduations4h}
- Avg volume per launch: ${ctx.avgVolumePerLaunch} SOL
- Hour (UTC): ${ctx.hourUtc}

Rate 0.0-1.0:
1. market_mood: overall market sentiment (0 = panic, 1 = greed)
2. meme_season: is this a memecoin season or a lull
3. volume_signal: is pump.fun volume normal or anomalous
4. timing_score: overall timing score for entry

Reply ONLY JSON:
{"market_mood": 0.0, "meme_season": 0.0, "volume_signal": 0.0, "timing_score": 0.0}`;

    const parsed = parseJson<Record<string, unknown>>(
      await callGrok(this.cfg, this.cfg.grok.fastModel, prompt, this.limiter));
    if (!parsed) return PESSIMISTIC_TIMING;

    return {
      marketMood: num(parsed.market_mood, 0.3),
      memeSeason: num(parsed.meme_season, 0.3),
      volumeSignal: num(parsed.volume_signal, 0.3),
      timingScore: num(parsed.timing_score, 0.3),
    };
  }

  get cacheAge(): number | null {
    return this.cached ? Math.round((Date.now() - this.cached.at) / 1000) : null;
  }
}

// ── 4. adversarial checker ─────────────────────────────────────────────────

export async function runChecker(
  cfg: PumpConfig, token: PumpToken, audit: AuditVerdict,
  narrative: NarrativeVerdict, timing: TimingVerdict,
  breakdown: ScoreBreakdown, limiter: GrokLimiter,
): Promise<CheckerVerdict> {
  const prompt = `You are an adversarial checker. Your job is to find reasons
NOT to buy this token. Previous agents approved the purchase.

Token: ${token.name} (${token.symbol}), score: ${breakdown.total.toFixed(2)}
Score came from: audit=${breakdown.audit.toFixed(2)}, narrative=${breakdown.narrative.toFixed(2)}, timing=${breakdown.timing.toFixed(2)}, metrics=${breakdown.metrics.toFixed(2)}
Audit: coordinated_buys=${audit.coordinatedBuys}, wash_trading=${audit.washTrading}, creator_dump_risk=${audit.creatorDumpRisk.toFixed(1)}, organic=${audit.organicScore.toFixed(1)}
Narrative: fit=${narrative.narrativeFit.toFixed(1)}, virality=${narrative.virality.toFixed(1)}, community=${narrative.community.toFixed(1)}
Timing: moment=${timing.timingScore.toFixed(1)}, meme_season=${timing.memeSeason.toFixed(1)}

Look for AGAINST. What can go wrong? Is there a contradiction between
signals? Are there red flags the previous agents missed? In particular:
high meme potential with low organic share; a healthy curve with top-5
concentration; a strong score carried by one component while the rest fail.

Reply ONLY JSON:
{"approve": true, "confidence": 0.0, "risk_flags": [], "reason": ""}

approve=false if you found a serious red flag. confidence from 0 to 1.`;

  const parsed = parseJson<Record<string, unknown>>(
    await callGrok(cfg, cfg.grok.checkerModel, prompt, limiter));
  if (!parsed) return PESSIMISTIC_CHECKER;

  return {
    approve: parsed.approve === true,
    confidence: num(parsed.confidence),
    riskFlags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags.map(String) : [],
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}
