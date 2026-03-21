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
  return parseFloat(account[field]??0);
}

interface Props { onClose: () => void; defaultFrom?: Wallet; defaultTo?: Wallet; }

export function WalletTransfer({ onClose, defaultFrom, defaultTo }: Props) {
  const { user, account, saveAccount } = useAuth();
  const [from,      setFrom]      = useState<Wallet>(defaultFrom ?? 'funding');
  const [to,        setTo]        = useState<Wallet>(defaultTo ?? 'spot_mock');
  const [amount,    setAmount]    = useState('');
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState('');
  const [history,   setHistory]   = useState<any[]>([]);

  const fromBalance = getBalance(account, from);
  const amt = parseFloat(amount)||0;
  const fmtUsd = (n:number) => `$${Math.abs(n).toFixed(2)}`;

  const loadHistory = useCallback(async()=>{
    if(!supabase||!user) return;
    const {data}=await supabase.from('wallet_transfers').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(10);
    setHistory(data??[]);
  },[user]);

  useEffect(()=>{loadHistory();},[loadHistory]);

  const transfer = async () => {
    if(!supabase||!user||!account||amt<=0||amt>fromBalance){
      setMsg(amt>fromBalance?`Insufficient balance (${fmtUsd(fromBalance)} available)`:'Enter a valid amount');
      return;
    }
    if(from===to){setMsg('Cannot transfer to the same wallet');return;}
    setSaving(true); setMsg('');

    // Update balances locally
    const fromField = WALLET_FIELD_MAP[from];
    const toField   = WALLET_FIELD_MAP[to];
    const patch: any = {
      [fromField]: Math.max(0, getBalance(account,from) - amt),
      [toField]:   getBalance(account,to) + amt,
    };
    await saveAccount(patch);

    // Log transfer
    await supabase.from('wallet_transfers').insert({ user_id:user.id, from_wallet:from, to_wallet:to, amount:amt, is_mock:!WALLETS.find(w=>w.id===from)?.live, note:'' });

    setMsg(`Transferred ${fmtUsd(amt)} from ${WALLETS.find(w=>w.id===from)?.label} to ${WALLETS.find(w=>w.id===to)?.label}`);
    setAmount(''); await loadHistory();
    setSaving(false);
    setTimeout(()=>setMsg(''),3000);
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
            <p className="text-sm font-black text-[#F4F6FA]">Transfer Funds</p>
            <p className="text-[10px] text-[#374151]">Move balance between accounts instantly</p>
          </div>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#A7B0B7] p-1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* All balances */}
          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-1.5">
            {WALLETS.map(w=>(
              <div key={w.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${w.live?'bg-[#2BFFF1]':'bg-[#374151]'}`}/>
                  <span className="text-[#A7B0B7]">{w.label}</span>
                </div>
                <span className="font-mono font-bold text-[#F4F6FA]">${getBalance(account,w.id).toFixed(2)}</span>
              </div>
            ))}
          </div>

          <WalletSelect value={from} onChange={setFrom} label="From"/>

          {/* Swap arrow */}
          <div className="flex justify-center">
            <button onClick={()=>{const t=from;setFrom(to);setTo(t);}} className="w-8 h-8 rounded-xl border border-white/[0.08] flex items-center justify-center text-[#4B5563] hover:text-[#2BFFF1] hover:border-[#2BFFF1]/30 transition-all">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="7 16 3 12 7 8"/><polyline points="17 8 21 12 17 16"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
            </button>
          </div>

          <WalletSelect value={to} onChange={setTo} label="To"/>

          {/* Amount */}
          <div>
            <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">Amount (USD)</label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-1.5 bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-[#2BFFF1]/40">
                <span className="text-[#374151]">$</span>
                <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00"
                  className="flex-1 bg-transparent text-sm font-mono text-[#F4F6FA] outline-none" style={{minWidth:0}}/>
              </div>
              <button onClick={()=>setAmount(fromBalance.toFixed(2))} className="px-3 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#2BFFF1] hover:bg-[#2BFFF1]/10 transition-all">MAX</button>
            </div>
            <p className="text-[9px] text-[#374151] mt-1">Available: {fmtUsd(fromBalance)}</p>
          </div>

          {msg&&<div className={`rounded-xl px-3 py-2 text-xs font-semibold ${msg.includes('Error')||msg.includes('Cannot')||msg.includes('Insufficient')?'text-red-400 bg-red-500/10 border border-red-500/15':'text-green-400 bg-green-500/10 border border-green-500/15'}`}>{msg}</div>}

          <button onClick={transfer} disabled={saving||amt<=0||amt>fromBalance}
            className="w-full py-3 rounded-xl text-sm font-black bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
            {saving?<span className="flex items-center justify-center gap-2"><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"/>Transferring…</span>:`Transfer ${amt>0?fmtUsd(amt):''}`}
          </button>

          {/* History */}
          {history.length>0&&(
            <div>
              <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide mb-2">Recent Transfers</p>
              {history.map(h=>(
                <div key={h.id} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0 text-[10px]">
                  <span className="text-[#6B7280]">{WALLETS.find(w=>w.id===h.from_wallet)?.label} → {WALLETS.find(w=>w.id===h.to_wallet)?.label}</span>
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
