import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useTradingStore } from '../store';
import { PriceChart } from '../components/PriceChart';
import { Candle } from '../types';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';
const MOCK_FEE = 0.0025, LIVE_FEE = 0.0035;
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Platform wallet trade — uses internal balance, no external wallet needed
async function platformWalletTrade(params: {
  authToken: string; isMock: boolean; side: 'buy'|'sell';
  amountUsd: number; tokenMint: string; tokenSymbol: string; tokenName: string; priceUsd: number;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/platform-wallet-trade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.authToken}` },
    body: JSON.stringify({
      action: 'trade', isMock: params.isMock, side: params.side,
      amountUsd: params.amountUsd, tokenMint: params.tokenMint,
      tokenSymbol: params.tokenSymbol, tokenName: params.tokenName, priceUsd: params.priceUsd,
    }),
  });
  const d = await r.json();
  if (!r.ok) return { success: false, error: d.error ?? 'Trade failed' };
  return { success: true, message: d.message };
}
const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d'] as const;

interface Token { mint:string; symbol:string; name:string; priceUsd:number; change24h:number; volume24h:number; mcap:number; logoUri:string; pairAddress:string; }
interface Holding { id:string; token_mint:string; token_symbol:string; token_name:string; amount:number; avg_cost:number; is_mock:boolean; currentPrice?:number; pnl?:number; pnlPct?:number; }
interface Trade { id:string; token_symbol:string; side:'buy'|'sell'; amount_token:number; amount_usd:number; price_usd:number; fee_usd:number; is_mock:boolean; status:string; created_at:string; }

function fmtP(p:number):string { if(!p||p<=0) return '$0'; if(p>=1000) return `$${p.toFixed(2)}`; if(p>=1) return `$${p.toFixed(4)}`; if(p>=0.001) return `$${p.toFixed(6)}`; return `$${p.toFixed(9)}`; }
function fmtUsd(n:number):string { if(!n) return '$0'; if(Math.abs(n)>=1e6) return `$${(n/1e6).toFixed(2)}M`; if(Math.abs(n)>=1e3) return `$${(n/1e3).toFixed(1)}K`; return `$${Math.abs(n).toFixed(2)}`; }

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
    {!err&&src?<img src={src} alt={symbol} className="w-full h-full object-cover" onError={()=>setErr(true)}/>:<span className="text-[#2BFFF1] font-black" style={{fontSize:Math.max(8,size*0.3)}}>{symbol.slice(0,3)}</span>}
  </div>;
}

// ── Inline pressure mini display ─────────────────────────────────────────
function PressureBar({ token, candles }:{ token:Token|null; candles:Candle[] }) {
  const [buys,setBuys]=useState(0); const [sells,setSells]=useState(0);
  useEffect(()=>{
    if(!token) return;
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.mint}`)
      .then(r=>r.json()).then(d=>{ const p=d.pairs?.[0]; if(p){ setBuys(p.txns?.h1?.buys??0); setSells(p.txns?.h1?.sells??0); } }).catch(()=>{});
  },[token?.mint]);
  const candleBuyPct = useMemo(()=>{ const r=candles.slice(-20); if(!r.length) return 50; let bv=0,sv=0; for(const c of r) c.close>=c.open?bv+=c.volume:sv+=c.volume; return bv+sv>0?(bv/(bv+sv))*100:50; },[candles]);
  const total=buys+sells; const buyPct=Math.round(total>0?(buys/total)*100:candleBuyPct);
  return (
    <div className="flex flex-col gap-1 px-3 py-2 border-t border-white/[0.05]">
      <div className="flex justify-between text-[9px] font-semibold">
        <span className="text-green-400">Buy {buyPct}%</span>
        <span className="text-[#4B5563]">Pressure (1h)</span>
        <span className="text-red-400">Sell {100-buyPct}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden flex">
        <div className="h-full bg-green-500/70 transition-all duration-700" style={{width:`${buyPct}%`}}/>
        <div className="h-full bg-red-500/60 flex-1"/>
      </div>
      {total>0&&<p className="text-[9px] text-[#374151] text-center">{buys} buys · {sells} sells this hour · DexScreener</p>}
    </div>
  );
}

