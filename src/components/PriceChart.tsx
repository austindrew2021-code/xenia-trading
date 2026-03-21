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

// Width of the right price axis column in pixels
const PRICE_AXIS_WIDTH = 70;

export function PriceChart({ candles, livePrice, positions, onQuickTP, onQuickSL }: Props) {
  const wrapperRef     = useRef<HTMLDivElement>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  // Overlay div that sits exactly on top of the price axis — intercepts its touch events
  const axisOverlayRef = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  const candleRef      = useRef<ISeriesApi<'Candlestick', any> | null>(null);
  const volumeRef      = useRef<ISeriesApi<'Histogram', any> | null>(null);
  const posLinesRef    = useRef<any[]>([]);
  const drawnRef       = useRef<any[]>([]);
  const fmtKeyRef      = useRef('');
  const holdTimer      = useRef<ReturnType<typeof setTimeout>>();
  const lastParamRef   = useRef<any>(null);

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
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,   // LWC handles chart body vertical pan
      },
      kineticScroll: { touch: true, mouse: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:'#4ADE80', downColor:'#F87171',
      borderUpColor:'#4ADE80', borderDownColor:'#F87171',
      wickUpColor:'#22C55E', wickDownColor:'#EF4444',
      priceFormat: { type:'price', precision:8, minMove:0.00000001 },
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color:'rgba(43,255,241,0.15)', priceFormat:{ type:'volume' }, priceScaleId:'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins:{ top:0.82, bottom:0 } });

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

    // Block page wheel scroll inside the chart area
    const el = containerRef.current;
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stopWheel, { passive: false });

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width:containerRef.current.clientWidth, height:containerRef.current.clientHeight });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', stopWheel);
      chart.remove();
      chartRef.current = null; candleRef.current = null; volumeRef.current = null;
    };
  }, []);

  // ── Price axis overlay: dedicated element that captures ONLY the axis zone ─
  // This element sits over the price axis column and handles ALL its touch events.
  // The chart canvas below is completely unaffected — LWC gets 100% of chart body touches.
  useEffect(() => {
    const overlay = axisOverlayRef.current;
    const chart   = chartRef.current;
    if (!overlay || !chart) return;

    interface AxisDrag { startY: number; centerPrice: number; halfRange: number; }
    let drag: AxisDrag | null = null;

    const getRange = (): { center: number; half: number } | null => {
      const series = candleRef.current;
      const el     = containerRef.current;
      if (!series || !el) return null;
      const h = el.clientHeight;
      const top    = series.coordinateToPrice(10);
      const center = series.coordinateToPrice(h / 2);
      const bottom = series.coordinateToPrice(h - 10);
      if (top == null || center == null || bottom == null) return null;
      return { center, half: Math.abs(top - bottom) / 2 };
    };

    const applyRange = (min: number, max: number) => {
      if (!candleRef.current) return;
      candleRef.current.applyOptions({
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: min, maxValue: max },
          margins: { above: 0, below: 0 },
        }),
      });
    };

    const onStart = (clientY: number) => {
      const r = getRange();
      if (!r) return;
      drag = { startY: clientY, centerPrice: r.center, halfRange: r.half };
    };

    const onMove = (clientY: number) => {
      if (!drag) return;
      const deltaY  = clientY - drag.startY;
      // 80px per doubling — same exponential feel as TradingView
      const factor  = Math.pow(2, deltaY / 80);
      const newHalf = Math.max(drag.centerPrice * 0.00001, drag.halfRange * factor);
      applyRange(drag.centerPrice - newHalf, drag.centerPrice + newHalf);
    };

    const onEnd = () => { drag = null; };

    const onDblClick = () => {
      if (!candleRef.current) return;
      candleRef.current.applyOptions({ autoscaleInfoProvider: undefined });
    };

    // Touch (mobile) — no passive so we can preventDefault to block page scroll
    const onTouchStart = (e: TouchEvent) => { e.preventDefault(); onStart(e.touches[0].clientY); };
    const onTouchMove  = (e: TouchEvent) => { e.preventDefault(); onMove(e.touches[0].clientY); };
    const onTouchEnd   = () => onEnd();

    // Mouse (desktop) — the overlay intercepts mouse down on the axis zone
    const onMouseDown  = (e: MouseEvent) => { e.preventDefault(); onStart(e.clientY); };
    const onMouseMove  = (e: MouseEvent) => { onMove(e.clientY); };
    const onMouseUp    = () => onEnd();

    overlay.addEventListener('touchstart',  onTouchStart, { passive: false });
    overlay.addEventListener('touchmove',   onTouchMove,  { passive: false });
    overlay.addEventListener('touchend',    onTouchEnd,   { passive: true  });
    overlay.addEventListener('dblclick',    onDblClick);
    overlay.addEventListener('mousedown',   onMouseDown);
    document.addEventListener('mousemove',  onMouseMove);
    document.addEventListener('mouseup',    onMouseUp);

    return () => {
      overlay.removeEventListener('touchstart',  onTouchStart);
      overlay.removeEventListener('touchmove',   onTouchMove);
      overlay.removeEventListener('touchend',    onTouchEnd);
      overlay.removeEventListener('dblclick',    onDblClick);
      overlay.removeEventListener('mousedown',   onMouseDown);
      document.removeEventListener('mousemove',  onMouseMove);
      document.removeEventListener('mouseup',    onMouseUp);
    };
  }, []);

  // Precision
  useEffect(() => {
    if (!candleRef.current) return;
    const key = `${priceFormat.precision}`;
    if (key === fmtKeyRef.current) return;
    fmtKeyRef.current = key;
    candleRef.current.applyOptions({
      priceFormat: { type:'price', precision:priceFormat.precision, minMove:priceFormat.minMove },
    });
  }, [priceFormat]);

  // Candle data
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

  // Live price
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

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setIsFullscreen(false); setContextMenu(null); }
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, []);

  // Drawing tools
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || activeTool === 'none') return;
    const handler = (param: any) => {
      if (!param.point) return;
      const price = candleRef.current?.coordinateToPrice(param.point.y);
      if (!price || price <= 0) return;
      if (activeTool === 'hline') {
        try {
          const pl = candleRef.current?.createPriceLine({ price, lineWidth:1, lineStyle:LineStyle.Dashed, color:'#A78BFA', axisLabelVisible:true, title:formatPrice(price) });
          if (pl) { drawnRef.current.push(pl); setDrawnCount(c=>c+1); }
        } catch { /* skip */ }
        setActiveTool('none'); setHint(''); setDrawStep(0);
      } else if (activeTool === 'orderblock') {
        if (drawStep === 0) { setDrawStart(price); setDrawStep(1); setHint('Click bottom of zone'); }
        else {
          const top = Math.max(drawStart, price); const bottom = Math.min(drawStart, price);
          const isBull = price < drawStart; const color = isBull ? '#4ADE80' : '#F87171';
          try {
            const pl1 = candleRef.current?.createPriceLine({ price:top, lineWidth:2, lineStyle:LineStyle.Solid, color, axisLabelVisible:true, title:isBull?'OB Top':'OB Top' });
            const pl2 = candleRef.current?.createPriceLine({ price:bottom, lineWidth:2, lineStyle:LineStyle.Solid, color, axisLabelVisible:true, title:'OB Bot' });
            if (pl1) drawnRef.current.push(pl1); if (pl2) drawnRef.current.push(pl2);
            setDrawnCount(c=>c+1);
          } catch { /* skip */ }
          setActiveTool('none'); setHint(''); setDrawStep(0);
        }
      }
    };
    chart.subscribeClick(handler);
    return () => { try { chart.unsubscribeClick(handler); } catch {} };
  }, [activeTool, drawStep, drawStart]);

  // Context menu
  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool !== 'none') return;
    holdTimer.current = setTimeout(() => {
      const param = lastParamRef.current;
      if (!param?.point) return;
      const price = candleRef.current?.coordinateToPrice(param.point.y);
      if (!price || price <= 0) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setContextMenu({ x:Math.min(e.clientX-rect.left, rect.width-180), y:Math.min(e.clientY-rect.top, rect.height-120), price });
    }, 500);
  };
  const handleMouseUp   = () => clearTimeout(holdTimer.current);
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const param = lastParamRef.current;
    if (!param?.point) return;
    const price = candleRef.current?.coordinateToPrice(param.point.y);
    if (!price || price <= 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContextMenu({ x:Math.min(e.clientX-rect.left, rect.width-180), y:Math.min(e.clientY-rect.top, rect.height-120), price });
  };

  const handleQuickTP = (price: number) => {
    if (onQuickTP) onQuickTP(price);
    try { const pl = candleRef.current?.createPriceLine({ price, lineWidth:2, lineStyle:LineStyle.Dashed, color:'#4ADE80', axisLabelVisible:true, title:'TP' }); if (pl) drawnRef.current.push(pl); } catch {}
    setContextMenu(null);
  };
  const handleQuickSL = (price: number) => {
    if (onQuickSL) onQuickSL(price);
    try { const pl = candleRef.current?.createPriceLine({ price, lineWidth:2, lineStyle:LineStyle.Dashed, color:'#F87171', axisLabelVisible:true, title:'SL' }); if (pl) drawnRef.current.push(pl); } catch {}
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
          <span className="hidden lg:block text-[9px] text-[#2D3748]">Drag price axis ↕ · Double-tap axis to reset</span>
          <button onClick={() => setIsFullscreen(f => !f)}
            className="p-1.5 rounded-lg text-[#4B5563] hover:text-[#2BFFF1] border border-white/[0.05] hover:border-[#2BFFF1]/30 transition-all">
            {isFullscreen
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
            }
          </button>
        </div>
      </div>

      {/* Chart canvas wrapper — relative so overlay positions inside it, NOT over toolbar */}
      <div className="relative flex-1 min-h-0">

        {/* LWC canvas — touchAction:none required for LWC vertTouchDrag to work */}
        <div
          ref={containerRef}
          className="w-full h-full select-none"
          style={{
            cursor: activeTool !== 'none' ? 'crosshair' : 'default',
            touchAction: 'none',  // LWC needs this to receive all touch events
          }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
        />

        {/* ── Price axis overlay ──────────────────────────────────────────
            Positioned INSIDE the canvas wrapper (not over the toolbar).
            Intercepts touches/mouse on the right price axis column only.
        ────────────────────────────────────────────────────────────────── */}
        <div
          ref={axisOverlayRef}
          className="absolute top-0 right-0 bottom-0"
          style={{
            width: PRICE_AXIS_WIDTH,
            cursor: 'ns-resize',
            zIndex: 5,
            touchAction: 'none',
            background: 'transparent',
          }}
          title="Drag up/down to zoom · Double-tap to reset"
        />

      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="absolute inset-0 z-20" onClick={() => setContextMenu(null)}/>
          <div className="absolute z-30 bg-[#0B0E14] border border-white/[0.12] rounded-xl shadow-2xl py-1 min-w-44"
            style={{ left: contextMenu.x, top: contextMenu.y }}>
            <div className="px-3 py-1.5 border-b border-white/[0.06] mb-1">
              <p className="text-[9px] text-[#4B5563] uppercase tracking-wide">At {formatPrice(contextMenu.price)}</p>
            </div>
            {onQuickTP && (
              <button onClick={() => handleQuickTP(contextMenu.price)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-green-400 hover:bg-green-500/10 transition-all text-left">
                <div className="w-2 h-2 rounded-full bg-green-400"/>Set Take Profit
              </button>
            )}
            {onQuickSL && (
              <button onClick={() => handleQuickSL(contextMenu.price)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-all text-left">
                <div className="w-2 h-2 rounded-full bg-red-400"/>Set Stop Loss
              </button>
            )}
            <button onClick={() => { setContextMenu(null); setActiveTool('hline'); }}
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
    return <div className="fixed inset-0 z-[300]">{chartContent}</div>;
  }
  return <div className="w-full h-full">{chartContent}</div>;
}
