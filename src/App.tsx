import { useState, useEffect, useRef } from 'react';
import { useAuth } from './auth/AuthContext';
import { useTradingStore } from './store';
import { usePriceData, TOP_ASSETS, searchPumpTokens, SearchAsset, AssetId, INTERVALS } from './hooks/usePriceData';
import { useBotEngine } from './hooks/useBotEngine';
import { BotPanel } from './components/BotPanel';
import { PositionsTable } from './components/PositionsTable';
import { PriceChart, formatPrice } from './components/PriceChart';
import { AuthModal } from './components/AuthModal';
import { WalletDepositModal } from './components/WalletDepositModal';
import { PointsBadge, PointsLeaderboard } from './components/PointsLeaderboard';
import { MarketsPage } from './pages/MarketsPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { P2PPage } from './pages/P2PPage';
import { EarnPage } from './pages/EarnPage';
import { HomePage } from './pages/HomePage';
import { calcRSI, calcStochastic, calcATR } from './bots/indicators';
import { BuySellPressure } from './components/BuySellPressure';
import { Side } from './types';
import { TouchGrassModal, TouchGrassActive, useTouchGrass } from './components/TouchGrassMode';
import { PnlShareCard } from './components/PnlShareCard';

type Page = 'home' | 'trade' | 'markets' | 'p2p' | 'earn' | 'discover';
type SubNav = { tab?: string; rightTab?: string; discoverTab?: string; earnTab?: string };

