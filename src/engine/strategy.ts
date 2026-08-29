// ── Xenia Engine — Strategy grammar ───────────────────────────────────────
//
// WHY A GRAMMAR INSTEAD OF FREE-FORM CODE
//
// Every serious bug in this project came from a detector written on the fly:
// a HOLD that returned `stop: 0` and let shorts exit at price zero; a "double top"
// whose neckline was the lowest low of the whole window (so the short only fired
// when price was already at the bottom of the range); a break-even that peeked at
// the same bar's high. Free-form strategy code is where those enter.
//
// So a strategy is DATA, not code. It picks a trigger, up to a couple of context
// filters, an optional confirmation, a stop rule and an exit rule — all from the
// verified sets below. The resulting object cannot express an invalid stop, cannot
// read an array beyond the current bar, and cannot surprise the simulator.
//
// Creativity belongs in WHICH combination to try next, not in reimplementing a
// fair value gap for the fortieth time.

import { Features } from './features';
import { FamilyName, Signal, SpecParams, StrategySpec, Side } from './types';

export const DEFAULT_PARAMS: SpecParams = {
  minSweepDepthAtr: 0.15,
  minPocDist: 1.0,
  maxHoldBars: 24,
};

type Pred = (f: Features, i: number, p: SpecParams) => boolean;

export const TRIGGERS: Record<string, { side: Side; label: string; fn: Pred }> = {
  // ── liquidity ──────────────────────────────────────────────────────────
  sweep_low: {
    side: 1, label: 'Sweep of swing low + reclaim',
    fn: (f, i, p) => f.sweepLow[i] === 1 && f.sweepLowDepthAtr[i] >= p.minSweepDepthAtr,
  },
  sweep_high: {
    side: -1, label: 'Sweep of swing high + rejection',
    fn: (f, i, p) => f.sweepHigh[i] === 1 && f.sweepHighDepthAtr[i] >= p.minSweepDepthAtr,
  },
  eql_sweep: {
    side: 1, label: 'Equal lows swept (stop pool)',
    fn: (f, i) => f.sweepLow[i] === 1 && f.equalLows[i] === 1,
  },
  eqh_sweep: {
    side: -1, label: 'Equal highs swept (stop pool)',
    fn: (f, i) => f.sweepHigh[i] === 1 && f.equalHighs[i] === 1,
  },
  pdl_reclaim: {
    side: 1, label: 'Prior day low swept + reclaimed',
    fn: (f, i) => f.l[i] < f.priorDayLow[i] && f.c[i] > f.priorDayLow[i],
  },
  pdh_reject: {
    side: -1, label: 'Prior day high swept + rejected',
    fn: (f, i) => f.h[i] > f.priorDayHigh[i] && f.c[i] < f.priorDayHigh[i],
  },
  // ── structure ──────────────────────────────────────────────────────────
  choch_up: { side: 1, label: 'Change of character up', fn: (f, i) => f.chochUp[i] === 1 },
  choch_down: { side: -1, label: 'Change of character down', fn: (f, i) => f.chochDown[i] === 1 },
  bos_up_retest: {
    side: 1, label: 'Break of structure up, retest',
    fn: (f, i) => {
      if (f.trendState[i] <= 0 || f.c[i] > f.lastSh[i]) return false;
      for (let k = Math.max(i - 6, 0); k <= i; k++) if (f.bosUp[k] === 1) return true;
      return false;
    },
  },
  bos_down_retest: {
    side: -1, label: 'Break of structure down, retest',
    fn: (f, i) => {
      if (f.trendState[i] >= 0 || f.c[i] < f.lastSl[i]) return false;
      for (let k = Math.max(i - 6, 0); k <= i; k++) if (f.bosDown[k] === 1) return true;
      return false;
    },
  },
  // ── imbalance / zones ──────────────────────────────────────────────────
  bull_fvg_fill: { side: 1, label: 'Bullish FVG filled', fn: (f, i) => f.inBullFvg[i] === 1 },
  bear_fvg_fill: { side: -1, label: 'Bearish FVG filled', fn: (f, i) => f.inBearFvg[i] === 1 },
  bull_ob_tap: { side: 1, label: 'Bullish order block tapped', fn: (f, i) => f.atBullOb[i] === 1 },
  bear_ob_tap: { side: -1, label: 'Bearish order block tapped', fn: (f, i) => f.atBearOb[i] === 1 },
  // ── value ──────────────────────────────────────────────────────────────
  poc_revert_up: {
    side: 1, label: 'Below value, reverting to POC',
    fn: (f, i, p) => f.belowValue[i] === 1 && f.c[i] > f.c[i - 1] && f.pocDistAtr[i] < -p.minPocDist,
  },
  poc_revert_down: {
    side: -1, label: 'Above value, reverting to POC',
    fn: (f, i, p) => f.aboveValue[i] === 1 && f.c[i] < f.c[i - 1] && f.pocDistAtr[i] > p.minPocDist,
  },
  avwap_bounce: {
    side: 1, label: 'Anchored VWAP bounce in uptrend',
    fn: (f, i) => f.atAvwap[i] === 1 && f.trendState[i] > 0,
  },
  avwap_reject: {
    side: -1, label: 'Anchored VWAP rejection in downtrend',
    fn: (f, i) => f.atAvwap[i] === 1 && f.trendState[i] < 0,
  },
  // ── momentum ───────────────────────────────────────────────────────────
  div_bull: { side: 1, label: 'Regular bullish divergence', fn: (f, i) => f.divRegularBull[i] === 1 },
  div_bear: { side: -1, label: 'Regular bearish divergence', fn: (f, i) => f.divRegularBear[i] === 1 },
  hidden_div_bull: {
    side: 1, label: 'Hidden bullish divergence (continuation)',
    fn: (f, i) => f.divHiddenBull[i] === 1 && f.trendState[i] > 0,
  },
  hidden_div_bear: {
    side: -1, label: 'Hidden bearish divergence (continuation)',
    fn: (f, i) => f.divHiddenBear[i] === 1 && f.trendState[i] < 0,
  },
};

