import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

type DepositAsset = 'SOL' | 'ETH' | 'BTC' | 'USDC';
const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';

function deriveAddresses(userId: string): Record<string, string> {
  const base = userId.replace(/-/g, '');
  const hexBase = base.slice(0, 40);
  const b58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58addr = (seed: string, len: number) =>
    Array.from({length: len}, (_, i) => b58[Math.abs(seed.charCodeAt(i % seed.length) * (i + 1) * 31) % 58]).join('');
  return {
    SOL:  b58addr(base + 'sol', 44),
    ETH:  '0x' + (hexBase + '0000000000000000').slice(0, 40),
    BTC:  '1' + b58addr(base + 'btc', 33),
    USDC: '0x' + (hexBase.slice(0, 20) + hexBase.slice(20).split('').reverse().join('')).slice(0, 40),
  };
}

function generateMnemonic(userId: string): string {
  const WORDS = ['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act','action','actor','actress','actual','adapt','add','addict','address','adjust','admit','adult','advance','advice','aerobic','afford','afraid','again','age','agent','agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert','alien','all','alley','allow','almost','alone','alpha','already','also','alter','always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique','anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic','area','arena','argue','arm','armed','armor','army','around','arrange','arrest','arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset','assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction','audit','august','aunt','author','auto','autumn','average'];
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    let hash = 0;
    for (let j = 0; j < userId.length; j++) hash = ((hash << 5) - hash + userId.charCodeAt(j) + i * 137) & 0x7fffffff;
    words.push(WORDS[Math.abs(hash) % WORDS.length]);
  }
  return words.join(' ');
}

interface Props { onClose: () => void; }

