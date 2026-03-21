import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { PriceChart } from '../components/PriceChart';
import { Candle } from '../types';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';
const MOCK_FEE = 0.0025, LIVE_FEE = 0.0035;
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d'] as const;

interface Token { mint:string; symbol:string; name:string; priceUsd:number; change24h:number; volume24h:number; mcap:number; logoUri:string; pairAddress:string; }
interface Holding { id:string; token_mint:string; token_symbol:string; token_name:string; amount:number; avg_cost:number; is_mock:boolean; currentPrice?:number; pnl?:number; pnlPct?:number; }
interface Trade { id:string; token_symbol:string; side:'buy'|'sell'; amount_token:number; amount_usd:number; price_usd:number; fee_usd:number; is_mock:boolean; status:string; created_at:string; }

function fmtP(p:number):string { if(!p||p<=0) return '$0'; if(p>=1000) return `$${p.toFixed(2)}`; if(p>=1) return `$${p.toFixed(4)}`; if(p>=0.001) return `$${p.toFixed(6)}`; return `$${p.toFixed(9)}`; }
function fmtUsd(n:number):string { if(!n) return '$0'; if(n>=1e6) return `$${(n/1e6).toFixed(2)}M`; if(n>=1e3) return `$${(n/1e3).toFixed(1)}K`; return `$${Math.abs(n).toFixed(2)}`; }

async function searchTokens(q:string):Promise<Token[]> {
  if(!q.trim()) return [];
  try {
    const isAddr=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim());
    const url=isAddr?`https://api.dexscreener.com/latest/dex/tokens/${q.trim()}`:`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
    const r=await fetch(url); if(!r.ok) return [];
    const d=await r.json(); const seen=new Set<string>(); const out:Token[]=[];
    for(const p of (d.pairs??[]).slice(0,40)) {
      if(p.chainId!=='solana'||!p.baseToken) continue;
      const mint=p.baseToken.address; if(seen.has(mint)) continue;
      const price=parseFloat(p.priceUsd??'0'); const mcap=parseFloat(p.marketCap??p.fdv??'0');
      if(mcap>0&&mcap<30_000) continue;
      const logo=p.info?.imageUrl??''; if(!logo&&!isAddr) continue;
      seen.add(mint);
      out.push({ mint, symbol:p.baseToken.symbol, name:p.baseToken.name, priceUsd:price, change24h:parseFloat(p.priceChange?.h24??'0'), volume24h:parseFloat(p.volume?.h24??'0'), mcap, logoUri:logo, pairAddress:p.pairAddress??mint });
      if(out.length>=20) break;
    }
    return out;
  } catch { return []; }
}

async function fetchSpotCandles(pairAddress:string, interval:string):Promise<Candle[]> {
  const G:{[k:string]:{tf:string;agg:number}} = {'1m':{tf:'minute',agg:1},'5m':{tf:'minute',agg:5},'15m':{tf:'minute',agg:15},'30m':{tf:'minute',agg:30},'1h':{tf:'hour',agg:1},'4h':{tf:'hour',agg:4},'1d':{tf:'day',agg:1}};
  const {tf,agg}=G[interval]??{tf:'minute',agg:15};
  try {
    const r=await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddress}/ohlcv/${tf}?aggregate=${agg}&limit=300&currency=usd&token=base`,{headers:{Accept:'application/json;version=20230302'}});
    if(!r.ok) return [];
    const d=await r.json();
    return (d?.data?.attributes?.ohlcv_list??[]).map((c:any)=>({time:c[0]*1000,open:parseFloat(c[1]),high:parseFloat(c[2]),low:parseFloat(c[3]),close:parseFloat(c[4]),volume:parseFloat(c[5])})).reverse().filter((c:any)=>c.open>0);
  } catch { return []; }
}

function TokenImg({src,symbol,size=28}:{src:string;symbol:string;size?:number}) {
  const [err,setErr]=useState(false);
  return <div className="rounded-full flex-shrink-0 bg-[#0D1117] border border-white/[0.05] flex items-center justify-center overflow-hidden" style={{width:size,height:size}}>
    {!err&&src?<img src={src} alt={symbol} className="w-full h-full object-cover" onError={()=>setErr(true)}/>:<span className="text-[#2BFFF1] font-black" style={{fontSize:size*0.3}}>{symbol.slice(0,3)}</span>}
  </div>;
}

