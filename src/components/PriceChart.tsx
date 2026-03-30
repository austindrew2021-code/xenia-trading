import { useEffect, useRef, useState, useMemo } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  IChartApi, ISeriesApi, CandlestickSeries, HistogramSeries, LineSeries,
  PriceScaleMode,
} from 'lightweight-charts';

// ── Indicator math helpers ────────────────────────────────────────────────
function indSMA(closes: number[], n: number): (number|null)[] {
  return closes.map((_,i) => i<n-1?null:closes.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n);
}
function indEMA(closes: number[], n: number): (number|null)[] {
  const k=2/(n+1); const out: (number|null)[]=new Array(closes.length).fill(null);
  if(closes.length<n) return out;
  let e=closes.slice(0,n).reduce((a,b)=>a+b,0)/n; out[n-1]=e;
  for(let i=n;i<closes.length;i++){e=closes[i]*k+e*(1-k);out[i]=e;}
  return out;
}
function indWMA(closes: number[], n: number): (number|null)[] {
  return closes.map((_,i)=>{if(i<n-1)return null;const sl=closes.slice(i-n+1,i+1);let w=0,s=0;for(let j=0;j<n;j++){w+=j+1;s+=(j+1)*sl[j];}return s/w;});
}
function indHMA(closes: number[], n: number): (number|null)[] {
  const half=Math.max(2,Math.floor(n/2)),sq=Math.max(2,Math.round(Math.sqrt(n)));
  const wmaHalf=indWMA(closes,half),wmaFull=indWMA(closes,n);
  const diff=closes.map((_,i)=>wmaHalf[i]!==null&&wmaFull[i]!==null?2*(wmaHalf[i] as number)-(wmaFull[i] as number):null);
  const clean=diff.filter(v=>v!==null) as number[];
  const wma2=indWMA(clean,sq);
  const out:( number|null)[]=new Array(closes.length).fill(null);
  let offset=diff.findIndex(v=>v!==null);
  for(let i=0;i<wma2.length;i++) out[offset+i]=wma2[i];
  return out;
}
function indDEMA(closes: number[], n: number): (number|null)[] {
  const e1=indEMA(closes,n); const clean=e1.filter(v=>v!==null) as number[];
  const e2=indEMA(clean,n); const off=e1.findIndex(v=>v!==null);
  return closes.map((_,i)=>{const e1v=e1[i];if(e1v===null)return null;const e2i=i-off;const e2v=e2[e2i];if(e2v===null||e2i<0)return null;return 2*e1v-e2v;});
}
function indVWAP(candles: {high:number;low:number;close:number;volume:number}[]): (number|null)[] {
  let cpv=0,cv=0;
  return candles.map(c=>{const tp=(c.high+c.low+c.close)/3;cpv+=tp*c.volume;cv+=c.volume;return cv>0?cpv/cv:null;});
}
function indBB(closes: number[], n: number, mult: number) {
  const mid=indSMA(closes,n);
  const upper=mid.map((m,i)=>{if(m===null||i<n-1)return null;const sl=closes.slice(i-n+1,i+1);const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/n);return m+mult*sd;});
  const lower=mid.map((m,i)=>{if(m===null||i<n-1)return null;const sl=closes.slice(i-n+1,i+1);const sd=Math.sqrt(sl.reduce((s,v)=>s+(v-m)**2,0)/n);return m-mult*sd;});
  return {upper,mid,lower};
}
function indKeltner(candles:{high:number;low:number;close:number}[], n:number, mult:number) {
  const closes=candles.map(c=>c.close);
  const mid=indEMA(closes,n);
  const trArr=candles.map((c,i)=>i===0?c.high-c.low:Math.max(c.high-c.low,Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)));
  const atr=indSMA(trArr,n);
  return{upper:mid.map((m,i)=>m!==null&&atr[i]!==null?(m as number)+mult*(atr[i] as number):null),mid,lower:mid.map((m,i)=>m!==null&&atr[i]!==null?(m as number)-mult*(atr[i] as number):null)};
}
function indDonchian(candles:{high:number;low:number}[], n:number) {
  return{upper:candles.map((_,i)=>i<n-1?null:Math.max(...candles.slice(i-n+1,i+1).map(c=>c.high))),lower:candles.map((_,i)=>i<n-1?null:Math.min(...candles.slice(i-n+1,i+1).map(c=>c.low)))};
}
function indATR(candles:{high:number;low:number;close:number}[], n:number): (number|null)[] {
  const tr=candles.map((c,i)=>i===0?c.high-c.low:Math.max(c.high-c.low,Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)));
  return indSMA(tr,n);
}
function indSupertrend(candles:{high:number;low:number;close:number}[], period:number, mult:number): (number|null)[] {
  const atr=indATR(candles,period);
  const out:(number|null)[]=new Array(candles.length).fill(null);
  let up=0,dn=0,trend=1;
  for(let i=period;i<candles.length;i++){
    const atrv=atr[i]; if(atrv===null) continue;
    const mid=(candles[i].high+candles[i].low)/2;
    const newUp=mid-mult*atrv; const newDn=mid+mult*atrv;
    up=candles[i-1].close>up?Math.max(newUp,up):newUp;
    dn=candles[i-1].close<dn?Math.min(newDn,dn):newDn;
    if(candles[i].close>dn){trend=1;}else if(candles[i].close<up){trend=-1;}
    out[i]=trend===1?up:dn;
  }
  return out;
}
function indPSAR(candles:{high:number;low:number;close:number}[], step=0.02, maxStep=0.2): (number|null)[] {
  if(candles.length<2) return candles.map(()=>null);
  const out:(number|null)[]=new Array(candles.length).fill(null);
  let bull=true,sar=candles[0].low,ep=candles[0].high,af=step;
  for(let i=1;i<candles.length;i++){
    sar=sar+af*(ep-sar);
    if(bull){sar=Math.min(sar,candles[i-1].low,i>1?candles[i-2].low:candles[i-1].low);if(candles[i].low<sar){bull=false;sar=ep;ep=candles[i].low;af=step;}else{if(candles[i].high>ep){ep=candles[i].high;af=Math.min(af+step,maxStep);}}}
    else{sar=Math.max(sar,candles[i-1].high,i>1?candles[i-2].high:candles[i-1].high);if(candles[i].high>sar){bull=true;sar=ep;ep=candles[i].high;af=step;}else{if(candles[i].low<ep){ep=candles[i].low;af=Math.min(af+step,maxStep);}}}
    out[i]=sar;
  }
  return out;
}
function indRSIArr(closes: number[], n: number): (number|null)[] {
  const out:(number|null)[]=new Array(closes.length).fill(null);
  if(closes.length<n+1) return out;
  let avgG=0,avgL=0;
  for(let i=1;i<=n;i++){const d=closes[i]-closes[i-1];d>0?avgG+=d:avgL-=d;}
  avgG/=n; avgL/=n;
  out[n]=avgL===0?100:100-100/(1+avgG/avgL);
  for(let i=n+1;i<closes.length;i++){const d=closes[i]-closes[i-1];const g=d>0?d:0,l=d<0?-d:0;avgG=(avgG*(n-1)+g)/n;avgL=(avgL*(n-1)+l)/n;out[i]=avgL===0?100:100-100/(1+avgG/avgL);}
  return out;
}
function indMACDArr(closes: number[]): {macd:(number|null)[];signal:(number|null)[];hist:(number|null)[]} {
  const fast=indEMA(closes,12),slow=indEMA(closes,26);
  const macd=closes.map((_,i)=>fast[i]!==null&&slow[i]!==null?(fast[i] as number)-(slow[i] as number):null);
  const cleanM=macd.filter(v=>v!==null) as number[]; const off=macd.findIndex(v=>v!==null);
  const sig9=indEMA(cleanM,9);
  const signal:( number|null)[]=new Array(closes.length).fill(null);
  const hist:( number|null)[]=new Array(closes.length).fill(null);
  for(let i=0;i<sig9.length;i++){const mi=off+i;signal[mi]=sig9[i];if(macd[mi]!==null&&sig9[i]!==null)hist[mi]=(macd[mi] as number)-(sig9[i] as number);}
  return{macd,signal,hist};
}
function indStochArr(candles:{high:number;low:number;close:number}[], k:number, d:number, smooth:number): {kArr:(number|null)[];dArr:(number|null)[]} {
  const kRaw=candles.map((_,i)=>{if(i<k-1)return null;const sl=candles.slice(i-k+1,i+1);const hi=Math.max(...sl.map(c=>c.high)),lo=Math.min(...sl.map(c=>c.low));return hi===lo?50:(candles[i].close-lo)/(hi-lo)*100;});
  const cleanK=kRaw.filter(v=>v!==null) as number[]; const offK=kRaw.findIndex(v=>v!==null);
  const kSmooth=indSMA(cleanK,smooth);
  const kArr:(number|null)[]=new Array(candles.length).fill(null);
  for(let i=0;i<kSmooth.length;i++) kArr[offK+i]=kSmooth[i];
  const cleanKS=kSmooth.filter(v=>v!==null) as number[]; const offKS=kArr.findIndex(v=>v!==null);
  const dSmooth=indSMA(cleanKS,d);
  const dArr:(number|null)[]=new Array(candles.length).fill(null);
  for(let i=0;i<dSmooth.length;i++) dArr[offKS+i]=dSmooth[i];
  return{kArr,dArr};
}
function indOBV(candles:{close:number;volume:number}[]): number[] {
  const out:number[]=[0];
  for(let i=1;i<candles.length;i++) out.push(out[i-1]+(candles[i].close>candles[i-1].close?candles[i].volume:candles[i].close<candles[i-1].close?-candles[i].volume:0));
  return out;
}
function indADX(candles:{high:number;low:number;close:number}[], n:number): (number|null)[] {
  if(candles.length<n+1) return candles.map(()=>null);
  const tr:number[]=[],pdm:number[]=[],ndm:number[]=[];
  for(let i=1;i<candles.length;i++){
    tr.push(Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-candles[i-1].close),Math.abs(candles[i].low-candles[i-1].close)));
    pdm.push(Math.max(candles[i].high-candles[i-1].high,0));
    ndm.push(Math.max(candles[i-1].low-candles[i].low,0));
  }
  const atr=indSMA(tr,n),pdi=indSMA(pdm,n),ndi=indSMA(ndm,n);
  const out:(number|null)[]=new Array(candles.length).fill(null);
  for(let i=0;i<tr.length;i++){const a=atr[i],p=pdi[i],nd=ndi[i];if(a===null||a===0||p===null||nd===null)continue;const pDI=p/a*100,nDI=nd/a*100;const dx=Math.abs(pDI-nDI)/(pDI+nDI)*100;out[i+1]=dx;}
  return out;
}
function indRSI(closes: number[], n: number): number|null {
  if(closes.length<n+1) return null;
  let g=0,l=0;
  for(let i=closes.length-n;i<closes.length;i++){const d=closes[i]-closes[i-1];d>0?g+=d:l-=d;}
  const ag=g/n,al=l/n; return al===0?100:100-100/(1+ag/al);
}
function indMACD(closes: number[]): {macd:number|null;signal:number|null;hist:number|null} {
  const fast=indEMA(closes,12),slow=indEMA(closes,26);
  const macdLine=closes.map((_,i)=>fast[i]!==null&&slow[i]!==null?(fast[i] as number)-(slow[i] as number):null);
  const validMacd=macdLine.filter(v=>v!==null) as number[];
  if(validMacd.length===0) return{macd:null,signal:null,hist:null};
  const sigVals=indEMA(validMacd,9);
  const macd=macdLine[macdLine.length-1];
  const signal=sigVals[sigVals.length-1];
  return{macd,signal,hist:macd!==null&&signal!==null?macd-signal:null};
}
import { Candle } from '../types';
import type { ChartTheme } from './ChartSettings';
import { ChartIndicatorsMenu } from './ChartIndicatorsMenu';
import { loadChartTheme } from './ChartSettings';

