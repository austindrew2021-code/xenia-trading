import { useEffect, useRef, useState, useMemo } from 'react';
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

type DrawTool = 'none' | 'hline' | 'orderblock';

export function PriceChart({ candles, livePrice, positions }: Props) {
  const wrapperRef   = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<'Candlestick', any> | null>(null);
  const volumeRef    = useRef<ISeriesApi<'Histogram', any> | null>(null);
  const priceLineRefs = useRef<any[]>([]);
  const fmtKeyRef    = useRef('');

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTool,   setActiveTool]   = useState<DrawTool>('none');
  const [drawStep,     setDrawStep]     = useState(0); // for 2-click tools
  const [drawStart,    setDrawStart]    = useState(0); // start price
  const [hint,         setHint]         = useState('');
  const [drawnCount,   setDrawnCount]   = useState(0);

  const priceFormat = useMemo(() => {
    if (!candles.length) return getPriceFormat(livePrice);
    const avg = candles.slice(-20).reduce((s,c) => s+c.close, 0) / Math.min(20, candles.length);
    return getPriceFormat(avg || livePrice);
  }, [candles, livePrice]);

  // Create chart
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
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 0.5,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      // ── KEY: disable ALL default scroll/scale so the page never scrolls ──
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        // vertTouchDrag: false prevents page scroll competition on mobile
        vertTouchDrag: false,
      },
      kineticScroll: { touch: false, mouse: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#4ADE80', downColor: '#F87171',
      borderUpColor: '#4ADE80', borderDownColor: '#F87171',
      wickUpColor: '#22C55E', wickDownColor: '#EF4444',
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(43,255,241,0.15)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    try {
      const img = new Image(); img.src = '/logo.png';
      img.onload = () => {
        try { (chart as any).panes()[0]?.createImageWatermark(img, { maxWidth:48, maxHeight:48, padding:{bottom:12,right:12}, horzAlign:'right', vertAlign:'bottom', alpha:0.15 }); } catch {}
      };
    } catch {}

    chartRef.current  = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    // ── Prevent the wrapper div from scrolling when user drags inside chart ──
    const el = containerRef.current;
    const stopProp = (e: Event) => e.stopPropagation();
    el.addEventListener('wheel', stopProp, { passive: false });
    el.addEventListener('touchmove', stopProp, { passive: false });

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', stopProp);
      el.removeEventListener('touchmove', stopProp);
      chart.remove();
      chartRef.current = null; candleRef.current = null; volumeRef.current = null;
    };
  }, []);

  // Update precision
  useEffect(() => {
    if (!candleRef.current) return;
    const key = `${priceFormat.precision}`;
    if (key === fmtKeyRef.current) return;
    fmtKeyRef.current = key;
    candleRef.current.applyOptions({ priceFormat: { type: 'price', precision: priceFormat.precision, minMove: priceFormat.minMove } });
  }, [priceFormat]);

  // Set candle data — clear first to avoid stale data flash
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !candles.length) return;
    candleRef.current.setData([]);
    volumeRef.current.setData([]);
    candleRef.current.setData(candles.map(c => ({ time:(c.time/1000) as any, open:c.open, high:c.high, low:c.low, close:c.close })));
    volumeRef.current.setData(candles.map(c => ({ time:(c.time/1000) as any, value:c.volume, color:c.close>=c.open?'rgba(74,222,128,0.2)':'rgba(248,113,113,0.2)' })));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Live tick
  useEffect(() => {
    if (!candleRef.current || !candles.length || livePrice <= 0) return;
    const last = candles[candles.length-1];
    try {
      candleRef.current.update({ time:(last.time/1000) as any, open:last.open, high:Math.max(last.high,livePrice), low:Math.min(last.low,livePrice), close:livePrice });
    } catch {}
  }, [livePrice, candles]);

  // Position lines
  useEffect(() => {
    if (!candleRef.current) return;
    priceLineRefs.current.forEach(pl => { try { candleRef.current?.removePriceLine(pl); } catch {} });
    priceLineRefs.current = [];
    positions.filter(p => p.status === 'open').forEach(p => {
      try {
        const pl = candleRef.current?.createPriceLine({ price:p.entryPrice, lineWidth:1, lineStyle:LineStyle.Dashed, color:p.side==='LONG'?'#4ADE80':'#F87171', axisLabelVisible:true, title:p.side });
        if (pl) priceLineRefs.current.push(pl);
      } catch {}
    });
  }, [positions]);

  // Escape fullscreen
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, []);

  // Drawing click handler
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || activeTool === 'none') return;
    const handler = (param: any) => {
      if (!param.point) return;
      const price = candleRef.current?.coordinateToPrice(param.point.y);
      if (!price || price <= 0) return;

      if (activeTool === 'hline') {
        try {
          const pl = candleRef.current?.createPriceLine({ price, lineWidth:1, lineStyle:LineStyle.Dashed, color:'#A78BFA', axisLabelVisible:true, title:`$${price.toFixed(priceFormat.precision)}` });
          if (pl) { priceLineRefs.current.push(pl); setDrawnCount(c=>c+1); }
        } catch {}
        setActiveTool('none'); setHint(''); setDrawStep(0);
      } else if (activeTool === 'orderblock') {
        if (drawStep === 0) {
          setDrawStart(price); setDrawStep(1); setHint('Click to set order block bottom');
        } else {
          const top    = Math.max(drawStart, price);
          const bottom = Math.min(drawStart, price);
          const isBull = price < drawStart;
          const color  = isBull ? '#4ADE80' : '#F87171';
          try {
            const pl1 = candleRef.current?.createPriceLine({ price:top,    lineWidth:2, lineStyle:LineStyle.Solid, color, axisLabelVisible:true, title:isBull?'OB ▲ Top':'OB ▼ Top' });
            const pl2 = candleRef.current?.createPriceLine({ price:bottom, lineWidth:2, lineStyle:LineStyle.Solid, color, axisLabelVisible:true, title:isBull?'OB ▲ Bot':'OB ▼ Bot' });
            if (pl1) priceLineRefs.current.push(pl1);
            if (pl2) priceLineRefs.current.push(pl2);
            setDrawnCount(c=>c+1);
          } catch {}
          setActiveTool('none'); setHint(''); setDrawStep(0);
        }
      }
    };
    chart.subscribeClick(handler);
    return () => { try { chart.unsubscribeClick(handler); } catch {} };
  }, [activeTool, drawStep, drawStart, priceFormat.precision]);

  const clearAll = () => {
    priceLineRefs.current.forEach(pl => { try { candleRef.current?.removePriceLine(pl); } catch {} });
    priceLineRefs.current = priceLineRefs.current.filter(pl => {
      // Keep position lines (they get re-added from positions effect)
      return false;
    });
    setDrawnCount(0);
  };

  const btnClass = (tool: DrawTool) =>
    `flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all border ${
      activeTool === tool
        ? 'bg-[#2BFFF1]/20 text-[#2BFFF1] border-[#2BFFF1]/40'
        : 'bg-white/[0.03] text-[#4B5563] border-white/[0.06] hover:text-[#A7B0B7] hover:border-white/[0.12]'
    }`;

  const chartContent = (
    <div className="relative flex flex-col w-full h-full bg-[#05060B]" ref={wrapperRef}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.05] flex-shrink-0 bg-[#05060B]">
        <button onClick={() => { setActiveTool(t => t==='hline'?'none':'hline'); setDrawStep(0); setHint(activeTool!=='hline'?'Click price to place horizontal line':''); }} className={btnClass('hline')} title="Horizontal Line">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="12" x2="21" y2="12"/></svg>H-Line
        </button>
        <button onClick={() => { setActiveTool(t => t==='orderblock'?'none':'orderblock'); setDrawStep(0); setHint(activeTool!=='orderblock'?'Click top of order block zone':''); }} className={btnClass('orderblock')} title="Order Block">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="1"/></svg>OB
        </button>
        {drawnCount > 0 && (
          <button onClick={clearAll} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] text-red-400/60 border border-red-500/15 bg-red-500/05 hover:text-red-400 transition-all">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>Clear
          </button>
        )}
        {hint && <span className="text-[9px] text-[#2BFFF1]/60 ml-1 animate-pulse">{hint}</span>}

        {/* Zoom hint */}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:block text-[9px] text-[#2D3748]">Drag price axis ↕ to zoom · Scroll to pan</span>
          <button onClick={() => setIsFullscreen(f => !f)}
            className="p-1.5 rounded-lg text-[#4B5563] hover:text-[#2BFFF1] border border-white/[0.05] hover:border-[#2BFFF1]/30 transition-all"
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
            {isFullscreen
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
            }
          </button>
        </div>
      </div>

      {/* Chart canvas */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 select-none"
        style={{ cursor: activeTool !== 'none' ? 'crosshair' : 'default', touchAction: 'none' }}
      />

      {/* Empty state */}
      {!candles.length && (
        <div className="absolute inset-0 flex items-center justify-center text-[#4B5563] text-sm gap-2 pointer-events-none">
          <div className="w-4 h-4 border-2 border-[#2BFFF1]/25 border-t-[#2BFFF1] rounded-full animate-spin" />
          Loading chart…
        </div>
      )}
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-[300]" style={{ touchAction: 'none' }}>
        {chartContent}
      </div>
    );
  }

  return <div className="w-full h-full" style={{ touchAction: 'none' }}>{chartContent}</div>;
}
