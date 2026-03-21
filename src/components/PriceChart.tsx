import { useEffect, useRef, useState, useMemo } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  IChartApi, ISeriesApi, CandlestickSeries, HistogramSeries,
  PriceScaleMode,
} from 'lightweight-charts';
import { Candle } from '../types';

interface Props {
  candles: Candle[];
  livePrice: number;
  positions: { entryPrice: number; side: string; status: string }[];
  onQuickTP?: (price: number) => void;
  onQuickSL?: (price: number) => void;
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

interface ContextMenu { x: number; y: number; price: number; }

export function PriceChart({ candles, livePrice, positions, onQuickTP, onQuickSL }: Props) {
  const wrapperRef    = useRef<HTMLDivElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const candleRef     = useRef<ISeriesApi<'Candlestick', any> | null>(null);
  const volumeRef     = useRef<ISeriesApi<'Histogram', any> | null>(null);
  const posLinesRef   = useRef<any[]>([]);
  const drawnRef      = useRef<any[]>([]);
  const fmtKeyRef     = useRef('');
  const holdTimer     = useRef<ReturnType<typeof setTimeout>>();
  const lastParamRef  = useRef<any>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTool,   setActiveTool]   = useState<DrawTool>('none');
  const [drawStep,     setDrawStep]     = useState(0);
  const [drawStart,    setDrawStart]    = useState(0);
  const [hint,         setHint]         = useState('');
  const [drawnCount,   setDrawnCount]   = useState(0);
  const [contextMenu,  setContextMenu]  = useState<ContextMenu | null>(null);

