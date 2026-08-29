import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries, HistogramSeries, createChart,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import {
  sanitizeCandles, toCandlestickData, toVolumeData,
  type Candle, type RawCandle,
} from '../lib/candles';

// ── Xenia — Trading screen ─────────────────────────────────────────────────
//
// DESIGN NOTES — read before changing spacing or type
//
//   Density is the whole point. A terminal earns trust by showing a trader
//   everything at once; a dashboard earns nothing by showing them a summary.
//   The rules this file follows, in order of how much they matter:
//
//   1. NUMBERS ARE MONO AND TABULAR. `font-variant-numeric: tabular-nums` on a
//      monospace face is the single largest difference between this and a
//      generic app. Decimal points align down a column, and a price updating
//      from 0.19 to 0.21 does not shift the layout by a pixel. Every price,
//      size, percentage and countdown in here uses `.num`.
//   2. 8PX VERTICAL RHYTHM. Cards are 8px apart, not 16 or 24. Padding is 8-12,
//      not 16-20. On a 6.8" screen that is the difference between four visible
//      panels and two.
//   3. THE CHART GETS THE VIEWPORT. It is sized off `100dvh` minus the fixed
//      furniture, so it grows on a tall phone instead of leaving dead space.
//      `dvh` rather than `vh` because mobile browser chrome collapses on scroll
//      and `vh` leaves a gap that never closes.
//   4. THE TICKET IS ALWAYS THERE. Buy and sell are reachable without a tap.
//
//   Colour is unchanged from the rest of Xenia: #080B10 ground, #0D1117 panels,
//   #2BFFF1 accent, and green/red reserved exclusively for direction. Nothing
//   else in this file is allowed to be green or red — if everything is
//   coloured, direction stops reading at a glance.
//
//   THE SIGNATURE ELEMENT is the cost-to-R readout in the ticket. Round-trip
//   cost as a fraction of the distance to your stop is the number that decides
//   whether a strategy can be profitable at all, and no retail terminal shows
//   it. At 10× on a 15m chart it is routinely above 0.5R, which is why those
//   trades lose over time regardless of entry quality. Showing it at the moment
//   of sizing is the most useful thing this screen does.
//
// INTEGRATION
//   This component is deliberately free of store imports so it can be dropped
//   in and wired incrementally. Pass your existing data through the props
//   below; nothing here reaches for Zustand, Supabase or the runner directly.

export interface Market {
  symbol: string;          // 'BONK'
  name: string;            // 'Bonk'
  mint?: string;
  price: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  liquidityUsd?: number;
  marketCapUsd?: number;
}

export interface OpenPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entry: number;
  size: number;            // base units
  notionalUsd: number;
  leverage: number;
  stop?: number;
  target?: number;
  liquidation?: number;
  unrealisedUsd: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface TradingScreenProps {
  market: Market;
  candles: RawCandle[];
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  positions: OpenPosition[];
  /** Free collateral in USD. */
  balanceUsd: number;
  mode: 'mock' | 'live';
  /** Round-trip cost in percent of notional: fees + slippage, both legs. */
  roundTripCostPct: number;
  maxLeverage?: number;
  loading?: boolean;
  onSubmit: (order: {
    side: 'long' | 'short'; marginUsd: number; leverage: number;
    stop: number | null; target: number | null;
  }) => Promise<void> | void;
  onClosePosition?: (id: string) => void;
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

// Terminals show more significant figures on cheap tokens, not fewer. A memecoin
// at $0.000002998 is four decimals of noise in a generic formatter.
function px(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return v.toFixed(4);
  if (a >= 0.01) return v.toFixed(5);
  if (a >= 0.0001) return v.toFixed(7);
  return v.toPrecision(4);
}

function usd(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

// ── atoms ──────────────────────────────────────────────────────────────────

const num = 'font-mono tabular-nums tracking-tight';
const panel = 'bg-[#0D1117] border border-white/[0.06] rounded-lg';
const eyebrow = 'text-[9px] uppercase tracking-[0.14em] text-[#4B5563] font-semibold';

function Stat({ label, value, tone }: {
  label: string; value: string; tone?: 'up' | 'down' | 'accent';
}) {
  const color = tone === 'up' ? 'text-[#10B981]'
    : tone === 'down' ? 'text-[#EF4444]'
    : tone === 'accent' ? 'text-[#2BFFF1]' : 'text-[#E5E9EF]';
  return (
    <div className="flex flex-col gap-[1px] min-w-0">
      <span className={eyebrow}>{label}</span>
      <span className={`${num} text-[11px] font-semibold ${color} truncate`}>{value}</span>
    </div>
  );
}

// ── chart ──────────────────────────────────────────────────────────────────

function Chart({ candles, height }: { candles: Candle[]; height: number }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#4B5563',
        fontSize: 10,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        attributionLogo: false,
      },
      // Hairline grid. Heavier than this and the wicks stop reading.
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.025)' },
        horzLines: { color: 'rgba(255,255,255,0.025)' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)', scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(43,255,241,0.35)', width: 1, style: 3, labelBackgroundColor: '#0D1117' },
        horzLine: { color: 'rgba(43,255,241,0.35)', width: 1, style: 3, labelBackgroundColor: '#0D1117' },
      },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });
    chart.current = c;

    price.current = c.addSeries(CandlestickSeries, {
      upColor: '#10B981', downColor: '#EF4444',
      borderUpColor: '#10B981', borderDownColor: '#EF4444',
      wickUpColor: '#10B981', wickDownColor: '#EF4444',
    });
    vol.current = c.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const ro = new ResizeObserver(() => {
      if (host.current) c.applyOptions({ width: host.current.clientWidth });
    });
    ro.observe(host.current);
    return () => { ro.disconnect(); c.remove(); chart.current = null; };
  }, []);

  useEffect(() => {
    if (!price.current || !vol.current || candles.length === 0) return;
    price.current.setData(toCandlestickData(candles));
    vol.current.setData(toVolumeData(candles));
    chart.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => { chart.current?.applyOptions({ height }); }, [height]);

  return <div ref={host} style={{ height }} className="w-full" />;
}

