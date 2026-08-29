// ── Xenia Engine — Backtest ────────────────────────────────────────────────
//
// THE CONTRACT
//   • a signal at bar i is evaluated from data up to and including bar i
//   • the fill happens at close[i]
//   • exits at bar j > i resolve against the stop/target that existed at the OPEN
//     of bar j — i.e. levels set on bar j-1 or earlier
//   • stop/target updates computed on bar j take effect from bar j+1
//   • liquidation is checked against low/high, NOT close, and takes priority when
//     it sits nearer to entry than the stop
//   • a stop outside the liquidation distance is rejected at entry
//
// Why phase 1 / phase 2 matters. The old engine did this:
//     fav = high[i] - entry;  if (fav/risk >= 1) stop = entry;   // BE from the HIGH
//     if (low[i] <= stop) exit(stop);                            // filled by the LOW
// A stop level decided by this bar's high cannot be filled by this bar's low. That
// single ordering error turns real losses into scratches, which is what produces
// the "high profit factor, tiny expectancy" signature. It is the quieter sibling of
// the `stop: 0` bug and it inflates every result it touches.

import { Features } from './features';
import { evaluateSpec } from './strategy';
import {
  BacktestResult, Candle, ExitReason, FoldResult, RunConfig, Stats,
  StrategySpec, Trade, WalkForwardResult, liqDistance, roundTripCostEquity,
} from './types';

export function backtest(
  spec: StrategySpec,
  f: Features,
  cfg: RunConfig,
  span?: [number, number],
): BacktestResult {
  const lo = Math.max(span?.[0] ?? f.warmup, f.warmup);
  const hi = Math.min(span?.[1] ?? f.n - 1, f.n - 1);

  const liq = liqDistance(cfg.leverage, cfg.costs.maintMarginPct);
  const costEq = roundTripCostEquity(cfg);
  const fundPerBar = (cfg.costs.fundingPctPer8h / 100) * cfg.leverage
    * cfg.marginFraction * (cfg.tfHours / 8);

  const trades: Trade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];
  let equity = cfg.startEquity;
  let peak = equity;
  let maxDd = 0;
  let skippedLiq = 0;

  let pos: {
    bar: number; time: number; side: 1 | -1; entry: number;
    stop: number; target: number; riskDist: number;
    barsHeld: number; beDone: boolean; regime: Trade['regime']; maxHold: number;
  } | null = null;

  for (let i = lo; i <= hi; i++) {
    // ── phase 1: resolve exits against levels carried in from EARLIER bars ──
    if (pos) {
      const { side, entry, stop, target } = pos;
      const liqPx = side > 0 ? entry * (1 - liq) : entry * (1 + liq);
      let exitPx: number | null = null;
      let reason: ExitReason | null = null;

      if (side > 0) {
        const hitLiq = f.l[i] <= liqPx;
        const hitStop = f.l[i] <= stop;
        const hitTgt = f.h[i] >= target;
        if (hitLiq && (!hitStop || liqPx >= stop)) { exitPx = liqPx; reason = 'liquidation'; }
        else if (hitStop) { exitPx = stop; reason = 'stop'; }   // stop wins ties: pessimistic
        else if (hitTgt) { exitPx = target; reason = 'target'; }
      } else {
        const hitLiq = f.h[i] >= liqPx;
        const hitStop = f.h[i] >= stop;
        const hitTgt = f.l[i] <= target;
        if (hitLiq && (!hitStop || liqPx <= stop)) { exitPx = liqPx; reason = 'liquidation'; }
        else if (hitStop) { exitPx = stop; reason = 'stop'; }
        else if (hitTgt) { exitPx = target; reason = 'target'; }
      }

      pos.barsHeld++;
      if (exitPx === null && pos.barsHeld >= pos.maxHold) {
        exitPx = f.c[i]; reason = 'timeout';
      }

      if (exitPx !== null && reason !== null) {
        const raw = side > 0 ? (exitPx - entry) / entry : (entry - exitPx) / entry;
        const onMargin = reason === 'liquidation' ? -1 : raw * cfg.leverage;
        const funding = fundPerBar * pos.barsHeld;
        const eqRet = Math.max(onMargin * cfg.marginFraction - costEq - funding,
          -cfg.marginFraction);
        equity = Math.max(equity + equity * eqRet, 0);
        trades.push({
          entryBar: pos.bar, exitBar: i,
          entryTime: pos.time, exitTime: f.time[i],
          side, entry, exit: exitPx, reason,
          rMultiple: (raw * entry) / pos.riskDist,
          equityReturn: eqRet, regime: pos.regime, barsHeld: pos.barsHeld,
          riskDistPct: pos.riskDist / pos.entry,
        });
        equityCurve.push({ time: f.time[i], equity });
        peak = Math.max(peak, equity);
        maxDd = Math.max(maxDd, peak > 0 ? (peak - equity) / peak : 0);
        pos = null;
      } else {
        // ── phase 2: update levels FOR THE NEXT BAR ──
        const rNow = ((side > 0 ? f.c[i] - entry : entry - f.c[i])) / pos.riskDist;
        if (cfg.beAtR !== null && rNow >= cfg.beAtR && !pos.beDone) {
          pos.stop = entry;
          pos.beDone = true;
        }
        if (cfg.trailAtr !== null && rNow >= 1.5 && Number.isFinite(f.atr[i])) {
          const t = f.c[i] - side * cfg.trailAtr * f.atr[i];
          pos.stop = side > 0 ? Math.max(pos.stop, t) : Math.min(pos.stop, t);
        }
      }
    }

    // ── entries, flat only ──
    if (!pos && equity > 0.5) {
      const sig = evaluateSpec(spec, f, i);
      if (sig) {
        if (sig.riskDist / sig.entry >= liq) {
          skippedLiq++;              // stop beyond liquidation is not a stop
        } else {
          pos = {
            bar: i, time: f.time[i], side: sig.side, entry: sig.entry,
            stop: sig.stop, target: sig.target, riskDist: sig.riskDist,
            barsHeld: 0, beDone: false, regime: sig.regime, maxHold: sig.maxHoldBars,
          };
        }
      }
    }
  }

  return {
    trades,
    stats: summarize(trades, maxDd * 100, skippedLiq),
    equityCurve,
    finalEquity: equity,
  };
}

