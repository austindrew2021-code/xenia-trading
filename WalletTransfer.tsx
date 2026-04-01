import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';

type Wallet = 'funding'|'spot_live'|'spot_mock'|'leverage_live'|'leverage_mock'|'bot_live'|'bot_mock';

const WALLETS: { id:Wallet; label:string; desc:string; live:boolean }[] = [
  { id:'funding',        label:'Funding',        desc:'Main deposit account',         live:true  },
  { id:'spot_live',      label:'Spot (Live)',     desc:'Jupiter DEX spot trading',     live:true  },
  { id:'spot_mock',      label:'Spot (Mock)',     desc:'Practice spot trading',        live:false },
  { id:'leverage_live',  label:'Leverage (Live)', desc:'1-300x leverage positions',    live:true  },
  { id:'leverage_mock',  label:'Leverage (Mock)', desc:'Practice leverage trading',    live:false },
  { id:'bot_live',       label:'Bots (Live)',     desc:'AI bot live trading',          live:true  },
  { id:'bot_mock',       label:'Bots (Mock)',     desc:'AI bot practice trading',      live:false },
];

const WALLET_FIELD_MAP: Record<Wallet, string> = {
  funding:       'real_balance',
  spot_live:     'spot_live_balance',
  spot_mock:     'mock_balance',
  leverage_live: 'real_balance',
  leverage_mock: 'mock_balance',
  bot_live:      'bot_balance',
  bot_mock:      'bot_mock_balance',
};

function getBalance(account: any, wallet: Wallet): number {
  if(!account) return 0;
  const field = WALLET_FIELD_MAP[wallet];
  return parseFloat(account[field] ?? 0) || 0;
}

interface Props { onClose: () => void; defaultFrom?: Wallet; defaultTo?: Wallet; }

