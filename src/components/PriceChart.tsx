import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  IChartApi, ISeriesApi, CandlestickSeries, HistogramSeries,
} from 'lightweight-charts';
import { Candle } from '../types';

interface Props {
  candles: Candle[];
  livePrice: number;
  positions: { entryPrice: number; side: string; status: string }[];
}

function getPriceFormat(price: number) {
  if (!price || price <= 0) return { precision: 2, minMove: 0.01 };
  if (price >= 1000)  return { precision: 2, minMove: 0.01 };
  if (price >= 100)   return { precision: 3, minMove: 0.001 };
  if (price >= 10)    return { precision: 4, minMove: 0.0001 };
  if (price >= 1)     return { precision: 5, minMove: 0.00001 };
  if (price >= 0.1)   return { precision: 6, minMove: 0.000001 };
  if (price >= 0.01)  return { precision: 7, minMove: 0.0000001 };
  if (price >= 0.001) return { precision: 8, minMove: 0.00000001 };
  if (price >= 0.0001)return { precision: 9, minMove: 0.000000001 };
  return               { precision: 10,minMove: 0.0000000001 };
}

export function formatPrice(price: number): string {
  if (!price || price <= 0) return '$0.00';
  const { precision } = getPriceFormat(price);
  return `$${price.toFixed(Math.min(precision, 12))}`;
}

type DrawTool = 'none' | 'trendline' | 'orderblock' | 'hline';

interface DrawnObject {
  id: string;
  type: DrawTool;
  priceLine?: any;
  series?: any;
}