  const priceFormat = useMemo(() => {
    if (!candles.length) return getPriceFormat(livePrice);
    const avg = candles.slice(-20).reduce((s,c) => s+c.close, 0) / Math.min(20, candles.length);
    return getPriceFormat(avg || livePrice);
  }, [candles, livePrice]);

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
        textColor: '#6B7280',
        scaleMargins: { top: 0.08, bottom: 0.22 },
        autoScale: true,
        // Allow mouse drag on price scale for zooming
        mode: PriceScaleMode.Normal,
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 0.5,
      },
      handleScale: {
        // This is the key setting — allows dragging the price axis
        axisPressedMouseMove: {
          time: true,
          price: true, // drag price axis to scale vertically
        },
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      kineticScroll: { touch: false, mouse: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:'#4ADE80', downColor:'#F87171',
      borderUpColor:'#4ADE80', borderDownColor:'#F87171',
      wickUpColor:'#22C55E', wickDownColor:'#EF4444',
      priceFormat: { type:'price', precision:8, minMove:0.00000001 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color:'rgba(43,255,241,0.15)',
      priceFormat:{ type:'volume' },
      priceScaleId:'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins:{ top:0.82, bottom:0 } });

    // Logo watermark
    try {
      const img = new Image(); img.src = '/logo.png';
      img.onload = () => {
        try {
          (chart as any).panes()[0]?.createImageWatermark(img, {
            maxWidth:48, maxHeight:48, padding:{bottom:12,right:12},
            horzAlign:'right', vertAlign:'bottom', alpha:0.15,
          });
        } catch { /* skip */ }
      };
    } catch { /* skip */ }

    chart.subscribeCrosshairMove((param) => { lastParamRef.current = param; });

    chartRef.current  = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    // Block page scroll when inside chart canvas
    const el = containerRef.current;
    const preventScroll = (e: WheelEvent) => { e.stopPropagation(); };
    el.addEventListener('wheel', preventScroll, { passive: false });

    // ── Custom touch handler for price axis drag (right ~60px) ──────────
    // lightweight-charts doesn't route touch events to price scale natively,
    // so we implement vertical-drag-to-zoom manually for that region.
    let priceAxisTouch: { startY: number; startMarginTop: number; startMarginBottom: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const touch = e.touches[0];
      const AXIS_WIDTH = 68; // px — width of right price axis column
      const touchX = touch.clientX - rect.left;

      if (touchX > rect.width - AXIS_WIDTH) {
        // Touch on price axis zone — capture for vertical scale drag
        // preventDefault stops the page from scrolling but does NOT stop LWC
        e.preventDefault();
        const curOpts = chart.priceScale('right').options() as any;
        priceAxisTouch = {
          startY: touch.clientY,
          startMarginTop:    curOpts?.scaleMargins?.top    ?? 0.08,
          startMarginBottom: curOpts?.scaleMargins?.bottom ?? 0.22,
        };
      }
      // For chart body: do NOT call stopPropagation — LWC needs the event for panning
    };

    const onTouchMove = (e: TouchEvent) => {
      if (priceAxisTouch && e.touches.length === 1) {
        // We own this touch — scale the price axis
        e.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const deltaY = (e.touches[0].clientY - priceAxisTouch.startY) / rect.height;
        // Up = zoom in (tighten margins so candles appear larger)
        // Down = zoom out (widen margins to show more price range)
        const sensitivity = 0.2;
        const newTop    = Math.max(0,    Math.min(0.45, priceAxisTouch.startMarginTop    + deltaY * sensitivity));
        const newBottom = Math.max(0.05, Math.min(0.55, priceAxisTouch.startMarginBottom - deltaY * sensitivity));
        chart.priceScale('right').applyOptions({ scaleMargins: { top: newTop, bottom: newBottom } });
        return;
      }
      // Chart body: do NOT call stopPropagation — LWC handles horizontal drag for panning
    };

    const onTouchEnd = () => { priceAxisTouch = null; };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });
    el.addEventListener('touchend',   onTouchEnd,   { passive: true });

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width:containerRef.current.clientWidth, height:containerRef.current.clientHeight });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', preventScroll);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
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
    candleRef.current.applyOptions({
      priceFormat: { type:'price', precision:priceFormat.precision, minMove:priceFormat.minMove },
    });
  }, [priceFormat]);

  // Candle data — clear before set to avoid stale data flash
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !candles.length) return;
    candleRef.current.setData([]);
    volumeRef.current.setData([]);
    candleRef.current.setData(candles.map(c => ({
      time:(c.time/1000) as any, open:c.open, high:c.high, low:c.low, close:c.close,
    })));
    volumeRef.current.setData(candles.map(c => ({
      time:(c.time/1000) as any, value:c.volume,
      color:c.close>=c.open?'rgba(74,222,128,0.2)':'rgba(248,113,113,0.2)',
    })));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Live price tick
  useEffect(() => {
    if (!candleRef.current || !candles.length || livePrice <= 0) return;
    const last = candles[candles.length-1];
    try {
      candleRef.current.update({
        time:(last.time/1000) as any, open:last.open,
        high:Math.max(last.high,livePrice), low:Math.min(last.low,livePrice), close:livePrice,
      });
    } catch { /* skip */ }
  }, [livePrice, candles]);

  // Position lines
  useEffect(() => {
    if (!candleRef.current) return;
    posLinesRef.current.forEach(pl => { try { candleRef.current?.removePriceLine(pl); } catch {} });
    posLinesRef.current = [];
    positions.filter(p => p.status === 'open').forEach(p => {
      try {
        const pl = candleRef.current?.createPriceLine({
          price:p.entryPrice, lineWidth:1, lineStyle:LineStyle.Dashed,
          color:p.side==='LONG'?'#4ADE80':'#F87171', axisLabelVisible:true, title:p.side,
        });
        if (pl) posLinesRef.current.push(pl);
      } catch { /* skip */ }
    });
  }, [positions]);

  // Escape key
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setIsFullscreen(false); setContextMenu(null); }
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, []);

  // Drawing tool handler
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || activeTool === 'none') return;
    const handler = (param: any) => {
      if (!param.point) return;
      const price = candleRef.current?.coordinateToPrice(param.point.y);
      if (!price || price <= 0) return;

      if (activeTool === 'hline') {
        try {
          const pl = candleRef.current?.createPriceLine({
            price, lineWidth:1, lineStyle:LineStyle.Dashed,
            color:'#A78BFA', axisLabelVisible:true, title:formatPrice(price),
          });
          if (pl) { drawnRef.current.push(pl); setDrawnCount(c=>c+1); }
        } catch { /* skip */ }
        setActiveTool('none'); setHint(''); setDrawStep(0);
      } else if (activeTool === 'orderblock') {
        if (drawStep === 0) {
          setDrawStart(price); setDrawStep(1); setHint('Click bottom of zone');
        } else {
          const top = Math.max(drawStart, price); const bottom = Math.min(drawStart, price);
          const isBull = price < drawStart;
          const color = isBull ? '#4ADE80' : '#F87171';
          try {
            const pl1 = candleRef.current?.createPriceLine({ price:top, lineWidth:2, lineStyle:LineStyle.Solid, color, axisLabelVisible:true, title:isBull?'OB Top':'OB Top' });
            const pl2 = candleRef.current?.createPriceLine({ price:bottom, lineWidth:2, lineStyle:LineStyle.Solid, color, axisLabelVisible:true, title:'OB Bot' });
            if (pl1) drawnRef.current.push(pl1);
            if (pl2) drawnRef.current.push(pl2);
            setDrawnCount(c=>c+1);
          } catch { /* skip */ }
          setActiveTool('none'); setHint(''); setDrawStep(0);
        }
      }
    };
    chart.subscribeClick(handler);
    return () => { try { chart.unsubscribeClick(handler); } catch {} };
  }, [activeTool, drawStep, drawStart]);

  // Context menu (right-click / long-press)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool !== 'none') return;
    holdTimer.current = setTimeout(() => {
      const param = lastParamRef.current;
      if (!param?.point) return;
      const price = candleRef.current?.coordinateToPrice(param.point.y);
      if (!price || price <= 0) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setContextMenu({ x: Math.min(e.clientX - rect.left, rect.width - 180), y: Math.min(e.clientY - rect.top, rect.height - 120), price });
    }, 500);
  };

  const handleMouseUp = () => clearTimeout(holdTimer.current);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const param = lastParamRef.current;
    if (!param?.point) return;
    const price = candleRef.current?.coordinateToPrice(param.point.y);
    if (!price || price <= 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContextMenu({ x: Math.min(e.clientX - rect.left, rect.width - 180), y: Math.min(e.clientY - rect.top, rect.height - 120), price });
  };

  const handleQuickTP = (price: number) => {
    if (onQuickTP) onQuickTP(price);
    try {
      const pl = candleRef.current?.createPriceLine({ price, lineWidth:2, lineStyle:LineStyle.Dashed, color:'#4ADE80', axisLabelVisible:true, title:'TP' });
      if (pl) drawnRef.current.push(pl);
    } catch { /* skip */ }
    setContextMenu(null);
  };

  const handleQuickSL = (price: number) => {
    if (onQuickSL) onQuickSL(price);
    try {
      const pl = candleRef.current?.createPriceLine({ price, lineWidth:2, lineStyle:LineStyle.Dashed, color:'#F87171', axisLabelVisible:true, title:'SL' });
      if (pl) drawnRef.current.push(pl);
    } catch { /* skip */ }
    setContextMenu(null);
  };

  const clearAll = () => {
    drawnRef.current.forEach(pl => { try { candleRef.current?.removePriceLine(pl); } catch {} });
    drawnRef.current = []; setDrawnCount(0);
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
        <button onClick={() => { setActiveTool(t => t==='hline'?'none':'hline'); setDrawStep(0); setHint(activeTool!=='hline'?'Click a price level':''); }} className={btnClass('hline')} title="H-Line">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="12" x2="21" y2="12"/></svg>
          <span className="hidden sm:inline">H-Line</span>
        </button>
        <button onClick={() => { setActiveTool(t => t==='orderblock'?'none':'orderblock'); setDrawStep(0); setHint(activeTool!=='orderblock'?'Click zone top':''); }} className={btnClass('orderblock')} title="Order Block">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="1"/></svg>
          <span className="hidden sm:inline">OB</span>
        </button>
        {drawnCount > 0 && (
          <button onClick={clearAll} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] text-red-400/60 border border-red-500/15 bg-red-500/05 hover:text-red-400 transition-all">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
            <span className="hidden sm:inline">Clear</span>
          </button>
        )}
        {hint && <span className="text-[9px] text-[#2BFFF1]/60 ml-1 animate-pulse hidden sm:inline">{hint}</span>}

        <div className="ml-auto flex items-center gap-1.5">
          {/* Price axis hint */}
          <span className="hidden lg:block text-[9px] text-[#2D3748]">Drag price axis ↕ · Scroll time axis ↔</span>
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

      {/* Chart */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 select-none"
        style={{ cursor: activeTool !== 'none' ? 'crosshair' : 'default', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
      />

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="absolute inset-0 z-10" onClick={() => setContextMenu(null)}/>
          <div className="absolute z-20 bg-[#0B0E14] border border-white/[0.12] rounded-xl shadow-2xl py-1 min-w-44"
            style={{ left: contextMenu.x, top: contextMenu.y }}>
            <div className="px-3 py-1.5 border-b border-white/[0.06] mb-1">
              <p className="text-[9px] text-[#4B5563] uppercase tracking-wide">At {formatPrice(contextMenu.price)}</p>
            </div>
            {onQuickTP && (
              <button onClick={() => handleQuickTP(contextMenu.price)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-green-400 hover:bg-green-500/10 transition-all text-left">
                <div className="w-2 h-2 rounded-full bg-green-400"/>Set Take Profit
              </button>
            )}
            {onQuickSL && (
              <button onClick={() => handleQuickSL(contextMenu.price)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-all text-left">
                <div className="w-2 h-2 rounded-full bg-red-400"/>Set Stop Loss
              </button>
            )}
            <button onClick={() => { setActiveTool('hline'); setContextMenu(null); setHint(''); const pl=candleRef.current?.createPriceLine({price:contextMenu.price,lineWidth:1,lineStyle:LineStyle.Dashed,color:'#A78BFA',axisLabelVisible:true,title:formatPrice(contextMenu.price)}); if(pl){drawnRef.current.push(pl);setDrawnCount(c=>c+1);} }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#A78BFA] hover:bg-[#A78BFA]/10 transition-all text-left">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="12" x2="21" y2="12"/></svg>
              Draw H-Line here
            </button>
            <div className="border-t border-white/[0.06] mt-1 pt-1">
              <button onClick={() => setContextMenu(null)} className="w-full text-left px-3 py-1.5 text-[10px] text-[#4B5563] hover:text-[#A7B0B7] transition-all">Cancel</button>
            </div>
          </div>
        </>
      )}

      {!candles.length && (
        <div className="absolute inset-0 flex items-center justify-center text-[#4B5563] text-sm gap-2 pointer-events-none">
          <div className="w-4 h-4 border-2 border-[#2BFFF1]/25 border-t-[#2BFFF1] rounded-full animate-spin"/>
          Loading chart…
        </div>
      )}
    </div>
  );

  if (isFullscreen) {
    return <div className="fixed inset-0 z-[300]" style={{ touchAction:'none' }}>{chartContent}</div>;
  }

  return <div className="w-full h-full" style={{ touchAction:'none' }}>{chartContent}</div>;
}
