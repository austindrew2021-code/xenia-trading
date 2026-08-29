// ── Xenia — Chart indicator bridge ────────────────────────────────────────
//
// Fixes the "toggle does nothing" bug and stops it recurring.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE BUG
//
// PriceChart.tsx maps indicator output to series data like this:
//
//     const toData = (vals: (number|null)[]) =>
//       vals.map((v,i) => ({ time: times[i], value: v ?? undefined }))
//           .filter(d => d.value !== undefined)
//
// `??` is NULLISH coalescing. It catches null and undefined. It does NOT catch
// NaN:
//
//     NaN ?? undefined   ===   NaN        <- passes the filter
//     null ?? undefined  ===   undefined  <- filtered correctly
//
// So NaN reaches setData(), lightweight-charts rejects the series, and the line
// never draws. No console error. No visible failure. The toggle lights up and
// nothing happens.
//
// It only bites SOME indicators because the codebase has THREE implementations
// with two different warmup conventions:
//
//     PriceChart.tsx local (indSMA, indEMA, indHMA, indRSI…)  -> null   works
//     indicators.ts        (sma, ema, rsi, atr, macd…)        -> NaN    fails
//     indicatorsExtended.ts                                    -> NaN    fails
//
// Which is exactly the reported symptom: some toggles work, some silently do
// nothing, and it looks random.
// ═══════════════════════════════════════════════════════════════════════════

export type Numeric = number | null | undefined;

/**
 * The only sanctioned way to turn indicator output into series data.
 *
 * Rejects NaN, Infinity, null and undefined — every non-finite form, not just
 * the nullish ones. Use this instead of `toData` everywhere.
 */
export function toSeriesData<T extends number | string>(
  times: T[], values: Numeric[],
): { time: T; value: number }[] {
  const out: { time: T; value: number }[] = [];
  for (let i = 0; i < values.length && i < times.length; i++) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v)) out.push({ time: times[i], value: v });
  }
  return out;
}

/**
 * Same, for band indicators where the series must stay aligned. A point is
 * emitted only when every band has a finite value at that index — otherwise
 * upper and lower drift apart and the fill between them goes wrong.
 */