export function summarize(trades: Trade[], maxDdPct = 0, skippedLiq = 0): Stats {
  const r = trades.map(t => t.equityReturn);
  const empty: Stats = {
    n: 0, pf: 0, expectancy: 0, winRate: 0, medianR: 0, maxR: 0, nLosses: 0,
    maxDrawdownPct: maxDdPct,
    reasons: { stop: 0, target: 0, liquidation: 0, timeout: 0, eod: 0 },
    byRegime: {}, skippedStopOutsideLiq: skippedLiq,
  };
  if (!r.length) return empty;

  const wins = r.filter(x => x > 0), losses = r.filter(x => x <= 0);
  const lossSum = Math.abs(losses.reduce((a, b) => a + b, 0));
  const sorted = [...r].sort((a, b) => a - b);
  const reasons = { ...empty.reasons };
  const byRegime: Record<string, { n: number; expectancy: number }> = {};
  for (const t of trades) {
    reasons[t.reason]++;
    const g = byRegime[t.regime] ?? { n: 0, expectancy: 0 };
    g.expectancy = (g.expectancy * g.n + t.equityReturn) / (g.n + 1);
    g.n++;
    byRegime[t.regime] = g;
  }
  return {
    n: r.length,
    pf: lossSum > 1e-12 ? wins.reduce((a, b) => a + b, 0) / lossSum : 0,
    expectancy: r.reduce((a, b) => a + b, 0) / r.length,
    winRate: (wins.length / r.length) * 100,
    medianR: sorted[Math.floor(sorted.length / 2)],
    maxR: Math.max(...r),
    nLosses: losses.length,
    maxDrawdownPct: maxDdPct,
    reasons,
    byRegime,
    skippedStopOutsideLiq: skippedLiq,
  };
}