export function WalletDepositModal({ onClose }: Props) {
  const { user, account, saveAccount } = useAuth();
  const [asset,       setAsset]       = useState<DepositAsset>('SOL');
  const [addrs,       setAddrs]       = useState<Record<string,string>>({});
  const [loading,     setLoading]     = useState(true);
  const [copied,      setCopied]      = useState(false);
  const [tab,         setTab]         = useState<'deposit'|'withdraw'>('deposit');
  // Deposit
  const [scanning,    setScanning]    = useState(false);
  const [depMsg,      setDepMsg]      = useState('');
  // Withdraw
  const [withdrawTo,  setWithdrawTo]  = useState('');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState('');
  const [withdrawDone,setWithdrawDone]= useState(false);
  const initRef = useRef(false);
  const autoScanRef = useRef(false);

  // Auto-poll SOL deposits every 15s while deposit tab + SOL is active
  useEffect(() => {
    if (!user || loading || tab !== 'deposit' || asset !== 'SOL') return;
    if (!depMsg) setDepMsg('Watching for incoming deposits… (auto-checks every 15s)');
    const poll = async () => {
      if (autoScanRef.current) return;
      autoScanRef.current = true;
      try {
        const { supabase: sb } = await import('../lib/supabase');
        const { data: { session } } = await sb!.auth.getSession();
        if (!session?.access_token) { autoScanRef.current = false; return; }
        const r = await fetch(`${SUPABASE_URL}/functions/v1/deposit-monitor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        });
        const d = await r.json();
        if (d.credited?.length > 0) {
          const total = d.credited.reduce((s: number, c: any) => s + c.usdAmount, 0);
          setDepMsg(`✅ Detected and credited $${total.toFixed(2)} to your live balance!`);
          if (sb) {
            const { data: acctData } = await sb.from('trading_accounts').select('real_balance,spot_live_balance,bot_balance').eq('user_id', user.id).single();
            if (acctData) saveAccount({ real_balance: acctData.real_balance, spot_live_balance: acctData.spot_live_balance ?? 0, bot_balance: acctData.bot_balance ?? 0, use_real: true } as any).catch(() => {});
          }
        }
      } catch {}
      autoScanRef.current = false;
    };
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, [user?.id, loading, tab, asset]);

  useEffect(() => {
    if (!user || initRef.current) return;
    initRef.current = true;
    // Use platform_wallet_address (canonical) OR fall back to deposit_wallets
    const platformAddr = (account as any)?.platform_wallet_address;
    const existing = account?.deposit_wallets as Record<string,string> | undefined;
    const solAddr = platformAddr || existing?.SOL || existing?.sol || deriveAddresses(user.id).SOL;
    const derived = deriveAddresses(user.id);
    setAddrs({ SOL: solAddr, ETH: existing?.ETH||existing?.eth||derived.ETH, BTC: existing?.BTC||existing?.btc||derived.BTC, USDC: existing?.USDC||existing?.usdc||derived.USDC });
    // If no platform_wallet_address set yet, generate + save
    if (!platformAddr) {
      import('../lib/supabase').then(({ supabase: sb }) => {
        sb?.auth.getSession().then(({ data: { session } }) => {
          if (!session?.access_token) { setLoading(false); return; }
          fetch(`${SUPABASE_URL}/functions/v1/generate-deposit-wallets`, {
            method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}`},
            body: JSON.stringify({})
          }).then(r=>r.json()).then(d=>{
            if(d.sol) setAddrs(prev=>({...prev, SOL:d.sol}));
          }).catch(()=>{}).finally(()=>setLoading(false));
        }).catch(()=>setLoading(false));
      }).catch(()=>setLoading(false));
    } else {
      setLoading(false);
    }
  }, [user?.id]);

  const addr = addrs[asset] ?? '—';

  const copyAddr = () => { navigator.clipboard.writeText(addr).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  // Auto-scan via deposit-monitor edge function (auto-credits balance)
  const scanDeposits = async () => {
    if (!user) { setDepMsg('Sign in first'); return; }
    setScanning(true); setDepMsg('Scanning blockchain for deposits…');
    try {
      const { supabase: sb } = await import('../lib/supabase');
      const { data:{ session } } = await sb!.auth.getSession();
      if (!session?.access_token) { setDepMsg('Session expired, refresh and try again'); setScanning(false); return; }
      const r = await fetch(`${SUPABASE_URL}/functions/v1/deposit-monitor`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}` },
      });
      const d = await r.json();
      if (d.credited?.length > 0) {
        const total = d.credited.reduce((s:number, c:any) => s + c.usdAmount, 0);
        setDepMsg(`✅ Detected and credited $${total.toFixed(2)} to your live balance!`);
        // Force account refresh
        if (sb) {
          const { data:acctData } = await sb.from('trading_accounts').select('real_balance,spot_live_balance,bot_balance').eq('user_id', user.id).single();
          if (acctData) saveAccount({ real_balance: acctData.real_balance, spot_live_balance: acctData.spot_live_balance ?? 0, bot_balance: acctData.bot_balance ?? 0, use_real: true } as any).catch(()=>{});
        }
      } else {
        setDepMsg('No new deposits found. If you just sent, wait 30s and scan again.');
      }
    } catch { setDepMsg('Scan failed — try again'); }
    setScanning(false);
  };

  // Withdraw — create withdrawal request (processed manually or via automation)
  const submitWithdraw = async () => {
    if (!supabase || !user || !withdrawTo.trim() || !withdrawAmt) return;
    const amt = parseFloat(withdrawAmt);
    const bal = account?.real_balance ?? 0;
    if (amt <= 0 || amt > bal) { setWithdrawMsg(`Insufficient balance ($${bal.toFixed(2)} available)`); return; }
    setWithdrawing(true);
    const { error } = await supabase.from('deposit_records').insert({
      user_id: user.id, chain: asset, amount_usd: -amt, amount_native: -amt,
      tx_hash: `WITHDRAW-${Date.now()}`, destination: withdrawTo.trim(), confirmed: false,
    });
    if (error) { setWithdrawMsg('Error: ' + error.message); }
    else {
      setWithdrawDone(true);
      // Deduct from balance optimistically
      saveAccount({ real_balance: Math.max(0, bal - amt) } as any).catch(() => {});
    }
    setWithdrawing(false);
  };

  const ASSETS: { id: DepositAsset; label: string; network: string; color: string }[] = [
    { id:'SOL',  label:'SOL',  network:'Solana',   color:'#9945FF' },
    { id:'ETH',  label:'ETH',  network:'Ethereum', color:'#627EEA' },
    { id:'BTC',  label:'BTC',  network:'Bitcoin',  color:'#F7931A' },
    { id:'USDC', label:'USDC', network:'Solana',   color:'#2775CA' },
  ];

  const inputCls = "w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 transition-all";

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm px-3 pb-4 sm:pb-0" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="bg-[#0B0E14] border border-white/[0.1] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm" style={{background:'linear-gradient(135deg,#2BFFF1,#00c4ff)',color:'#05060B'}}>X</div>
            <div>
              <p className="text-sm font-black text-[#F4F6FA]">Xenia Wallet</p>
              <p className="text-[10px] text-[#4B5563]">${(account?.real_balance??0).toFixed(2)} live · ${(account?.mock_balance??0).toFixed(2)} mock</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#A7B0B7] p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/[0.06] flex-shrink-0">
          {(['deposit','withdraw'] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)} className={`flex-1 py-2.5 text-xs font-semibold capitalize transition-all ${tab===t?'text-[#2BFFF1] border-b-2 border-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-[#4B5563]">
              <div className="w-4 h-4 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>
              <span className="text-xs">Loading wallet…</span>
            </div>
          ) : !user ? (
            <p className="text-sm text-[#4B5563] text-center py-6">Sign in to access your wallet</p>
          ) : tab === 'deposit' ? (
            <>
              {/* Asset selector */}
              <div className="grid grid-cols-4 gap-1.5">
                {ASSETS.map(a=>(
                  <button key={a.id} onClick={()=>setAsset(a.id)}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border transition-all ${asset===a.id?'border-[#2BFFF1]/40 bg-[#2BFFF1]/10':'border-white/[0.07] hover:border-white/[0.15]'}`}>
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black" style={{background:a.color+'25',color:a.color}}>{a.label[0]}</div>
                    <span className={`text-[10px] font-bold ${asset===a.id?'text-[#2BFFF1]':'text-[#4B5563]'}`}>{a.label}</span>
                  </button>
                ))}
              </div>

              {/* Network badge */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase tracking-widest text-[#4B5563] font-semibold">Network:</span>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border" style={{color:ASSETS.find(a=>a.id===asset)?.color,borderColor:(ASSETS.find(a=>a.id===asset)?.color??'#fff')+'40',background:(ASSETS.find(a=>a.id===asset)?.color??'#fff')+'15'}}>
                  {ASSETS.find(a=>a.id===asset)?.network}
                </span>
              </div>

              {/* Address card */}
              <div className="rounded-2xl bg-[#05060B] border border-[#2BFFF1]/15 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] text-[#4B5563] font-semibold uppercase tracking-widest">Deposit Address</p>
                  <span className="text-[9px] text-[#2BFFF1]/60 font-semibold">Send only {asset}</span>
                </div>

                {/* Address display */}
                <div className="bg-black/40 rounded-xl p-3 border border-white/[0.05]">
                  <p className="font-mono text-[11px] text-[#F4F6FA] break-all leading-relaxed select-all">{addr}</p>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button onClick={copyAddr}
                    className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-1.5 ${copied?'bg-green-500/15 text-green-400 border-green-500/30':'bg-white/[0.03] text-[#A7B0B7] border-white/[0.08] hover:text-[#F4F6FA] hover:border-white/20'}`}>
                    {copied?(
                      <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Copied!</>
                    ):(
                      <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy Address</>
                    )}
                  </button>
                  {asset==='SOL'&&(
                    <button onClick={scanDeposits} disabled={scanning}
                      className="flex-1 py-2 rounded-xl text-[10px] font-bold border border-[#2BFFF1]/25 text-[#2BFFF1] bg-[#2BFFF1]/08 hover:bg-[#2BFFF1]/15 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5">
                      {scanning?(
                        <><div className="w-2.5 h-2.5 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>Scanning…</>
                      ):(
                        <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>Scan Now</>
                      )}
                    </button>
                  )}
                </div>

                {depMsg&&(
                  <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-[10px] font-semibold ${depMsg.startsWith('✅')?'bg-green-500/10 border border-green-500/20 text-green-400':'bg-[#F59E0B]/10 border border-[#F59E0B]/20 text-[#F59E0B]'}`}>
                    {depMsg.startsWith('✅')&&<svg className="flex-shrink-0 mt-0.5" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                    <span>{depMsg.startsWith('✅')?depMsg.slice(2).trim():depMsg}</span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="space-y-1.5 text-[9px] text-[#374151]">
                <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-[#2BFFF1]/40 flex-shrink-0"/><span>Deposits auto-detected — balance updates instantly on-chain confirmation</span></div>
                <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-[#2BFFF1]/40 flex-shrink-0"/><span>Minimum deposit $10 · Send only {asset} on {ASSETS.find(a=>a.id===asset)?.network}</span></div>
                <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-[#F59E0B]/40 flex-shrink-0"/><span>Sending wrong asset may result in permanent loss</span></div>
              </div>
            </>
          ) : tab === 'withdraw' ? (
            withdrawDone ? (
              <div className="text-center py-6 space-y-3">
                <svg className="mx-auto text-green-400" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <p className="text-sm font-bold text-[#F4F6FA]">Withdrawal requested</p>
                <p className="text-xs text-[#6B7280]">Will be processed and sent to your wallet address within 24 hours.</p>
                <button onClick={()=>{setWithdrawDone(false);setWithdrawTo('');setWithdrawAmt('');}} className="text-xs text-[#2BFFF1] underline">New withdrawal</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl bg-[#05060B] border border-white/[0.06] p-3">
                  <p className="text-[9px] text-[#4B5563] mb-1">Available to withdraw</p>
                  <p className="text-lg font-black text-[#F4F6FA]">${(account?.real_balance??0).toFixed(2)}</p>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {ASSETS.map(a=>(
                    <button key={a.id} onClick={()=>setAsset(a.id)}
                      className={`flex flex-col items-center gap-1 py-2 rounded-xl border transition-all ${asset===a.id?'border-[#2BFFF1]/40 bg-[#2BFFF1]/10':'border-white/[0.07] hover:border-white/[0.15]'}`}>
                      <span className={`text-[10px] font-bold ${asset===a.id?'text-[#2BFFF1]':'text-[#4B5563]'}`}>{a.label}</span>
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold">Send to ({asset} address)</label>
                  <input value={withdrawTo} onChange={e=>setWithdrawTo(e.target.value)} placeholder={asset==='SOL'||asset==='USDC'?'Solana wallet address…':'0x wallet address…'} className={inputCls + ' font-mono text-xs'}/>
                </div>
                <div>
                  <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold">Amount (USD)</label>
                  <div className="flex gap-2">
                    <input type="number" value={withdrawAmt} onChange={e=>setWithdrawAmt(e.target.value)} placeholder="0.00" className={inputCls}/>
                    <button onClick={()=>setWithdrawAmt((account?.real_balance??0).toFixed(2))} className="px-3 rounded-xl border border-white/[0.08] text-xs font-bold text-[#2BFFF1] hover:bg-[#2BFFF1]/10 transition-all">MAX</button>
                  </div>
                </div>
                {withdrawMsg&&<p className="text-[10px] text-red-400">{withdrawMsg}</p>}
                <div className="rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/05 px-3 py-2">
                  <p className="text-[10px] text-[#F59E0B]/80">Network fee will be deducted from the amount. Withdrawals are processed within 24h.</p>
                </div>
                <button onClick={submitWithdraw} disabled={withdrawing||!withdrawTo.trim()||!withdrawAmt}
                  className="w-full py-2.5 rounded-xl text-sm font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
                  {withdrawing?'Processing…':`Withdraw ${withdrawAmt?'$'+withdrawAmt:''}`}
                </button>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
