import { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { Candle } from '../types';

interface Props {
  candles: Candle[];
  livePrice: number;
  positions: { entryPrice: number; side: string; status: string }[];
}

export function PriceChart({ candles, livePrice, positions }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<'Candlestick', any> | null>(null);
  const volumeRef    = useRef<ISeriesApi<'Histogram', any> | null>(null);
  const wmRef        = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#4B5563',
        fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.03)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(43,255,241,0.3)', labelBackgroundColor: '#0B0E14' },
        horzLine: { color: 'rgba(43,255,241,0.3)', labelBackgroundColor: '#0B0E14' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        textColor: '#4B5563',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:        '#4ADE80',
      downColor:      '#F87171',
      borderUpColor:  '#4ADE80',
      borderDownColor:'#F87171',
      wickUpColor:    '#4ADE80',
      wickDownColor:  '#F87171',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(43,255,241,0.2)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    // ── Logo watermark using our logo.png instead of TradingView ──────────
    try {
      const img = new Image();
      img.src = '/logo.png';
      img.onload = () => {
        if (chartRef.current) {
          const wm = (chartRef.current as any).panes()[0].createImageWatermark(img, {
            maxWidth: 60, maxHeight: 60,
            padding: { bottom: 14, right: 14 },
            horzAlign: 'right',
            vertAlign: 'bottom',
            alpha: 0.25,
          });
          wmRef.current = wm;
        }
      };
    } catch { /* watermark optional */ }

    chartRef.current  = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; candleRef.current = null; volumeRef.current = null; };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !candles.length) return;
    candleRef.current.setData(candles.map(c => ({ time:(c.time/1000) as any, open:c.open, high:c.high, low:c.low, close:c.close })));
    volumeRef.current.setData(candles.map(c => ({ time:(c.time/1000) as any, value:c.volume, color:c.close>=c.open?'rgba(74,222,128,0.25)':'rgba(248,113,113,0.25)' })));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    if (!candleRef.current || !candles.length || livePrice <= 0) return;
    const last = candles[candles.length-1];
    candleRef.current.update({ time:(last.time/1000) as any, open:last.open, high:Math.max(last.high,livePrice), low:Math.min(last.low,livePrice), close:livePrice });
  }, [livePrice, candles]);

  if (candles.length === 0) return (
    <div className="w-full h-full flex items-center justify-center text-[#4B5563] text-sm gap-2">
      <div className="w-4 h-4 border-2 border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />
      Loading chart…
    </div>
  );

  return <div ref={containerRef} className="w-full h-full" />;
}