// ── purged walk-forward ────────────────────────────────────────────────────
//
// Plain k-fold leaks: a trade opened near the end of the train window closes
// inside the test window, so the same trade contributes to both and the split is
// decorative. The purge gap must be >= maxHoldBars.

export function walkForwardFolds(
  nBars: number, warmup: number, nFolds = 4, testFrac = 0.25, purgeBars = 26,
): { train: [number, number]; test: [number, number] }[] {
  const usable = nBars - warmup;
  if (usable < 400) return [];
  const testLen = Math.max(Math.floor((usable * testFrac) / nFolds) * 2, 120);
  const folds: { train: [number, number]; test: [number, number] }[] = [];
  for (let k = 0; k < nFolds; k++) {
    const testEnd = nBars - 1 - k * testLen;
    const testStart = testEnd - testLen;
    const trainEnd = testStart - purgeBars;
    if (trainEnd - warmup < 250) break;
    folds.push({ train: [warmup, trainEnd], test: [testStart, testEnd] });
  }
  return folds.reverse();
}

// ── multiple-testing gate ──────────────────────────────────────────────────
//
// Measured on a strict zero-edge system: best-of-40 at 30 trades gives an
// in-sample profit factor of 2.29 whose out-of-sample profit factor is 1.00.
// A fixed `minPf = 1.3` gate is therefore passed by ~100% of pure noise.
// The bar has to rise with how much you searched.

const NULL_CACHE = new Map<number, Float64Array>();

// The null pf ladder is discrete: with w wins and n-w losses at 2:1 payoff,
// pf = 2w/(n-w), so only n+1 values exist. The gate therefore plateaus at the
// top of that ladder rather than rising smoothly past ~200 trials. That is a
// property of the null, not a bug — but it means at very high trial counts the
// bar is a floor, not a guarantee. Past a few hundred trials in one family, the
// honest move is to pivot, not to keep drawing from it.
function nullPfDistribution(nTrades: number, nSims = 20000, seed = 11): Float64Array {
  const key = Math.max(10, Math.round(nTrades / 10) * 10);
  const cached = NULL_CACHE.get(key);
  if (cached) return cached;
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out = new Float64Array(nSims);
  for (let k = 0; k < nSims; k++) {
    let w = 0, l = 0;
    for (let j = 0; j < key; j++) {
      if (rand() < 1 / 3) w += 2; else l += 1;
    }
    out[k] = l > 1e-9 ? w / l : 99;
  }
  out.sort();
  NULL_CACHE.set(key, out);
  return out;
}

/**
 * Out-of-sample profit factor a strategy must clear to be `confidence` unlikely to
 * be the luckiest of `nTrials` zero-edge candidates.
 *
 *   50 OOS trades:   1 trial → 1.57    50 trials → 2.35    1000 trials → 2.99
 *   200 OOS trades:  1 trial → 1.28    50 trials → 1.57    1000 trials → 1.74
 *
 * Past a few hundred trials the bar becomes unreachable at small trade counts.
 * That is correct — it is the signal to abandon the family, not to lower the bar.
 */
export function requiredPf(nOosTrades: number, nTrials: number, confidence = 0.95): number {
  const dist = nullPfDistribution(nOosTrades);
  const q = Math.min(Math.pow(confidence, 1 / Math.max(1, nTrials)), 0.99995);
  const idx = Math.min(dist.length - 1, Math.floor(q * dist.length));
  return dist[idx];
}