export const CONTEXTS: Record<string, { label: string; fn: Pred }> = {
  in_discount: { label: 'In discount (lower half of range)', fn: (f, i) => f.inDiscount[i] === 1 },
  in_premium: { label: 'In premium (upper half of range)', fn: (f, i) => f.inPremium[i] === 1 },
  below_value: { label: 'Below value area', fn: (f, i) => f.belowValue[i] === 1 },
  above_value: { label: 'Above value area', fn: (f, i) => f.aboveValue[i] === 1 },
  trend_up: { label: 'Uptrend (HH + HL)', fn: (f, i) => f.trendState[i] > 0 },
  trend_down: { label: 'Downtrend (LH + LL)', fn: (f, i) => f.trendState[i] < 0 },
  range_only: { label: 'Range (no trend)', fn: (f, i) => f.trendState[i] === 0 },
  not_highvol: { label: 'Not high volatility', fn: (f, i) => f.volRegime[i] !== 2 },
  vol_expanding: { label: 'Volatility expanding', fn: (f, i) => f.volRegime[i] === 2 },
  squeeze: { label: 'Volatility squeeze', fn: (f, i) => f.squeeze[i] === 1 },
  above_avwap: { label: 'Above anchored VWAP', fn: (f, i) => f.c[i] > f.avwapSwing[i] },
  below_avwap: { label: 'Below anchored VWAP', fn: (f, i) => f.c[i] < f.avwapSwing[i] },
  rsi_oversold: { label: 'RSI < 35', fn: (f, i) => f.rsi[i] < 35 },
  rsi_overbought: { label: 'RSI > 65', fn: (f, i) => f.rsi[i] > 65 },
};

export const CONFIRMS: Record<string, { label: string; fn: Pred }> = {
  none: { label: 'No confirmation', fn: () => true },
  engulf_bull: { label: 'Bullish engulfing', fn: (f, i) => f.engulfBull[i] === 1 },
  engulf_bear: { label: 'Bearish engulfing', fn: (f, i) => f.engulfBear[i] === 1 },
  pin_bull: { label: 'Bullish pin bar', fn: (f, i) => f.pinBull[i] === 1 },
  pin_bear: { label: 'Bearish pin bar', fn: (f, i) => f.pinBear[i] === 1 },
  displacement_up: { label: 'Up displacement', fn: (f, i) => f.displacement[i] > 0 },
  displacement_down: { label: 'Down displacement', fn: (f, i) => f.displacement[i] < 0 },
  close_above_open: { label: 'Green candle', fn: (f, i) => f.c[i] > f.o[i] },
  close_below_open: { label: 'Red candle', fn: (f, i) => f.c[i] < f.o[i] },
};