// ── Asset Selector ──────────────────────────────────────────────────────────
function AssetSelector({ current, onChange }: { current:string; onChange:(id:string,addr?:string,pair?:string)=>void }) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<SearchAsset[]>([]);
  const [srch, setSrch]       = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => { setSrch(true); setResults(await searchPumpTokens(query)); setSrch(false); }, 400);
  }, [query]);

  const cur = (TOP_ASSETS as unknown as any[]).find((a: any) => a.id === current);

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:border-white/20 transition-all">
        <span className="text-sm font-bold text-[#F4F6FA]">{cur?.label ?? current}</span>
        <svg className="w-3 h-3 text-[#4B5563]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[199]" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1.5 w-72 bg-[#0B0E14] border border-white/[0.1] rounded-2xl shadow-2xl z-[200] overflow-hidden">
            <div className="p-3 border-b border-white/[0.06]">
              <input autoFocus placeholder="Search Pump.fun / Solana tokens…" value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
            </div>
            <div className="max-h-72 overflow-y-auto">
              {!query && (
                <>
                  <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-widest px-3 pt-2.5 pb-1">Top 10 Tokens</p>
                  {(TOP_ASSETS as unknown as any[]).map((a: any) => (
                    <button key={a.id} onClick={() => { onChange(a.id); setOpen(false); setQuery(''); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.04] transition-all text-left ${a.id===current?'bg-[#2BFFF1]/05':''}`}>
                      <div className="w-7 h-7 rounded-lg bg-white/[0.05] flex items-center justify-center text-xs font-black text-[#F4F6FA]">{a.id[0].toUpperCase()}</div>
                      <div><p className="text-sm font-semibold text-[#F4F6FA]">{a.label}</p>{a.isPump&&<p className="text-[9px] text-[#F59E0B]">Pump.fun</p>}</div>
                      {a.id===current&&<div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#2BFFF1]"/>}
                    </button>
                  ))}
                </>
              )}
              {query && srch && <div className="flex items-center justify-center py-6 gap-2 text-[#4B5563] text-xs"><div className="w-4 h-4 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>Searching…</div>}
              {query && !srch && results.length > 0 && results.map(r => (
                <button key={r.id} onClick={() => { onChange(r.id,r.address,r.pairAddress); setOpen(false); setQuery(''); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.04] transition-all text-left">
                  <div className="w-7 h-7 rounded-lg bg-[#F59E0B]/10 flex items-center justify-center text-[#F59E0B] text-xs font-black">P</div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-[#F4F6FA] truncate">{r.symbol}</p><p className="text-[9px] text-[#4B5563] truncate">{r.address?.slice(0,16)}…</p></div>
                  {r.priceUsd&&r.priceUsd>0&&<span className="text-[10px] text-[#A7B0B7]">${r.priceUsd.toFixed(6)}</span>}
                </button>
              ))}
              {query && !srch && results.length===0 && <p className="text-center text-xs text-[#4B5563] py-6">No results</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Trade form ──────────────────────────────────────────────────────────────
const LEVERAGE_PRESETS = [1,5,10,25,50,100,150,200,300];
function getPrecision(p: number): number { if(p>=1) return 4; if(p>=0.001) return 8; return 10; }

function TradeForm({ livePrice, asset, chartTP, chartSL, onClearChartTPSL }: { livePrice:number; asset:string; chartTP?:number|null; chartSL?:number|null; onClearChartTPSL?:()=>void }) {
  const { capital, openPosition, addLog } = useTradingStore();
  const { account, saveAccount, recordTrade } = useAuth();
  const [side,setSide] = useState<Side>('LONG');
  const [size,setSize] = useState('50');
  const [lev,setLev]   = useState('10');
  const [tp,setTp]     = useState('');
  const [sl,setSl]     = useState('');


  const [warnAck, setWarnAck] = useState(false);

  // Auto-fill TP/SL from chart right-click
  useEffect(() => {
    if (chartTP != null) { setTp(chartTP.toFixed(Math.min(getPrecision(chartTP), 8))); if (onClearChartTPSL) onClearChartTPSL(); }
  }, [chartTP]);
  useEffect(() => {
    if (chartSL != null) { setSl(chartSL.toFixed(Math.min(getPrecision(chartSL), 8))); if (onClearChartTPSL) onClearChartTPSL(); }
  }, [chartSL]);

  const sizeN  = parseFloat(size)||0;
  const levN   = Math.min(parseInt(lev)||1, 300);
  const notional = sizeN * levN;
  const cap    = account ? (account.use_real ? account.real_balance : account.mock_balance) : capital;
  const liqPct = (1/levN) * 0.9;
  const isHighLev = levN > 50;
  const isExtrLev = levN > 100;
  const needsWarn = isHighLev && !warnAck;

  const submit = async () => {
    if (sizeN <= 0 || sizeN > cap) return;
    if (needsWarn) { setWarnAck(true); return; }
    const pos = openPosition(asset, side, livePrice, sizeN, levN, 'manual', tp ? parseFloat(tp) : undefined, sl ? parseFloat(sl) : undefined);
    if (pos) {
      addLog(`📌 Manual ${side} ${asset} $${sizeN} ×${levN} @ $${livePrice.toFixed(4)}`);
      if (account) {
        const field = account.use_real ? 'real_balance' : 'mock_balance';
        const bal = account.use_real ? account.real_balance : account.mock_balance;
        saveAccount({ [field]: Math.max(0, bal - sizeN) } as any);
        recordTrade(notional, 0, false);
      }
      setWarnAck(false);
    }
  };

  const levBtnColor = (p: number) => {
    if (levN === p) return p > 100 ? 'bg-red-500/20 text-red-400 border-red-500/30' : p > 50 ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : 'bg-[#2BFFF1]/15 text-[#2BFFF1] border-[#2BFFF1]/30';
    return 'text-[#4B5563] border-white/[0.07] hover:text-[#A7B0B7]';
  };

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Place Trade</p>
        {account && <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${account.use_real ? 'text-[#2BFFF1] border-[#2BFFF1]/30 bg-[#2BFFF1]/10' : 'text-[#6B7280] border-white/[0.08]'}`}>{account.use_real ? 'LIVE' : 'MOCK'}</span>}
      </div>

      <div className="flex rounded-xl overflow-hidden border border-white/[0.07] mb-3">
        {(['LONG','SHORT'] as Side[]).map(s => (
          <button key={s} onClick={() => setSide(s)} className={`flex-1 py-2.5 text-xs font-bold transition-all ${side===s ? s==='LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {s==='LONG' ? '▲ LONG' : '▼ SHORT'}
          </button>
        ))}
      </div>

      {/* Size */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-[#6B7280] w-16 flex-shrink-0">Size ($)</span>
        <input type="number" value={size} onChange={e => setSize(e.target.value)}
          className="flex-1 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40"/>
      </div>

      {/* Leverage */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] text-[#6B7280] w-16 flex-shrink-0">Leverage</span>
          <input type="number" value={lev} min="1" max="300" onChange={e => { setLev(e.target.value); setWarnAck(false); }}
            className={`flex-1 bg-[#0B0E14] border rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none ${isExtrLev ? 'border-red-500/50' : isHighLev ? 'border-yellow-500/40' : 'border-white/[0.08] focus:border-[#2BFFF1]/40'}`}/>
          <span className={`text-xs font-black ${isExtrLev ? 'text-red-400' : isHighLev ? 'text-yellow-400' : 'text-[#A7B0B7]'}`}>{levN}×</span>
        </div>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {LEVERAGE_PRESETS.map(p => (
            <button key={p} onClick={() => { setLev(String(p)); setWarnAck(false); }}
              className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${levBtnColor(p)}`}>
              {p}×
            </button>
          ))}
        </div>
        <input type="range" min="1" max="300" value={levN} onChange={e => { setLev(e.target.value); setWarnAck(false); }}
          className="w-full h-1 rounded-full appearance-none bg-white/[0.05] cursor-pointer"
          style={{ accentColor: isExtrLev ? '#EF4444' : isHighLev ? '#F59E0B' : '#2BFFF1' }}/>
        <div className="flex justify-between text-[9px] text-[#374151] mt-0.5"><span>1×</span><span>150×</span><span>300×</span></div>
      </div>

      {isExtrLev && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 mb-3">
          <p className="text-[10px] text-red-400 font-bold mb-0.5">⚠️ EXTREME RISK — {levN}× LEVERAGE</p>
          <p className="text-[9px] text-red-400/70">A {((1/levN)*100).toFixed(2)}% adverse move will liquidate. Most retail traders lose money at this leverage.</p>
        </div>
      )}
      {isHighLev && !isExtrLev && (
        <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/08 p-2.5 mb-3">
          <p className="text-[10px] text-yellow-400 font-semibold">⚡ High leverage — {levN}× — Liq in {((1/levN)*100).toFixed(1)}% move</p>
        </div>
      )}

      {[['TP Price', tp, setTp], ['SL Price', sl, setSl]].map(([label, val, setter]: any) => (
        <div key={label} className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-[#6B7280] w-16 flex-shrink-0">{label}</span>
          <input type="number" value={val} placeholder="Optional" onChange={e => setter(e.target.value)}
            className="flex-1 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40"/>
        </div>
      ))}

      <div className="rounded-xl bg-[#0B0E14] px-3 py-2.5 mb-3 space-y-1.5">
        {[
          ['Notional', `$${notional.toFixed(0)}`],
          [`Liq ~${(liqPct*100).toFixed(2)}% away`, `$${(side==='LONG' ? livePrice*(1-liqPct) : livePrice*(1+liqPct)).toFixed(6)}`],
          ['Available', `$${cap.toFixed(2)}`, sizeN > cap ? '#F87171' : '#4ADE80'],
        ].map(([k, v, c]: any) => (
          <div key={k} className="flex justify-between text-[10px]"><span className="text-[#4B5563]">{k}</span><span style={{ color: c || '#A7B0B7' }}>{v}</span></div>
        ))}
      </div>

      <button onClick={submit} disabled={sizeN <= 0 || sizeN > cap}
        className={`w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
          needsWarn
            ? isExtrLev ? 'bg-red-500/30 text-red-300 border border-red-500/50 animate-pulse' : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 animate-pulse'
            : side==='LONG' ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
        }`}>
        {needsWarn ? `⚠️ Confirm ${levN}× — click again to open` : side==='LONG' ? '▲ Open Long' : '▼ Open Short'}
      </button>
    </div>
  );
}
function IndicatorsPanel({ prices }: { prices:number[] }) {
  const rsi=calcRSI(prices), {k,d}=calcStochastic(prices), atr=calcATR(prices)*100;
  const rsiC=rsi>70?'#F87171':rsi<30?'#4ADE80':'#A7B0B7', stC=k>80?'#F87171':k<20?'#4ADE80':'#A7B0B7';
  const bull=prices.length>5&&prices[prices.length-1]>prices[prices.length-5];
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-3">Indicators</p>
      <div className="space-y-3">
        {[['RSI (14)',rsi,rsiC],['Stoch K',k,stC]].map(([l,v,c]:any)=>(
          <div key={l}><div className="flex justify-between mb-1"><span className="text-[10px] text-[#6B7280]">{l}</span><span className="text-[10px] font-bold" style={{color:c}}>{Number(v).toFixed(1)}</span></div>
          <div className="h-1.5 rounded-full bg-white/[0.05]"><div className="h-full rounded-full" style={{width:`${Math.min(v,100)}%`,background:c}}/></div></div>
        ))}
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="flex justify-between"><span className="text-[#6B7280]">Stoch D</span><span className="text-[#A7B0B7]">{d.toFixed(1)}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">ATR</span><span className="text-[#A7B0B7]">{atr.toFixed(3)}%</span></div>
        </div>
        <div className="flex justify-between text-[10px]"><span className="text-[#6B7280]">Trend</span><span className="font-bold" style={{color:bull?'#4ADE80':'#F87171'}}>{bull?'▲ Bullish':'▼ Bearish'}</span></div>
      </div>
    </div>
  );
}

function StatsBar() {
  const {capital,positions,startingCapital}=useTradingStore(), {account}=useAuth();
  const closed=positions.filter(p=>p.status!=='open'), wins=closed.filter(p=>p.pnl>0).length;
  const tPnl=closed.reduce((s,p)=>s+p.pnl,0), oPnl=positions.filter(p=>p.status==='open').reduce((s,p)=>s+p.pnl,0);
  const wr=closed.length>0?wins/closed.length*100:0;
  const cap=account?(account.use_real?account.real_balance:account.mock_balance):capital;
  const cc=((cap-startingCapital)/startingCapital)*100;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {[{label:'Capital',value:`$${cap.toFixed(2)}`,sub:`${cc>=0?'+':''}${cc.toFixed(1)}%`,color:cc>=0?'#4ADE80':'#F87171'},
        {label:'Realized P&L',value:`${tPnl>=0?'+':''}$${tPnl.toFixed(2)}`,color:tPnl>=0?'#4ADE80':'#F87171'},
        {label:'Unrealized',value:`${oPnl>=0?'+':''}$${oPnl.toFixed(2)}`,color:oPnl>=0?'#4ADE80':'#F87171'},
        {label:'Win Rate',value:`${wr.toFixed(0)}%`,sub:`${wins}/${closed.length}`,color:'#A7B0B7'}].map(s=>(
        <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] text-[#4B5563] mb-0.5">{s.label}</p>
          <p className="text-sm font-bold" style={{color:s.color}}>{s.value}</p>
          {s.sub&&<p className="text-[10px] text-[#6B7280]">{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function ActivityLog() {
  const {logs}=useTradingStore();
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 h-full flex flex-col">
      <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-3 flex-shrink-0">Activity</p>
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {logs.length===0?<p className="text-[11px] text-[#4B5563]">No activity yet</p>:logs.map((l,i)=><p key={i} className="text-[10px] text-[#6B7280] font-mono leading-relaxed">{l}</p>)}
      </div>
    </div>
  );
}

// ── Mobile nav — custom SVG icons ──────────────────────────────────────────
const NAV_ICONS: Record<Page, (active:boolean)=>React.ReactNode> = {
  home:     (a) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?'#2BFFF1':'#374151'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  trade:    (a) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?'#2BFFF1':'#374151'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  markets:  (a) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?'#2BFFF1':'#374151'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  discover: (a) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?'#2BFFF1':'#374151'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>,
  earn:     (a) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?'#2BFFF1':'#374151'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  p2p:      (a) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?'#2BFFF1':'#374151'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>,
};

function MobileNav({ page, setPage }: { page:Page; setPage:(p:Page)=>void }) {
  const items: {id:Page;label:string}[] = [
    {id:'home',    label:'Home'},
    {id:'trade',   label:'Trade'},
    {id:'markets', label:'Markets'},
    {id:'discover',label:'Discover'},
    {id:'earn',    label:'Earn'},
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0B0E14]/96 backdrop-blur-sm border-t border-white/[0.06] flex md:hidden">
      {items.map(item=>{
        const active = page===item.id;
        return (
          <button key={item.id} onClick={()=>setPage(item.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all ${active?'text-[#2BFFF1]':'text-[#374151]'}`}>
            {NAV_ICONS[item.id]?.(active)}
            <span className="text-[9px] font-semibold">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Live/Mock toggle component ─────────────────────────────────────────────
function LiveMockToggle() {
  const { account, saveAccount } = useAuth();
  if (!account) return null;
  const toggle = () => saveAccount({ use_real: !account.use_real } as any);
  return (
    <button onClick={toggle}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-black transition-all ${account.use_real ? 'border-[#2BFFF1]/50 bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'border-white/[0.12] bg-white/[0.04] text-[#6B7280] hover:text-[#A7B0B7] hover:border-white/25'}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${account.use_real ? 'bg-[#2BFFF1] shadow-[0_0_6px_#2BFFF1]' : 'bg-[#374151]'}`}/>
      {account.use_real ? 'LIVE' : 'MOCK'}
    </button>
  );
}

// ── Mobile Trade ────────────────────────────────────────────────────────────
function MobileTrade({ assetId,livePrice,change24h,candles,prices,assetLabel,onChangeAsset,interval,setInterval,chartTP,chartSL,onSetTP,onSetSL }:any) {
  const [tab,setTab] = useState<'chart'|'trade'|'bots'|'board'>('chart');
  const {positions} = useTradingStore();
  return (
    <div className="flex flex-col h-full pb-16">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-shrink-0 overflow-x-auto">
        <AssetSelector current={assetId} onChange={onChangeAsset}/>
        <span className={`text-sm font-bold ml-1 font-mono ${change24h>=0?'text-green-400':'text-red-400'}`}>
          {livePrice>0?formatPrice(livePrice):'—'}
        </span>
        <span className={`text-xs ${change24h>=0?'text-green-400':'text-red-400'}`}>{change24h>=0?'+':''}{change24h.toFixed(2)}%</span>
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          {INTERVALS.map(i=>(
            <button key={i} onClick={()=>setInterval(i)} className={`px-1.5 py-1 rounded text-[10px] font-bold transition-all ${interval===i?'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/20':'text-[#4B5563]'}`}>{i}</button>
          ))}
          <LiveMockToggle/>
        </div>
      </div>
      <div className="flex border-b border-white/[0.06] flex-shrink-0">
        {([['chart','Chart'],['trade','Trade'],['bots','Bots'],['board','Rankings']] as const).map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t as any)} className={`flex-1 py-2 text-[10px] font-semibold transition-all ${tab===t?'text-[#2BFFF1] border-b-2 border-[#2BFFF1]':'text-[#4B5563]'}`}>{l}</button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {tab==='chart'&&(
          <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0 p-2"><PriceChart candles={candles} livePrice={livePrice} positions={positions}/></div>
            <div className="p-3 border-t border-white/[0.06] flex-shrink-0"><StatsBar/></div>
            <div className="flex-1 overflow-y-auto p-3 min-h-0"><PositionsTable livePrice={livePrice}/></div>
          </div>
        )}
        {tab==='trade'&&<div className="overflow-y-auto h-full p-3 space-y-3"><TradeForm livePrice={livePrice} asset={assetLabel}/><IndicatorsPanel prices={prices}/><BuySellPressure candles={candles} livePrice={livePrice} asset={assetLabel} assetId={assetId}/></div>}
        {tab==='bots'&&<div className="overflow-y-auto h-full p-3 space-y-3"><BotPanel/><ActivityLog/></div>}
        {tab==='board'&&<div className="overflow-y-auto h-full p-4"><PointsLeaderboard/></div>}
      </div>
    </div>
  );
}

// ── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [assetId,    setAssetId]    = useState<AssetId>('sol');
  const [customAddr, setCustomAddr] = useState<string|undefined>();
  const [customPair, setCustomPair]   = useState<string|undefined>();
  const [interval,   setInterval_]  = useState('15m');
  const [page,       setPage]       = useState<Page>('home');
  const [rightTab,   setRightTab]   = useState<'trade'|'bots'|'board'>('trade');
  const [discoverTab,setDiscoverTab] = useState<string>('discover');
  const [showAuth,   setShowAuth]   = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [flash,      setFlash]      = useState(false);
  const [showPnlShare, setShowPnlShare] = useState(false);
  const [quickTP, setQuickTP] = useState<number|null>(null);
  const [quickSL, setQuickSL] = useState<number|null>(null);
  const { showModal: showTG, grassActive, handleActivate: tgActivate, handleSkip: tgSkip, handleDeactivate: tgDeactivate } = useTouchGrass();
  const [favs,       setFavs]       = useState<string[]>([]);

  const {candles,livePrice,loading,change24h,prices,asset} = usePriceData(assetId,interval,customAddr,customPair);
  const {capital,setCapital,resetCapital,positions} = useTradingStore();
  const {user,account,signOut,loading:authLoading} = useAuth();

  useBotEngine({prices,livePrice,asset:asset.label,candles});
  useEffect(()=>{setFlash(true);setTimeout(()=>setFlash(false),300);},[livePrice]);
  useEffect(()=>{if(account)setCapital(account.use_real?account.real_balance:account.mock_balance);},[account,setCapital]);

  const handleChangeAsset = (id:string,addr?:string,pair?:string) => { setAssetId(id); setCustomAddr(addr); setCustomPair(pair); setPage('trade'); };
  const handleNavigate = (p: Page, subNav?: SubNav) => {
    setPage(p);
    if (subNav?.rightTab) setRightTab(subNav.rightTab as any);
    if (subNav?.discoverTab) setDiscoverTab(subNav.discoverTab);
  };
  const toggleFav = (addr:string) => setFavs(prev=>prev.includes(addr)?prev.filter(a=>a!==addr):[...prev,addr]);

  const dispCap = account?(account.use_real?account.real_balance:account.mock_balance):capital;

  if (authLoading) return <div className="min-h-screen bg-[#05060B] flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/></div>;

  const desktopNavItems: {id:Page;label:string}[] = [
    {id:'home',    label:'Home'},
    {id:'trade',   label:'Trade'},
    {id:'markets', label:'Markets'},
    {id:'p2p',     label:'P2P'},
    {id:'earn',    label:'Earn'},
    {id:'discover',label:'Discover'},
  ];

  return (
    <div className="h-screen bg-[#05060B] flex flex-col overflow-hidden" style={{fontFamily:'-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'}}>

      {/* ── Header ── */}
      <div className="border-b border-white/[0.06] bg-[#05060B]/90 backdrop-blur-sm sticky top-0 z-50 flex-shrink-0">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={()=>setPage('home')} className="flex items-center gap-2 flex-shrink-0">
            <img src="/logo.png" alt="Xenia" className="w-8 h-8 rounded-lg object-cover" onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>
            <div className="hidden sm:block">
              <span className="font-bold text-[#F4F6FA] text-sm">Xenia</span>
              <span className="text-[#2BFFF1] font-bold text-sm"> Trading</span>
            </div>
          </button>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5 ml-2">
            {desktopNavItems.map(({id,label})=>(
              <button key={id} onClick={()=>setPage(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${page===id?'bg-[#2BFFF1]/15 text-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                {label}
              </button>
            ))}
          </nav>

          {/* Live price on trade page */}
          {page==='trade'&&(
            <div className="hidden md:flex items-center gap-2 ml-2">
              <span className={`text-base font-bold transition-colors font-mono ${flash?'text-[#2BFFF1]':'text-[#F4F6FA]'}`}>
                {livePrice>0?formatPrice(livePrice):'—'}
              </span>
              <span className={`text-xs font-semibold ${change24h>=0?'text-green-400':'text-red-400'}`}>{change24h>=0?'+':''}{change24h.toFixed(2)}%</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <LiveMockToggle/>
            <PointsBadge/>
            {user ? (
              <>
                <button onClick={()=>setShowPnlShare(true)}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:border-white/20 transition-all text-[10px] text-[#4B5563] hover:text-[#A7B0B7]"
                  title="Share P&L">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                  P&L
                </button>
                <button onClick={()=>setShowWallet(true)}
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:border-white/20 transition-all">
                  <span className="text-xs text-[#A7B0B7]">{account?.username??user.email?.split('@')[0]}</span>
                  <span className="text-xs font-bold" style={{color:account?.use_real?'#2BFFF1':'#6B7280'}}>${dispCap.toFixed(0)}</span>
                </button>
                <button onClick={()=>setShowWallet(true)} className="sm:hidden text-xs px-3 py-1.5 rounded-xl border border-[#2BFFF1]/25 text-[#2BFFF1] hover:bg-[#2BFFF1]/10 transition-all">💳</button>
                <button onClick={()=>signOut()} className="hidden sm:block text-[10px] px-2.5 py-1.5 rounded-xl border border-white/[0.07] text-[#4B5563] hover:text-[#A7B0B7] transition-all">Sign out</button>
              </>
            ) : (
              <button onClick={()=>setShowAuth(true)}
                className="text-xs px-3 py-1.5 rounded-xl border border-[#2BFFF1]/25 bg-[#2BFFF1]/10 text-[#2BFFF1] hover:bg-[#2BFFF1]/20 font-semibold transition-all">
                Sign In
              </button>
            )}

          </div>
        </div>
      </div>

      {/* ── Mobile layout ── */}
      <div className="flex-1 overflow-hidden md:hidden">
        {page==='home'&&<HomePage onNavigate={handleNavigate} onShowWallet={()=>setShowWallet(true)} onShowAuth={()=>setShowAuth(true)}/>}
        {page==='trade'&&<MobileTrade assetId={assetId} livePrice={livePrice} change24h={change24h} candles={candles} prices={prices} assetLabel={asset.label} onChangeAsset={handleChangeAsset} interval={interval} setInterval={setInterval_} chartTP={quickTP} chartSL={quickSL} onSetTP={setQuickTP} onSetSL={setQuickSL}/>}
        {page==='markets'&&<MarketsPage onTrade={handleChangeAsset} favourites={favs} onToggleFav={toggleFav}/>}
        {page==='p2p'&&<div className="overflow-y-auto h-full pb-16"><P2PPage/></div>}
        {page==='earn'&&<div className="overflow-y-auto h-full pb-16"><EarnPage/></div>}
        {page==='discover'&&<DiscoverPage initialTab={discoverTab}/>}
      </div>

      {/* ── Desktop layout ── */}
      <div className="hidden md:flex flex-1 overflow-hidden flex-col">
        {page==='home'&&<div className="flex-1 overflow-y-auto"><HomePage onNavigate={handleNavigate} onShowWallet={()=>setShowWallet(true)} onShowAuth={()=>setShowAuth(true)}/></div>}
        {page==='p2p'&&<div className="flex-1 overflow-y-auto"><P2PPage/></div>}
        {page==='earn'&&<div className="flex-1 overflow-y-auto"><EarnPage/></div>}
        {page==='discover'&&<div className="flex-1 overflow-hidden"><DiscoverPage initialTab={discoverTab}/></div>}
        {page==='markets'&&<div className="flex-1 overflow-hidden"><MarketsPage onTrade={handleChangeAsset} favourites={favs} onToggleFav={toggleFav}/></div>}
        {page==='trade'&&(
          <div className="flex flex-col flex-1 overflow-hidden px-4 pt-3 pb-3 gap-3">
            <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
              <AssetSelector current={assetId} onChange={handleChangeAsset}/>
              <div className="flex items-center gap-0.5">
                {INTERVALS.map(i=>(
                  <button key={i} onClick={()=>setInterval_(i)} className={`px-2 py-1 rounded text-[10px] font-semibold transition-all ${interval===i?'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/20':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>{i}</button>
                ))}
              </div>
              <div className="flex-1"><StatsBar/></div>
            </div>

            {grassActive && <TouchGrassActive onDeactivate={tgDeactivate}/>}
            <div className="grid grid-cols-[240px_1fr_260px] gap-3 flex-1 min-h-0">
              <div className="overflow-y-auto"><BotPanel/></div>
              <div className="flex flex-col gap-3 min-w-0 overflow-hidden">
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 flex-shrink-0" style={{height:'55%'}}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[#A7B0B7]">{asset.label} — {interval}</span>
                    {loading&&<div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>}
                  </div>
                  <div style={{height:'calc(100% - 28px)'}}><PriceChart candles={candles} livePrice={livePrice} positions={positions} onQuickTP={p=>setQuickTP(p)} onQuickSL={p=>setQuickSL(p)} /></div>
                </div>
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 flex-1 overflow-hidden"><PositionsTable livePrice={livePrice}/></div>
              </div>
              <div className="flex flex-col gap-3 overflow-hidden">
                <div className="flex rounded-xl border border-white/[0.07] overflow-hidden flex-shrink-0">
                  {([['trade','Trade'],['bots','Bots'],['board','Rankings']] as const).map(([t,l])=>(
                    <button key={t} onClick={()=>setRightTab(t as any)} className={`flex-1 py-2 text-[10px] font-semibold transition-all ${rightTab===t?'bg-[#2BFFF1]/15 text-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>{l}</button>
                  ))}
                </div>
                {rightTab==='trade'?<><TradeForm livePrice={livePrice} asset={asset.label}/><IndicatorsPanel prices={prices}/><BuySellPressure candles={candles} livePrice={livePrice} asset={asset.label} assetId={assetId}/><div className="flex-1 overflow-hidden min-h-0"><ActivityLog/></div></>
                :rightTab==='bots'?<div className="flex-1 overflow-y-auto"><BotPanel/></div>
                :<div className="flex-1 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4"><PointsLeaderboard/></div>}
              </div>
            </div>
          </div>
        )}
      </div>

      <MobileNav page={page} setPage={setPage}/>
      {showAuth&&<AuthModal onClose={()=>setShowAuth(false)}/>}
      {showWallet&&<WalletDepositModal onClose={()=>setShowWallet(false)}/>}
      {showPnlShare&&<PnlShareCard onClose={()=>setShowPnlShare(false)}/>}
      <TouchGrassModal show={showTG} onClose={tgSkip} onActivate={tgActivate}/>
    </div>
  );
}