export function walkForward(
  spec: StrategySpec,
  f: Features,
  cfg: RunConfig,
  symbol: string,
  nTrials = 1,
  nFolds = 4,
): WalkForwardResult | null {
  const purge = spec.params.maxHoldBars + 2;
  const folds = walkForwardFolds(f.n, f.warmup, nFolds, 0.25, purge);
  if (!folds.length) return null;

  const foldResults: FoldResult[] = [];
  const allOos: Trade[] = [];
  for (let k = 0; k < folds.length; k++) {
    const { train, test } = folds[k];
    const is = backtest(spec, f, cfg, train);
    const oos = backtest(spec, f, cfg, test);
    allOos.push(...oos.trades);
    foldResults.push({
      fold: k + 1, train, test,
      isPf: is.stats.pf, oosPf: oos.stats.pf,
      oosExpectancy: oos.stats.expectancy, oosN: oos.stats.n,
    });
  }
  if (allOos.length < 12) return null;

  const pooled = summarize(allOos);
  const isPfMean = foldResults.reduce((a, b) => a + b.isPf, 0) / foldResults.length;
  const bar = requiredPf(pooled.n, nTrials);
  const foldsPositive = foldResults.filter(r => r.oosExpectancy > 0).length;

  return {
    specId: '', family: spec.family, symbol,
    folds: foldResults,
    isPfMean,
    oosPfPooled: pooled.pf,
    oosN: pooled.n,
    oosExpectancy: pooled.expectancy,
    foldsPositive,
    overfitGap: isPfMean - pooled.pf,
    requiredPf: bar,
    trialsWhenTested: nTrials,
    passed: pooled.pf >= bar
      && foldsPositive >= Math.max(2, foldResults.length - 1)
      && pooled.expectancy > 0,
    byRegime: pooled.byRegime,
  };
}

// ── engine integrity tests ─────────────────────────────────────────────────

/** Synthetic geometric random walk with a given per-bar volatility. */
export function randomWalkCandles(n: number, vol = 0.018, seed = 5, start = 60000): Candle[] {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const gauss = () => {
    const u = Math.max(rand(), 1e-9), v = Math.max(rand(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const out: Candle[] = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const prev = px;
    px = px * Math.exp(gauss() * vol);
    out.push({
      time: Date.UTC(2024, 0, 1) + i * 4 * 3600_000,
      open: prev,
      high: Math.max(prev, px) * (1 + Math.abs(gauss()) * 0.004),
      low: Math.min(prev, px) * (1 - Math.abs(gauss()) * 0.004),
      close: px,
      volume: 1000 * (1 + rand()),
    });
  }
  return out;
}

/**
 * NULL TEST — the single most important test in the project.
 * On a random walk with no structure, every strategy must come out with expectancy
 * approximately equal to minus the cost. Anything positive means the engine still
 * has a hole. Run after every change to backtest() or features.ts.
 */
export function nullTest(
  specs: StrategySpec[], cfg: RunConfig, nBars = 3000,
): { ok: boolean; mean: number; median: number; max: number; expected: number; n: number } {
  const candles = randomWalkCandles(nBars);
  const f = new Features(candles, { tfHours: cfg.tfHours });
  const expected = -roundTripCostEquity(cfg);
  const vals: number[] = [];
  for (const s of specs) {
    const r = backtest(s, f, cfg);
    if (r.stats.n >= 15) vals.push(r.stats.expectancy);
  }
  if (!vals.length) return { ok: false, mean: 0, median: 0, max: 0, expected, n: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  return {
    ok: mean < 0.005,
    mean,
    median: sorted[Math.floor(sorted.length / 2)],
    max: Math.max(...vals),
    expected,
    n: vals.length,
  };
}

/** Shuffling bars must destroy any edge. If it survives, it was a sizing artefact. */
export function shuffleTest(
  spec: StrategySpec, candles: Candle[], cfg: RunConfig, seed = 9,
): { real: number; shuffled: number } {
  const real = backtest(spec, new Features(candles, { tfHours: cfg.tfHours }), cfg);
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const shuf = candles.map(c => ({ ...c }));
  for (let i = shuf.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = shuf[i], b = shuf[j];
    [a.open, b.open] = [b.open, a.open];
    [a.high, b.high] = [b.high, a.high];
    [a.low, b.low] = [b.low, a.low];
    [a.close, b.close] = [b.close, a.close];
  }
  const sh = backtest(spec, new Features(shuf, { tfHours: cfg.tfHours }), cfg);
  return { real: real.stats.expectancy, shuffled: sh.stats.expectancy };
}