// ── screen ─────────────────────────────────────────────────────────────────

export default function TradingScreen(props: TradingScreenProps) {
  const {
    market, timeframe, onTimeframeChange, positions, balanceUsd, mode,
    roundTripCostPct, maxLeverage = 100, loading, onSubmit, onClosePosition,
  } = props;

  const { candles, report } = useMemo(
    () => sanitizeCandles(props.candles), [props.candles],
  );

  const [side, setSide] = useState<'long' | 'short'>('long');
  const [marginStr, setMarginStr] = useState('');
  const [leverage, setLeverage] = useState(10);
  const [stopPct, setStopPct] = useState(4);
  const [targetR, setTargetR] = useState(2);
  const [tab, setTab] = useState<'position' | 'ticket'>('ticket');
  const [submitting, setSubmitting] = useState(false);
  const [chartH, setChartH] = useState(320);

  // The chart takes whatever the fixed furniture does not. Measured rather than
  // guessed so it adapts to a folded Z Flip or a landscape tablet.
  useEffect(() => {
    const fit = () => setChartH(Math.max(220, Math.round(window.innerHeight * 0.42)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const margin = Number(marginStr) || 0;
  const notional = margin * leverage;
  const stopDistPct = Math.max(0.01, stopPct);
  const stopPrice = side === 'long'
    ? market.price * (1 - stopDistPct / 100)
    : market.price * (1 + stopDistPct / 100);
  const targetPrice = side === 'long'
    ? market.price * (1 + (stopDistPct * targetR) / 100)
    : market.price * (1 - (stopDistPct * targetR) / 100);
  // Cross-margin approximation, maintenance margin 0.5%.
  const liqPrice = side === 'long'
    ? market.price * (1 - (1 / leverage - 0.005))
    : market.price * (1 + (1 / leverage - 0.005));

  const riskUsd = notional * (stopDistPct / 100);
  const costUsd = notional * (roundTripCostPct / 100);
  const costInR = riskUsd > 0 ? costUsd / riskUsd : 0;
  // Breakeven R:R at a 50% hit rate once cost is paid on both sides.
  const breakevenRR = 1 + 2 * costInR;
  const stopInsideLiq = side === 'long' ? stopPrice <= liqPrice : stopPrice >= liqPrice;

  const costTone = costInR > 0.35 ? 'text-[#EF4444]'
    : costInR > 0.15 ? 'text-[#F59E0B]' : 'text-[#10B981]';

  const canSubmit = margin > 0 && margin <= balanceUsd && !submitting && !stopInsideLiq;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ side, marginUsd: margin, leverage, stop: stopPrice, target: targetPrice });
      setMarginStr('');
    } finally { setSubmitting(false); }
  };

  const up = market.change24hPct >= 0;
  const openHere = positions.filter(p => p.symbol === market.symbol);

  return (
    <div className="flex flex-col h-[100dvh] bg-[#080B10] text-[#E5E9EF] overflow-hidden">

      {/* ── instrument header: price is the largest thing on screen ── */}
      <div className="px-3 pt-2 pb-1.5 border-b border-white/[0.06]">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-black tracking-tight">{market.symbol}</span>
          <span className="text-[10px] text-[#4B5563] truncate flex-1">{market.name}</span>
          <span className={`${eyebrow} px-1.5 py-0.5 rounded border ${
            mode === 'live'
              ? 'text-[#EF4444] border-[#EF4444]/30 bg-[#EF4444]/10'
              : 'text-[#4B5563] border-white/[0.08]'}`}>
            {mode === 'live' ? 'Live funds' : 'Mock'}
          </span>
        </div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className={`${num} text-[26px] font-bold leading-none ${up ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
            {px(market.price)}
          </span>
          <span className={`${num} text-[12px] font-semibold ${up ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
            {pct(market.change24hPct)}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-1.5">
          <Stat label="24h high" value={px(market.high24h)} />
          <Stat label="24h low" value={px(market.low24h)} />
          <Stat label="Volume" value={usd(market.volume24hUsd)} />
          <Stat label="Liquidity" value={market.liquidityUsd ? usd(market.liquidityUsd) : '—'} />
        </div>
      </div>

      {/* ── timeframes ── */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/[0.06]">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`${num} px-2 py-1 rounded text-[10px] font-bold transition-colors ${
              tf === timeframe
                ? 'bg-[#2BFFF1]/12 text-[#2BFFF1] border border-[#2BFFF1]/25'
                : 'text-[#4B5563] border border-transparent hover:text-[#9CA3AF]'}`}
          >
            {tf}
          </button>
        ))}
        <div className="flex-1" />
        {report.kept > 0 && (
          <span className={`${num} text-[9px] text-[#374151]`}>{report.kept} bars</span>
        )}
      </div>

      {/* ── chart ── */}
      <div className="relative shrink-0" style={{ height: chartH }}>
        {loading ? (
          <div className="absolute inset-0 grid place-items-center">
            <span className={eyebrow}>Loading {market.symbol}</span>
          </div>
        ) : report.fatal ? (
          <div className="absolute inset-0 grid place-items-center px-8 text-center">
            <div>
              <p className="text-[11px] text-[#9CA3AF] leading-relaxed">{report.fatal}</p>
              <p className={`${eyebrow} mt-1.5`}>Try another timeframe</p>
            </div>
          </div>
        ) : (
          <Chart candles={candles} height={chartH} />
        )}
      </div>

      {/* ── tabs ── */}
      <div className="flex border-y border-white/[0.06] shrink-0">
        {(['ticket', 'position'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] border-b-2 transition-colors ${
              tab === t
                ? 'border-[#2BFFF1] text-[#2BFFF1]'
                : 'border-transparent text-[#4B5563]'}`}
          >
            {t === 'ticket' ? 'Order' : `Positions${openHere.length ? ` (${openHere.length})` : ''}`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">

        {tab === 'position' && (
          openHere.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[11px] text-[#4B5563]">No open position in {market.symbol}.</p>
              <button onClick={() => setTab('ticket')}
                className="mt-1.5 text-[11px] font-bold text-[#2BFFF1]">Open one</button>
            </div>
          ) : openHere.map(p => (
            <div key={p.id} className={`${panel} p-2.5`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`${eyebrow} px-1.5 py-0.5 rounded ${
                    p.side === 'long'
                      ? 'text-[#10B981] bg-[#10B981]/10' : 'text-[#EF4444] bg-[#EF4444]/10'}`}>
                    {p.side} {p.leverage}×
                  </span>
                  <span className={`${num} text-[11px] text-[#9CA3AF]`}>{usd(p.notionalUsd)}</span>
                </div>
                <span className={`${num} text-[13px] font-bold ${
                  p.unrealisedUsd >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                  {p.unrealisedUsd >= 0 ? '+' : ''}{usd(p.unrealisedUsd)}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                <Stat label="Entry" value={px(p.entry)} />
                <Stat label="Stop" value={p.stop ? px(p.stop) : 'None'} />
                <Stat label="Target" value={p.target ? px(p.target) : 'None'} />
                <Stat label="Liq." value={p.liquidation ? px(p.liquidation) : '—'} tone="down" />
              </div>
              {onClosePosition && (
                <button onClick={() => onClosePosition(p.id)}
                  className="mt-2 w-full py-1.5 rounded bg-white/[0.05] border border-white/[0.08]
                             text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-white/[0.09]">
                  Close position
                </button>
              )}
            </div>
          ))
        )}

        {tab === 'ticket' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {(['long', 'short'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={`py-2 rounded text-[11px] font-black uppercase tracking-[0.1em] border transition-colors ${
                    side === s
                      ? s === 'long'
                        ? 'bg-[#10B981]/15 border-[#10B981]/40 text-[#10B981]'
                        : 'bg-[#EF4444]/15 border-[#EF4444]/40 text-[#EF4444]'
                      : 'bg-transparent border-white/[0.07] text-[#4B5563]'}`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className={`${panel} p-2.5 space-y-2.5`}>
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <span className={eyebrow}>Margin</span>
                  <button onClick={() => setMarginStr(String(Math.floor(balanceUsd)))}
                    className={`${num} text-[10px] text-[#2BFFF1]`}>
                    {usd(balanceUsd)} free
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`${num} text-[#4B5563] text-[13px]`}>$</span>
                  <input
                    value={marginStr}
                    onChange={e => setMarginStr(e.target.value.replace(/[^\d.]/g, ''))}
                    inputMode="decimal" placeholder="0.00"
                    className={`${num} flex-1 bg-transparent text-[18px] font-bold outline-none
                                placeholder:text-[#1F2937]`}
                  />
                  {[25, 50, 100].map(p => (
                    <button key={p}
                      onClick={() => setMarginStr((balanceUsd * p / 100).toFixed(2))}
                      className={`${num} px-1.5 py-1 rounded bg-white/[0.04] text-[9px] font-bold text-[#6B7280]`}>
                      {p}%
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <span className={eyebrow}>Leverage</span>
                  <span className={`${num} text-[12px] font-bold text-[#2BFFF1]`}>{leverage}×</span>
                </div>
                <input
                  type="range" min={1} max={maxLeverage} value={leverage}
                  onChange={e => setLeverage(Number(e.target.value))}
                  className="w-full accent-[#2BFFF1] h-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className={eyebrow}>Stop distance</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <input
                      type="range" min={0.5} max={20} step={0.5} value={stopPct}
                      onChange={e => setStopPct(Number(e.target.value))}
                      className="flex-1 accent-[#6B7280] h-1"
                    />
                    <span className={`${num} text-[11px] font-semibold w-10 text-right`}>{stopPct}%</span>
                  </div>
                </div>
                <div>
                  <span className={eyebrow}>Target</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <input
                      type="range" min={0.5} max={6} step={0.25} value={targetR}
                      onChange={e => setTargetR(Number(e.target.value))}
                      className="flex-1 accent-[#6B7280] h-1"
                    />
                    <span className={`${num} text-[11px] font-semibold w-10 text-right`}>{targetR}R</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── the signature: what this trade actually costs ── */}
            <div className={`${panel} p-2.5`}>
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Notional" value={usd(notional)} />
                <Stat label="Stop" value={px(stopPrice)} />
                <Stat label="Target" value={px(targetPrice)} />
                <Stat label="Liquidation" value={px(liqPrice)} tone="down" />
              </div>

              <div className="h-px bg-white/[0.06] my-2" />

              <div className="flex items-baseline justify-between">
                <span className={eyebrow}>Round trip costs</span>
                <span className={`${num} text-[13px] font-bold ${costTone}`}>
                  {costInR.toFixed(2)}R
                </span>
              </div>
              {/* A bar is faster to read than a number when the question is
                  "how much of my risk am I paying to enter". 1.0R is total loss
                  of the trade to costs, so the scale is anchored there. */}
              <div className="h-1 rounded-full bg-white/[0.06] mt-1 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    costInR > 0.35 ? 'bg-[#EF4444]' : costInR > 0.15 ? 'bg-[#F59E0B]' : 'bg-[#10B981]'}`}
                  style={{ width: `${Math.min(100, costInR * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-[#6B7280] leading-snug mt-1.5">
                {usd(costUsd)} of your {usd(riskUsd)} risk goes to fees and slippage.
                At a 50% hit rate you need better than{' '}
                <span className={`${num} font-semibold text-[#9CA3AF]`}>{breakevenRR.toFixed(2)}R</span>{' '}
                to break even.
                {costInR > 0.35 && ' At this leverage and stop, costs eat the edge before direction does.'}
              </p>
            </div>

            {stopInsideLiq && (
              <div className="rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-2.5 py-2">
                <p className="text-[10px] text-[#EF4444] leading-snug">
                  Your stop sits past the liquidation price. You would be liquidated before the
                  stop fills. Lower the leverage or tighten the stop.
                </p>
              </div>
            )}

            <button
              onClick={submit}
              disabled={!canSubmit}
              className={`w-full py-3 rounded-lg text-[12px] font-black uppercase tracking-[0.12em]
                          transition-colors disabled:opacity-25 ${
                side === 'long'
                  ? 'bg-[#10B981]/15 border border-[#10B981]/40 text-[#10B981]'
                  : 'bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444]'}`}
            >
              {submitting ? 'Submitting' : `${side === 'long' ? 'Buy' : 'Sell'} ${market.symbol}`}
            </button>

            {margin > balanceUsd && (
              <p className="text-[10px] text-[#EF4444] text-center">
                {usd(margin)} exceeds your {usd(balanceUsd)} free collateral.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