const CHART_INTERVALS = ['1m','5m','15m','30m','1h','4h','1d'] as const;

interface Props {
  candles: Candle[];
  livePrice: number;
  positions: { entryPrice: number; side: string; status: string }[];
  onQuickTP?: (price: number) => void;
  onQuickSL?: (price: number) => void;
  theme?: ChartTheme;
  onOpenSettings?: () => void;
  /** If provided, enables the floating trade panel for quick order entry */
  onPlaceOrder?: (side: 'buy'|'sell', tp: number|null, sl: number|null) => void;
  interval?: string;
  onIntervalChange?: (i: string) => void;
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

const PRICE_AXIS_WIDTH = 70;

export function PriceChart({ candles, livePrice, positions, onQuickTP, onQuickSL, theme, onOpenSettings, onPlaceOrder, interval, onIntervalChange }: Props) {
  const wrapperRef     = useRef<HTMLDivElement>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const axisOverlayRef = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  const candleRef      = useRef<ISeriesApi<'Candlestick', any> | null>(null);
  const volumeRef      = useRef<ISeriesApi<'Histogram', any> | null>(null);
  const posLinesRef    = useRef<any[]>([]);
  const drawnRef       = useRef<any[]>([]);
  const fmtKeyRef      = useRef('');
  const holdTimer      = useRef<ReturnType<typeof setTimeout>>();
  const lastParamRef   = useRef<any>(null);
  const tpLineRef      = useRef<any>(null);
  const slLineRef      = useRef<any>(null);
  const obLineRef      = useRef<any[]>([]);
  const indicatorSeriesRef = useRef<Map<string, any[]>>(new Map());

  const [indicatorParams, setIndicatorParams] = useState<Record<string,Record<string,number>>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTool,   setActiveTool]   = useState<DrawTool>('none');
  const [drawStep,     setDrawStep]     = useState(0);
  const [drawStart,    setDrawStart]    = useState(0);
  const [hint,         setHint]         = useState('');
  const [drawnCount,   setDrawnCount]   = useState(0);
  const [contextMenu,  setContextMenu]  = useState<ContextMenu | null>(null);
  const [showOB,       setShowOB]       = useState(true);
  // Draggable TP/SL
  const [tpPrice,      setTpPrice]      = useState<number|null>(null);
  const [slPrice,      setSlPrice]      = useState<number|null>(null);
  const [tpSlEnabled,  setTpSlEnabled]  = useState(true);
  // Floating trade panel (fullscreen)
  const [showIndicators,     setShowIndicators]     = useState(false);
  const [activeIndicators,   setActiveIndicators]   = useState<string[]>([]);
  const [showTradePanel,     setShowTradePanel]     = useState(false);
  // On mobile fullscreen show trade panel too
  const [mobileTradePanelPos, setMobileTradePanelPos] = useState({ x: 8, y: 60 });
  const [tradePanelPos,  setTradePanelPos]  = useState({ x: 20, y: 80 });
  const [tradeSide,      setTradeSide]      = useState<'buy'|'sell'>('buy');
  const dragPanel = useRef<{ startX:number; startY:number; ox:number; oy:number } | null>(null);

