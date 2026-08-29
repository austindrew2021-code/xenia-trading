import { useEffect, useRef, useState } from 'react';
import * as LWC from 'lightweight-charts';
import { createChart, ColorType, IChartApi, ISeriesApi, LineStyle, UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '../engine/types';

// ── Xenia chart ────────────────────────────────────────────────────────────
//
// Design intent: this is a chart people stare at while money is at risk, so
// nothing on it decorates. Every mark either shows price or shows where the
// user's money stops. The palette is the app's existing near-black ground with
// the single cyan accent; the risk lines borrow amber and red because those are
// the only two colours a trader should have to interpret quickly.
//
// The one deliberate flourish is the mark: a low-opacity brand watermark behind
// the price, which is what every professional terminal does and what makes a
// screenshot recognisably yours when someone shares a trade. It sits behind the
// series, never over the candles.

export const XENIA_CHART_THEME = {
  ground: '#080B10',
  panel: '#0D1117',
  grid: 'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.06)',
  text: '#4B5563',
  textBright: '#F4F6FA',
  accent: '#2BFFF1',
  up: '#26D9A3',
  down: '#FF5C6C',
  entry: '#2BFFF1',
  stop: '#FFB84D',
  liquidation: '#FF3B4E',
  target: '#26D9A3',
};

export interface PriceLine {
  price: number;
  label: string;
  color: string;
  dashed?: boolean;
}

export interface XeniaChartProps {
  candles: Candle[];
  symbol: string;
  interval: string;
  /** Entry, stop, target, liquidation — anything the user needs to see instantly. */
  lines?: PriceLine[];
  /**
   * Brand mark drawn behind the price. Pass a URL or an inline data URI.
   * Falls back to the wordmark below if omitted — replace it with the real asset
   * when you have it; I do not have your logo file, so what ships here is a
   * placeholder built from the app's own type and accent.
   */
  logoUrl?: string;
  logoText?: string;
  height?: number;
  showVolume?: boolean;
}

export default function XeniaChart({
  candles, symbol, interval, lines = [], logoUrl, logoText = 'XENIA',
  height = 420, showVolume = true,
}: XeniaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number; t: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !candles.length) return;
    const T = XENIA_CHART_THEME;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: T.ground },
        textColor: T.text,
        fontSize: 10,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      grid: {
        vertLines: { color: T.grid },
        horzLines: { color: T.grid },
      },
      rightPriceScale: {
        borderColor: T.border,
        scaleMargins: { top: 0.08, bottom: showVolume ? 0.28 : 0.08 },
      },
      timeScale: {
        borderColor: T.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(43,255,241,0.25)', width: 1, style: LineStyle.Solid, labelBackgroundColor: T.panel },
        horzLine: { color: 'rgba(43,255,241,0.25)', width: 1, style: LineStyle.Solid, labelBackgroundColor: T.panel },
      },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    // lightweight-charts v5 replaced addCandlestickSeries() with
    // addSeries(CandlestickSeries, ...). Xenia's installed version decides which
    // exists, so probe rather than assume and break on upgrade.
    const anyChart = chart as unknown as Record<string, any>;
    const candleSeries: ISeriesApi<'Candlestick'> = anyChart.addCandlestickSeries
      ? anyChart.addCandlestickSeries({
          upColor: T.up, downColor: T.down,
          borderUpColor: T.up, borderDownColor: T.down,
          wickUpColor: T.up, wickDownColor: T.down,
          priceLineColor: T.accent,
        })
      : anyChart.addSeries(
          (LWC as any).CandlestickSeries,
          {
            upColor: T.up, downColor: T.down,
            borderUpColor: T.up, borderDownColor: T.down,
            wickUpColor: T.up, wickDownColor: T.down,
            priceLineColor: T.accent,
          },
        );

    candleSeries.setData(candles.map(c => ({
      time: (c.time / 1000) as UTCTimestamp,
      open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    if (showVolume) {
      const volSeries = anyChart.addHistogramSeries
        ? anyChart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'vol',
          })
        : anyChart.addSeries(
            (LWC as any).HistogramSeries,
            { priceFormat: { type: 'volume' }, priceScaleId: 'vol' },
          );
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      volSeries.setData(candles.map(c => ({
        time: (c.time / 1000) as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(38,217,163,0.22)' : 'rgba(255,92,108,0.22)',
      })));
    }

    // Risk lines. These are the reason the chart exists — a leveraged user
    // should be able to see where they are dead without reading a number.
    for (const l of lines) {
      candleSeries.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: l.color === XENIA_CHART_THEME.liquidation ? 2 : 1,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: l.label,
      });
    }

    chart.subscribeCrosshairMove(param => {
      const d = param.seriesData.get(candleSeries) as any;
      setHover(d ? { o: d.open, h: d.high, l: d.low, c: d.close, t: Number(param.time) * 1000 } : null);
    });

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, lines, height, showVolume]);

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const changePct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  const shown = hover ?? (last ? { o: last.open, h: last.high, l: last.low, c: last.close, t: last.time } : null);

  return (
    <div className="relative rounded-2xl border border-white/[0.05] bg-[#080B10] overflow-hidden">
      {/* header — OHLC reads out on hover, which is what a terminal does */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between
                      px-3 py-2 pointer-events-none">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-black tracking-tight text-[#F4F6FA]">{symbol}</span>
          <span className="text-[10px] uppercase tracking-widest text-[#4B5563]">{interval}</span>
          {shown && (
            <div className="flex gap-2 text-[10px] font-mono text-[#4B5563]">
              <span>O<span className="text-[#A7B0B7] ml-1">{fmt(shown.o)}</span></span>
              <span>H<span className="text-[#A7B0B7] ml-1">{fmt(shown.h)}</span></span>
              <span>L<span className="text-[#A7B0B7] ml-1">{fmt(shown.l)}</span></span>
              <span>C<span className="text-[#A7B0B7] ml-1">{fmt(shown.c)}</span></span>
            </div>
          )}
        </div>
        {last && (
          <div className="text-right">
            <div className="text-xs font-bold font-mono text-[#F4F6FA]">{fmt(last.close)}</div>
            <div className={`text-[10px] font-mono ${changePct >= 0 ? 'text-[#26D9A3]' : 'text-[#FF5C6C]'}`}>
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
            </div>
          </div>
        )}
      </div>

      {/* brand mark, behind the price */}
      <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none select-none">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="w-40 opacity-[0.05]" />
        ) : (
          <span className="text-[64px] font-black tracking-[0.3em] text-[#2BFFF1] opacity-[0.035]">
            {logoText}
          </span>
        )}
      </div>

      <div ref={containerRef} className="relative z-10" />

      {/* legend for the risk lines — a colour with no key is decoration */}
      {lines.length > 0 && (
        <div className="relative z-20 flex flex-wrap gap-3 px-3 py-2 border-t border-white/[0.04]">
          {lines.map(l => (
            <span key={l.label} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-3 h-px" style={{ background: l.color }} />
              <span className="text-[#4B5563]">{l.label}</span>
              <span className="font-mono text-[#A7B0B7]">{fmt(l.price)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(8).replace(/0+$/, '');
}

/**
 * Build the risk lines for an open position. Liquidation is drawn heaviest and
 * in red because it is the only line on the chart that ends the position without
 * the user choosing to.
 *
 * On routed leverage, pass the liquidation price VELOCITY reports — not one
 * computed locally. Ours would be an estimate of theirs, and an estimate drawn
 * as a solid line is a lie about how much room the user has.
 */
export function positionLines(o: {
  entry: number; stop?: number; target?: number; liquidation?: number;
}): PriceLine[] {
  const T = XENIA_CHART_THEME;
  const out: PriceLine[] = [{ price: o.entry, label: 'Entry', color: T.entry }];
  if (o.target) out.push({ price: o.target, label: 'Target', color: T.target, dashed: true });
  if (o.stop) out.push({ price: o.stop, label: 'Stop', color: T.stop, dashed: true });
  if (o.liquidation) out.push({ price: o.liquidation, label: 'Liquidation', color: T.liquidation });
  return out;
}