export const FAMILIES: Record<FamilyName, string[]> = {
  sweep_reclaim: ['sweep_low', 'sweep_high', 'eql_sweep', 'eqh_sweep', 'pdl_reclaim', 'pdh_reject'],
  structure: ['choch_up', 'choch_down', 'bos_up_retest', 'bos_down_retest'],
  imbalance: ['bull_fvg_fill', 'bear_fvg_fill', 'bull_ob_tap', 'bear_ob_tap'],
  value: ['poc_revert_up', 'poc_revert_down', 'avwap_bounce', 'avwap_reject'],
  momentum: ['div_bull', 'div_bear', 'hidden_div_bull', 'hidden_div_bear'],
};

// ── stop / exit distance ───────────────────────────────────────────────────

function stopDistance(spec: StrategySpec, f: Features, i: number, side: Side): number {
  const a = f.atr[i];
  const pad = spec.stop.padAtr ?? 0.3;
  const mult = spec.stop.mult ?? 1.5;
  switch (spec.stop.kind) {
    case 'swing': {
      const lvl = side > 0 ? f.lastSl[i] : f.lastSh[i];
      return Math.abs(f.c[i] - lvl) + pad * a;
    }
    case 'bar': {
      const lvl = side > 0 ? f.l[i] : f.h[i];
      return Math.abs(f.c[i] - lvl) + pad * a;
    }
    case 'structure': {
      const lvl = side > 0 ? f.rangeLow[i] : f.rangeHigh[i];
      return Math.abs(f.c[i] - lvl) + pad * a;
    }
    default:
      return mult * a;
  }
}

function rewardDistance(
  spec: StrategySpec, f: Features, i: number, side: Side, riskDist: number,
): number {
  const rr = spec.exit.rr ?? 2;
  switch (spec.exit.kind) {
    case 'poc': return Math.abs(f.poc[i] - f.c[i]);
    case 'avwap': return Math.abs(f.avwapSwing[i] - f.c[i]);
    case 'opposite': return Math.abs((side > 0 ? f.lastSh[i] : f.lastSl[i]) - f.c[i]);
    case 'valueEdge': return Math.abs((side > 0 ? f.vah[i] : f.val[i]) - f.c[i]);
    default: return rr * riskDist;
  }
}

/**
 * Evaluate a spec at bar i. Returns null if it does not fire.
 *
 * Structural guarantees: stop is never 0, NaN or on the wrong side of entry;
 * riskDist is always positive and finite; nothing reads past index i.
 */
export function evaluateSpec(spec: StrategySpec, f: Features, i: number): Signal | null {
  if (i < 1 || i >= f.n) return null;
  const p = { ...DEFAULT_PARAMS, ...spec.params };
  const trig = TRIGGERS[spec.trigger];
  if (!trig) return null;
  const side = trig.side;

  if (!trig.fn(f, i, p)) return null;
  for (const ctx of spec.context) {
    const c = CONTEXTS[ctx];
    if (!c || !c.fn(f, i, p)) return null;
  }
  const conf = CONFIRMS[spec.confirm ?? 'none'];
  if (!conf || !conf.fn(f, i, p)) return null;

  const entry = f.c[i];
  const a = f.atr[i];
  if (!(a > 0) || !(entry > 0)) return null;

  let riskDist = stopDistance(spec, f, i, side);
  if (!Number.isFinite(riskDist) || riskDist <= 0) return null;
  // a stop wider than 6 ATR is not a stop, it is hope
  riskDist = Math.min(Math.max(riskDist, 0.35 * a), 6 * a);

  let reward = rewardDistance(spec, f, i, side, riskDist);
  if (!Number.isFinite(reward) || reward <= 0) reward = (spec.exit.rr ?? 2) * riskDist;
  reward = Math.max(reward, 0.8 * riskDist);   // never take a sub-0.8R target

  const stop = entry - side * riskDist;
  const target = entry + side * reward;
  if (!(stop > 0) || !(target > 0)) return null;

  return {
    side, entry, stop, target, riskDist,
    reason: `${spec.trigger}|${spec.context.join('+') || 'any'}|${spec.confirm ?? 'none'}`,
    regime: f.regime[i],
    maxHoldBars: p.maxHoldBars,
  };
}

export function specId(spec: StrategySpec): string {
  const p = spec.params ?? {};
  const ps = Object.keys(p).sort().map(k => `${k}=${p[k]}`).join(',');
  return [
    spec.trigger,
    spec.context.join('+') || 'any',
    spec.confirm ?? 'none',
    spec.stop.kind + (spec.stop.mult ?? spec.stop.padAtr ?? ''),
    spec.exit.kind + (spec.exit.rr ?? ''),
    ps,
  ].join('__');
}

