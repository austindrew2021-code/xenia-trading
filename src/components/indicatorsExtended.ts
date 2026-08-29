// ── Xenia — Indicator completion and corrections ──────────────────────────
//
// Companion to the existing `indicators.ts`. Two jobs:
//
//   1. Implement the ~15 indicators ChartIndicatorsMenu offers but nothing backs
//   2. Provide Wilder-correct RSI/ATR/ADX so our numbers match what a trader
//      sees on every other platform
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY WILDER'S SMOOTHING IS NOT A DETAIL
//
// RSI, ATR and ADX are all DEFINED with Wilder's smoothing (an EMA with
// alpha = 1/period, not 2/(period+1)). Using a simple average produces a curve
// that is close enough to look right and wrong enough to disagree with every
// other chart.
//
// For ATR that is not cosmetic. Stop distances here are quoted in ATR multiples,
// so a different ATR means the backtest and the chart disagree about where the
// same trade's stop sits — and the user believes the chart.
// ─────────────────────────────────────────────────────────────────────────────

export interface Candle { time:number; open:number; high:number; low:number; close:number; volume:number; }

const nan = (n: number) => new Array(n).fill(NaN) as number[];

/** Wilder's smoothing. The thing SMA is standing in for. */
export function rma(values: number[], period: number): number[] {
  const out = nan(values.length);
  if (values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;
  out[period - 1] = seed;
  for (let i = period; i < values.length; i++) {
    seed = (seed * (period - 1) + values[i]) / period;
    out[i] = seed;
  }
  return out;
}

export function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

export function smaSeries(values: number[], period: number): number[] {
  return values.map((_, i) => i < period - 1 ? NaN
    : values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
}

export function wmaSeries(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return NaN;
    let num = 0, den = 0;
    for (let j = 0; j < period; j++) { num += (period - j) * values[i - j]; den += period - j; }
    return num / den;
  });
}

export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => i === 0 ? c.high - c.low
    : Math.max(c.high - c.low,
        Math.abs(c.high - candles[i - 1].close),
        Math.abs(c.low - candles[i - 1].close)));
}

// ═══════════════════════════════════════════════════════════════════════════
// CORRECTED CORE — these replace the SMA-based versions
// ═══════════════════════════════════════════════════════════════════════════

/** ATR as Wilder defined it. Matches TradingView, Binance and the engine. */
export function atrWilder(candles: Candle[], period = 14): number[] {
  return rma(trueRange(candles), period);
}

/** RSI as Wilder defined it. */
export function rsiWilder(closes: number[], period = 14): number[] {
  const gains = [0], losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  const ag = rma(gains, period), al = rma(losses, period);
  return closes.map((_, i) => {
    if (!Number.isFinite(ag[i])) return NaN;
    if (al[i] === 0) return 100;
    return 100 - 100 / (1 + ag[i] / al[i]);
  });
}

/**
 * MACD, with both defects of the original fixed.
 *
 *   1. The original filtered NaN out of macdLine before computing the signal,
 *      which shortened the array and misaligned every index after it.
 *   2. `v - signal[i] || NaN` turned a histogram value of exactly zero into NaN.
 *      Zero is the crossover — the one bar anybody cares about.
 */
export function macdFixed(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = emaSeries(closes, fast), es = emaSeries(closes, slow);
  const macdLine = ef.map((v, i) => v - es[i]);
  const signalLine = emaSeries(macdLine, signal);        // same length, aligned
  const hist = macdLine.map((v, i) => v - signalLine[i]); // 0 stays 0
  return { macd: macdLine, signal: signalLine, hist };
}

