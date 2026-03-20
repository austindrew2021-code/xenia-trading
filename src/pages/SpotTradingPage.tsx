import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { PriceChart } from '../components/PriceChart';
import { BuySellPressure } from '../components/BuySellPressure';
import { Candle } from '../types';

// ── Constants ──────────────────────────────────────────────────────────────
const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';
const MOCK_FEE = 0.0025;
const LIVE_FEE = 0.0035;
const SOL_MINT  = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d'] as const;

// ── Types ──────────────────────────────────────────────────────────────────
interface Token { mint:string; symbol:string; name:string; priceUsd:number; change24h:number; volume24h:number; mcap:number; logoUri:string; pairAddress:string; }
interface Holding { id:string; token_mint:string; token_symbol:string; token_name:string; amount:number; avg_cost:number; is_mock:boolean; currentPrice?:number; pnl?:number; pnlPct?:number; }
interface Trade { id:string; token_symbol:string; side:'buy'|'sell'; amount_token:number; amount_usd:number; price_usd:number; fee_usd:number; is_mock:boolean; status:string; created_at:string; }
interface WalletInfo { address:string; funding_balance:number; spot_balance:number; spot_mock_balance:number; leverage_balance:number; mock_balance:number; }
type SubAccount = 'funding'|'spot'|'mock_spot'|'leverage'|'mock_leverage';

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtP(p:number):string { if(!p||p<=0) return '$0'; if(p>=1000) return `$${p.toFixed(2)}`; if(p>=1) return `$${p.toFixed(4)}`; if(p>=0.001) return `$${p.toFixed(6)}`; return `$${p.toFixed(9)}`; }
function fmtUsd(n:number):string { if(!n) return '$0'; if(n>=1e6) return `$${(n/1e6).toFixed(2)}M`; if(n>=1e3) return `$${(n/1e3).toFixed(1)}K`; return `$${n.toFixed(2)}`; }

// ── Token search ──────────────────────────────────────────────────────────
async function searchTokens(q:string):Promise<Token[]> {
  if(!q.trim()) return [];
  try {
    const isAddr=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim());
    const url=isAddr?`https://api.dexscreener.com/latest/dex/tokens/${q.trim()}`:`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
    const r=await fetch(url); if(!r.ok) return [];
    const d=await r.json(); const seen=new Set<string>(); const results:Token[]=[];
    for(const p of (d.pairs??[]).slice(0,40)) {
      if(p.chainId!=='solana'||!p.baseToken) continue;
      const mint=p.baseToken.address; if(seen.has(mint)) continue;
      const price=parseFloat(p.priceUsd??'0'); const mcap=parseFloat(p.marketCap??p.fdv??'0');
      if(mcap>0&&mcap<30_000) continue;
      const logo=p.info?.imageUrl??''; if(!logo&&!isAddr) continue;
      seen.add(mint);
      results.push({ mint, symbol:p.baseToken.symbol, name:p.baseToken.name, priceUsd:price, change24h:parseFloat(p.priceChange?.h24??'0'), volume24h:parseFloat(p.volume?.h24??'0'), mcap, logoUri:logo, pairAddress:p.pairAddress??mint });
      if(results.length>=20) break;
    }
    return results;
  } catch { return []; }
}

// ── Fetch GeckoTerminal candles for a Solana pair ──────────────────────────
async function fetchSpotCandles(pairAddress:string, interval:string):Promise<Candle[]> {
  const GECKO:{[k:string]:{tf:string;agg:number}} = { '1m':{tf:'minute',agg:1},'5m':{tf:'minute',agg:5},'15m':{tf:'minute',agg:15},'30m':{tf:'minute',agg:30},'1h':{tf:'hour',agg:1},'4h':{tf:'hour',agg:4},'1d':{tf:'day',agg:1} };
  const {tf,agg}=GECKO[interval]??{tf:'minute',agg:15};
  try {
    const r=await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddress}/ohlcv/${tf}?aggregate=${agg}&limit=300&currency=usd&token=base`,{headers:{Accept:'application/json;version=20230302'}});
    if(!r.ok) return [];
    const d=await r.json();
    const list:any[]=d?.data?.attributes?.ohlcv_list??[];
    return list.map(c=>({ time:c[0]*1000, open:parseFloat(c[1]), high:parseFloat(c[2]), low:parseFloat(c[3]), close:parseFloat(c[4]), volume:parseFloat(c[5]) })).reverse().filter(c=>c.open>0);
  } catch { return []; }
}

// ── Token image ────────────────────────────────────────────────────────────
function TokenImg({ src, symbol, size=32 }:{src:string;symbol:string;size?:number}) {
  const [err,setErr]=useState(false);
  return <div className="rounded-full flex-shrink-0 bg-[#0D1117] border border-white/[0.05] flex items-center justify-center overflow-hidden" style={{width:size,height:size}}>{!err&&src?<img src={src} alt={symbol} className="w-full h-full object-cover" onError={()=>setErr(true)}/>:<span className="text-[#2BFFF1] font-black" style={{fontSize:size*0.28}}>{symbol.slice(0,3)}</span>}</div>;
}