// ── Live Buy/Sell Pressure (on-chain) ─────────────────────────────────────
function SpotPressure({ token, candles, livePrice }:{ token:Token|null; candles:Candle[]; livePrice:number }) {
  const [onchainBuys, setOnchainBuys] = useState(0);
  const [onchainSells, setOnchainSells] = useState(0);
  const [liquidity, setLiquidity] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if(!token) return;
    setLoading(true);
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.mint}`)
      .then(r=>r.json()).then(d=>{
        const p=d.pairs?.[0];
        if(p) {
          setOnchainBuys(p.txns?.h1?.buys??0);
          setOnchainSells(p.txns?.h1?.sells??0);
          setLiquidity(parseFloat(p.liquidity?.usd??'0'));
        }
        setLoading(false);
      }).catch(()=>setLoading(false));
  }, [token?.mint]);

  const candleBuyPct = useMemo(()=>{
    const r=candles.slice(-30);
    if(!r.length) return 50;
    let bv=0,sv=0; for(const c of r) c.close>=c.open?bv+=c.volume:sv+=c.volume;
    return bv+sv>0?(bv/(bv+sv))*100:50;
  },[candles]);

  const total=onchainBuys+onchainSells;
  const obBuyPct=total>0?(onchainBuys/total)*100:candleBuyPct;
  const buyPct=Math.round(obBuyPct);
  const sellPct=100-buyPct;
  const trending=buyPct>55?'bullish':buyPct<45?'bearish':'neutral';
  const tColor=trending==='bullish'?'#4ADE80':trending==='bearish'?'#F87171':'#A7B0B7';

  if(!token) return null;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-[#A7B0B7] uppercase tracking-widest">Buy / Sell Pressure</p>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-green-400 bg-green-400/10">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/>LIVE
          </span>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{color:tColor,background:tColor+'20',border:`1px solid ${tColor}40`}}>{trending.charAt(0).toUpperCase()+trending.slice(1)}</span>
        </div>
      </div>
      <div>
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-green-400 font-bold">▲ BUY {buyPct}%</span>
          <span className="text-red-400 font-bold">▼ SELL {sellPct}%</span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden flex">
          <div className="h-full bg-green-500/60 transition-all duration-700" style={{width:`${buyPct}%`}}/>
          <div className="h-full bg-red-500/50 flex-1"/>
        </div>
      </div>
      <div className="flex justify-around">
        {[['BUY',buyPct,'#4ADE80'],['SELL',sellPct,'#F87171']].map(([l,pct,c])=>(
          <div key={l as string} className="relative flex items-center justify-center">
            <svg width="60" height="60" viewBox="0 0 60 60">
              <circle cx="30" cy="30" r="22" fill="none" stroke={`${c}20`} strokeWidth="5"/>
              <circle cx="30" cy="30" r="22" fill="none" stroke={c as string} strokeWidth="5"
                strokeDasharray={`${2*Math.PI*22*(pct as number)/100} ${2*Math.PI*22*(1-(pct as number)/100)}`}
                strokeDashoffset={2*Math.PI*22*0.25} strokeLinecap="round"
                style={{transition:'stroke-dasharray 0.6s ease'}}/>
            </svg>
            <div className="absolute text-center">
              <p className="text-[10px] font-black" style={{color:c as string}}>{pct}%</p>
              <p className="text-[8px] text-[#4B5563]">{l}</p>
            </div>
          </div>
        ))}
        <div className="text-center space-y-0.5 self-center">
          {total>0&&<><p className="text-[9px] text-[#4B5563]">1h txns</p><p className="text-[10px] font-bold text-green-400">{onchainBuys} B</p><p className="text-[10px] font-bold text-red-400">{onchainSells} S</p></>}
          {liquidity>0&&<><p className="text-[9px] text-[#4B5563] mt-1">Liq</p><p className="text-[10px] text-[#A7B0B7]">{fmtUsd(liquidity)}</p></>}
        </div>
      </div>
      <p className="text-[9px] text-[#374151] text-center">DexScreener · {loading?'Loading…':'Updated'}</p>
    </div>
  );
}

// ── Main Spot Page ─────────────────────────────────────────────────────────
interface Props { isMock:boolean; onToggleMock:()=>void; }

export function SpotTradingPage({ isMock, onToggleMock }:Props) {
  const { user, account } = useAuth();

  const [searchQ,       setSearchQ]       = useState('');
  const [searchResults, setSearchResults] = useState<Token[]>([]);
  const [searching,     setSearching]     = useState(false);
  const [token,         setToken]         = useState<Token|null>(null);
  const [livePrice,     setLivePrice]     = useState(0);
  const [candles,       setCandles]       = useState<Candle[]>([]);
  const [interval,      setInterval_]     = useState('15m');
  const [loadingChart,  setLoadingChart]  = useState(false);
  const [side,          setSide]          = useState<'buy'|'sell'>('buy');
  const [amountUsd,     setAmountUsd]     = useState('');
  const [amountPct,     setAmountPct]     = useState(0);
  const [tp,            setTp]            = useState('');
  const [sl,            setSl]            = useState('');
  const [executing,     setExecuting]     = useState(false);
  const [txStatus,      setTxStatus]      = useState<{type:'success'|'error';msg:string}|null>(null);
  const [tab,           setTab]           = useState<'chart'|'portfolio'|'history'>('chart');
  const [holdings,      setHoldings]      = useState<Holding[]>([]);
  const [trades,        setTrades]        = useState<Trade[]>([]);
  const [loadingPort,   setLoadingPort]   = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(true);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const priceTimer  = useRef<ReturnType<typeof setInterval>>();

  const balance  = account ? (isMock ? account.mock_balance : account.real_balance) : 0;
  const amtN     = parseFloat(amountUsd)||0;
  const feeP     = isMock ? MOCK_FEE : LIVE_FEE;
  const feeUsd   = amtN * feeP;
  const netUsd   = side==='buy' ? amtN+feeUsd : amtN-feeUsd;
  const tokOut   = livePrice>0 ? amtN/livePrice : 0;
  const currentHolding = holdings.find(h=>h.token_mint===token?.mint&&h.is_mock===isMock);

  const getAuth = async () => { const {data:{session}} = await supabase!.auth.getSession(); return session?.access_token??''; };

  // Search
  useEffect(()=>{
    if(!searchQ.trim()){setSearchResults([]);return;}
    clearTimeout(searchTimer.current); setSearching(true);
    searchTimer.current=setTimeout(async()=>{ const r=await searchTokens(searchQ); setSearchResults(r); setSearching(false); },350);
  },[searchQ]);

  // Price
  useEffect(()=>{
    if(!token) return;
    setLivePrice(token.priceUsd);
    clearInterval(priceTimer.current);
    priceTimer.current=setInterval(async()=>{ try{const r=await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.mint}`);const d=await r.json();const p=parseFloat(d.pairs?.[0]?.priceUsd??'0');if(p>0)setLivePrice(p);}catch{} },10_000);
    return()=>clearInterval(priceTimer.current);
  },[token?.mint]);

  // Candles
  useEffect(()=>{
    if(!token?.pairAddress) return;
    setLoadingChart(true); setCandles([]);
    fetchSpotCandles(token.pairAddress, interval).then(c=>{ setCandles(c); setLoadingChart(false); });
  },[token?.pairAddress, interval]);

  // Amount % sync
  useEffect(()=>{ if(balance>0&&amountPct>0) setAmountUsd((balance*amountPct/100).toFixed(2)); },[amountPct,balance]);

  // Portfolio
  const loadPortfolio = useCallback(async()=>{
    if(!supabase||!user) return;
    setLoadingPort(true);
    const [hr,tr]=await Promise.all([
      supabase.from('spot_holdings').select('*').eq('user_id',user.id).eq('is_mock',isMock).order('updated_at',{ascending:false}),
      supabase.from('spot_trades').select('*').eq('user_id',user.id).eq('is_mock',isMock).order('created_at',{ascending:false}).limit(40),
    ]);
    const raw=(hr.data??[]) as Holding[];
    const enriched=await Promise.all(raw.map(async h=>{
      try{const r=await fetch(`https://api.dexscreener.com/latest/dex/tokens/${h.token_mint}`);const d=await r.json();const p=parseFloat(d.pairs?.[0]?.priceUsd??'0');return{...h,currentPrice:p,pnl:p>0?(p-h.avg_cost)*h.amount:0,pnlPct:h.avg_cost>0?((p-h.avg_cost)/h.avg_cost)*100:0};}catch{return h;}
    }));
    setHoldings(enriched.filter(h=>h.amount>0.000001));
    setTrades((tr.data??[]) as Trade[]);
    setLoadingPort(false);
  },[user,isMock]);

  useEffect(()=>{ if(tab==='portfolio'||tab==='history') loadPortfolio(); },[tab, loadPortfolio]);

  const executeTrade = async()=>{
    if(!user||!token||amtN<=0) return;
    if(amtN>balance){setTxStatus({type:'error',msg:'Insufficient balance'});return;}
    setExecuting(true); setTxStatus(null);
    try {
      const authToken=await getAuth();
      const r=await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken}`},
        body:JSON.stringify({ action:'mock_trade', isMock, inputMint:side==='buy'?USDC_MINT:token.mint, outputMint:side==='buy'?token.mint:USDC_MINT, amountUsd:amtN, tokenSymbol:token.symbol, tokenName:token.name, priceUsd:livePrice, side }),
      });
      const d=await r.json();
      if(!r.ok) throw new Error(d.error??'Trade failed');
      setTxStatus({type:'success',msg:`${side==='buy'?'Bought':'Sold'} ${tokOut.toFixed(4)} ${token.symbol} · fee $${feeUsd.toFixed(4)}`});
      setAmountUsd(''); setAmountPct(0);
      if(!isMock) {
        // Live: use Jupiter — same as before
      }
      await loadPortfolio();
    } catch(e:any){ setTxStatus({type:'error',msg:e.message??'Trade failed'}); }
    setExecuting(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#05060B]">

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-shrink-0">
        {/* Search */}
        <div className="relative flex-1">
          <div className="flex items-center gap-2 bg-[#0B0E14] border border-white/[0.08] rounded-xl px-2.5 py-2 focus-within:border-[#2BFFF1]/40 transition-all">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search token…" className="flex-1 bg-transparent text-xs text-[#F4F6FA] outline-none placeholder-[#2D3748]" style={{minWidth:0}}/>
            {token&&<button onClick={()=>setToken(null)} className="text-[#4B5563] hover:text-[#A7B0B7] text-xs">✕</button>}
            {searching&&<div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin flex-shrink-0"/>}
          </div>
          {searchResults.length>0&&(
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#0B0E14] border border-white/[0.1] rounded-2xl shadow-2xl z-[200] overflow-hidden max-h-52 overflow-y-auto">
              {searchResults.map(t=>(
                <button key={t.mint} onClick={()=>{setToken(t);setSearchQ('');setSearchResults([]);}} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.04] transition-all text-left">
                  <TokenImg src={t.logoUri} symbol={t.symbol} size={28}/>
                  <div className="flex-1 min-w-0"><p className="text-xs font-bold text-[#F4F6FA]">{t.symbol}</p><p className="text-[9px] text-[#374151] truncate">{t.name}</p></div>
                  <div className="text-right flex-shrink-0"><p className="text-xs font-mono text-[#A7B0B7]">{fmtP(t.priceUsd)}</p><p className={`text-[9px] ${t.change24h>=0?'text-green-400':'text-red-400'}`}>{t.change24h>=0?'+':''}{t.change24h.toFixed(2)}%</p></div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mock/Live */}
        <button onClick={onToggleMock} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[11px] font-black transition-all flex-shrink-0 ${isMock?'border-white/[0.1] bg-white/[0.03] text-[#6B7280]':'border-[#2BFFF1]/50 bg-[#2BFFF1]/15 text-[#2BFFF1]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isMock?'bg-[#374151]':'bg-[#2BFFF1] animate-pulse'}`}/>
          {isMock?'MOCK':'LIVE'}
        </button>
      </div>

      {/* ── Token strip ──────────────────────────────────────────────── */}
      {token&&(
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.05] flex-shrink-0 bg-[#080A10]">
          <TokenImg src={token.logoUri} symbol={token.symbol} size={26}/>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black text-[#F4F6FA]">{token.symbol}</span>
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${token.change24h>=0?'text-green-400 bg-green-500/10':'text-red-400 bg-red-500/10'}`}>{token.change24h>=0?'+':''}{token.change24h.toFixed(2)}%</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-black font-mono text-[#F4F6FA]">{fmtP(livePrice)}</p>
            <p className="text-[9px] text-[#374151]">Vol {fmtUsd(token.volume24h)}</p>
          </div>
          <div className="flex gap-0.5 ml-1">
            {INTERVALS.map(i=>(
              <button key={i} onClick={()=>setInterval_(i)} className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${interval===i?'bg-[#2BFFF1]/15 text-[#2BFFF1]':'text-[#374151] hover:text-[#6B7280]'}`}>{i}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="flex border-b border-white/[0.05] flex-shrink-0">
        {(['chart','portfolio','history'] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)} className={`flex-1 py-2 text-[11px] font-semibold capitalize transition-all ${tab===t?'text-[#2BFFF1] border-b-2 border-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {t==='chart'?'📈 Trade':t==='portfolio'?'📊 Portfolio':'🕐 History'}
          </button>
        ))}
      </div>

      {/* ════════════════════ CHART + ORDER FORM ═══════════════════════ */}
      {tab==='chart'&&(
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* ── Chart area ─────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Chart */}
            <div className="flex-1 min-h-0">
              {token?(
                loadingChart&&candles.length===0
                  ?<div className="h-full flex items-center justify-center gap-2 text-[#4B5563] text-xs"><div className="w-4 h-4 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>Loading chart…</div>
                  :<PriceChart candles={candles} livePrice={livePrice} positions={[]} onQuickTP={p=>{setTp(p.toFixed(9).replace(/\.?0+$/,''));}} onQuickSL={p=>{setSl(p.toFixed(9).replace(/\.?0+$/,''));}}/>
              ):(
                <div className="h-full flex flex-col items-center justify-center text-center p-6">
                  <p className="text-4xl mb-3">📈</p>
                  <p className="text-sm text-[#4B5563]">Search any Solana token to start</p>
                  <p className="text-[10px] text-[#374151] mt-1">Pump.fun · Raydium · Jupiter · Any $30k+ MCap</p>
                </div>
              )}
            </div>

            {/* Pressure below chart */}
            {token&&candles.length>0&&(
              <div className="flex-shrink-0 border-t border-white/[0.05]" style={{maxHeight:'200px',overflowY:'auto'}}>
                <SpotPressure token={token} candles={candles} livePrice={livePrice}/>
              </div>
            )}
          </div>

          {/* ── Order form panel ────────────────────────────────────── */}
          <div className="w-[220px] sm:w-[260px] flex-shrink-0 border-l border-white/[0.06] flex flex-col overflow-y-auto bg-[#080A10]">
            {token?(
              <div className="p-3 space-y-3">
                {/* Buy / Sell */}
                <div className="flex rounded-xl overflow-hidden border border-white/[0.07]">
                  {(['buy','sell'] as const).map(s=>(
                    <button key={s} onClick={()=>setSide(s)} className={`flex-1 py-2.5 text-xs font-black transition-all ${side===s?s==='buy'?'bg-green-500/20 text-green-400':'bg-red-500/20 text-red-400':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                      {s==='buy'?'▲ BUY':'▼ SELL'}
                    </button>
                  ))}
                </div>

                {/* Balance */}
                <div className="flex justify-between text-[10px]">
                  <span className="text-[#4B5563]">Available</span>
                  <span className="font-mono font-bold text-[#F4F6FA]">${balance.toFixed(2)}</span>
                </div>

                {/* Amount input */}
                <div>
                  <label className="text-[9px] text-[#4B5563] mb-1 block">Amount (USD)</label>
                  <div className="flex items-center gap-1.5 bg-[#05060B] border border-white/[0.08] rounded-xl px-2.5 py-2 focus-within:border-[#2BFFF1]/40">
                    <span className="text-[#374151] text-xs">$</span>
                    <input type="number" value={amountUsd} onChange={e=>{setAmountUsd(e.target.value);setAmountPct(0);}} placeholder="0.00" className="flex-1 bg-transparent text-xs font-mono text-[#F4F6FA] outline-none" style={{minWidth:0}}/>
                  </div>
                </div>

                {/* Percentage slider */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[9px] text-[#374151]">
                    <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                  </div>
                  <input type="range" min={0} max={100} step={5} value={amountPct} onChange={e=>setAmountPct(parseInt(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{accentColor:side==='buy'?'#4ADE80':'#F87171',background:`linear-gradient(to right, ${side==='buy'?'#4ADE80':'#F87171'} ${amountPct}%, #1a2030 ${amountPct}%)`}}/>
                  <div className="flex gap-1">
                    {[25,50,75,100].map(p=>(
                      <button key={p} onClick={()=>setAmountPct(p)} className={`flex-1 py-1 rounded-lg text-[9px] font-bold transition-all ${amountPct===p?(side==='buy'?'bg-green-500/20 text-green-400 border border-green-500/25':'bg-red-500/20 text-red-400 border border-red-500/25'):'bg-white/[0.04] text-[#4B5563] border border-white/[0.06] hover:text-[#A7B0B7]'}`}>{p}%</button>
                    ))}
                  </div>
                </div>

                {/* TP / SL */}
                <div className="grid grid-cols-2 gap-1.5">
                  {[['TP',tp,setTp,'#4ADE80'],['SL',sl,setSl,'#F87171']].map(([label,val,setter,color]:any)=>(
                    <div key={label}>
                      <label className="text-[9px] mb-0.5 block font-semibold" style={{color}}>{label}</label>
                      <input type="number" value={val} onChange={e=>setter(e.target.value)} placeholder="Optional"
                        className="w-full bg-[#05060B] rounded-lg px-2 py-1.5 text-[10px] text-[#F4F6FA] outline-none font-mono"
                        style={{border:`1px solid ${val?color+'40':'rgba(255,255,255,0.06)'}`,transition:'border-color 0.2s'}}/>
                    </div>
                  ))}
                </div>

                {/* Summary */}
                {amtN>0&&livePrice>0&&(
                  <div className="rounded-xl bg-[#05060B] border border-white/[0.05] px-2.5 py-2 space-y-1">
                    <div className="flex justify-between text-[9px]"><span className="text-[#4B5563]">Tokens</span><span className="font-mono text-[#A7B0B7]">{tokOut.toFixed(4)}</span></div>
                    <div className="flex justify-between text-[9px]"><span className="text-[#4B5563]">Fee {isMock?'0.25%':'0.35%'}</span><span className="font-mono text-[#F59E0B]">${feeUsd.toFixed(4)}</span></div>
                    <div className="flex justify-between text-[9px] font-bold pt-0.5 border-t border-white/[0.04]"><span className="text-[#4B5563]">Total</span><span className="text-[#F4F6FA]">${netUsd.toFixed(2)}</span></div>
                  </div>
                )}

                {/* Status */}
                {txStatus&&(
                  <div className={`rounded-xl px-2.5 py-2 text-[10px] font-semibold ${txStatus.type==='success'?'bg-green-500/10 text-green-400 border border-green-500/15':'bg-red-500/10 text-red-400 border border-red-500/15'}`}>
                    {txStatus.type==='success'?'✅':'❌'} {txStatus.msg}
                  </div>
                )}

                {/* Execute */}
                <button onClick={executeTrade} disabled={executing||!user||amtN<=0||amtN>balance}
                  className={`w-full py-3 rounded-xl text-sm font-black transition-all disabled:opacity-40 ${side==='buy'?'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30':'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'}`}>
                  {executing?<span className="flex items-center justify-center gap-1.5"><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"/>{isMock?'Simulating…':'Sending…'}</span>
                    :!user?'Sign in':
                    `${side==='buy'?'▲ BUY':'▼ SELL'} ${token.symbol}`}
                </button>

                {/* Current holding */}
                {currentHolding&&(
                  <div className="rounded-xl bg-[#05060B] border border-white/[0.05] px-2.5 py-2 space-y-0.5">
                    <p className="text-[9px] text-[#4B5563] font-semibold">YOUR POSITION</p>
                    <div className="flex justify-between text-[9px]"><span className="text-[#4B5563]">Amount</span><span className="font-mono text-[#A7B0B7]">{currentHolding.amount.toFixed(4)}</span></div>
                    <div className="flex justify-between text-[9px]"><span className="text-[#4B5563]">Avg cost</span><span className="font-mono text-[#A7B0B7]">{fmtP(currentHolding.avg_cost)}</span></div>
                    <div className="flex justify-between text-[9px] font-bold">
                      <span className="text-[#4B5563]">P&L</span>
                      <span className={(currentHolding.pnl??0)>=0?'text-green-400':'text-red-400'}>{(currentHolding.pnl??0)>=0?'+':'-'}{fmtUsd(Math.abs(currentHolding.pnl??0))} ({(currentHolding.pnlPct??0).toFixed(1)}%)</span>
                    </div>
                  </div>
                )}
              </div>
            ):(
              <div className="flex-1 flex items-center justify-center p-4 text-center">
                <p className="text-[10px] text-[#374151]">Search a token to start trading</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════ PORTFOLIO ════════════════════════════════ */}
      {tab==='portfolio'&&(
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Holdings · {isMock?'Mock':'Live'}</p>
            <button onClick={loadPortfolio} className="text-[10px] text-[#4B5563] hover:text-[#2BFFF1] transition-all">↻ Refresh</button>
          </div>
          {loadingPort?<div className="flex items-center justify-center py-10 gap-2 text-[#4B5563]"><div className="w-5 h-5 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/><span className="text-xs">Loading…</span></div>
          :holdings.length===0?<div className="text-center py-12"><p className="text-3xl mb-3">📭</p><p className="text-sm text-[#4B5563]">No holdings yet</p></div>:(
            <>
              {(()=>{const tv=holdings.reduce((s,h)=>s+(h.currentPrice??0)*h.amount,0);const tc=holdings.reduce((s,h)=>s+h.avg_cost*h.amount,0);const tp2=tv-tc;return(
                <div className="rounded-2xl bg-[#0B0E14] border border-white/[0.07] p-3">
                  <p className="text-[9px] text-[#4B5563]">Portfolio Value</p>
                  <p className="text-xl font-black text-[#F4F6FA]">{fmtUsd(tv)}</p>
                  <p className={`text-xs font-bold ${tp2>=0?'text-green-400':'text-red-400'}`}>{tp2>=0?'▲':'▼'} {fmtUsd(Math.abs(tp2))} ({tc>0?(Math.abs(tp2)/tc*100).toFixed(1):0}%)</p>
                </div>
              );})()}
              {holdings.map(h=>(
                <div key={h.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5 flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#0B0E14] border border-white/[0.05] flex items-center justify-center flex-shrink-0"><span className="text-[9px] font-black text-[#2BFFF1]">{h.token_symbol.slice(0,3)}</span></div>
                  <div className="flex-1 min-w-0"><p className="text-xs font-bold text-[#F4F6FA]">{h.token_symbol}</p><p className="text-[9px] text-[#374151]">{h.amount.toFixed(4)} @ avg {fmtP(h.avg_cost)}</p></div>
                  <div className="text-right"><p className="text-xs font-mono text-[#F4F6FA]">{fmtUsd((h.currentPrice??0)*h.amount)}</p><p className={`text-[9px] font-bold ${(h.pnl??0)>=0?'text-green-400':'text-red-400'}`}>{(h.pnl??0)>=0?'+':''}{fmtUsd(h.pnl??0)} ({(h.pnlPct??0).toFixed(1)}%)</p></div>
                  <button onClick={()=>{const t:Token={mint:h.token_mint,symbol:h.token_symbol,name:h.token_name,priceUsd:h.currentPrice??0,change24h:0,volume24h:0,mcap:0,logoUri:'',pairAddress:h.token_mint};setToken(t);setLivePrice(h.currentPrice??0);setSide('sell');setTab('chart');}} className="px-2 py-1 rounded-lg text-[9px] font-bold text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all flex-shrink-0">Sell</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ════════════════════ HISTORY ══════════════════════════════════ */}
      {tab==='history'&&(
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-2">Trade History · {isMock?'Mock':'Live'}</p>
          {trades.length===0?<div className="text-center py-12"><p className="text-3xl mb-3">🕐</p><p className="text-sm text-[#4B5563]">No trades yet</p></div>
          :trades.map(t=>(
            <div key={t.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-2.5 py-2 flex items-center gap-2.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black ${t.side==='buy'?'bg-green-500/15 text-green-400':'bg-red-500/15 text-red-400'}`}>{t.side==='buy'?'B':'S'}</div>
              <div className="flex-1 min-w-0"><p className="text-xs font-bold text-[#F4F6FA]">{t.side.toUpperCase()} {t.token_symbol}</p><p className="text-[9px] text-[#374151]">{new Date(t.created_at).toLocaleString()}</p></div>
              <div className="text-right"><p className="text-xs font-mono text-[#A7B0B7]">${t.amount_usd.toFixed(2)}</p><p className="text-[9px] text-[#374151]">{t.amount_token.toFixed(4)} @ {fmtP(t.price_usd)}</p></div>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${t.status==='completed'?'text-green-400 bg-green-500/10':'text-yellow-400 bg-yellow-500/10'}`}>{t.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