export function describeSpec(spec: StrategySpec): string {
  const t = TRIGGERS[spec.trigger]?.label ?? spec.trigger;
  const ctx = spec.context.map(c => CONTEXTS[c]?.label ?? c).join(', ');
  const cf = spec.confirm && spec.confirm !== 'none' ? CONFIRMS[spec.confirm]?.label : null;
  const parts = [t];
  if (ctx) parts.push(`only when ${ctx}`);
  if (cf) parts.push(`confirmed by ${cf}`);
  parts.push(`stop ${spec.stop.kind}`, `exit ${spec.exit.kind}${spec.exit.rr ? ' ' + spec.exit.rr + 'R' : ''}`);
  return parts.join(' · ');
}

/** Full composition space for a family, side-filtered so combinations make sense. */
export function enumerateSpecs(family: FamilyName, seed = 0): StrategySpec[] {
  const ctxPool = ['any', 'trend_up', 'trend_down', 'range_only', 'in_discount',
    'in_premium', 'not_highvol', 'below_value', 'above_value', 'squeeze',
    'above_avwap', 'below_avwap'];
  const confirms = Object.keys(CONFIRMS);
  const stops: StrategySpec['stop'][] = [
    { kind: 'swing', padAtr: 0.3 }, { kind: 'atr', mult: 1.5 },
    { kind: 'atr', mult: 2.5 }, { kind: 'bar', padAtr: 0.25 },
  ];
  const exits: StrategySpec['exit'][] = [
    { kind: 'rr', rr: 1.5 }, { kind: 'rr', rr: 2 }, { kind: 'rr', rr: 3 },
    { kind: 'poc' }, { kind: 'avwap' }, { kind: 'opposite' },
  ];
  const longBad = ['trend_down', 'in_premium', 'above_value'];
  const shortBad = ['trend_up', 'in_discount', 'below_value'];
  const longBadC = ['engulf_bear', 'pin_bear', 'displacement_down', 'close_below_open'];
  const shortBadC = ['engulf_bull', 'pin_bull', 'displacement_up', 'close_above_open'];

  const out: StrategySpec[] = [];
  for (const trigger of FAMILIES[family]) {
    const side = TRIGGERS[trigger].side;
    const ctxs = ctxPool.filter(c =>
      !(side > 0 && longBad.includes(c)) && !(side < 0 && shortBad.includes(c)));
    const cfs = confirms.filter(c =>
      !(side > 0 && longBadC.includes(c)) && !(side < 0 && shortBadC.includes(c)));
    for (const ctx of ctxs) for (const cf of cfs) for (const st of stops) for (const ex of exits) {
      out.push({
        family, trigger,
        context: ctx === 'any' ? [] : [ctx],
        confirm: cf, stop: { ...st }, exit: { ...ex },
        params: { ...DEFAULT_PARAMS },
      });
    }
  }
  // deterministic shuffle so exploration order is reproducible
  let s = seed || 1;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Local search around a spec that showed promise. */
export function mutateSpec(spec: StrategySpec, rand: () => number): StrategySpec {
  const s: StrategySpec = JSON.parse(JSON.stringify(spec));
  const choice = ['rr', 'stop', 'context', 'confirm', 'hold'][Math.floor(rand() * 5)];
  if (choice === 'rr' && s.exit.kind === 'rr') {
    s.exit.rr = Math.max(1, (s.exit.rr ?? 2) + (rand() < 0.5 ? -0.5 : 0.5));
  } else if (choice === 'stop') {
    if (s.stop.kind === 'atr') s.stop.mult = Math.max(0.5, (s.stop.mult ?? 1.5) + (rand() < 0.5 ? -0.5 : 0.5));
    else s.stop.padAtr = Math.max(0, (s.stop.padAtr ?? 0.3) + (rand() < 0.5 ? -0.15 : 0.15));
  } else if (choice === 'context') {
    const pool = Object.keys(CONTEXTS);
    s.context = rand() < 0.7 ? [pool[Math.floor(rand() * pool.length)]] : [];
  } else if (choice === 'confirm') {
    const pool = Object.keys(CONFIRMS);
    s.confirm = pool[Math.floor(rand() * pool.length)];
  } else {
    s.params.maxHoldBars = Math.max(6, s.params.maxHoldBars + [-6, 6, 12][Math.floor(rand() * 3)]);
  }
  return s;
}
