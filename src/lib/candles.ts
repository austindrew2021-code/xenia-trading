// ── Xenia — Candle sanitiser ───────────────────────────────────────────────
//
// Everything that reaches a lightweight-charts series goes through here first.
//
// WHY THIS EXISTS
//   The chart throws `Value is null` from inside its renderer when a bar is
//   partially populated — `{ time, open: 123, high: null, low: 4, close: 5 }`.
//   A bar with *no* OHLC at all is legal whitespace and draws as a gap; a bar
//   with some fields present and some missing is a fault, and the error surfaces
//   during paint with a minified stack that names nothing useful.
//
//   Feeds produce these routinely: a gap in GeckoTerminal history, a pump.fun
//   token with no trades in a bucket, a bar that has not closed yet, a JSON
//   number that arrived as a string and became NaN. None of those are bugs in
//   the chart, and none of them should reach it.
//
// THE FOUR INVARIANTS lightweight-charts ACTUALLY REQUIRES
//   1. Every OHLC value is a finite number. NaN and Infinity throw, and NaN in
//      particular survives arithmetic silently until it hits the renderer.
//   2. `time` is a finite number of SECONDS, not milliseconds. Feeding ms puts
//      your bars in the year 56000 and the chart renders blank with no error —
//      the worst failure mode here, because it looks like "no data".
//   3. Times strictly ascend with no duplicates. Out-of-order data throws
//      `Cannot update oldest data`, duplicates silently drop bars.
//   4. high >= max(open, close) and low <= min(open, close). A feed that
//      violates this draws inverted wicks rather than throwing, so it is worth
//      repairing rather than dropping.
//
// This module drops what it cannot repair and repairs what it can, and reports
// what it did so a silently-empty chart can be told apart from a healthy one.

export interface RawCandle {
  time?: number | string | null;
  timestamp?: number | string | null;
  t?: number | string | null;
  open?: number | string | null;
  high?: number | string | null;
  low?: number | string | null;
  close?: number | string | null;
  o?: number | string | null;
  h?: number | string | null;
  l?: number | string | null;
  c?: number | string | null;
  volume?: number | string | null;
  v?: number | string | null;
}

export interface Candle {
  time: number;      // UTC seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SanitizeReport {
  kept: number;
  droppedNonFinite: number;
  droppedBadTime: number;
  droppedDuplicate: number;
  reordered: boolean;
  repairedWicks: number;
  /** Non-null when the result is unusable and the caller should show a message. */
  fatal: string | null;
}

/** Coerce to a finite number or null. Strings from JSON feeds are common. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Seconds vs milliseconds, decided by magnitude rather than by trusting the
 * feed's documentation. 1e11 seconds is the year 5138; anything at or above it
 * was milliseconds. Anything below ~1e8 is not a plausible modern timestamp.
 */
function toSeconds(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  const secs = n >= 1e11 ? Math.floor(n / 1000) : Math.floor(n);
  if (secs < 1e8 || secs > 4e9) return null;   // ~1973 to ~2096
  return secs;
}

export function sanitizeCandles(raw: readonly RawCandle[] | null | undefined): {
  candles: Candle[]; report: SanitizeReport;
} {
  const report: SanitizeReport = {
    kept: 0, droppedNonFinite: 0, droppedBadTime: 0, droppedDuplicate: 0,
    reordered: false, repairedWicks: 0, fatal: null,
  };

  if (!Array.isArray(raw) || raw.length === 0) {
    report.fatal = 'No candle data was returned for this market.';
    return { candles: [], report };
  }

  const out: Candle[] = [];

  for (const r of raw) {
    const time = toSeconds(r.time ?? r.timestamp ?? r.t);
    if (time === null) { report.droppedBadTime++; continue; }

    const open = num(r.open ?? r.o);
    const high = num(r.high ?? r.h);
    const low = num(r.low ?? r.l);
    const close = num(r.close ?? r.c);

    // All four or none. A partial bar is the thing that throws, and there is no
    // honest way to invent the missing side — interpolating would draw a price
    // that never traded, which then feeds the backtest.
    if (open === null || high === null || low === null || close === null) {
      report.droppedNonFinite++;
      continue;
    }
    if (open <= 0 || close <= 0) { report.droppedNonFinite++; continue; }

    let h = high, l = low;
    const needMax = Math.max(open, close);
    const needMin = Math.min(open, close);
    if (h < needMax || l > needMin) {
      h = Math.max(h, needMax);
      l = Math.min(l, needMin);
      report.repairedWicks++;
    }

    out.push({ time, open, high: h, low: l, close, volume: num(r.volume ?? r.v) ?? 0 });
  }

  // Sort before dedupe so "last write wins" means the latest bar in feed order
  // for a given timestamp, which is what a live-updating last bar needs.
  for (let i = 1; i < out.length; i++) {
    if (out[i].time < out[i - 1].time) { report.reordered = true; break; }
  }
  if (report.reordered) out.sort((a, b) => a.time - b.time);

  const deduped: Candle[] = [];
  for (const c of out) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.time === c.time) {
      deduped[deduped.length - 1] = c;
      report.droppedDuplicate++;
    } else {
      deduped.push(c);
    }
  }

  report.kept = deduped.length;
  if (deduped.length === 0) {
    report.fatal = 'Every candle in the response was malformed. The feed is returning '
      + 'data this chart cannot draw.';
  } else if (deduped.length < 2) {
    report.fatal = 'Only one usable candle. Not enough to draw a chart.';
  }

  return { candles: deduped, report };
}

/** Candlestick series payload. Times are already seconds. */
export function toCandlestickData(candles: readonly Candle[]) {
  return candles.map(c => ({
    time: c.time as never,
    open: c.open, high: c.high, low: c.low, close: c.close,
  }));
}

/** Histogram payload, coloured by bar direction. */
export function toVolumeData(candles: readonly Candle[], up = '#10B98166', down = '#EF444466') {
  return candles.map(c => ({
    time: c.time as never,
    value: c.volume,
    color: c.close >= c.open ? up : down,
  }));
}

/**
 * Line/area payload from an indicator array aligned to `candles`. Indicator
 * warm-up periods produce nulls, and those must be omitted entirely rather than
 * passed through as whitespace — mixing whitespace into a line series is the
 * other common source of the same null error.
 */
export function toLineData(candles: readonly Candle[], values: readonly (number | null)[]) {
  const out: { time: never; value: number }[] = [];
  const n = Math.min(candles.length, values.length);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    out.push({ time: candles[i].time as never, value: v });
  }
  return out;
}

/** One-line summary for a log line or a dev-only banner. */
export function describeReport(r: SanitizeReport): string {
  if (r.fatal) return r.fatal;
  const notes: string[] = [];
  if (r.droppedNonFinite) notes.push(`${r.droppedNonFinite} malformed`);
  if (r.droppedBadTime) notes.push(`${r.droppedBadTime} bad timestamps`);
  if (r.droppedDuplicate) notes.push(`${r.droppedDuplicate} duplicates`);
  if (r.repairedWicks) notes.push(`${r.repairedWicks} wicks repaired`);
  if (r.reordered) notes.push('reordered');
  return notes.length ? `${r.kept} candles (${notes.join(', ')})` : `${r.kept} candles`;
}