// ══════════════════════════════════════════════════════════════════════════
// ── Wallet & Accounts Panel ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
function WalletPanel({ isMock, onClose }:{isMock:boolean; onClose:()=>void}) {
  const { user, account } = useAuth();
  const [wallet, setWallet]     = useState<WalletInfo|null>(null);
  const [loading, setLoading]   = useState(true);
  const [from, setFrom]         = useState<SubAccount>('funding');
  const [to, setTo]             = useState<SubAccount>('spot');
  const [amount, setAmount]     = useState('');
  const [transferring, setTf]   = useState(false);
  const [msg, setMsg]           = useState('');
  const [checking, setChecking] = useState(false);
  const [copied, setCopied]     = useState(false);

  const getAuth = async () => {
    const { data:{ session } } = await supabase!.auth.getSession();
    return session?.access_token ?? '';
  };

  const loadWallet = useCallback(async () => {
    if(!user) return;
    setLoading(true);
    const token = await getAuth();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/platform-wallet`, {
      method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body: JSON.stringify({ action:'get_wallet' }),
    });
    const d = await r.json();
    setWallet(d);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadWallet(); }, [loadWallet]);

  const doTransfer = async () => {
    if(!amount||parseFloat(amount)<=0) return;
    setTf(true); setMsg('');
    const token = await getAuth();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/platform-wallet`, {
      method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body: JSON.stringify({ action:'transfer', from_account:from, to_account:to, amount:parseFloat(amount) }),
    });
    const d = await r.json();
    if(d.success) { setMsg('✅ Transfer complete'); setAmount(''); await loadWallet(); }
    else setMsg(`❌ ${d.error}`);
    setTf(false);
  };

  const checkDeposits = async () => {
    setChecking(true); setMsg('');
    const token = await getAuth();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/platform-wallet`, {
      method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body: JSON.stringify({ action:'check_deposits', credit_to:'funding' }),
    });
    const d = await r.json();
    if(d.credits?.length>0) { setMsg(`✅ Detected ${d.credits.length} deposit(s)`); await loadWallet(); }
    else setMsg('No new deposits found');
    setChecking(false);
  };

  const copyAddr = () => { navigator.clipboard.writeText(wallet?.address??''); setCopied(true); setTimeout(()=>setCopied(false),2000); };

  const ACCT_LABELS:Record<SubAccount,string> = { funding:'Funding', spot:'Spot (Live)', mock_spot:'Spot (Mock)', leverage:'Leverage (Live)', mock_leverage:'Leverage (Mock)' };
  const balanceOf = (a:SubAccount):number => {
    if(!wallet) return 0;
    const m:Record<SubAccount,number> = { funding:wallet.funding_balance, spot:wallet.spot_balance, mock_spot:wallet.spot_mock_balance, leverage:wallet.leverage_balance, mock_leverage:wallet.mock_balance };
    return m[a]??0;
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm px-3 pb-4 sm:pb-0" onClick={onClose}>
      <div className="bg-[#0B0E14] border border-white/[0.1] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <div><p className="text-sm font-black text-[#F4F6FA]">Platform Wallet</p><p className="text-[10px] text-[#4B5563]">Auto-generated · Solana</p></div>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#A7B0B7] text-lg">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-[#4B5563]">
              <div className="w-5 h-5 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>
              <span className="text-xs">Setting up wallet…</span>
            </div>
          ) : (
            <>
              {/* Wallet address */}
              <div className="rounded-xl bg-[#05060B] border border-white/[0.06] p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-[#4B5563] font-semibold">YOUR PLATFORM WALLET (SOL)</p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Auto-created</span>
                </div>
                <p className="font-mono text-xs text-[#F4F6FA] break-all mb-2">{wallet?.address ?? '—'}</p>
                <div className="flex gap-2">
                  <button onClick={copyAddr} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/10 transition-all">
                    {copied ? '✓ Copied' : '📋 Copy'}
                  </button>
                  <button onClick={checkDeposits} disabled={checking} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-[#A7B0B7] border border-white/[0.1] hover:bg-white/[0.04] transition-all disabled:opacity-50">
                    {checking ? '⏳ Scanning…' : '🔍 Scan deposits'}
                  </button>
                </div>
                <p className="text-[9px] text-[#374151] mt-2">Deposit SOL to this address and click Scan to credit your Funding balance.</p>
              </div>

              {/* Sub-account balances */}
              <div>
                <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide mb-2">Account Balances</p>
                <div className="space-y-1.5">
                  {(['funding','spot','mock_spot','leverage','mock_leverage'] as SubAccount[]).map(a => (
                    <div key={a} className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${a.startsWith('mock')?'bg-[#374151]':'bg-[#2BFFF1]'}`}/>
                        <span className="text-xs text-[#A7B0B7]">{ACCT_LABELS[a]}</span>
                      </div>
                      <span className="text-xs font-bold font-mono text-[#F4F6FA]">${balanceOf(a).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Transfer */}
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2.5">
                <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide">Transfer Between Accounts</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-[#4B5563] block mb-1">From</label>
                    <select value={from} onChange={e=>setFrom(e.target.value as SubAccount)} className="w-full bg-[#05060B] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none">
                      {(['funding','spot','mock_spot','leverage','mock_leverage'] as SubAccount[]).map(a=><option key={a} value={a}>{ACCT_LABELS[a]} (${balanceOf(a).toFixed(0)})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-[#4B5563] block mb-1">To</label>
                    <select value={to} onChange={e=>setTo(e.target.value as SubAccount)} className="w-full bg-[#05060B] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none">
                      {(['funding','spot','mock_spot','leverage','mock_leverage'] as SubAccount[]).map(a=><option key={a} value={a}>{ACCT_LABELS[a]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Amount (USD)" className="flex-1 bg-[#05060B] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40"/>
                  <button onClick={()=>setAmount(String(balanceOf(from).toFixed(2)))} className="px-2 py-1.5 rounded-lg text-[9px] font-bold text-[#2BFFF1] border border-[#2BFFF1]/20 hover:bg-[#2BFFF1]/10 transition-all">MAX</button>
                </div>
                {msg && <p className={`text-[10px] font-semibold ${msg.startsWith('✅')?'text-green-400':'text-red-400'}`}>{msg}</p>}
                <button onClick={doTransfer} disabled={transferring||!amount||parseFloat(amount)<=0} className="w-full py-2 rounded-xl text-xs font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
                  {transferring ? 'Transferring…' : `Transfer ${ACCT_LABELS[from]} → ${ACCT_LABELS[to]}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ── Main Spot Trading Page ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
interface Props { isMock:boolean; onToggleMock:()=>void; }

export function SpotTradingPage({ isMock, onToggleMock }:Props) {
  const { user, account, saveAccount } = useAuth();

  // Token state
  const [searchQ,       setSearchQ]       = useState('');
  const [searchResults, setSearchResults] = useState<Token[]>([]);
  const [searching,     setSearching]     = useState(false);
  const [token,         setToken]         = useState<Token|null>(null);
  const [livePrice,     setLivePrice]     = useState(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const priceTimer  = useRef<ReturnType<typeof setInterval>>();

  // Chart state
  const [candles,       setCandles]       = useState<Candle[]>([]);
  const [interval,      setInterval_]     = useState('15m');
  const [loadingChart,  setLoadingChart]  = useState(false);
  const [chartTP,       setChartTP]       = useState<number|null>(null);
  const [chartSL,       setChartSL]       = useState<number|null>(null);

  // Trade form
  const [side,          setSide]          = useState<'buy'|'sell'>('buy');
  const [amountUsd,     setAmountUsd]     = useState('');
  const [executing,     setExecuting]     = useState(false);
  const [txStatus,      setTxStatus]      = useState<{type:'success'|'error';msg:string}|null>(null);

  // Portfolio
  const [tab,           setTab]           = useState<'chart'|'swap'|'portfolio'|'history'>('chart');
  const [holdings,      setHoldings]      = useState<Holding[]>([]);
  const [trades,        setTrades]        = useState<Trade[]>([]);
  const [loadingData,   setLoadingData]   = useState(false);

  // Wallet panel
  const [showWallet,    setShowWallet]    = useState(false);
  const [walletInfo,    setWalletInfo]    = useState<WalletInfo|null>(null);

  // Balance for selected mode
  const getSpotBalance = () => {
    if(!walletInfo) return account ? (isMock ? account.mock_balance : account.real_balance) : 0;
    return isMock ? walletInfo.spot_mock_balance : walletInfo.spot_balance;
  };
  const balance = getSpotBalance();

  const amtN    = parseFloat(amountUsd)||0;
  const feeP    = isMock ? MOCK_FEE : LIVE_FEE;
  const feeUsd  = amtN * feeP;
  const netUsd  = side==='buy' ? amtN+feeUsd : amtN-feeUsd;
  const tokOut  = livePrice>0 ? amtN/livePrice : 0;
  const currentHolding = holdings.find(h=>h.token_mint===token?.mint&&h.is_mock===isMock);

  const getAuth = async () => {
    const { data:{ session } } = await supabase!.auth.getSession();
    return session?.access_token ?? '';
  };

  // ── Wallet info loader ──────────────────────────────────────────────────
  const loadWalletInfo = useCallback(async () => {
    if(!user||!supabase) return;
    const token = await getAuth();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/platform-wallet`, {
      method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body: JSON.stringify({ action:'get_wallet' }),
    });
    const d = await r.json();
    if(d.address) setWalletInfo(d);
  }, [user]);

  useEffect(() => { loadWalletInfo(); }, [loadWalletInfo]);

  // ── Token search ────────────────────────────────────────────────────────
  useEffect(() => {
    if(!searchQ.trim()) { setSearchResults([]); return; }
    clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current = setTimeout(async()=>{ const r=await searchTokens(searchQ); setSearchResults(r); setSearching(false); }, 350);
  }, [searchQ]);

  // ── Price polling ────────────────────────────────────────────────────────
  useEffect(() => {
    if(!token) return;
    setLivePrice(token.priceUsd);
    clearInterval(priceTimer.current);
    priceTimer.current = setInterval(async()=>{ try { const r=await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.mint}`); const d=await r.json(); const p=parseFloat(d.pairs?.[0]?.priceUsd??'0'); if(p>0) setLivePrice(p); } catch {} }, 10_000);
    return () => clearInterval(priceTimer.current);
  }, [token?.mint]);

  // ── Chart candles ────────────────────────────────────────────────────────
  useEffect(() => {
    if(!token?.pairAddress) return;
    setLoadingChart(true);
    setCandles([]);
    fetchSpotCandles(token.pairAddress, interval).then(c=>{ setCandles(c); setLoadingChart(false); });
  }, [token?.pairAddress, interval]);

  // ── Portfolio ────────────────────────────────────────────────────────────
  const loadPortfolio = useCallback(async()=>{
    if(!supabase||!user) return;
    setLoadingData(true);
    const [hr,tr]=await Promise.all([
      supabase.from('spot_holdings').select('*').eq('user_id',user.id).eq('is_mock',isMock).order('updated_at',{ascending:false}),
      supabase.from('spot_trades').select('*').eq('user_id',user.id).eq('is_mock',isMock).order('created_at',{ascending:false}).limit(50),
    ]);
    const raw=(hr.data??[]) as Holding[];
    const enriched=await Promise.all(raw.map(async h=>{
      try { const r=await fetch(`https://api.dexscreener.com/latest/dex/tokens/${h.token_mint}`); const d=await r.json(); const p=parseFloat(d.pairs?.[0]?.priceUsd??'0'); return {...h,currentPrice:p,pnl:p>0?(p-h.avg_cost)*h.amount:0,pnlPct:h.avg_cost>0?((p-h.avg_cost)/h.avg_cost)*100:0}; } catch { return h; }
    }));
    setHoldings(enriched.filter(h=>h.amount>0.000001));
    setTrades((tr.data??[]) as Trade[]);
    setLoadingData(false);
  },[user,isMock]);

  useEffect(()=>{ loadPortfolio(); },[loadPortfolio,isMock]);

  // ── Auto-fill TP/SL from chart ────────────────────────────────────────
  const tpStr = chartTP ? chartTP.toFixed(9).replace(/\.?0+$/,'') : '';
  const slStr = chartSL ? chartSL.toFixed(9).replace(/\.?0+$/,'') : '';
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  useEffect(()=>{ if(chartTP) setTp(tpStr); },[chartTP]);
  useEffect(()=>{ if(chartSL) setSl(slStr); },[chartSL]);

  // ── Execute trade ─────────────────────────────────────────────────────
  const executeTrade = async() => {
    if(!user||!token||amtN<=0) return;
    if(amtN>balance) { setTxStatus({type:'error',msg:'Insufficient balance'}); return; }
    setExecuting(true); setTxStatus(null);
    try {
      const authToken=await getAuth();
      if(!authToken) throw new Error('Not authenticated');

      if(isMock) {
        const r=await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`,{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken}`},
          body:JSON.stringify({ action:'mock_trade', isMock:true, inputMint:side==='buy'?USDC_MINT:token.mint, outputMint:side==='buy'?token.mint:USDC_MINT, amountUsd:amtN, tokenSymbol:token.symbol, tokenName:token.name, priceUsd:livePrice, side }),
        });
        const d=await r.json();
        if(!r.ok) throw new Error(d.error??'Mock trade failed');
        setTxStatus({type:'success',msg:`Mock ${side.toUpperCase()} ${tokOut.toFixed(4)} ${token.symbol} · fee $${feeUsd.toFixed(4)}`});
        // Reload wallet info to reflect updated mock balance
        await loadWalletInfo();
      } else {
        const phantom=(window as any).solana;
        if(!phantom?.isPhantom) throw new Error('Phantom wallet required for live trading');
        if(!phantom.isConnected) await phantom.connect();
        const userWallet=phantom.publicKey?.toBase58();
        if(!userWallet) throw new Error('No wallet connected');

        const qRes=await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`,{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken}`},
          body:JSON.stringify({ action:'quote', inputMint:side==='buy'?USDC_MINT:token.mint, outputMint:side==='buy'?token.mint:USDC_MINT, amountUsd:amtN, tokenSymbol:token.symbol, tokenName:token.name, priceUsd:livePrice, userWallet, side }),
        });
        const {quote,error:qErr}=await qRes.json();
        if(qErr) throw new Error(qErr);

        const swapRes=await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`,{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken}`},
          body:JSON.stringify({ action:'swap', quote, inputMint:side==='buy'?USDC_MINT:token.mint, outputMint:side==='buy'?token.mint:USDC_MINT, amountUsd:amtN, tokenSymbol:token.symbol, tokenName:token.name, priceUsd:livePrice, userWallet, side }),
        });
        const {swapTransaction,tradeId,error:swErr}=await swapRes.json();
        if(swErr) throw new Error(swErr);

        const txBuf=Buffer.from(swapTransaction,'base64');
        const {VersionedTransaction,Connection}=await import('@solana/web3.js') as any;
        const tx=VersionedTransaction.deserialize(txBuf);
        const signed=await phantom.signTransaction(tx);
        const conn=new Connection('https://api.mainnet-beta.solana.com');
        const txHash=await conn.sendRawTransaction(signed.serialize(),{skipPreflight:false,preflightCommitment:'confirmed'});
        await conn.confirmTransaction(txHash,'confirmed');

        await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`,{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authToken}`},
          body:JSON.stringify({ action:'confirm', tradeId, txHash, outputMint:token.mint, tokenSymbol:token.symbol, tokenName:token.name, amountUsd:amtN, priceUsd:livePrice, tokenAmount:tokOut }),
        });
        setTxStatus({type:'success',msg:`Live ${side.toUpperCase()} confirmed! ${txHash.slice(0,8)}…`});
      }
      setAmountUsd(''); await loadPortfolio();
    } catch(e:any) { setTxStatus({type:'error',msg:e.message??'Trade failed'}); }
    setExecuting(false);
  };

  // ══════════════════════════════════════════════════════════════════════
  // ── Render ────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#05060B]">
      {/* Wallet panel overlay */}
      {showWallet && <WalletPanel isMock={isMock} onClose={()=>{ setShowWallet(false); loadWalletInfo(); }}/>}

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] flex-shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black text-[#F4F6FA]">Spot Trading</p>
          <p className="text-[9px] text-[#374151]">Jupiter · Pump.fun · Raydium</p>
        </div>

        {/* Wallet balance quick view */}
        <button onClick={()=>setShowWallet(true)} className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-white/[0.07] hover:border-white/20 transition-all">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          <span className="text-[10px] text-[#A7B0B7] font-mono">${balance.toFixed(0)}</span>
        </button>

        {/* Mock/Live toggle */}
        <button onClick={onToggleMock} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-black transition-all ${isMock?'border-white/[0.12] bg-white/[0.04] text-[#6B7280]':'border-[#2BFFF1]/50 bg-[#2BFFF1]/15 text-[#2BFFF1]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isMock?'bg-[#374151]':'bg-[#2BFFF1] shadow-[0_0_6px_#2BFFF1]'}`}/>
          {isMock?'MOCK':'LIVE'}
        </button>

        <button onClick={()=>setShowWallet(true)} className="px-2.5 py-1.5 rounded-xl border border-[#2BFFF1]/25 text-[#2BFFF1] text-[10px] font-bold hover:bg-[#2BFFF1]/10 transition-all">
          💳 Wallet
        </button>
      </div>

      {/* ── Token Search Bar ─────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-white/[0.05] flex-shrink-0 relative z-10">
        <div className="flex items-center gap-2 bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-2 focus-within:border-[#2BFFF1]/40 transition-all">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search token — name, symbol, or paste contract address…" className="flex-1 bg-transparent text-xs text-[#F4F6FA] outline-none placeholder-[#2D3748]"/>
          {token && <button onClick={()=>setToken(null)} className="text-[#4B5563] hover:text-[#A7B0B7] text-xs">✕</button>}
          {searching&&<div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>}
        </div>

        {/* Search dropdown */}
        {searchResults.length>0&&(
          <div className="absolute left-3 right-3 top-full mt-1 bg-[#0B0E14] border border-white/[0.1] rounded-2xl shadow-2xl z-[200] overflow-hidden max-h-56 overflow-y-auto">
            {searchResults.map(t=>(
              <button key={t.mint} onClick={()=>{ setToken(t); setSearchQ(''); setSearchResults([]); setTab('chart'); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-all text-left">
                <TokenImg src={t.logoUri} symbol={t.symbol} size={30}/>
                <div className="flex-1 min-w-0"><p className="text-xs font-bold text-[#F4F6FA]">{t.symbol}</p><p className="text-[9px] text-[#374151] truncate">{t.name}</p></div>
                <div className="text-right"><p className="text-xs font-mono text-[#A7B0B7]">{fmtP(t.priceUsd)}</p><p className={`text-[10px] font-semibold ${t.change24h>=0?'text-green-400':'text-red-400'}`}>{t.change24h>=0?'+':''}{t.change24h.toFixed(2)}%</p></div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Token header strip ────────────────────────────────────────── */}
      {token&&(
        <div className="flex items-center gap-3 px-3 py-2 border-b border-white/[0.05] flex-shrink-0 bg-[#0B0E14]">
          <TokenImg src={token.logoUri} symbol={token.symbol} size={28}/>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-[#F4F6FA]">{token.symbol}/USD</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${token.change24h>=0?'text-green-400 bg-green-500/10':'text-red-400 bg-red-500/10'}`}>{token.change24h>=0?'+':''}{token.change24h.toFixed(2)}%</span>
            </div>
            <p className="text-[9px] text-[#374151] truncate">{token.name}</p>
          </div>
          <div className="text-right">
            <p className="text-base font-black font-mono text-[#F4F6FA]">{fmtP(livePrice)}</p>
            <p className="text-[9px] text-[#374151]">Vol {fmtUsd(token.volume24h)}</p>
          </div>
          {/* Interval selector */}
          <div className="flex gap-0.5 ml-2">
            {INTERVALS.map(i=>(
              <button key={i} onClick={()=>setInterval_(i)} className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${interval===i?'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/20':'text-[#374151] hover:text-[#6B7280]'}`}>{i}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="flex border-b border-white/[0.05] flex-shrink-0">
        {(['chart','swap','portfolio','history'] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)} className={`flex-1 py-2 text-[11px] font-semibold capitalize transition-all ${tab===t?'text-[#2BFFF1] border-b-2 border-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {t==='chart'?'📈 Chart':t==='swap'?'⇄ Swap':t==='portfolio'?'📊 Portfolio':'🕐 History'}
          </button>
        ))}
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* ═══════ CHART TAB ══════════════════════════════════════════ */}
        {tab==='chart'&&(
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Chart */}
            <div className="flex-1 min-h-0">
              {token ? (
                loadingChart&&candles.length===0
                  ? <div className="h-full flex items-center justify-center gap-2 text-[#4B5563] text-xs"><div className="w-4 h-4 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>Loading chart…</div>
                  : <PriceChart candles={candles} livePrice={livePrice} positions={[]} onQuickTP={p=>setChartTP(p)} onQuickSL={p=>setChartSL(p)}/>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <p className="text-3xl mb-3">📈</p>
                  <p className="text-sm text-[#4B5563]">Search a token above to view its chart</p>
                  <p className="text-[10px] text-[#374151] mt-1">Supports any Solana token on Pump.fun, Raydium, Jupiter</p>
                </div>
              )}
            </div>

            {/* Quick trade panel at bottom of chart */}
            {token&&(
              <div className="flex-shrink-0 border-t border-white/[0.06] p-3 bg-[#0B0E14]">
                <div className="flex gap-2">
                  <div className="flex rounded-xl overflow-hidden border border-white/[0.07] flex-shrink-0">
                    {(['buy','sell'] as const).map(s=>(
                      <button key={s} onClick={()=>setSide(s)} className={`px-4 py-2 text-xs font-bold transition-all ${side===s?s==='buy'?'bg-green-500/20 text-green-400':'bg-red-500/20 text-red-400':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                        {s==='buy'?'▲ Buy':'▼ Sell'}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 flex items-center gap-1.5 bg-[#05060B] border border-white/[0.08] rounded-xl px-2.5 focus-within:border-[#2BFFF1]/40">
                    <span className="text-[#4B5563] text-xs">$</span>
                    <input type="number" value={amountUsd} onChange={e=>setAmountUsd(e.target.value)} placeholder="Amount USD" className="flex-1 bg-transparent text-xs text-[#F4F6FA] outline-none"/>
                  </div>
                  <button onClick={()=>{ setTab('swap'); }} className="px-3 py-2 rounded-xl text-[10px] font-bold text-[#4B5563] border border-white/[0.07] hover:text-[#A7B0B7] transition-all whitespace-nowrap">Full form →</button>
                  <button onClick={executeTrade} disabled={executing||amtN<=0||amtN>balance} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-40 ${side==='buy'?'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30':'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'}`}>
                    {executing?'…':`${side==='buy'?'Buy':'Sell'} ${isMock?'(M)':'(L)'}`}
                  </button>
                </div>
                {(chartTP||chartSL)&&(
                  <div className="flex gap-3 mt-2 text-[10px]">
                    {chartTP&&<span className="text-green-400">TP set: {fmtP(chartTP)} <button onClick={()=>setChartTP(null)} className="text-[#374151] hover:text-red-400 ml-1">✕</button></span>}
                    {chartSL&&<span className="text-red-400">SL set: {fmtP(chartSL)} <button onClick={()=>setChartSL(null)} className="text-[#374151] hover:text-red-400 ml-1">✕</button></span>}
                  </div>
                )}
                {txStatus&&<p className={`text-[10px] mt-1.5 font-semibold ${txStatus.type==='success'?'text-green-400':'text-red-400'}`}>{txStatus.type==='success'?'✅':'❌'} {txStatus.msg}</p>}
              </div>
            )}
          </div>
        )}

        {/* ═══════ SWAP TAB ═══════════════════════════════════════════ */}
        {tab==='swap'&&(
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-3 max-w-lg mx-auto">
              {!token?(
                <div className="rounded-2xl border border-dashed border-white/[0.08] p-10 text-center"><p className="text-3xl mb-2">🔍</p><p className="text-sm text-[#4B5563]">Search a token above to trade</p></div>
              ):(
                <>
                  {/* Buy/Sell toggle */}
                  <div className="flex rounded-xl overflow-hidden border border-white/[0.07]">
                    {(['buy','sell'] as const).map(s=>(
                      <button key={s} onClick={()=>setSide(s)} className={`flex-1 py-3 text-sm font-black transition-all ${side===s?s==='buy'?'bg-green-500/20 text-green-400':'bg-red-500/20 text-red-400':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                        {s==='buy'?'▲ BUY':'▼ SELL'} {token.symbol}
                      </button>
                    ))}
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="text-[10px] text-[#4B5563] mb-1 block">Amount (USD)</label>
                    <div className="flex items-center gap-2 bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-[#2BFFF1]/40">
                      <span className="text-[#4B5563]">$</span>
                      <input type="number" value={amountUsd} onChange={e=>setAmountUsd(e.target.value)} placeholder="0.00" className="flex-1 bg-transparent text-sm font-mono text-[#F4F6FA] outline-none"/>
                      {[0.25,0.5,1].map(f=>(
                        <button key={f} onClick={()=>setAmountUsd(String((balance*f).toFixed(2)))} className="text-[9px] text-[#2BFFF1] border border-[#2BFFF1]/20 px-1.5 py-0.5 rounded-md hover:bg-[#2BFFF1]/10 transition-all">{f===1?'MAX':f*100+'%'}</button>
                      ))}
                    </div>
                  </div>

                  {/* TP / SL from chart */}
                  <div className="grid grid-cols-2 gap-2">
                    {[['Take Profit',tp,setTp,chartTP],['Stop Loss',sl,setSl,chartSL]].map(([label,val,setter,chartVal]:any)=>(
                      <div key={label}>
                        <label className="text-[10px] text-[#4B5563] mb-1 block flex items-center gap-1">{label} {chartVal&&<span className="text-[#2BFFF1] text-[8px]">← from chart</span>}</label>
                        <input type="number" value={val} onChange={e=>setter(e.target.value)} placeholder="Optional" className="w-full bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40"/>
                      </div>
                    ))}
                  </div>

                  {/* Sell info */}
                  {side==='sell'&&currentHolding&&(
                    <div className="rounded-xl bg-[#0B0E14] px-3 py-2 text-[10px] space-y-0.5">
                      <div className="flex justify-between"><span className="text-[#4B5563]">Available</span><span className="text-[#F4F6FA] font-mono">{currentHolding.amount.toFixed(4)} {token.symbol}</span></div>
                      <div className="flex justify-between"><span className="text-[#4B5563]">Value</span><span className="text-[#A7B0B7]">{fmtUsd(currentHolding.amount*livePrice)}</span></div>
                    </div>
                  )}

                  {/* Summary */}
                  {amtN>0&&livePrice>0&&(
                    <div className="rounded-xl bg-[#0B0E14] px-3 py-2.5 space-y-1.5">
                      {[['You receive',`${tokOut.toFixed(6)} ${token.symbol}`],['Price per token',fmtP(livePrice)],[`Fee (${isMock?'0.25%':'0.35%'})`,`$${feeUsd.toFixed(4)}`],['Total',`$${netUsd.toFixed(2)}`]].map(([k,v])=>(
                        <div key={k} className={`flex justify-between text-[10px] ${k==='Total'?'font-bold border-t border-white/[0.06] pt-1.5 mt-1.5':''}`}><span className="text-[#4B5563]">{k}</span><span className={k==='Total'?'text-[#F4F6FA]':k.includes('Fee')?'text-[#F59E0B]':'text-[#A7B0B7]'}>{v}</span></div>
                      ))}
                    </div>
                  )}

                  {txStatus&&(
                    <div className={`rounded-xl px-3 py-2.5 text-xs font-semibold ${txStatus.type==='success'?'bg-green-500/10 text-green-400 border border-green-500/20':'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                      {txStatus.type==='success'?'✅':'❌'} {txStatus.msg}
                    </div>
                  )}

                  {!isMock&&(
                    <div className="rounded-xl border border-[#F59E0B]/15 bg-[#F59E0B]/05 px-3 py-2">
                      <p className="text-[9px] text-[#F59E0B]/60">⚡ 0.35% fee sent on-chain to Xenia wallet via Jupiter · Requires Phantom</p>
                    </div>
                  )}

                  <button onClick={executeTrade} disabled={executing||!user||amtN<=0||amtN>balance}
                    className={`w-full py-3.5 rounded-xl text-sm font-black transition-all disabled:opacity-40 ${side==='buy'?'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30':'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'}`}>
                    {executing?<span className="flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"/>{isMock?'Simulating…':'Signing…'}</span>
                      :!user?'Sign in to trade':`${side==='buy'?'▲ Buy':'▼ Sell'} ${token.symbol} ${isMock?'(Mock)':'(Live)'}`}
                  </button>

                  {/* Buy/Sell pressure */}
                  <BuySellPressure candles={candles} livePrice={livePrice} asset={token.symbol} pairAddress={token.pairAddress}/>
                </>
              )}
            </div>
          </div>
        )}

        {/* ═══════ PORTFOLIO TAB ══════════════════════════════════════ */}
        {tab==='portfolio'&&(
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Holdings · {isMock?'Mock':'Live'}</p>
              <button onClick={loadPortfolio} className="text-[10px] text-[#4B5563] hover:text-[#2BFFF1] transition-all">↻ Refresh</button>
            </div>
            {loadingData?<div className="flex items-center justify-center py-12 gap-2 text-[#4B5563]"><div className="w-5 h-5 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/><span className="text-xs">Loading…</span></div>
            :holdings.length===0?<div className="text-center py-12"><p className="text-3xl mb-3">📭</p><p className="text-sm text-[#4B5563]">No holdings — make a trade to get started</p></div>
            :(
              <>
                {(()=>{const tv=holdings.reduce((s,h)=>s+(h.currentPrice??0)*h.amount,0);const tc=holdings.reduce((s,h)=>s+h.avg_cost*h.amount,0);const tp2=tv-tc;const tpp=tc>0?(tp2/tc)*100:0;return(
                  <div className="rounded-2xl border border-white/[0.07] bg-[#0B0E14] p-4">
                    <p className="text-[10px] text-[#4B5563] mb-1">Portfolio Value</p>
                    <p className="text-2xl font-black text-[#F4F6FA]">{fmtUsd(tv)}</p>
                    <p className={`text-sm font-bold mt-0.5 ${tp2>=0?'text-green-400':'text-red-400'}`}>{tp2>=0?'▲':'▼'} {fmtUsd(Math.abs(tp2))} ({Math.abs(tpp).toFixed(2)}%)</p>
                  </div>
                );})()}
                {holdings.map(h=>(
                  <div key={h.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#0B0E14] border border-white/[0.05] flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-black text-[#2BFFF1]">{h.token_symbol.slice(0,3)}</span></div>
                    <div className="flex-1 min-w-0"><p className="text-xs font-bold text-[#F4F6FA]">{h.token_symbol}</p><p className="text-[9px] text-[#374151]">{h.amount.toFixed(4)} · avg {fmtP(h.avg_cost)}</p></div>
                    <div className="text-right"><p className="text-xs font-mono text-[#F4F6FA]">{fmtUsd((h.currentPrice??0)*h.amount)}</p><p className={`text-[10px] font-bold ${(h.pnl??0)>=0?'text-green-400':'text-red-400'}`}>{(h.pnl??0)>=0?'+':''}{fmtUsd(h.pnl??0)} ({(h.pnlPct??0).toFixed(1)}%)</p></div>
                    <button onClick={()=>{const t:Token={mint:h.token_mint,symbol:h.token_symbol,name:h.token_name,priceUsd:h.currentPrice??0,change24h:0,volume24h:0,mcap:0,logoUri:'',pairAddress:h.token_mint};setToken(t);setLivePrice(h.currentPrice??0);setSide('sell');setTab('swap');}} className="flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all">Sell</button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ═══════ HISTORY TAB ════════════════════════════════════════ */}
        {tab==='history'&&(
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-2">History · {isMock?'Mock':'Live'}</p>
            {trades.length===0?<div className="text-center py-12"><p className="text-3xl mb-3">🕐</p><p className="text-sm text-[#4B5563]">No trades yet</p></div>
            :trades.map(t=>(
              <div key={t.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-black ${t.side==='buy'?'bg-green-500/15 text-green-400':'bg-red-500/15 text-red-400'}`}>{t.side==='buy'?'B':'S'}</div>
                <div className="flex-1 min-w-0"><p className="text-xs font-bold text-[#F4F6FA]">{t.side.toUpperCase()} {t.token_symbol}</p><p className="text-[9px] text-[#374151]">{new Date(t.created_at).toLocaleString()} · fee ${t.fee_usd.toFixed(4)}</p></div>
                <div className="text-right"><p className="text-xs font-mono text-[#A7B0B7]">${t.amount_usd.toFixed(2)}</p><p className="text-[9px] text-[#374151]">{t.amount_token.toFixed(4)} @ {fmtP(t.price_usd)}</p></div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${t.status==='completed'?'text-green-400 bg-green-500/10':'text-yellow-400 bg-yellow-500/10'}`}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