export function PriceChart({ candles, livePrice, positions }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const candleRef     = useRef<ISeriesApi<'Candlestick', any> | null>(null);
  const volumeRef     = useRef<ISeriesApi<'Histogram', any> | null>(null);
  const fmtKeyRef     = useRef('');
  const drawnRef      = useRef<DrawnObject[]>([]);
  const drawStateRef  = useRef<{ tool: DrawTool; startPrice: number; startTime: number }>({ tool: 'none', startPrice: 0, startTime: 0 });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTool, setActiveTool]     = useState<DrawTool>('none');
  const [drawingInfo, setDrawingInfo]   = useState('');

  const priceFormat = useMemo(() => {
    if (!candles.length) return getPriceFormat(livePrice);
    const avg = candles.slice(-20).reduce((s,c) => s + c.close, 0) / Math.min(20, candles.length);
    return getPriceFormat(avg || livePrice);
  }, [candles, livePrice]);

  // Build chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#05060B' },
        textColor: '#4B5563',
        fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.025)' },
        horzLines: { color: 'rgba(255,255,255,0.025)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(43,255,241,0.4)', labelBackgroundColor: '#0B0E14' },
        horzLine: { color: 'rgba(43,255,241,0.4)', labelBackgroundColor: '#0B0E14' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        textColor: '#4B5563',
        scaleMargins: { top: 0.08, bottom: 0.22 },
        // Allow mouse drag on price axis to scale
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,      // default candle width
        minBarSpacing: 1,   // allow zooming all the way in
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true }, // drag price axis to resize
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
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(43,255,241,0.15)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    // Watermark
    try {
      const img = new Image();
      img.src = '/logo.png';
      img.onload = () => {
        try {
          (chart as any).panes()[0]?.createImageWatermark(img, {
            maxWidth: 48, maxHeight: 48,
            padding: { bottom: 12, right: 12 },
            horzAlign: 'right', vertAlign: 'bottom', alpha: 0.15,
          });
        } catch { /* skip */ }
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
      chartRef.current = null; candleRef.current = null; volumeRef.current = null;
    };
  }, []);

  // Update precision when asset changes
  useEffect(() => {
    if (!candleRef.current) return;
    const key = `${priceFormat.precision}`;
    if (key === fmtKeyRef.current) return;
    fmtKeyRef.current = key;
    candleRef.current.applyOptions({
      priceFormat: { type: 'price', precision: priceFormat.precision, minMove: priceFormat.minMove },
    });
  }, [priceFormat]);

  // Set candle data
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !candles.length) return;
    candleRef.current.setData(candles.map(c => ({
      time:(c.time/1000) as any, open:c.open, high:c.high, low:c.low, close:c.close,
    })));
    volumeRef.current.setData(candles.map(c => ({
      time:(c.time/1000) as any, value:c.volume,
      color: c.close >= c.open ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)',
    })));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Live price update
  useEffect(() => {
    if (!candleRef.current || !candles.length || livePrice <= 0) return;
    const last = candles[candles.length-1];
    candleRef.current.update({
      time:(last.time/1000) as any, open:last.open,
      high:Math.max(last.high,livePrice), low:Math.min(last.low,livePrice), close:livePrice,
    });
  }, [livePrice, candles]);

  // Position entry lines
  useEffect(() => {
    if (!candleRef.current) return;
    positions.filter(p => p.status === 'open').forEach(p => {
      try {
        candleRef.current?.createPriceLine({
          price: p.entryPrice, lineWidth: 1, lineStyle: LineStyle.Dashed,
          color: p.side === 'LONG' ? '#4ADE80' : '#F87171',
          axisLabelVisible: true, title: p.side,
        });
      } catch { /* skip */ }
    });
  }, [positions]);

  // ── Drawing tools ──────────────────────────────────────────────────────
  const handleToolSelect = useCallback((tool: DrawTool) => {
    setActiveTool(prev => prev === tool ? 'none' : tool);
    if (activeTool === tool) {
      setDrawingInfo('');
    } else {
      const hints: Record<DrawTool, string> = {
        trendline:  'Click to set start point, click again to draw trend line',
        orderblock: 'Click drag to create order block zone',
        hline:      'Click price level to draw horizontal line',
        none: '',
      };
      setDrawingInfo(hints[tool]);
    }
  }, [activeTool]);

  const clearDrawings = useCallback(() => {
    drawnRef.current.forEach(d => {
      try { d.priceLine && candleRef.current?.removePriceLine(d.priceLine); } catch { /* skip */ }
    });
    drawnRef.current = [];
  }, []);

  // Chart click handler for drawing tools
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = (param: any) => {
      const tool = drawStateRef.current.tool;
      if (tool === 'none' || !param.point || !param.time) return;

      const price = candleRef.current?.coordinateToPrice(param.point.y) ?? 0;
      if (!price || price <= 0) return;

      if (tool === 'hline') {
        // Draw horizontal line
        const pl = candleRef.current?.createPriceLine({
          price, lineWidth: 1, lineStyle: LineStyle.Dashed,
          color: '#A78BFA', axisLabelVisible: true, title: `$${price.toFixed(priceFormat.precision)}`,
        });
        if (pl) drawnRef.current.push({ id: Math.random().toString(), type: 'hline', priceLine: pl });
        drawStateRef.current = { tool: 'none', startPrice: 0, startTime: 0 };
        setActiveTool('none');
        setDrawingInfo('');
      } else if (tool === 'trendline') {
        if (!drawStateRef.current.startPrice) {
          drawStateRef.current = { tool, startPrice: price, startTime: param.time };
          setDrawingInfo('Start set — click end point');
        } else {
          // Draw trend line as a horizontal at midpoint (LWC doesn't support diagonal lines natively)
          const midPrice = (drawStateRef.current.startPrice + price) / 2;
          const pl = candleRef.current?.createPriceLine({
            price: midPrice, lineWidth: 1, lineStyle: LineStyle.Solid,
            color: '#2BFFF1', axisLabelVisible: true, title: 'Trend',
          });
          if (pl) drawnRef.current.push({ id: Math.random().toString(), type: 'trendline', priceLine: pl });
          drawStateRef.current = { tool: 'none', startPrice: 0, startTime: 0 };
          setActiveTool('none');
          setDrawingInfo('');
        }
      } else if (tool === 'orderblock') {
        if (!drawStateRef.current.startPrice) {
          drawStateRef.current = { tool, startPrice: price, startTime: param.time };
          setDrawingInfo('Start set — click to set block height');
        } else {
          // Draw two lines forming the order block zone
          const top    = Math.max(drawStateRef.current.startPrice, price);
          const bottom = Math.min(drawStateRef.current.startPrice, price);
          const isBull = price > drawStateRef.current.startPrice;
          const color  = isBull ? '#4ADE80' : '#F87171';
          const plTop = candleRef.current?.createPriceLine({
            price: top, lineWidth: 2, lineStyle: LineStyle.Solid,
            color, axisLabelVisible: true, title: isBull ? 'OB Top' : 'OB Top',
          });
          const plBot = candleRef.current?.createPriceLine({
            price: bottom, lineWidth: 2, lineStyle: LineStyle.Solid,
            color, axisLabelVisible: true, title: 'OB Bot',
          });
          const id = Math.random().toString();
          if (plTop) drawnRef.current.push({ id, type: 'orderblock', priceLine: plTop });
          if (plBot) drawnRef.current.push({ id, type: 'orderblock', priceLine: plBot });
          drawStateRef.current = { tool: 'none', startPrice: 0, startTime: 0 };
          setActiveTool('none');
          setDrawingInfo('');
        }
      }
    };

    chart.subscribeClick(handler);
    return () => { try { chart.unsubscribeClick(handler); } catch { /* skip */ } };
  }, [priceFormat.precision]);

  // Sync activeTool → drawStateRef
  useEffect(() => {
    drawStateRef.current = { tool: activeTool, startPrice: 0, startTime: 0 };
  }, [activeTool]);

  // Fullscreen escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  if (!candles.length) return (
    <div className="w-full h-full flex items-center justify-center text-[#4B5563] text-sm gap-2 bg-[#05060B]">
      <div className="w-4 h-4 border-2 border-[#2BFFF1]/25 border-t-[#2BFFF1] rounded-full animate-spin" />
      Loading chart…
    </div>
  );

  const toolbarBtnClass = (tool: DrawTool) =>
    `px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all border ${
      activeTool === tool
        ? 'bg-[#2BFFF1]/20 text-[#2BFFF1] border-[#2BFFF1]/40'
        : 'bg-white/[0.03] text-[#4B5563] border-white/[0.06] hover:text-[#A7B0B7] hover:border-white/[0.12]'
    }`;

  const chartEl = (
    <div className="relative w-full h-full flex flex-col bg-[#05060B]">
      {/* Drawing toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.05] flex-shrink-0">
        <button onClick={() => handleToolSelect('trendline')} className={toolbarBtnClass('trendline')} title="Trend Line">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="20" x2="21" y2="4"/></svg>
        </button>
        <button onClick={() => handleToolSelect('hline')} className={toolbarBtnClass('hline')} title="Horizontal Line">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="12" x2="21" y2="12"/></svg>
        </button>
        <button onClick={() => handleToolSelect('orderblock')} className={toolbarBtnClass('orderblock')} title="Order Block">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="1"/><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2"/></svg>
        </button>
        {drawnRef.current.length > 0 && (
          <button onClick={clearDrawings} className="px-2 py-1.5 rounded-lg text-[10px] text-red-400/60 border border-red-500/15 bg-red-500/05 hover:text-red-400 hover:border-red-500/30 transition-all" title="Clear drawings">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        )}
        {drawingInfo && (
          <span className="text-[10px] text-[#2BFFF1]/70 ml-2 animate-pulse">{drawingInfo}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[9px] text-[#374151]">Drag price axis to zoom ↕</span>
          <button onClick={() => setIsFullscreen(f => !f)}
            className="p-1.5 rounded-lg text-[#4B5563] hover:text-[#2BFFF1] border border-white/[0.06] hover:border-[#2BFFF1]/30 transition-all"
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
            {isFullscreen
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
            }
          </button>
        </div>
      </div>
      {/* Chart canvas */}
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-[300] bg-[#05060B]" style={{ cursor: activeTool !== 'none' ? 'crosshair' : 'default' }}>
        {chartEl}
      </div>
    );
  }

  return (
    <div className="w-full h-full" style={{ cursor: activeTool !== 'none' ? 'crosshair' : 'default' }}>
      {chartEl}
    </div>
  );
}