export function toBandData<T extends number | string>(
  times: T[], bands: Numeric[][],
): { time: T; values: number[] }[] {
  const out: { time: T; values: number[] }[] = [];
  const n = Math.min(times.length, ...bands.map(b => b.length));
  for (let i = 0; i < n; i++) {
    const row = bands.map(b => b[i]);
    if (row.every(v => typeof v === 'number' && Number.isFinite(v))) {
      out.push({ time: times[i], values: row as number[] });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// VISIBILITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SECOND REASON A TOGGLE CAN DO NOTHING.
 *
 * PriceChart disables autoscale on the right price scale:
 *
 *     priceScale('right').applyOptions({ autoScale: true });
 *     requestAnimationFrame(() => applyOptions({ autoScale: false }));
 *
 * and the price-axis drag handler installs an `autoscaleInfoProvider` that pins
 * the range. Both are deliberate — they let the user pan the price axis freely.
 *
 * But they also mean an overlay series whose values fall outside the pinned
 * range is added successfully, holds correct data, and is invisible. An SMA sits
 * inside the price range so it looks fine; a Force Index in the tens of
 * thousands, or an OBV in the millions, does not.
 *
 * So: anything not denominated in price MUST go on its own scale. This decides
 * that, rather than leaving it to whoever adds the next indicator.
 */
export type ScaleKind = 'price' | 'oscillator-0-100' | 'oscillator-centered' | 'volume-magnitude';

export const INDICATOR_SCALE: Record<string, ScaleKind> = {
  // overlay on price — safe on the right scale
  sma: 'price', ema: 'price', wma: 'price', vwap: 'price', hma: 'price',
  dema: 'price', tema: 'price', alma: 'price', bbands: 'price',
  keltner: 'price', donchian: 'price', supertrend: 'price', ichimoku: 'price',
  psar: 'price',

  // bounded 0-100 — own pane
  rsi: 'oscillator-0-100', stoch: 'oscillator-0-100', stochrsi: 'oscillator-0-100',
  mfi: 'oscillator-0-100', aroon: 'oscillator-0-100', ultimate: 'oscillator-0-100',
  adx: 'oscillator-0-100',

  // centered on zero — own pane
  macd: 'oscillator-centered', cci: 'oscillator-centered', roc: 'oscillator-centered',
  willr: 'oscillator-centered', cmf: 'oscillator-centered', chaikin: 'oscillator-centered',
  eom: 'oscillator-centered',

  // unbounded magnitudes — own pane, and the ones that vanish silently on the
  // price scale because their values are orders of magnitude away from price
  obv: 'volume-magnitude', vpt: 'volume-magnitude', force: 'volume-magnitude',
  volosc: 'volume-magnitude', atr: 'volume-magnitude', stddev: 'volume-magnitude',
};

export function scaleIdFor(indicatorId: string): string | undefined {
  const kind = INDICATOR_SCALE[indicatorId] ?? 'price';
  return kind === 'price' ? undefined : `pane_${indicatorId}`;
}

/** Pane geometry. Stacks panes so two oscillators do not draw on top of each other. */
export function paneMarginsFor(index: number, total: number) {
  const paneHeight = Math.min(0.25, 0.55 / Math.max(total, 1));
  const bottom = index * paneHeight;
  return { top: 1 - paneHeight - bottom, bottom };
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC
// ═══════════════════════════════════════════════════════════════════════════

export interface IndicatorDiagnostic {
  id: string;
  ok: boolean;
  totalPoints: number;
  plottablePoints: number;
  nanCount: number;
  nullCount: number;
  infiniteCount: number;
  scale: ScaleKind;
  problem: string | null;
}

/**
 * Run before rendering. Answers "why is nothing showing" without a debugger.
 *
 * The failures it catches are all silent ones: a series that is all NaN, a
 * warmup longer than the loaded history, or an unbounded indicator pointed at
 * the price scale where it will be added successfully and never seen.
 */
export function diagnoseIndicator(
  id: string, values: Numeric[], barsLoaded: number,
): IndicatorDiagnostic {
  let nan = 0, nul = 0, inf = 0, ok = 0;
  for (const v of values) {
    if (v === null || v === undefined) nul++;
    else if (Number.isNaN(v)) nan++;
    else if (!Number.isFinite(v)) inf++;
    else ok++;
  }
  const scale = INDICATOR_SCALE[id] ?? 'price';
  let problem: string | null = null;

  if (values.length === 0) {
    problem = 'Indicator returned an empty array — check the function is wired to the id.';
  } else if (ok === 0) {
    problem = nan > 0
      ? `All ${nan} values are NaN. Either the period exceeds the ${barsLoaded} bars loaded, `
        + `or the input series is empty.`
      : 'No finite values produced.';
  } else if (ok < 5) {
    problem = `Only ${ok} plottable points from ${values.length} bars — the warmup is nearly `
      + `as long as the loaded history. Load more bars or shorten the period.`;
  } else if (scale !== 'price' && scaleIdFor(id) === undefined) {
    problem = `${id} is unbounded but mapped to the price scale. It will be added `
      + `successfully and be invisible. Give it its own pane.`;
  }

  return {
    id, ok: problem === null,
    totalPoints: values.length, plottablePoints: ok,
    nanCount: nan, nullCount: nul, infiniteCount: inf,
    scale, problem,
  };
}

/**
 * Sweep every active indicator and report what will actually be seen.
 * Wire to a dev-only console call, or a hidden panel in the chart settings.
 */
export function diagnoseAll(
  active: { id: string; values: Numeric[] }[], barsLoaded: number,
): { allOk: boolean; report: IndicatorDiagnostic[]; summary: string } {
  const report = active.map(a => diagnoseIndicator(a.id, a.values, barsLoaded));
  const broken = report.filter(r => !r.ok);
  return {
    allOk: broken.length === 0,
    report,
    summary: broken.length === 0
      ? `${report.length} indicators, all plottable.`
      : `${broken.length} of ${report.length} will not render: `
        + broken.map(b => `${b.id} (${b.problem})`).join('; '),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THIRD REASON A TOGGLE CAN MISBEHAVE — untoggling leaving artifacts behind.
 *
 * The existing cleanup distinguishes series from price lines by duck-typing:
 *
 *     if (typeof s.applyOptions === 'function' && typeof s.setData === 'function')
 *       chart.removeSeries(s); else candleRef.current?.removePriceLine(s);
 *
 * That works today because IPriceLine has applyOptions but no setData. It is
 * fragile — it depends on a library internal staying absent. Tag the objects
 * when you create them instead, so removal reads a fact rather than inferring
 * one.
 */
export type ChartArtifact =
  | { kind: 'series'; handle: unknown; scaleId?: string }
  | { kind: 'priceLine'; handle: unknown };

export function disposeArtifacts(
  artifacts: ChartArtifact[],
  chart: { removeSeries(s: any): void },
  candleSeries: { removePriceLine(l: any): void } | null,
): { removed: number; failed: number } {
  let removed = 0, failed = 0;
  for (const a of artifacts) {
    try {
      if (a.kind === 'series') chart.removeSeries(a.handle);
      else candleSeries?.removePriceLine(a.handle);
      removed++;
    } catch {
      failed++;   // already gone, or the chart was disposed first
    }
  }
  return { removed, failed };
}