// ── Order form (reusable for both desktop side panel and mobile bottom sheet)
function OrderForm({ token, livePrice, isMock, candles, onSuccess }:{ token:Token|null; livePrice:number; isMock:boolean; candles:Candle[]; onSuccess:()=>void }) {
  const { user, account, saveAccount } = useAuth();
  const { capital } = useTradingStore();
  const [side,setSide]       = useState<'buy'|'sell'>('buy');
  const [amountUsd,setAmt]   = useState('');
  const [amountPct,setPct]   = useState(0);
  const [tp,setTp]           = useState('');
  const [sl,setSl]           = useState('');
  const [executing,setExec]  = useState(false);
  const [txStatus,setStatus] = useState<{type:'success'|'error';msg:string}|null>(null);

  // Use mock_balance from account (same as leverage mock balance)
  const balance = account ? (isMock ? account.mock_balance : account.real_balance) : capital;
  const amtN = parseFloat(amountUsd)||0;
  const feeP = isMock ? MOCK_FEE : LIVE_FEE;
  const feeUsd = amtN * feeP;
  const netUsd = side==='buy' ? amtN+feeUsd : amtN-feeUsd;
  const tokOut = livePrice>0 ? amtN/livePrice : 0;

  useEffect(()=>{ if(balance>0&&amountPct>0) setAmt((balance*amountPct/100).toFixed(2)); },[amountPct,balance]);

  const getAuth = async () => { const {data:{session}}=await supabase!.auth.getSession(); return session?.access_token??''; };

  const executeTrade = async () => {
    if(!user||!token||amtN<=0) return;
    if(amtN>balance) { setStatus({type:'error',msg:'Insufficient balance'}); return; }
    setExec(true); setStatus(null);
    try {
      const authToken = await getAuth();

      if(isMock) {
        // ── Mock trade ─────────────────────────────────────────────
        const r = await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`,{
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken}`},
          body:JSON.stringify({ action:'mock_trade', isMock:true, inputMint:side==='buy'?USDC_MINT:token.mint, outputMint:side==='buy'?token.mint:USDC_MINT, amountUsd:amtN, tokenSymbol:token.symbol, tokenName:token.name, priceUsd:livePrice, side }),
        });
        const d = await r.json();
        if(!r.ok) throw new Error(d.error??'Trade failed');
        // Sync mock balance with the account (same pool as leverage mock)
        if(account) {
          if(side==='buy') saveAccount({ mock_balance: Math.max(0, account.mock_balance - netUsd) } as any);
          else saveAccount({ mock_balance: account.mock_balance + (amtN - feeUsd) } as any);
        }
        setStatus({type:'success',msg:`Mock ${side==='buy'?'bought':'sold'} ${tokOut.toFixed(4)} ${token.symbol}`});

      } else {
        // ── Live trade: try platform wallet first, then external wallet ──
        // Platform wallet = user's internal balance, server-side execution
        setStatus({type:'success',msg:'Executing via platform wallet…'});
        const platResult = await platformWalletTrade({
          authToken, isMock: false, side, amountUsd: amtN,
          tokenMint: token.mint, tokenSymbol: token.symbol, tokenName: token.name, priceUsd: livePrice,
        });
        if (platResult.success) {
          setStatus({type:'success',msg:platResult.message ?? 'Trade executed via platform wallet'});
          setAmt(''); setPct(0); onSuccess();
          setExec(false); return;
        }
        // Platform wallet not available (no funds/wallet) — fall back to Phantom
        const phantom = (window as any).solana ?? (window as any).solflare;
        if(!phantom) throw new Error(platResult.error ?? 'No Solana wallet found. Fund your platform wallet or install Phantom.');
        if(!phantom.isConnected) {
          try { await phantom.connect(); } catch(ce:any) { throw new Error('Wallet connection cancelled'); }
        }
        const userWallet = phantom.publicKey?.toBase58?.();
        if(!userWallet) throw new Error('No wallet connected');

        // Step 1: Get Jupiter quote
        setStatus({type:'success',msg:'Getting Jupiter quote…'});
        const qRes = await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`,{
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken}`},
          body:JSON.stringify({ action:'quote', inputMint:side==='buy'?USDC_MINT:token.mint, outputMint:side==='buy'?token.mint:USDC_MINT, amountUsd:amtN, tokenSymbol:token.symbol, tokenName:token.name, priceUsd:livePrice, userWallet, side }),
        });
        const { quote, error:qErr } = await qRes.json();
        if(qErr||!quote) throw new Error(qErr ?? 'Quote failed');

        // Step 2: Build swap transaction
        setStatus({type:'success',msg:'Building transaction…'});
        const swapRes = await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`,{
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken}`},
          body:JSON.stringify({ action:'swap', quote, inputMint:side==='buy'?USDC_MINT:token.mint, outputMint:side==='buy'?token.mint:USDC_MINT, amountUsd:amtN, tokenSymbol:token.symbol, tokenName:token.name, priceUsd:livePrice, userWallet, side }),
        });
        const { swapTransaction, tradeId, error:swErr } = await swapRes.json();
        if(swErr||!swapTransaction) throw new Error(swErr ?? 'Swap build failed');

        // Step 3: Sign with wallet
        setStatus({type:'success',msg:'Sign in your wallet…'});
        let txBuf: Buffer;
        try { txBuf = Buffer.from(swapTransaction, 'base64'); } catch { throw new Error('Invalid transaction data'); }
        
        // Try VersionedTransaction first, fall back to legacy
        let tx: any;
        try {
          const { VersionedTransaction } = await import('@solana/web3.js') as any;
          tx = VersionedTransaction.deserialize(txBuf);
        } catch {
          const { Transaction } = await import('@solana/web3.js') as any;
          tx = Transaction.from(txBuf);
        }
        const signed = await phantom.signTransaction(tx);

        // Step 4: Send to network
        setStatus({type:'success',msg:'Broadcasting…'});
        const { Connection } = await import('@solana/web3.js') as any;
        const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const txHash = await conn.sendRawTransaction(signed.serialize(), { skipPreflight:false, preflightCommitment:'confirmed' });
        
        setStatus({type:'success',msg:'Confirming on-chain…'});
        await conn.confirmTransaction(txHash, 'confirmed');

        // Step 5: Confirm with backend
        await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`,{
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken}`},
          body:JSON.stringify({ action:'confirm', tradeId, txHash, outputMint:token.mint, tokenSymbol:token.symbol, tokenName:token.name, amountUsd:amtN, priceUsd:livePrice, tokenAmount:tokOut }),
        });

        setStatus({type:'success',msg:`Live buy confirmed! ${txHash.slice(0,8)}…`});
      }

      setAmt(''); setPct(0); onSuccess();
    } catch(e:any) { setStatus({type:'error',msg:e.message??'Trade failed'}); }
    setExec(false);
  };

  if(!token) return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <svg className="opacity-20 mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <p className="text-sm text-[#4B5563]">Search a token to trade</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5 p-3">
      {/* Buy / Sell */}
      <div className="flex rounded-xl overflow-hidden border border-white/[0.07]">
        {(['buy','sell'] as const).map(s=>(
          <button key={s} onClick={()=>setSide(s)} className={`flex-1 py-2.5 text-xs font-black transition-all ${side===s?s==='buy'?'bg-green-500/20 text-green-400':'bg-red-500/20 text-red-400':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {s==='buy'?'Buy':'Sell'} {token.symbol}
          </button>
        ))}
      </div>

      {/* Balance */}
      <div className="flex justify-between text-[10px] px-0.5">
        <div className="flex items-center gap-1">
          <span className="text-[#4B5563]">Available ({isMock?'Mock':'Live'})</span>
          {!isMock&&<span className="text-[8px] text-[#2BFFF1] bg-[#2BFFF1]/10 px-1 py-0.5 rounded">Platform wallet</span>}
        </div>
        <span className="font-mono font-bold text-[#F4F6FA]">${balance.toFixed(2)}</span>
      </div>

      {/* Amount */}
      <div className="flex items-center gap-1.5 bg-[#05060B] border border-white/[0.08] rounded-xl px-2.5 py-2 focus-within:border-[#2BFFF1]/40 transition-all">
        <span className="text-[#374151] text-xs">$</span>
        <input type="number" value={amountUsd} onChange={e=>{setAmt(e.target.value);setPct(0);}} placeholder="0.00" className="flex-1 bg-transparent text-xs font-mono text-[#F4F6FA] outline-none" style={{minWidth:0}}/>
      </div>

      {/* % slider */}
      <div className="space-y-1.5">
        <input type="range" min={0} max={100} step={5} value={amountPct} onChange={e=>setPct(parseInt(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{accentColor:side==='buy'?'#4ADE80':'#F87171',background:`linear-gradient(to right,${side==='buy'?'#4ADE80':'#F87171'} ${amountPct}%,#1a2030 ${amountPct}%)`}}/>
        <div className="flex gap-1">
          {[25,50,75,100].map(p=>(
            <button key={p} onClick={()=>setPct(p)} className={`flex-1 py-1 rounded text-[9px] font-bold transition-all ${amountPct===p?(side==='buy'?'bg-green-500/20 text-green-400 border border-green-500/25':'bg-red-500/20 text-red-400 border border-red-500/25'):'bg-white/[0.04] text-[#4B5563] border border-white/[0.06] hover:text-[#A7B0B7]'}`}>{p}%</button>
          ))}
        </div>
      </div>

      {/* TP / SL */}
      <div className="grid grid-cols-2 gap-1.5">
        {[['TP',tp,setTp,'#4ADE80'],['SL',sl,setSl,'#F87171']].map(([label,val,setter,color]:any)=>(
          <div key={label}>
            <label className="text-[9px] mb-0.5 block font-semibold" style={{color}}>{label === 'TP' ? 'Take Profit' : 'Stop Loss'}</label>
            <input type="number" value={val} onChange={e=>setter(e.target.value)} placeholder="Optional"
              className="w-full bg-[#05060B] rounded-lg px-2 py-1.5 text-[10px] text-[#F4F6FA] outline-none font-mono"
              style={{border:`1px solid ${val?color+'40':'rgba(255,255,255,0.06)'}`,transition:'border-color 0.2s'}}/>
          </div>
        ))}
      </div>

      {/* Summary */}
      {amtN>0&&livePrice>0&&(
        <div className="rounded-xl bg-[#05060B] border border-white/[0.05] px-2.5 py-2 space-y-1">
          <div className="flex justify-between text-[9px]"><span className="text-[#4B5563]">Receive</span><span className="font-mono text-[#A7B0B7]">{tokOut.toFixed(4)} {token.symbol}</span></div>
          <div className="flex justify-between text-[9px]"><span className="text-[#4B5563]">Fee {isMock?'0.25%':'0.35%'}</span><span className="font-mono text-[#F59E0B]">${feeUsd.toFixed(4)}</span></div>
          <div className="flex justify-between text-[9px] font-bold pt-0.5 border-t border-white/[0.04]"><span className="text-[#4B5563]">Total</span><span className="text-[#F4F6FA]">${netUsd.toFixed(2)}</span></div>
        </div>
      )}

      {txStatus&&(
        <div className={`rounded-xl px-2.5 py-2 text-[10px] font-semibold ${txStatus.type==='success'?'bg-green-500/08 text-green-400 border border-green-500/15':'bg-red-500/08 text-red-400 border border-red-500/15'}`}>
          {txStatus.msg}
        </div>
      )}

      <button onClick={executeTrade} disabled={executing||!user||amtN<=0||amtN>balance}
        className={`w-full py-3 rounded-xl text-sm font-black transition-all disabled:opacity-40 ${side==='buy'?'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30':'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'}`}>
        {executing?<span className="flex items-center justify-center gap-1.5"><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"/>{isMock?'Simulating…':'Sending…'}</span>
          :!user?'Sign in to trade'
          :`${side==='buy'?'Buy':'Sell'} ${token.symbol} ${isMock?'· Mock':'· Live'}`}
      </button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
interface Props { isMock:boolean; onToggleMock:()=>void; }

export function SpotTradingPage({ isMock, onToggleMock }:Props) {
  const { user } = useAuth();

  const [searchQ,      setSearchQ]      = useState('');
  const [searchRes,    setSearchRes]    = useState<Token[]>([]);
  const [searching,    setSearching]    = useState(false);
  const [token,        setToken]        = useState<Token|null>(null);
  const [livePrice,    setLivePrice]    = useState(0);
  const [candles,      setCandles]      = useState<Candle[]>([]);
  const [interval,     setInterval_]    = useState('15m');
  const [loadingChart, setLoadingChart] = useState(false);
  const [tab,          setTab]          = useState<'chart'|'portfolio'|'history'>('chart');
  const [holdings,     setHoldings]     = useState<Holding[]>([]);
  const [trades,       setTrades]       = useState<Trade[]>([]);
  const [loadingPort,  setLoadingPort]  = useState(false);
  const [showOrderForm,setShowOrder]    = useState(false); // mobile bottom sheet

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const priceTimer  = useRef<ReturnType<typeof setInterval>>();

  // Search
  useEffect(()=>{
    if(!searchQ.trim()){setSearchRes([]);return;}
    clearTimeout(searchTimer.current); setSearching(true);
    searchTimer.current=setTimeout(async()=>{ const r=await searchTokens(searchQ); setSearchRes(r); setSearching(false); },350);
  },[searchQ]);

  // Price
  useEffect(()=>{
    if(!token){return;}
    setLivePrice(token.priceUsd);
    clearInterval(priceTimer.current);
    priceTimer.current=setInterval(async()=>{ try{const r=await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.mint}`);const d=await r.json();const p=parseFloat(d.pairs?.[0]?.priceUsd??'0');if(p>0)setLivePrice(p);}catch{} },10_000);
    return()=>clearInterval(priceTimer.current);
  },[token?.mint]);

  // Candles
  useEffect(()=>{
    if(!token?.pairAddress){setCandles([]);return;}
    setLoadingChart(true); setCandles([]);
    fetchSpotCandles(token.pairAddress, interval).then(c=>{ setCandles(c); setLoadingChart(false); });
  },[token?.pairAddress, interval]);

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

  useEffect(()=>{ if(tab==='portfolio'||tab==='history') loadPortfolio(); },[tab,loadPortfolio]);

  const selectToken = (t:Token) => { setToken(t); setSearchQ(''); setSearchRes([]); setTab('chart'); };

  const TabBtn = ({id,label}:{id:typeof tab;label:string}) => (
    <button onClick={()=>setTab(id)} className={`flex-1 py-2 text-[11px] font-semibold transition-all ${tab===id?'text-[#2BFFF1] border-b-2 border-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>{label}</button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#05060B]">

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-shrink-0">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <div className="flex items-center gap-2 bg-[#0B0E14] border border-white/[0.08] rounded-xl px-2.5 py-2 focus-within:border-[#2BFFF1]/40 transition-all">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2" className="flex-shrink-0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder={token?token.symbol+'/USD — tap to change…':'Search any Solana token…'} className="flex-1 bg-transparent text-xs text-[#F4F6FA] outline-none placeholder-[#2D3748]" style={{minWidth:0}}/>
            {token&&<button onClick={()=>setToken(null)} className="text-[#4B5563] hover:text-[#A7B0B7] text-xs flex-shrink-0">✕</button>}
            {searching&&<div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin flex-shrink-0"/>}
          </div>
          {searchRes.length>0&&(
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#0B0E14] border border-white/[0.1] rounded-2xl shadow-2xl z-[200] overflow-hidden max-h-52 overflow-y-auto">
              {searchRes.map(t=>(
                <button key={t.mint} onClick={()=>selectToken(t)} className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.04] transition-all text-left">
                  <TokenImg src={t.logoUri} symbol={t.symbol} size={28}/>
                  <div className="flex-1 min-w-0"><p className="text-xs font-bold text-[#F4F6FA]">{t.symbol}</p><p className="text-[9px] text-[#374151] truncate">{t.name}</p></div>
                  <div className="text-right flex-shrink-0"><p className="text-xs font-mono text-[#A7B0B7]">{fmtP(t.priceUsd)}</p><p className={`text-[9px] ${t.change24h>=0?'text-green-400':'text-red-400'}`}>{t.change24h>=0?'+':''}{t.change24h.toFixed(2)}%</p></div>
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={onToggleMock} className={`flex items-center gap-1 px-2 py-1.5 rounded-xl border text-[11px] font-black transition-all flex-shrink-0 ${isMock?'border-white/[0.1] bg-white/[0.03] text-[#6B7280]':'border-[#2BFFF1]/50 bg-[#2BFFF1]/15 text-[#2BFFF1]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isMock?'bg-[#374151]':'bg-[#2BFFF1] animate-pulse'}`}/>
          {isMock?'Mock':'Live'}
        </button>
      </div>

      {/* ── Token info strip ─────────────────────────────────────── */}
      {token&&(
        <div className="flex flex-col border-b border-white/[0.05] flex-shrink-0 bg-[#080A10]">
          {/* Row 1: symbol + price + change */}
          <div className="flex items-center gap-2 px-3 pt-1.5 pb-1">
            <TokenImg src={token.logoUri} symbol={token.symbol} size={20}/>
            <span className="text-sm font-black text-[#F4F6FA]">{token.symbol}</span>
            <span className="text-sm font-black font-mono text-[#F4F6FA] ml-auto">{fmtP(livePrice)}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${token.change24h>=0?'text-green-400 bg-green-500/10':'text-red-400 bg-red-500/10'}`}>
              {token.change24h>=0?'+':''}{token.change24h.toFixed(2)}%
            </span>
          </div>
          {/* Row 2: interval buttons */}
          <div className="flex gap-0.5 px-3 pb-1.5 overflow-x-auto">
            {INTERVALS.map(i=>(
              <button key={i} onClick={()=>setInterval_(i)} className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all flex-shrink-0 ${interval===i?'bg-[#2BFFF1]/15 text-[#2BFFF1]':'text-[#374151] hover:text-[#6B7280]'}`}>{i}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="flex border-b border-white/[0.05] flex-shrink-0">
        <TabBtn id="chart" label="Trade"/>
        <TabBtn id="portfolio" label="Portfolio"/>
        <TabBtn id="history" label="History"/>
      </div>

      {/* ══════════ CHART / TRADE TAB ══════════════════════════════ */}
      {tab==='chart'&&(
        // On md+: side-by-side chart + order form. On mobile: chart full width + floating Buy button
        <div className="flex-1 flex overflow-y-auto md:overflow-hidden min-h-0">

          {/* Chart area — fixed height on mobile, flex-1 on desktop */}
          <div className="flex flex-col min-w-0" style={{flex:1,minHeight:0,overflow:'hidden'}}>
            {token?(
              <>
                <div className="flex-shrink-0 md:flex-1 md:min-h-0" style={{height:'300px',overflow:'hidden'}}
                  onTouchStart={e=>e.stopPropagation()}>
                  {loadingChart&&candles.length===0
                    ?<div className="h-full flex items-center justify-center gap-2 text-[#4B5563] text-xs"><div className="w-4 h-4 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>Loading…</div>
                    :<PriceChart candles={candles} livePrice={livePrice} positions={[]}/>}
                </div>
                <div className="flex-shrink-0 max-h-20 overflow-hidden">
                  <PressureBar token={token} candles={candles}/>
                </div>
              </>
            ):(
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <svg className="opacity-15 mb-4" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                <p className="text-sm font-semibold text-[#4B5563]">Search any Solana token</p>
                <p className="text-[10px] text-[#374151] mt-1">Pump.fun · Raydium · Jupiter · $30k+ MCap</p>
              </div>
            )}
          </div>

          {/* Desktop order panel */}
          <div className="hidden md:flex w-[240px] lg:w-[260px] flex-shrink-0 border-l border-white/[0.06] flex-col overflow-y-auto bg-[#080A10]">
            <OrderForm token={token} livePrice={livePrice} isMock={isMock} candles={candles} onSuccess={()=>{}}/>
          </div>

          {/* Mobile: floating Buy/Sell button + bottom sheet */}
          {token&&(
            <>
              <button
                onClick={()=>setShowOrder(true)}
                className="md:hidden fixed bottom-20 right-4 z-40 flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-sm shadow-2xl bg-[#2BFFF1] text-[#05060B]"
                style={{boxShadow:'0 0 24px rgba(43,255,241,0.4)'}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Trade
              </button>

              {/* Mobile bottom sheet */}
              {showOrderForm&&(
                <div className="md:hidden fixed inset-x-0 z-[200] flex flex-col justify-end" style={{top:0, bottom:'64px'}} onClick={()=>setShowOrder(false)}>
                  <div
                    className="bg-[#0B0E14] border-t border-white/[0.08] rounded-t-2xl shadow-2xl"
                    style={{
                      maxHeight:'100%',
                      overflowY:'auto',
                      overscrollBehavior:'contain',
                      WebkitOverflowScrolling:'touch',
                    }}
                    onClick={e=>e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <TokenImg src={token.logoUri} symbol={token.symbol} size={22}/>
                        <span className="text-sm font-black text-[#F4F6FA]">{token.symbol}/USD</span>
                        <span className="text-xs font-bold font-mono text-[#2BFFF1]">{fmtP(livePrice)}</span>
                      </div>
                      <button onClick={()=>setShowOrder(false)} className="text-[#4B5563] hover:text-[#A7B0B7] p-1">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                    <OrderForm token={token} livePrice={livePrice} isMock={isMock} candles={candles} onSuccess={()=>setShowOrder(false)}/>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════ PORTFOLIO ══════════════════════════════════════ */}
      {tab==='portfolio'&&(
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Holdings · {isMock?'Mock':'Live'}</p>
            <button onClick={loadPortfolio} className="text-[10px] text-[#4B5563] hover:text-[#2BFFF1] transition-all flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            </button>
          </div>
          {loadingPort?<div className="flex items-center justify-center py-10 gap-2 text-[#4B5563]"><div className="w-5 h-5 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/><span className="text-xs">Loading…</span></div>
          :holdings.length===0?<div className="text-center py-12"><svg className="mx-auto opacity-20 mb-3" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.5"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg><p className="text-sm text-[#4B5563]">No holdings yet</p></div>:(
            <>
              {(()=>{const tv=holdings.reduce((s,h)=>s+(h.currentPrice??0)*h.amount,0);const tc=holdings.reduce((s,h)=>s+h.avg_cost*h.amount,0);const p=tv-tc;return(
                <div className="rounded-2xl bg-[#0B0E14] border border-white/[0.07] p-3 mb-1">
                  <p className="text-[9px] text-[#4B5563]">Portfolio Value</p>
                  <p className="text-xl font-black text-[#F4F6FA]">{fmtUsd(tv)}</p>
                  <p className={`text-xs font-bold ${p>=0?'text-green-400':'text-red-400'}`}>{p>=0?'+':''}{fmtUsd(p)} ({tc>0?(Math.abs(p)/tc*100).toFixed(1):0}%)</p>
                </div>
              );})()}
              {holdings.map(h=>(
                <div key={h.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5 flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-[#0B0E14] border border-white/[0.05] flex items-center justify-center flex-shrink-0"><span className="text-[8px] font-black text-[#2BFFF1]">{h.token_symbol.slice(0,3)}</span></div>
                  <div className="flex-1 min-w-0"><p className="text-xs font-bold text-[#F4F6FA]">{h.token_symbol}</p><p className="text-[9px] text-[#374151]">{h.amount.toFixed(4)} @ avg {fmtP(h.avg_cost)}</p></div>
                  <div className="text-right"><p className="text-xs font-mono text-[#F4F6FA]">{fmtUsd((h.currentPrice??0)*h.amount)}</p><p className={`text-[9px] font-bold ${(h.pnl??0)>=0?'text-green-400':'text-red-400'}`}>{(h.pnl??0)>=0?'+':''}{fmtUsd(h.pnl??0)} ({(h.pnlPct??0).toFixed(1)}%)</p></div>
                  <button onClick={()=>{const t:Token={mint:h.token_mint,symbol:h.token_symbol,name:h.token_name,priceUsd:h.currentPrice??0,change24h:0,volume24h:0,mcap:0,logoUri:'',pairAddress:h.token_mint};setToken(t);setLivePrice(h.currentPrice??0);setTab('chart');setShowOrder(true);}} className="px-2 py-1 rounded-lg text-[9px] font-bold text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all flex-shrink-0">Sell</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ══════════ HISTORY ════════════════════════════════════════ */}
      {tab==='history'&&(
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-2">History · {isMock?'Mock':'Live'}</p>
          {trades.length===0?<div className="text-center py-12"><svg className="mx-auto opacity-20 mb-3" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p className="text-sm text-[#4B5563]">No trades yet</p></div>
          :trades.map(t=>(
            <div key={t.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-2.5 py-2 flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-black ${t.side==='buy'?'bg-green-500/15 text-green-400':'bg-red-500/15 text-red-400'}`}>{t.side==='buy'?'B':'S'}</div>
              <div className="flex-1 min-w-0"><p className="text-xs font-bold text-[#F4F6FA]">{t.side.toUpperCase()} {t.token_symbol}</p><p className="text-[9px] text-[#374151] truncate">{new Date(t.created_at).toLocaleString()}</p></div>
              <div className="text-right flex-shrink-0"><p className="text-xs font-mono text-[#A7B0B7]">${t.amount_usd.toFixed(2)}</p><p className="text-[9px] text-[#374151]">{t.amount_token.toFixed(4)}</p></div>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${t.status==='completed'?'text-green-400 bg-green-500/10':'text-yellow-400 bg-yellow-500/10'}`}>{t.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