  const activeTheme = theme ?? loadChartTheme();

  const priceFormat = useMemo(() => {
    if (!candles.length) return getPriceFormat(livePrice);
    const avg = candles.slice(-20).reduce((s,c) => s+c.close, 0) / Math.min(20, candles.length);
    return getPriceFormat(avg || livePrice);
  }, [candles, livePrice]);

  // ── Create chart ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: activeTheme.background },
        textColor: activeTheme.textColor,
        fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: activeTheme.gridLines },
        horzLines: { color: activeTheme.gridLines },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: activeTheme.crosshair, labelBackgroundColor: activeTheme.background },
        horzLine: { color: activeTheme.crosshair, labelBackgroundColor: activeTheme.background },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        textColor: activeTheme.textColor,
        scaleMargins: { top: 0.08, bottom: 0.22 },
        autoScale: false,
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
        vertTouchDrag: true,
      },
      kineticScroll: { touch: true, mouse: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:        activeTheme.upColor,
      downColor:      activeTheme.downColor,
      borderUpColor:  activeTheme.upBorder,
      borderDownColor:activeTheme.downBorder,
      wickUpColor:    activeTheme.upWick,
      wickDownColor:  activeTheme.downWick,
      priceFormat: { type:'price', precision:8, minMove:0.00000001 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: activeTheme.volumeUp, priceFormat:{ type:'volume' }, priceScaleId:'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins:{ top:0.82, bottom:0 } });

    chart.subscribeCrosshairMove((param) => { lastParamRef.current = param; });

    chartRef.current  = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    // ── Definitive touchAction fix: MutationObserver watches for canvas ──
    // LWC creates canvas asynchronously; we must set touchAction:'none' on it
    // directly because CSS touchAction is not inherited.
    const fixTouch = (el: HTMLElement) => { el.style.touchAction = 'none'; el.style.userSelect = 'none'; };

    const patchCanvases = () => {
      containerRef.current?.querySelectorAll('canvas').forEach(c => fixTouch(c as HTMLElement));
    };
    patchCanvases(); // sync attempt
    requestAnimationFrame(patchCanvases); // after first paint
    setTimeout(patchCanvases, 50);
    setTimeout(patchCanvases, 300); // final safety net

    // MutationObserver catches canvas added at any time
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        m.addedNodes.forEach(n => {
          if ((n as HTMLElement).tagName === 'CANVAS') fixTouch(n as HTMLElement);
          (n as HTMLElement).querySelectorAll?.('canvas').forEach(c => fixTouch(c as HTMLElement));
        });
      }
    });
    if (containerRef.current) mo.observe(containerRef.current, { childList:true, subtree:true });

    const el = containerRef.current;
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stopWheel, { passive: false });

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width:containerRef.current.clientWidth, height:containerRef.current.clientHeight });
    });
    ro.observe(containerRef.current);

    return () => {
      mo.disconnect();
      ro.disconnect();
      el.removeEventListener('wheel', stopWheel);
      chart.remove();
      chartRef.current = null; candleRef.current = null; volumeRef.current = null;
    };
  }, []);

  // ── Price axis overlay touch handler (2-finger = zoom price scale) ──────
  useEffect(() => {
    const overlay = axisOverlayRef.current;
    if (!overlay) return;

    interface AxisDrag { startY:number; centerPrice:number; halfRange:number; }
    let drag: AxisDrag | null = null;

    const getRange = (): {center:number;half:number}|null => {
      const series = candleRef.current; const el = containerRef.current;
      if (!series || !el) return null;
      const h = el.clientHeight;
      const top = series.coordinateToPrice(10);
      const center = series.coordinateToPrice(h/2);
      const bottom = series.coordinateToPrice(h-10);
      if (top==null||center==null||bottom==null) return null;
      return { center, half: Math.abs(top-bottom)/2 };
    };

    const applyRange = (min:number, max:number) => {
      if (!candleRef.current) return;
      candleRef.current.applyOptions({
        autoscaleInfoProvider: () => ({ priceRange:{minValue:min,maxValue:max}, margins:{above:0,below:0} }),
      });
    };

    const onStart = (y:number) => { const r=getRange(); if(!r) return; drag={startY:y,centerPrice:r.center,halfRange:r.half}; };
    const onMove  = (y:number) => { if(!drag) return; const factor=Math.pow(2,(y-drag.startY)/80); const newHalf=Math.max(drag.centerPrice*0.00001,drag.halfRange*factor); applyRange(drag.centerPrice-newHalf,drag.centerPrice+newHalf); };
    const onEnd   = () => { drag=null; };
    const onDbl   = () => { candleRef.current?.applyOptions({ autoscaleInfoProvider:undefined }); if(chartRef.current){chartRef.current.priceScale('right').applyOptions({autoScale:true});requestAnimationFrame(()=>chartRef.current?.priceScale('right').applyOptions({autoScale:false}));} };

    const onTouchStart = (e:TouchEvent) => { if(e.touches.length<2) return; e.preventDefault(); onStart((e.touches[0].clientY+e.touches[1].clientY)/2); };
    const onTouchMove  = (e:TouchEvent) => { if(!drag) return; e.preventDefault(); onMove(e.touches.length>=2?(e.touches[0].clientY+e.touches[1].clientY)/2:e.touches[0].clientY); };
    const onTouchEnd   = (e:TouchEvent) => { if(e.touches.length<2) onEnd(); };
    const onMouseDown  = (e:MouseEvent) => { e.preventDefault(); onStart(e.clientY); };
    const onMouseMove  = (e:MouseEvent) => onMove(e.clientY);
    const onMouseUp    = () => onEnd();

    overlay.addEventListener('touchstart', onTouchStart, { passive:false });
    overlay.addEventListener('touchmove',  onTouchMove,  { passive:false });
    overlay.addEventListener('touchend',   onTouchEnd,   { passive:true  });
    overlay.addEventListener('dblclick',   onDbl);
    overlay.addEventListener('mousedown',  onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);

    return () => {
      overlay.removeEventListener('touchstart', onTouchStart);
      overlay.removeEventListener('touchmove',  onTouchMove);
      overlay.removeEventListener('touchend',   onTouchEnd);
      overlay.removeEventListener('dblclick',   onDbl);
      overlay.removeEventListener('mousedown',  onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };
  }, []);

  // ── TP/SL draggable lines ───────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current) return;
    // Remove old
    if (tpLineRef.current) { try { candleRef.current.removePriceLine(tpLineRef.current); } catch {} tpLineRef.current=null; }
    if (slLineRef.current) { try { candleRef.current.removePriceLine(slLineRef.current); } catch {} slLineRef.current=null; }
    if (!tpSlEnabled) return;
    if (tpPrice && tpPrice > 0) {
      tpLineRef.current = candleRef.current.createPriceLine({ price:tpPrice, lineWidth:2, lineStyle:LineStyle.Dashed, color:'#4ADE80', axisLabelVisible:true, title:'▲ TP'});
      if (onQuickTP) tpLineRef.current?.subscribeDragged?.((p:number) => { setTpPrice(p); onQuickTP(p); });
    }
    if (slPrice && slPrice > 0) {
      slLineRef.current = candleRef.current.createPriceLine({ price:slPrice, lineWidth:2, lineStyle:LineStyle.Dashed, color:'#F87171', axisLabelVisible:true, title:'▼ SL'});
      if (onQuickSL) slLineRef.current?.subscribeDragged?.((p:number) => { setSlPrice(p); onQuickSL(p); });
    }
  }, [tpPrice, slPrice, tpSlEnabled]);

  // ── Auto Order Blocks + liquidity zones ────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !showOB || candles.length < 5) return;
    obLineRef.current.forEach(l => { try { candleRef.current?.removePriceLine(l); } catch {} });
    obLineRef.current = [];
    const n = candles.length;
    // Detect bullish OBs (last 50 candles, max 4)
    let bullCount = 0, bearCount = 0;
    for (let i = n-3; i >= Math.max(3, n-50) && bullCount < 4; i--) {
      const c=candles[i], p=candles[i-1], n2=candles[i+1];
      if (p.close < p.open && n2.close > n2.open && n2.close > p.high) {
        const pl = candleRef.current?.createPriceLine({ price:p.high, lineWidth:1, lineStyle:LineStyle.Solid, color:'rgba(74,222,128,0.6)', axisLabelVisible:false, title:`OB${bullCount+1}` });
        if (pl) { obLineRef.current.push(pl); bullCount++; }
        const pl2 = candleRef.current?.createPriceLine({ price:p.low, lineWidth:1, lineStyle:LineStyle.Dotted, color:'rgba(74,222,128,0.3)', axisLabelVisible:false, title:'' });
        if (pl2) obLineRef.current.push(pl2);
      }
    }
    // Detect bearish OBs
    for (let i = n-3; i >= Math.max(3, n-50) && bearCount < 4; i--) {
      const c=candles[i], p=candles[i-1], n2=candles[i+1];
      if (p.close > p.open && n2.close < n2.open && n2.close < p.low) {
        const pl = candleRef.current?.createPriceLine({ price:p.high, lineWidth:1, lineStyle:LineStyle.Solid, color:'rgba(248,113,113,0.6)', axisLabelVisible:false, title:`SOB${bearCount+1}` });
        if (pl) { obLineRef.current.push(pl); bearCount++; }
        const pl2 = candleRef.current?.createPriceLine({ price:p.low, lineWidth:1, lineStyle:LineStyle.Dotted, color:'rgba(248,113,113,0.3)', axisLabelVisible:false, title:'' });
        if (pl2) obLineRef.current.push(pl2);
      }
    }
    // Liquidity sweep levels (swing highs/lows)
    const swing_high = Math.max(...candles.slice(-30).map(c=>c.high));
    const swing_low  = Math.min(...candles.slice(-30).map(c=>c.low));
    const lh = candleRef.current?.createPriceLine({ price:swing_high, lineWidth:1, lineStyle:LineStyle.LargeDashed, color:'rgba(251,191,36,0.5)', axisLabelVisible:true, title:'Liq High' });
    const ll = candleRef.current?.createPriceLine({ price:swing_low,  lineWidth:1, lineStyle:LineStyle.LargeDashed, color:'rgba(251,191,36,0.5)', axisLabelVisible:true, title:'Liq Low' });
    if (lh) obLineRef.current.push(lh);
    if (ll) obLineRef.current.push(ll);
  }, [candles, showOB]);

  // ── Precision update ────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current) return;
    const key = `${priceFormat.precision}`;
    if (key === fmtKeyRef.current) return;
    fmtKeyRef.current = key;
    candleRef.current.applyOptions({ priceFormat:{ type:'price', precision:priceFormat.precision, minMove:priceFormat.minMove } });
  }, [priceFormat]);

  // ── Candle data ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !candles.length) return;
    candleRef.current.setData([]);
    volumeRef.current.setData([]);
    candleRef.current.setData(candles.map(c => ({ time:(c.time/1000) as any, open:c.open, high:c.high, low:c.low, close:c.close })));
    volumeRef.current.setData(candles.map(c => ({ time:(c.time/1000) as any, value:c.volume, color:c.close>=c.open?activeTheme.volumeUp:activeTheme.volumeDown })));
    chartRef.current?.timeScale().fitContent();
    // Reset price scale to fit new data (autoScale is off to allow free vertical movement)
    if (chartRef.current) {
      chartRef.current.priceScale('right').applyOptions({ autoScale: true });
      requestAnimationFrame(() => { chartRef.current?.priceScale('right').applyOptions({ autoScale: false }); });
    }
  }, [candles]);

  // ── Live price ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !candles.length || livePrice <= 0) return;
    const last = candles[candles.length-1];
    try { candleRef.current.update({ time:(last.time/1000) as any, open:last.open, high:Math.max(last.high,livePrice), low:Math.min(last.low,livePrice), close:livePrice }); } catch {}
  }, [livePrice, candles]);

  // ── Indicator series ───────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candles.length) return;
    // Remove all old indicator series
    indicatorSeriesRef.current.forEach(seriesArr => {
      seriesArr.forEach(s => { try { chart.removeSeries(s); } catch {} });
    });
    indicatorSeriesRef.current.clear();
    if (!activeIndicators.length) return;
    const closes = candles.map(c => c.close);
    const times  = candles.map(c => (c.time / 1000) as any);
    const toData = (vals: (number|null)[]) => vals.map((v,i) => ({ time: times[i], value: v ?? undefined })).filter(d => d.value !== undefined) as any[];

    for (const id of activeIndicators) {
      const p = indicatorParams[id] ?? {};
      const osc = (scaleId:string, color1:string, vals1:(number|null)[], color2?:string, vals2?:(number|null)[]) => {
        const s1=chart.addSeries(LineSeries,{color:color1,lineWidth:1,priceLineVisible:false,lastValueVisible:false,priceScaleId:scaleId});
        s1.setData(toData(vals1));
        const out=[s1];
        if(color2&&vals2?.length){const s2=chart.addSeries(LineSeries,{color:color2,lineWidth:1,priceLineVisible:false,lastValueVisible:false,priceScaleId:scaleId});s2.setData(toData(vals2));out.push(s2);}
        chart.priceScale(scaleId).applyOptions({scaleMargins:{top:0.75,bottom:0},borderColor:'rgba(255,255,255,0.05)',textColor:activeTheme.textColor});
        return out;
      };
      if (id === 'sma') {
        const n = p.period ?? 20;
        const s = chart.addSeries(LineSeries, { color:'#F59E0B', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        s.setData(toData(indSMA(closes, n)));
        indicatorSeriesRef.current.set(id, [s]);
      } else if (id === 'ema') {
        const n = p.period ?? 20;
        const s = chart.addSeries(LineSeries, { color:'#818CF8', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        s.setData(toData(indEMA(closes, n)));
        indicatorSeriesRef.current.set(id, [s]);
      } else if (id === 'wma') {
        const n = p.period ?? 20;
        const s = chart.addSeries(LineSeries, { color:'#C084FC', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        s.setData(toData(indWMA(closes, n)));
        indicatorSeriesRef.current.set(id, [s]);
      } else if (id === 'hma') {
        const n = p.period ?? 14;
        const s = chart.addSeries(LineSeries, { color:'#FB923C', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        s.setData(toData(indHMA(closes, n)));
        indicatorSeriesRef.current.set(id, [s]);
      } else if (id === 'dema') {
        const n = p.period ?? 20;
        const s = chart.addSeries(LineSeries, { color:'#A78BFA', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        s.setData(toData(indDEMA(closes, n)));
        indicatorSeriesRef.current.set(id, [s]);
      } else if (id === 'tema') {
        const n = p.period ?? 20;
        const e1=indEMA(closes,n);
        const c1=e1.filter(v=>v!==null) as number[];
        const e2=indEMA(c1,n);
        const c2=e2.filter(v=>v!==null) as number[];
        const e3=indEMA(c2,n);
        const o1=n-1, o2=o1+(n-1);
        const tema=closes.map((_,i)=>{const v1=e1[i];if(v1===null)return null;const i2=i-o1;const v2=i2>=0&&i2<e2.length?e2[i2]:null;if(v2===null)return null;const i3=i-o2;const v3=i3>=0&&i3<e3.length?e3[i3]:null;if(v3===null)return null;return 3*v1-3*v2+v3;});
        const s = chart.addSeries(LineSeries, { color:'#67E8F9', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        s.setData(toData(tema));
        indicatorSeriesRef.current.set(id, [s]);
      } else if (id === 'vwap') {
        const vals = indVWAP(candles);
        const s = chart.addSeries(LineSeries, { color:'#34D399', lineWidth:1, lineStyle:1, priceLineVisible:false, lastValueVisible:false });
        s.setData(toData(vals));
        indicatorSeriesRef.current.set(id, [s]);
      } else if (id === 'bbands') {
        const n = p.period ?? 20; const mult = p.mult ?? 2;
        const { upper, mid, lower } = indBB(closes, n, mult);
        const su = chart.addSeries(LineSeries, { color:'rgba(147,197,253,0.5)', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        const sm = chart.addSeries(LineSeries, { color:'rgba(147,197,253,0.9)', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        const sl = chart.addSeries(LineSeries, { color:'rgba(147,197,253,0.5)', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        su.setData(toData(upper)); sm.setData(toData(mid)); sl.setData(toData(lower));
        indicatorSeriesRef.current.set(id, [su, sm, sl]);
      } else if (id === 'keltner') {
        const n = p.period ?? 20; const mult = p.mult ?? 2;
        const { upper, mid, lower } = indKeltner(candles, n, mult);
        const su = chart.addSeries(LineSeries, { color:'rgba(251,146,60,0.5)', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        const sm = chart.addSeries(LineSeries, { color:'rgba(251,146,60,0.9)', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        const sl2 = chart.addSeries(LineSeries, { color:'rgba(251,146,60,0.5)', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        su.setData(toData(upper)); sm.setData(toData(mid)); sl2.setData(toData(lower));
        indicatorSeriesRef.current.set(id, [su, sm, sl2]);
      } else if (id === 'donchian') {
        const n = p.period ?? 20;
        const { upper, lower } = indDonchian(candles, n);
        const su = chart.addSeries(LineSeries, { color:'rgba(99,102,241,0.7)', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        const sl2 = chart.addSeries(LineSeries, { color:'rgba(99,102,241,0.7)', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
        su.setData(toData(upper)); sl2.setData(toData(lower));
        indicatorSeriesRef.current.set(id, [su, sl2]);
      } else if (id === 'supertrend') {
        const n = p.period ?? 10; const mult = p.mult ?? 3;
        const vals = indSupertrend(candles, n, mult);
        const s = chart.addSeries(LineSeries, { color:'#4ADE80', lineWidth:2, priceLineVisible:false, lastValueVisible:false });
        s.setData(toData(vals));
        indicatorSeriesRef.current.set(id, [s]);
      } else if (id === 'psar') {
        const step = p.step ?? 0.02; const max = p.max ?? 0.2;
        const vals = indPSAR(candles, step, max);
        const s = chart.addSeries(LineSeries, { color:'#F472B6', lineWidth:1, lineStyle:3, priceLineVisible:false, lastValueVisible:false });
        s.setData(toData(vals));
        indicatorSeriesRef.current.set(id, [s]);
      } else if (id === 'rsi') {
        const n = p.period ?? 14;
        indicatorSeriesRef.current.set(id, osc('rsi_scale','#818CF8',indRSIArr(closes,n)));
      } else if (id === 'macd') {
        const { macd, signal } = indMACDArr(closes);
        indicatorSeriesRef.current.set(id, osc('macd_scale','#2BFFF1',macd,'#F59E0B',signal));
      } else if (id === 'stoch') {
        const k = p.k ?? 14; const d = p.d ?? 3; const smooth = p.smooth ?? 3;
        const { kArr, dArr } = indStochArr(candles, k, d, smooth);
        indicatorSeriesRef.current.set(id, osc('stoch_scale','#4ADE80',kArr,'#F87171',dArr));
      } else if (id === 'stochrsi') {
        const rsiP = p.rsiPeriod ?? 14; const stP = p.stochPeriod ?? 14;
        const rsiArr = indRSIArr(closes, rsiP);
        const cleanR = rsiArr.filter(v=>v!==null) as number[];
        const {kArr,dArr} = indStochArr(cleanR.map(v=>({high:v,low:v,close:v})),stP,3,3);
        const off=rsiArr.findIndex(v=>v!==null);
        const kFull:(number|null)[]=new Array(closes.length).fill(null);
        const dFull:(number|null)[]=new Array(closes.length).fill(null);
        for(let i=0;i<kArr.length;i++){kFull[off+i]=kArr[i];dFull[off+i]=dArr[i];}
        indicatorSeriesRef.current.set(id, osc('stochrsi_scale','#A78BFA',kFull,'#F59E0B',dFull));
      } else if (id === 'atr') {
        const n = p.period ?? 14;
        indicatorSeriesRef.current.set(id, osc('atr_scale','#F59E0B',indATR(candles,n)));
      } else if (id === 'obv') {
        indicatorSeriesRef.current.set(id, osc('obv_scale','#34D399',indOBV(candles)));
      } else if (id === 'adx') {
        const n = p.period ?? 14;
        indicatorSeriesRef.current.set(id, osc('adx_scale','#F472B6',indADX(candles,n)));
      }
    }
  }, [activeIndicators, indicatorParams, candles]);

  // ── Position lines ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current) return;
    posLinesRef.current.forEach(pl => { try { candleRef.current?.removePriceLine(pl); } catch {} });
    posLinesRef.current = [];
    positions.filter(p => p.status === 'open').forEach(p => {
      try { const pl = candleRef.current?.createPriceLine({ price:p.entryPrice, lineWidth:1, lineStyle:LineStyle.Dashed, color:p.side==='LONG'?'#4ADE80':'#F87171', axisLabelVisible:true, title:p.side }); if(pl) posLinesRef.current.push(pl); } catch {}
    });
  }, [positions]);

  // ── Escape / keyboard ───────────────────────────────────────────────────
  useEffect(() => {
    const fn = (e:KeyboardEvent) => { if(e.key==='Escape'){setIsFullscreen(false);setContextMenu(null);} };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, []);

  // ── Drawing tool clicks ─────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || activeTool === 'none') return;
    const handler = (param:any) => {
      if (!param.point) return;
      const price = candleRef.current?.coordinateToPrice(param.point.y);
      if (!price || price <= 0) return;
      if (activeTool === 'hline') {
        try { const pl=candleRef.current?.createPriceLine({ price, lineWidth:1, lineStyle:LineStyle.Dashed, color:'#A78BFA', axisLabelVisible:true, title:formatPrice(price) }); if(pl){drawnRef.current.push(pl);setDrawnCount(c=>c+1);} } catch {}
        setActiveTool('none'); setHint(''); setDrawStep(0);
      } else if (activeTool === 'orderblock') {
        if (drawStep===0) { setDrawStart(price); setDrawStep(1); setHint('Click zone bottom'); }
        else {
          const top=Math.max(drawStart,price); const bot=Math.min(drawStart,price);
          const color=price<drawStart?'#4ADE80':'#F87171';
          try {
            const pl1=candleRef.current?.createPriceLine({ price:top, lineWidth:2, lineStyle:LineStyle.Solid, color, axisLabelVisible:true, title:'OB' });
            const pl2=candleRef.current?.createPriceLine({ price:bot, lineWidth:2, lineStyle:LineStyle.Solid, color, axisLabelVisible:false, title:'' });
            if(pl1) drawnRef.current.push(pl1); if(pl2) drawnRef.current.push(pl2); setDrawnCount(c=>c+1);
          } catch {}
          setActiveTool('none'); setHint(''); setDrawStep(0);
        }
      }
    };
    chart.subscribeClick(handler);
    return () => { try { chart.unsubscribeClick(handler); } catch {} };
  }, [activeTool, drawStep, drawStart]);

  // ── Context menu ────────────────────────────────────────────────────────
  const handleMouseDown = (e:React.MouseEvent) => {
    if (activeTool !== 'none') return;
    holdTimer.current = setTimeout(() => {
      const param = lastParamRef.current;
      if (!param?.point) return;
      const price = candleRef.current?.coordinateToPrice(param.point.y);
      if (!price || price <= 0) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setContextMenu({ x:Math.min(e.clientX-rect.left, rect.width-180), y:Math.min(e.clientY-rect.top, rect.height-130), price });
    }, 500);
  };
  const handleMouseUp = () => clearTimeout(holdTimer.current);
  const handleContextMenu = (e:React.MouseEvent) => {
    e.preventDefault();
    const param = lastParamRef.current;
    if (!param?.point) return;
    const price = candleRef.current?.coordinateToPrice(param.point.y);
    if (!price || price <= 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContextMenu({ x:Math.min(e.clientX-rect.left, rect.width-180), y:Math.min(e.clientY-rect.top, rect.height-130), price });
  };

  const setTpHere = (price:number) => { setTpPrice(price); if(onQuickTP) onQuickTP(price); setContextMenu(null); };
  const setSlHere = (price:number) => { setSlPrice(price); if(onQuickSL) onQuickSL(price); setContextMenu(null); };
  const clearAll = () => {
    drawnRef.current.forEach(pl => { try { candleRef.current?.removePriceLine(pl); } catch {} });
    drawnRef.current = []; setDrawnCount(0);
  };

  // ── Floating trade panel drag ───────────────────────────────────────────
  const startPanelDrag = (e:React.MouseEvent) => {
    dragPanel.current = { startX:e.clientX, startY:e.clientY, ox:tradePanelPos.x, oy:tradePanelPos.y };
    const move = (ev:MouseEvent) => {
      if (!dragPanel.current) return;
      setTradePanelPos({ x:dragPanel.current.ox+(ev.clientX-dragPanel.current.startX), y:dragPanel.current.oy+(ev.clientY-dragPanel.current.startY) });
    };
    const up = () => { dragPanel.current=null; document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const btnClass = (tool: DrawTool) =>
    `flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all border ${activeTool===tool?'bg-[#2BFFF1]/20 text-[#2BFFF1] border-[#2BFFF1]/40':'bg-white/[0.03] text-[#4B5563] border-white/[0.06] hover:text-[#A7B0B7] hover:border-white/[0.12]'}`;

  const chartContent = (
    <div className="relative flex flex-col w-full h-full" ref={wrapperRef} style={{ background: activeTheme.background }}>
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-white/[0.05] flex-shrink-0 flex-wrap" style={{ background: activeTheme.background }}>
        {/* Draw tools */}
        <button onClick={()=>{setActiveTool(t=>t==='hline'?'none':'hline');setDrawStep(0);setHint(activeTool!=='hline'?'Click price level':'');}} className={btnClass('hline')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="12" x2="21" y2="12"/></svg>
          <span className="hidden sm:inline">H-Line</span>
        </button>
        <button onClick={()=>{setActiveTool(t=>t==='orderblock'?'none':'orderblock');setDrawStep(0);setHint(activeTool!=='orderblock'?'Click zone top':'');}} className={btnClass('orderblock')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="1"/></svg>
          <span className="hidden sm:inline">OB</span>
        </button>
        {drawnCount>0&&<button onClick={clearAll} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] text-red-400/60 border border-red-500/15 bg-red-500/05 hover:text-red-400 transition-all">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          <span className="hidden sm:inline">Clear</span>
        </button>}

        {/* OB auto toggle */}
        <button onClick={()=>setShowOB(v=>!v)} className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold border transition-all ${showOB?'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30':'border-white/[0.06] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="6" height="6" rx="1"/><rect x="9" y="3" width="6" height="6" rx="1"/><rect x="16" y="3" width="6" height="6" rx="1"/><rect x="2" y="11" width="6" height="6" rx="1"/></svg>
          <span className="hidden sm:inline">OB/Liq</span>
        </button>

        {/* Indicators menu button */}
        <button onClick={()=>setShowIndicators(true)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold border border-white/[0.06] bg-white/[0.03] text-[#4B5563] hover:text-[#2BFFF1] hover:border-[#2BFFF1]/30 transition-all">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span className="hidden sm:inline">Indicators</span>
          {activeIndicators.length>0&&<span className="ml-0.5 text-[8px] bg-[#2BFFF1]/20 text-[#2BFFF1] rounded px-1">{activeIndicators.length}</span>}
        </button>

        {/* TP/SL toggle */}
        <button onClick={()=>setTpSlEnabled(v=>!v)} className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold border transition-all ${tpSlEnabled?'bg-green-500/15 text-green-400 border-green-500/30':'border-white/[0.06] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="16" x2="21" y2="16"/></svg>
          <span className="hidden sm:inline">TP/SL</span>
        </button>

        {/* Quick TP/SL inputs inline */}
        {tpSlEnabled && (
          <div className="flex items-center gap-1 ml-1">
            <div className="flex items-center gap-1 bg-green-500/08 border border-green-500/20 rounded-lg px-1.5 py-1">
              <span className="text-[9px] text-green-400 font-semibold">TP</span>
              <input type="number" value={tpPrice??''} onChange={e=>{const v=parseFloat(e.target.value);setTpPrice(v>0?v:null);if(v>0&&onQuickTP)onQuickTP(v);}} placeholder="price" className="bg-transparent text-[10px] text-green-400 outline-none w-16 font-mono"/>
              {tpPrice&&<button onClick={()=>setTpPrice(null)} className="text-green-400/40 hover:text-green-400 text-[9px]">✕</button>}
            </div>
            <div className="flex items-center gap-1 bg-red-500/08 border border-red-500/20 rounded-lg px-1.5 py-1">
              <span className="text-[9px] text-red-400 font-semibold">SL</span>
              <input type="number" value={slPrice??''} onChange={e=>{const v=parseFloat(e.target.value);setSlPrice(v>0?v:null);if(v>0&&onQuickSL)onQuickSL(v);}} placeholder="price" className="bg-transparent text-[10px] text-red-400 outline-none w-16 font-mono"/>
              {slPrice&&<button onClick={()=>setSlPrice(null)} className="text-red-400/40 hover:text-red-400 text-[9px]">✕</button>}
            </div>
          </div>
        )}

        {hint&&<span className="text-[9px] text-[#2BFFF1]/60 ml-1 animate-pulse hidden sm:inline">{hint}</span>}

        {onIntervalChange&&(
          <div className="flex items-center gap-0.5 ml-1">
            {CHART_INTERVALS.map(i=>(
              <button key={i} onClick={()=>onIntervalChange(i)} className={`px-1.5 py-1 rounded text-[9px] font-bold transition-all ${interval===i?'bg-[#2BFFF1]/15 text-[#2BFFF1]':'text-[#374151] hover:text-[#6B7280]'}`}>{i}</button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <span className="hidden xl:block text-[9px] text-[#2D3748]">Drag axis ↕ zoom · Right-click chart</span>
          {onOpenSettings&&(
            <button onClick={onOpenSettings} className="p-1.5 rounded-lg text-[#4B5563] hover:text-[#2BFFF1] border border-white/[0.05] hover:border-[#2BFFF1]/30 transition-all" title="Chart settings">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            </button>
          )}
          {onPlaceOrder&&(
            <button onClick={()=>setShowTradePanel(v=>!v)} className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${showTradePanel?'bg-[#2BFFF1]/20 text-[#2BFFF1] border-[#2BFFF1]/40':'border-white/[0.06] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Trade
            </button>
          )}
          <button onClick={()=>setIsFullscreen(f=>!f)} className="p-1.5 rounded-lg text-[#4B5563] hover:text-[#2BFFF1] border border-white/[0.05] hover:border-[#2BFFF1]/30 transition-all">
            {isFullscreen
              ?<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
              :<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
            }
          </button>
        </div>
      </div>

      {/* ── Chart area ──────────────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          className="w-full h-full select-none"
          style={{ cursor: activeTool!=='none'?'crosshair':'default', touchAction:'none' }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
        />

        {/* Price axis overlay — 2-finger drag to zoom scale */}
        <div
          ref={axisOverlayRef}
          className="absolute top-0 right-0 bottom-0"
          style={{ width:PRICE_AXIS_WIDTH, cursor:'ns-resize', zIndex:5, touchAction:'none', background:'transparent' }}
          title="2-finger drag to zoom · Double-click to reset"
        />

        {/* ── Floating trade panel (fullscreen only) ───────────────── */}
        {showTradePanel && onPlaceOrder && (
          <div className="absolute z-20 w-52 bg-[#0B0E14]/95 border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden"
            style={{ left:tradePanelPos.x, top:tradePanelPos.y }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] cursor-move" onMouseDown={startPanelDrag}>
              <p className="text-[10px] font-bold text-[#A7B0B7]">Quick Trade</p>
              <button onClick={()=>setShowTradePanel(false)} className="text-[#4B5563] hover:text-[#A7B0B7] text-xs">✕</button>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex rounded-xl overflow-hidden border border-white/[0.07]">
                {(['buy','sell'] as const).map(s=>(
                  <button key={s} onClick={()=>setTradeSide(s)} className={`flex-1 py-2 text-[10px] font-black transition-all ${tradeSide===s?s==='buy'?'bg-green-500/20 text-green-400':'bg-red-500/20 text-red-400':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                    {s==='buy'?'▲ BUY':'▼ SELL'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[9px] text-green-400 block mb-0.5">TP</label>
                  <input type="number" value={tpPrice??''} onChange={e=>{const v=parseFloat(e.target.value);setTpPrice(v>0?v:null);}} placeholder="Optional" className="w-full bg-[#05060B] border border-green-500/20 rounded-lg px-2 py-1.5 text-[10px] text-[#F4F6FA] outline-none font-mono"/>
                </div>
                <div>
                  <label className="text-[9px] text-red-400 block mb-0.5">SL</label>
                  <input type="number" value={slPrice??''} onChange={e=>{const v=parseFloat(e.target.value);setSlPrice(v>0?v:null);}} placeholder="Optional" className="w-full bg-[#05060B] border border-red-500/20 rounded-lg px-2 py-1.5 text-[10px] text-[#F4F6FA] outline-none font-mono"/>
                </div>
              </div>
              <button onClick={()=>{ onPlaceOrder(tradeSide, tpPrice, slPrice); }}
                className={`w-full py-2.5 rounded-xl text-xs font-black transition-all ${tradeSide==='buy'?'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30':'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'}`}>
                Place {tradeSide === 'buy' ? 'Long' : 'Short'}
              </button>
              <p className="text-[8px] text-[#374151] text-center">Drag panel header to move</p>
            </div>
          </div>
        )}

        {/* Indicators menu */}
      {showIndicators && (
        <ChartIndicatorsMenu
          selected={activeIndicators}
          onToggle={(id, params) => {
            setActiveIndicators(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
            if (params) setIndicatorParams(prev => ({ ...prev, [id]: params }));
          }}
          onClose={() => setShowIndicators(false)}
        />
      )}

      {/* Context menu */}
        {contextMenu&&(
          <>
            <div className="absolute inset-0 z-10" onClick={()=>setContextMenu(null)}/>
            <div className="absolute z-20 bg-[#0B0E14] border border-white/[0.12] rounded-xl shadow-2xl py-1 min-w-48" style={{left:contextMenu.x,top:contextMenu.y}}>
              <div className="px-3 py-1.5 border-b border-white/[0.06] mb-1">
                <p className="text-[9px] text-[#4B5563] uppercase tracking-wide">At {formatPrice(contextMenu.price)}</p>
              </div>
              <button onClick={()=>setTpHere(contextMenu.price)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-green-400 hover:bg-green-500/10 transition-all text-left">
                <div className="w-2 h-2 rounded-full bg-green-400"/>Set Take Profit here
              </button>
              <button onClick={()=>setSlHere(contextMenu.price)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-all text-left">
                <div className="w-2 h-2 rounded-full bg-red-400"/>Set Stop Loss here
              </button>
              <button onClick={()=>{try{const pl=candleRef.current?.createPriceLine({price:contextMenu.price,lineWidth:1,lineStyle:LineStyle.Dashed,color:'#A78BFA',axisLabelVisible:true,title:formatPrice(contextMenu.price)});if(pl){drawnRef.current.push(pl);setDrawnCount(c=>c+1);}}catch{}setContextMenu(null);}}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#A78BFA] hover:bg-[#A78BFA]/10 transition-all text-left">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="12" x2="21" y2="12"/></svg>Draw line here
              </button>
              <div className="border-t border-white/[0.06] mt-1 pt-1">
                <button onClick={()=>setContextMenu(null)} className="w-full text-left px-3 py-1.5 text-[10px] text-[#4B5563] hover:text-[#A7B0B7] transition-all">Cancel</button>
              </div>
            </div>
          </>
        )}
      </div>

      {!candles.length&&(
        <div className="absolute inset-0 flex items-center justify-center text-[#4B5563] text-sm gap-2 pointer-events-none" style={{top:'40px'}}>
          <div className="w-4 h-4 border-2 border-[#2BFFF1]/25 border-t-[#2BFFF1] rounded-full animate-spin"/>Loading chart…
        </div>
      )}
    </div>
  );

  if (isFullscreen) return <div className="fixed inset-0 z-[300]">{chartContent}</div>;
  return <div className="w-full h-full">{chartContent}</div>;
}
