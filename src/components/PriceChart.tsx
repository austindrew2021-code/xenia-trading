import { useEffect, useRef, useMemo } from 'react';
import {
  createChart, ColorType, CrosshairMode,
  IChartApi, ISeriesApi, CandlestickSeries, HistogramSeries,
} from 'lightweight-charts';
import { Candle } from '../types';

interface Props {
  candles: Candle[];
  livePrice: number;
  positions: { entryPrice: number; side: string; status: string }[];
}

// ── Detect correct decimal precision from price magnitude ──────────────────
// Returns { precision, minMove } for lightweight-charts priceFormat
function getPriceFormat(price: number): { precision: number; minMove: number } {
  if (!price || price <= 0) return { precision: 2, minMove: 0.01 };
  if (price >= 10_000)  return { precision: 2, minMove: 0.01 };
  if (price >= 1_000)   return { precision: 2, minMove: 0.01 };
  if (price >= 100)     return { precision: 3, minMove: 0.001 };
  if (price >= 10)      return { precision: 4, minMove: 0.0001 };
  if (price >= 1)       return { precision: 5, minMove: 0.00001 };
  if (price >= 0.1)     return { precision: 6, minMove: 0.000001 };
  if (price >= 0.01)    return { precision: 7, minMove: 0.0000001 };
  if (price >= 0.001)   return { precision: 8, minMove: 0.00000001 };
  if (price >= 0.0001)  return { precision: 9, minMove: 0.000000001 };
  if (price >= 0.00001) return { precision: 10, minMove: 0.0000000001 };
  return                       { precision: 12, minMove: 0.000000000001 };
}

// Format price for display (header, crosshair tooltip)
export function formatPrice(price: number): string {
  if (!price || price <= 0) return '$0.00';
  const { precision } = getPriceFormat(price);
  // For very small numbers, use subscript notation: $0.00₄1969 style
  // But since we can't render subscript in plain text, use a readable format
  if (price < 0.001) {
    // Count leading zeros after decimal point
    const str = price.toFixed(Math.min(precision, 12));
    return `$${str}`;
  }
  return `$${price.toFixed(Math.min(precision, 8))}`;
}

export function PriceChart({ candles, livePrice, positions }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<'Candlestick', any> | null>(null);
  const volumeRef    = useRef<ISeriesApi<'Histogram', any> | null>(null);
  const lastFmtRef   = useRef<string>('');

  // Detect price scale from candles
  const priceFormat = useMemo(() => {
    if (!candles.length) return getPriceFormat(livePrice);
    const avgPrice = candles.slice(-20).reduce((s, c) => s + c.close, 0) / Math.min(20, candles.length);
    return getPriceFormat(avgPrice || livePrice);
  }, [candles, livePrice]);

  // Create chart once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6B7280',
        fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.025)' },
        horzLines: { color: 'rgba(255,255,255,0.025)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(43,255,241,0.35)', labelBackgroundColor: '#0B0E14' },
        horzLine: { color: 'rgba(43,255,241,0.35)', labelBackgroundColor: '#0B0E14' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.05)',
        textColor: '#4B5563',
        scaleMargins: { top: 0.08, bottom: 0.22 },
        // Use full precision for axis labels
        mode: 0, // normal mode
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.05)',

        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      kineticScroll: { touch: true, mouse: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:        '#4ADE80',
      downColor:      '#F87171',
      borderUpColor:  '#4ADE80',
      borderDownColor:'#F87171',
      wickUpColor:    '#22C55E',
      wickDownColor:  '#EF4444',
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 }, // will be updated
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(43,255,241,0.15)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    // Logo watermark
    try {
      const img = new Image();
      img.src = '/logo.png';
      img.onload = () => {
        try {
          (chartRef.current as any)?.panes()[0]?.createImageWatermark(img, {
            maxWidth: 52, maxHeight: 52,
            padding: { bottom: 12, right: 12 },
            horzAlign: 'right', vertAlign: 'bottom',
            alpha: 0.18,
          });
        } catch { /* watermark optional */ }
      };
    } catch { /* skip */ }

    chartRef.current  = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  // When price format changes (different asset), update series precision
  useEffect(() => {
    if (!candleRef.current) return;
    const fmtKey = `${priceFormat.precision}`;
    if (fmtKey === lastFmtRef.current) return;
    lastFmtRef.current = fmtKey;
    candleRef.current.applyOptions({
      priceFormat: {
        type: 'price',
        precision: priceFormat.precision,
        minMove: priceFormat.minMove,
      },
    });
  }, [priceFormat]);

  // Update candle data
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !candles.length) return;

    candleRef.current.setData(
      candles.map(c => ({
        time:  (c.time / 1000) as any,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      }))
    );

    volumeRef.current.setData(
      candles.map(c => ({
        time:  (c.time / 1000) as any,
        value: c.volume,
        color: c.close >= c.open
          ? 'rgba(74,222,128,0.2)'
          : 'rgba(248,113,113,0.2)',
      }))
    );

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Live price tick
  useEffect(() => {
    if (!candleRef.current || !candles.length || livePrice <= 0) return;
    const last = candles[candles.length - 1];
    candleRef.current.update({
      time:  (last.time / 1000) as any,
      open:  last.open,
      high:  Math.max(last.high, livePrice),
      low:   Math.min(last.low, livePrice),
      close: livePrice,
    });
  }, [livePrice, candles]);

  // Position entry lines
  useEffect(() => {
    if (!candleRef.current) return;
    const open = positions.filter(p => p.status === 'open');
    // Remove old lines first (no API for this in lwc — just re-create)
    open.forEach(p => {
      try {
        candleRef.current?.createPriceLine({
          price:             p.entryPrice,
          color:             p.side === 'LONG' ? '#4ADE80' : '#F87171',
          lineWidth:         1,
          lineStyle:         2,
          axisLabelVisible:  true,
          title:             p.side,
        });
      } catch { /* skip */ }
    });
  }, [positions]);

  if (!candles.length) return (
    <div className="w-full h-full flex items-center justify-center text-[#4B5563] text-sm gap-2">
      <div className="w-4 h-4 border-2 border-[#2BFFF1]/25 border-t-[#2BFFF1] rounded-full animate-spin" />
      Loading chart…
    </div>
  );

  return <div ref={containerRef} className="w-full h-full" />;
}
