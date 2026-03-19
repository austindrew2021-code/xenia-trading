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

  // Create chart once
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
      upColor:   '#4ADE80',
      downColor: '#F87171',
      borderUpColor:   '#4ADE80',
      borderDownColor: '#F87171',
      wickUpColor:   '#4ADE80',
      wickDownColor: '#F87171',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(43,255,241,0.2)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current   = chart;
    candleRef.current  = candleSeries;
    volumeRef.current  = volumeSeries;

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
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

  // Update data when candles change
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || candles.length === 0) return;

    const candleData = candles.map(c => ({
      time: (c.time / 1000) as any,
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));

    const volumeData = candles.map(c => ({
      time:  (c.time / 1000) as any,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)',
    }));

    candleRef.current.setData(candleData);
    volumeRef.current.setData(volumeData);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Update live price line
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

  // Position lines
  useEffect(() => {
    if (!candleRef.current) return;
    const open = positions.filter(p => p.status === 'open');
    candleRef.current.applyOptions({
      lastValueVisible: true,
      priceLineVisible: true,
    });
    // Price lines for positions
    open.forEach(p => {
      candleRef.current?.createPriceLine({
        price: p.entryPrice,
        color: p.side === 'LONG' ? '#4ADE80' : '#F87171',
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: p.side,
      });
    });
  }, [positions]);

  if (candles.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-[#4B5563] text-sm">
        <div className="w-5 h-5 border-2 border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin mr-2" />
        Loading chart…
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full" />;
}