export function WalletTransfer({ onClose, defaultFrom, defaultTo }: Props) {
  const { user, account, saveAccount } = useAuth();
  const [mode,      setMode]      = useState<'transfer'|'withdraw'>('transfer');
  const [from,      setFrom]      = useState<Wallet>(defaultFrom ?? 'funding');
  const [to,        setTo]        = useState<Wallet>(defaultTo ?? 'spot_mock');
  const [amount,    setAmount]    = useState('');
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState('');
  const [history,   setHistory]   = useState<any[]>([]);
  const [wdFrom,    setWdFrom]    = useState<Wallet>('funding');
  const [wdAddress, setWdAddress] = useState('');
  const [wdAmount,  setWdAmount]  = useState('');
  const [wdSaving,  setWdSaving]  = useState(false);
  const [wdMsg,     setWdMsg]     = useState('');
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [confirmWd, setConfirmWd] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fromBalance = getBalance(account, from);
  const amt = parseFloat(amount)||0;
  const fmtUsd = (n:number) => `$${Math.abs(n).toFixed(2)}`;

  const loadHistory = useCallback(async()=>{
    if(!supabase||!user) return;
    const {data}=await supabase.from('wallet_transfers').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(10);
    setHistory(data??[]);
  },[user]);

  // ── CRITICAL: Refresh account balances from DB on mount ──
  const refreshBalances = useCallback(async () => {
    if(!supabase || !user) return;
    setRefreshing(true);
    try {
      const { data } = await supabase.from('trading_accounts')
        .select('real_balance,mock_balance,spot_live_balance,bot_balance,bot_mock_balance')
        .eq('user_id', user.id)
        .single();
      if(data) {
        saveAccount({
          real_balance: data.real_balance ?? 0,
          mock_balance: data.mock_balance ?? 0,
          spot_live_balance: data.spot_live_balance ?? 0,
          bot_balance: data.bot_balance ?? 0,
          bot_mock_balance: data.bot_mock_balance ?? 0,
        } as any);
      }
    } catch(e) { /* ignore */ }
    setRefreshing(false);
  }, [user, saveAccount]);

  useEffect(()=>{
    refreshBalances();
    loadHistory();
  },[refreshBalances, loadHistory]);

  const transfer = async () => {
    if(!supabase||!user||!account||amt<=0||amt>fromBalance){
      setMsg(amt>fromBalance?`Insufficient balance (${fmtUsd(fromBalance)} available)`:'Enter a valid amount');
      return;
    }
    if(from===to){setMsg('Cannot transfer to the same wallet');return;}
    if(WALLET_FIELD_MAP[from]===WALLET_FIELD_MAP[to]){setMsg('These wallets share the same balance pool — no transfer needed');return;}
    setSaving(true); setMsg('');

    const fromField = WALLET_FIELD_MAP[from];
    const toField   = WALLET_FIELD_MAP[to];

    // Write to DB first for accuracy
    try {
      const { data: freshAcct } = await supabase.from('trading_accounts')
        .select('real_balance,mock_balance,spot_live_balance,bot_balance,bot_mock_balance')
        .eq('user_id', user.id)
        .single();

      if(!freshAcct) throw new Error('Account not found');

      const freshFrom = parseFloat((freshAcct as any)[fromField] ?? 0) || 0;
      if(amt > freshFrom) { setMsg(`Insufficient balance (${fmtUsd(freshFrom)} available)`); setSaving(false); return; }

      const patch: any = {
        [fromField]: Math.max(0, freshFrom - amt),
        [toField]:   (parseFloat((freshAcct as any)[toField] ?? 0) || 0) + amt,
      };

      await supabase.from('trading_accounts').update(patch).eq('user_id', user.id);
      await saveAccount(patch);

      await supabase.from('wallet_transfers').insert({
        user_id: user.id, from_wallet: from, to_wallet: to, amount: amt,
        is_mock: !WALLETS.find(w=>w.id===from)?.live, note: '',
      });

      setMsg(`Transferred ${fmtUsd(amt)} from ${WALLETS.find(w=>w.id===from)?.label} to ${WALLETS.find(w=>w.id===to)?.label}`);
      setAmount('');
      await loadHistory();
      await refreshBalances();
    } catch(e:any) {
      setMsg(e.message ?? 'Transfer failed');
    }
    setSaving(false);
    setTimeout(()=>setMsg(''),3000);
  };

  const withdraw = async () => {
    const amt = parseFloat(wdAmount)||0;
    const fromBal = getBalance(account, wdFrom);
    if(!user||!account||amt<=0||amt>fromBal) { setWdMsg(amt>fromBal?`Insufficient (${fmtUsd(fromBal)} available)`:'Enter valid amount'); return; }
    if(!wdAddress.trim()||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wdAddress.trim())) { setWdMsg('Enter a valid Solana address'); return; }
    setWdSaving(true); setWdMsg('');
    try {
      const {data:{session}}=await supabase!.auth.getSession();
      const token=session?.access_token??'';
      const r = await fetch(`${SUPABASE_URL}/functions/v1/withdraw`, {
        method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({ fromWallet:wdFrom, toAddress:wdAddress.trim(), amount:amt, userId:user.id }),
      });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error??'Withdrawal failed');

      // Update balance from fresh DB read
      const field=WALLET_FIELD_MAP[wdFrom];
      const { data: freshAcct } = await supabase!.from('trading_accounts')
        .select('real_balance,mock_balance,spot_live_balance,bot_balance,bot_mock_balance')
        .eq('user_id', user.id)
        .single();
      if(freshAcct) {
        saveAccount({
          real_balance: freshAcct.real_balance ?? 0,
          mock_balance: freshAcct.mock_balance ?? 0,
          spot_live_balance: freshAcct.spot_live_balance ?? 0,
          bot_balance: freshAcct.bot_balance ?? 0,
          bot_mock_balance: freshAcct.bot_mock_balance ?? 0,
        } as any);
      } else {
        // Fallback: deduct locally
        await saveAccount({ [field]: Math.max(0, fromBal-amt) } as any);
      }

      if(supabase) await supabase.from('wallet_transfers').insert({ user_id:user.id, from_wallet:wdFrom, to_wallet:'external', amount:amt, is_mock:false, note:`To: ${wdAddress.trim().slice(0,8)}…` });
      setWdMsg(`Withdrawal of ${fmtUsd(amt)} sent!${d.txHash?' Tx: '+d.txHash.slice(0,12)+'…':''}`);
      setWdAmount(''); setWdAddress(''); await loadHistory();
      await refreshBalances();
    } catch(e:any) { setWdMsg(e.message??'Withdrawal failed'); }
    setWdSaving(false);
  };

  const WalletSelect = ({ value, onChange, label }:{ value:Wallet; onChange:(v:Wallet)=>void; label:string }) => (
    <div>
      <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">{label}</label>
      <select value={value} onChange={e=>onChange(e.target.value as Wallet)}
        className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40">
        {WALLETS.map(w=>(
          <option key={w.id} value={w.id}>{w.label} — ${getBalance(account,w.id).toFixed(2)}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-3" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="bg-[#0B0E14] border border-white/[0.1] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div>
            <p className="text-sm font-black text-[#F4F6FA]">{mode==='transfer'?'Transfer Funds':'Withdraw'}</p>
            <p className="text-[10px] text-[#374151]">{mode==='transfer'?'Move balance between accounts instantly':'Send funds to external Solana wallet'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refreshBalances} disabled={refreshing} className="text-[10px] text-[#4B5563] hover:text-[#2BFFF1] transition-all p-1" title="Refresh balances">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={refreshing?'animate-spin':''}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            </button>
            <button onClick={onClose} className="text-[#4B5563] hover:text-[#A7B0B7] p-1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-white/[0.06] flex-shrink-0">
          {(['transfer','withdraw'] as const).map(m=>(
            <button key={m} onClick={()=>setMode(m)} className={`flex-1 py-2 text-[11px] font-bold capitalize transition-all ${mode===m?'text-[#2BFFF1] border-b-2 border-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>{m}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Balance overview */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide">Wallet Balances</p>
            {WALLETS.map(w=>(
              <div key={w.id} className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${w.live?'bg-[#2BFFF1]':'bg-[#374151]'}`}/>
                  <span className="text-[#A7B0B7] text-xs">{w.label}</span>
                </div>
                <span className="font-mono font-bold text-[#F4F6FA] text-xs">${getBalance(account,w.id).toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Transfer form */}
          {mode==='transfer'&&(<>
            <WalletSelect label="From" value={from} onChange={setFrom}/>
            <div className="flex justify-center">
              <button onClick={()=>{const t=from;setFrom(to);setTo(t);}} className="p-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.05] transition-all">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
              </button>
            </div>
            <WalletSelect label="To" value={to} onChange={setTo}/>
            <div>
              <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">Amount</label>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-1.5 bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-[#2BFFF1]/40">
                  <span className="text-[#374151]">$</span>
                  <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" className="flex-1 bg-transparent text-sm font-mono text-[#F4F6FA] outline-none" style={{minWidth:0}}/>
                </div>
                <button onClick={()=>setAmount(fromBalance.toFixed(2))} className="px-3 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#2BFFF1] hover:bg-[#2BFFF1]/10 transition-all">MAX</button>
              </div>
              <p className="text-[9px] text-[#374151] mt-1">Available: {fmtUsd(fromBalance)}</p>
            </div>
            {msg&&<div className={`rounded-xl px-3 py-2 text-xs font-semibold ${msg.includes('failed')||msg.includes('Insufficient')||msg.includes('valid')||msg.includes('same')||msg.includes('share')?'text-red-400 bg-red-500/10 border border-red-500/15':'text-green-400 bg-green-500/10 border border-green-500/15'}`}>{msg}</div>}

            {confirmTransfer&&(
              <div className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/08 p-3 space-y-2">
                <p className="text-xs font-bold text-[#F59E0B]">Confirm Transfer</p>
                <p className="text-[10px] text-[#A7B0B7]">Move <strong className="text-[#F4F6FA]">{fmtUsd(amt)}</strong> from <strong className="text-[#F4F6FA]">{WALLETS.find(w=>w.id===from)?.label}</strong> to <strong className="text-[#F4F6FA]">{WALLETS.find(w=>w.id===to)?.label}</strong></p>
                {WALLETS.find(w=>w.id===from)?.live&&<p className="text-[9px] text-[#F59E0B]">This moves real funds between your internal wallets.</p>}
                <div className="flex gap-2">
                  <button onClick={()=>setConfirmTransfer(false)} className="flex-1 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#A7B0B7]">Cancel</button>
                  <button onClick={()=>{setConfirmTransfer(false);transfer();}} className="flex-1 py-2 rounded-xl text-xs font-bold bg-[#2BFFF1]/20 text-[#2BFFF1] border border-[#2BFFF1]/30">Confirm</button>
                </div>
              </div>
            )}
            {!confirmTransfer&&(
              <button onClick={()=>{if(amt>0&&amt<=fromBalance){setConfirmTransfer(true);}else{transfer();}}} disabled={saving||amt<=0||amt>fromBalance}
                className="w-full py-3 rounded-xl text-sm font-black bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
                {saving?<span className="flex items-center justify-center gap-2"><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"/>Transferring…</span>:`Transfer ${amt>0?fmtUsd(amt):''}`}
              </button>
            )}
          </>)}

          {/* Withdraw form */}
          {mode==='withdraw'&&(
            <>
              <div>
                <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">From Wallet</label>
                <select value={wdFrom} onChange={e=>setWdFrom(e.target.value as Wallet)} className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40">
                  {WALLETS.filter(w=>w.live).map(w=>(<option key={w.id} value={w.id}>{w.label} — ${getBalance(account,w.id).toFixed(2)}</option>))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">Destination Address</label>
                <input type="text" value={wdAddress} onChange={e=>setWdAddress(e.target.value)} placeholder="Solana wallet address (Base58)" className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-[#F4F6FA] outline-none font-mono focus:border-[#2BFFF1]/40 break-all"/>
              </div>
              <div>
                <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">Amount (USDC)</label>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-1.5 bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-[#2BFFF1]/40">
                    <span className="text-[#374151]">$</span>
                    <input type="number" value={wdAmount} onChange={e=>setWdAmount(e.target.value)} placeholder="0.00" className="flex-1 bg-transparent text-sm font-mono text-[#F4F6FA] outline-none" style={{minWidth:0}}/>
                  </div>
                  <button onClick={()=>setWdAmount(getBalance(account,wdFrom).toFixed(2))} className="px-3 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#2BFFF1] hover:bg-[#2BFFF1]/10 transition-all">MAX</button>
                </div>
                <p className="text-[9px] text-[#374151] mt-1">Available: {fmtUsd(getBalance(account,wdFrom))} · Network fee ~$0.02</p>
              </div>
              {wdMsg&&<div className={`rounded-xl px-3 py-2 text-xs font-semibold ${wdMsg.includes('failed')||wdMsg.includes('Insufficient')||wdMsg.includes('valid')?'text-red-400 bg-red-500/10 border border-red-500/15':'text-green-400 bg-green-500/10 border border-green-500/15'}`}>{wdMsg}</div>}

              {confirmWd&&(
                <div className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/08 p-3 space-y-2">
                  <p className="text-xs font-bold text-[#F59E0B]">Confirm Withdrawal</p>
                  <p className="text-[10px] text-[#A7B0B7]">Withdraw <strong className="text-[#F4F6FA]">{fmtUsd(parseFloat(wdAmount)||0)}</strong> to:</p>
                  <p className="font-mono text-[10px] text-[#2BFFF1] break-all">{wdAddress}</p>
                  <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-2 py-1.5">
                    <p className="text-[9px] text-red-400 font-semibold">This sends real funds on-chain. Double-check the address — this action is irreversible.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={()=>setConfirmWd(false)} className="flex-1 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#A7B0B7]">Cancel</button>
                    <button onClick={()=>{setConfirmWd(false);withdraw();}} className="flex-1 py-2 rounded-xl text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">Confirm Withdraw</button>
                  </div>
                </div>
              )}
              {!confirmWd&&(
                <button onClick={()=>{const a=parseFloat(wdAmount);if(a>0&&wdAddress.trim()){setConfirmWd(true);}else{withdraw();}}} disabled={wdSaving||!wdAddress||!wdAmount||parseFloat(wdAmount)<=0}
                  className="w-full py-3 rounded-xl text-sm font-black bg-orange-500/15 text-orange-400 border border-orange-500/25 hover:bg-orange-500/25 transition-all disabled:opacity-40">
                  {wdSaving?<span className="flex items-center justify-center gap-2"><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"/>Withdrawing…</span>:`Withdraw ${parseFloat(wdAmount)>0?fmtUsd(parseFloat(wdAmount)):''}`}
                </button>
              )}
            </>
          )}

          {/* History */}
          {history.length>0&&(
            <div>
              <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide mb-2">Recent {mode==='withdraw'?'Withdrawals':'Transfers'}</p>
              {history.map(h=>(
                <div key={h.id} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0 text-[10px]">
                  <span className="text-[#6B7280]">{WALLETS.find(w=>w.id===h.from_wallet)?.label??h.from_wallet} → {WALLETS.find(w=>w.id===h.to_wallet)?.label??h.to_wallet}{h.note?` (${h.note})`:''}</span>
                  <span className="font-mono text-[#F4F6FA]">${h.amount}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