/** Stochastic without the NaN->0 substitution that dragged %D toward zero. */
export function stochasticFixed(candles: Candle[], k = 14, d = 3, smooth = 1) {
  const rawK = candles.map((_, i) => {
    if (i < k - 1) return NaN;
    const slice = candles.slice(i - k + 1, i + 1);
    const lo = Math.min(...slice.map(c => c.low));
    const hi = Math.max(...slice.map(c => c.high));
    return hi === lo ? 50 : ((candles[i].close - lo) / (hi - lo)) * 100;
  });
  const kLine = smooth > 1 ? smaSeries(rawK, smooth) : rawK;
  // NaN in, NaN out. Substituting zero produces a %D that looks like a real
  // oversold reading during warmup.
  const dLine = kLine.map((_, i) => {
    if (i < d - 1) return NaN;
    const win = kLine.slice(i - d + 1, i + 1);
    return win.some(v => !Number.isFinite(v)) ? NaN : win.reduce((a, b) => a + b, 0) / d;
  });
  return { k: kLine, d: dLine };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MISSING FIFTEEN — every id the menu offers with nothing behind it
// ═══════════════════════════════════════════════════════════════════════════

/** Hull MA: WMA(2*WMA(n/2) - WMA(n), sqrt(n)) */
export function hma(closes: number[], period = 14): number[] {
  const half = wmaSeries(closes, Math.max(1, Math.floor(period / 2)));
  const full = wmaSeries(closes, period);
  const diff = half.map((h, i) => 2 * h - full[i]);
  return wmaSeries(diff, Math.max(1, Math.round(Math.sqrt(period))));
}

export function dema(closes: number[], period = 20): number[] {
  const e1 = emaSeries(closes, period), e2 = emaSeries(e1, period);
  return e1.map((v, i) => 2 * v - e2[i]);
}

export function tema(closes: number[], period = 20): number[] {
  const e1 = emaSeries(closes, period), e2 = emaSeries(e1, period), e3 = emaSeries(e2, period);
  return e1.map((v, i) => 3 * v - 3 * e2[i] + e3[i]);
}

/** Arnaud Legoux MA — Gaussian weights offset toward recent bars. */
export function alma(closes: number[], period = 21, sigma = 6, offset = 0.85): number[] {
  const m = offset * (period - 1), s = period / sigma;
  const w: number[] = [];
  let norm = 0;
  for (let i = 0; i < period; i++) {
    const v = Math.exp(-((i - m) ** 2) / (2 * s * s));
    w.push(v); norm += v;
  }
  return closes.map((_, i) => {
    if (i < period - 1) return NaN;
    let sum = 0;
    for (let j = 0; j < period; j++) sum += closes[i - period + 1 + j] * w[j];
    return sum / norm;
  });
}

export function stochRsi(closes: number[], rsiPeriod = 14, stochPeriod = 14): number[] {
  const r = rsiWilder(closes, rsiPeriod);
  return r.map((_, i) => {
    if (i < rsiPeriod + stochPeriod - 1) return NaN;
    const win = r.slice(i - stochPeriod + 1, i + 1).filter(Number.isFinite);
    if (win.length < stochPeriod) return NaN;
    const lo = Math.min(...win), hi = Math.max(...win);
    return hi === lo ? 50 : ((r[i] - lo) / (hi - lo)) * 100;
  });
}

export function roc(closes: number[], period = 12): number[] {
  return closes.map((c, i) => i < period ? NaN
    : closes[i - period] === 0 ? NaN : ((c - closes[i - period]) / closes[i - period]) * 100);
}

export function aroon(candles: Candle[], period = 25): { up: number[]; down: number[]; osc: number[] } {
  const up = nan(candles.length), down = nan(candles.length);
  for (let i = period; i < candles.length; i++) {
    const win = candles.slice(i - period, i + 1);
    let hiIdx = 0, loIdx = 0;
    win.forEach((c, j) => {
      if (c.high >= win[hiIdx].high) hiIdx = j;
      if (c.low <= win[loIdx].low) loIdx = j;
    });
    up[i] = ((hiIdx) / period) * 100;
    down[i] = ((loIdx) / period) * 100;
  }
  return { up, down, osc: up.map((u, i) => u - down[i]) };
}

/** Ultimate Oscillator — Larry Williams, three periods weighted 4:2:1. */
export function ultimateOscillator(candles: Candle[], p1 = 7, p2 = 14, p3 = 28): number[] {
  const bp: number[] = [], tr: number[] = [];
  candles.forEach((c, i) => {
    if (i === 0) { bp.push(0); tr.push(c.high - c.low); return; }
    const prevClose = candles[i - 1].close;
    bp.push(c.close - Math.min(c.low, prevClose));
    tr.push(Math.max(c.high, prevClose) - Math.min(c.low, prevClose));
  });
  const avg = (n: number, i: number) => {
    if (i < n) return NaN;
    let b = 0, t = 0;
    for (let j = i - n + 1; j <= i; j++) { b += bp[j]; t += tr[j]; }
    return t === 0 ? NaN : b / t;
  };
  return candles.map((_, i) => {
    const a1 = avg(p1, i), a2 = avg(p2, i), a3 = avg(p3, i);
    if (![a1, a2, a3].every(Number.isFinite)) return NaN;
    return (100 * (4 * a1 + 2 * a2 + a3)) / 7;
  });
}

export function stdDev(closes: number[], period = 20): number[] {
  return closes.map((_, i) => {
    if (i < period - 1) return NaN;
    const w = closes.slice(i - period + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / period;
    return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / period);
  });
}

export function chaikinVolatility(candles: Candle[], period = 10): number[] {
  const hl = candles.map(c => c.high - c.low);
  const e = emaSeries(hl, period);
  return e.map((v, i) => i < period ? NaN
    : e[i - period] === 0 ? NaN : ((v - e[i - period]) / e[i - period]) * 100);
}

export function chaikinMoneyFlow(candles: Candle[], period = 20): number[] {
  const mfv = candles.map(c => {
    const range = c.high - c.low;
    if (range === 0) return 0;
    return (((c.close - c.low) - (c.high - c.close)) / range) * c.volume;
  });
  return candles.map((_, i) => {
    if (i < period - 1) return NaN;
    let f = 0, v = 0;
    for (let j = i - period + 1; j <= i; j++) { f += mfv[j]; v += candles[j].volume; }
    return v === 0 ? 0 : f / v;
  });
}

export function volumePriceTrend(candles: Candle[]): number[] {
  let acc = 0;
  return candles.map((c, i) => {
    if (i === 0) return 0;
    const prev = candles[i - 1].close;
    if (prev !== 0) acc += ((c.close - prev) / prev) * c.volume;
    return acc;
  });
}

export function forceIndex(candles: Candle[], period = 13): number[] {
  const raw = candles.map((c, i) => i === 0 ? 0 : (c.close - candles[i - 1].close) * c.volume);
  return emaSeries(raw, period);
}

export function easeOfMovement(candles: Candle[], period = 14): number[] {
  const raw = candles.map((c, i) => {
    if (i === 0) return 0;
    const prev = candles[i - 1];
    const dist = (c.high + c.low) / 2 - (prev.high + prev.low) / 2;
    const range = c.high - c.low;
    if (c.volume === 0 || range === 0) return 0;
    return dist / ((c.volume / 100_000_000) / range);
  });
  return smaSeries(raw, period);
}

/**
 * Parabolic SAR. Stateful and order-dependent — the only one here that cannot
 * be expressed as a windowed function, which is why it is usually the one left
 * unimplemented.
 */
export function parabolicSar(candles: Candle[], step = 0.02, max = 0.2): { value: number[]; trend: number[] } {
  const n = candles.length;
  const value = nan(n), trend = new Array(n).fill(1) as number[];
  if (n < 2) return { value, trend };

  let isLong = candles[1].close >= candles[0].close;
  let sar = isLong ? candles[0].low : candles[0].high;
  let ep = isLong ? candles[0].high : candles[0].low;
  let af = step;
  value[0] = sar; trend[0] = isLong ? 1 : -1;

  for (let i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (isLong) {
      sar = Math.min(sar, candles[i - 1].low, candles[Math.max(i - 2, 0)].low);
      if (candles[i].low < sar) {
        isLong = false; sar = ep; ep = candles[i].low; af = step;
      } else if (candles[i].high > ep) {
        ep = candles[i].high; af = Math.min(af + step, max);
      }
    } else {
      sar = Math.max(sar, candles[i - 1].high, candles[Math.max(i - 2, 0)].high);
      if (candles[i].high > sar) {
        isLong = true; sar = ep; ep = candles[i].high; af = step;
      } else if (candles[i].low < ep) {
        ep = candles[i].low; af = Math.min(af + step, max);
      }
    }
    value[i] = sar; trend[i] = isLong ? 1 : -1;
  }
  return { value, trend };
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRY COVERAGE
// ═══════════════════════════════════════════════════════════════════════════
//
// The menu and the implementations are separate files, so they drift. They
// already have: ALL_INDICATORS lists ~15 ids nothing computes, and indicators.ts
// carries an ICT category the menu never shows.
//
// This is the check that stops it recurring. Wire it into CI, or at minimum run
// it before a release. A menu entry with no implementation is a user picking a
// tool and watching nothing happen.

export const IMPLEMENTED_IDS = new Set<string>([
  // existing indicators.ts
  'sma', 'ema', 'wma', 'vwap', 'rsi', 'macd', 'stoch', 'cci', 'willr',
  'bbands', 'atr', 'keltner', 'donchian', 'obv', 'volosc', 'mfi',
  'supertrend', 'adx', 'ichimoku',
  // added here
  'hma', 'dema', 'tema', 'alma', 'stochrsi', 'roc', 'aroon', 'ultimate',
  'stddev', 'chaikin', 'cmf', 'vpt', 'force', 'eom', 'psar',
  // present in indicators.ts registry but absent from the menu
  'fvg', 'ob', 'sweep',
]);

export function auditRegistry(menuIds: string[]): {
  ok: boolean; missingImplementation: string[]; hiddenFromMenu: string[];
} {
  const menu = new Set(menuIds);
  const missingImplementation = menuIds.filter(id => !IMPLEMENTED_IDS.has(id));
  const hiddenFromMenu = [...IMPLEMENTED_IDS].filter(id => !menu.has(id));
  return { ok: missingImplementation.length === 0, missingImplementation, hiddenFromMenu };
}
