import { useState, useEffect, useCallback } from 'react';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { ALCHEMY_RPC, fetchSOLPrice } from '../hooks/useSolanaBalance';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';
type Wallet = 'funding'|'spot_live'|'spot_mock'|'leverage_live'|'leverage_mock'|'bot_live'|'bot_mock';
const WALLETS: {id:Wallet;label:string;live:boolean}[] = [
  {id:'funding',label:'Funding',live:true},{id:'spot_live',label:'Spot (Live)',live:true},
  {id:'spot_mock',label:'Spot (Mock)',live:false},{id:'leverage_live',label:'Leverage (Live)',live:true},
  {id:'leverage_mock',label:'Leverage (Mock)',live:false},{id:'bot_live',label:'Bots (Live)',live:true},
  {id:'bot_mock',label:'Bots (Mock)',live:false},
];
const FIELD: Record<Wallet,string> = {funding:'real_balance',spot_live:'spot_live_balance',spot_mock:'mock_balance',leverage_live:'real_balance',leverage_mock:'mock_balance',bot_live:'bot_balance',bot_mock:'bot_mock_balance'};

function getProvider() { return (window as any).phantom?.solana ?? (window as any).solana ?? (window as any).solflare ?? null; }

interface Props { onClose:()=>void; defaultFrom?:Wallet; defaultTo?:Wallet; }

export function WalletTransfer({ onClose, defaultFrom, defaultTo }: Props) {
  const { user, account, saveAccount, refreshBalance, liveSOL, liveSOLUSD } = useAuth();
  const [mode, setMode] = useState<'transfer'|'withdraw'>('transfer');
  const [from, setFrom] = useState<Wallet>(defaultFrom ?? 'funding');
  const [to, setTo] = useState<Wallet>(defaultTo ?? 'spot_mock');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [wdFrom, setWdFrom] = useState<Wallet>('funding');
  const [wdAddress, setWdAddress] = useState('');
  const [wdAmount, setWdAmount] = useState('');
  const [wdSaving, setWdSaving] = useState(false);
  const [wdMsg, setWdMsg] = useState('');
  const [wdStep, setWdStep] = useState('');
  const [confirmT, setConfirmT] = useState(false);
  const [confirmW, setConfirmW] = useState(false);
  const [txHash, setTxHash] = useState('');
  const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`;

  // Use liveSOLUSD as authoritative balance for funding wallet (fixes 0 balance bug)
  function bal(w: Wallet): number {
    if (!account) return 0;
    // For funding/leverage_live: use on-chain balance if available (it's the source of truth)
    if ((w === 'funding' || w === 'leverage_live') && liveSOLUSD > 0) return liveSOLUSD;
    return parseFloat(account[FIELD[w] as keyof typeof account] as any ?? 0) || 0;
  }

  const fb = bal(from);
  const amt = parseFloat(amount) || 0;

  const loadHist = useCallback(async () => {
    if (!supabase || !user) return;
    const { data } = await supabase.from('wallet_transfers').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10);
    setHistory(data ?? []);
  }, [user]);

  useEffect(() => { refreshBalance(); loadHist(); }, [refreshBalance, loadHist]);

  // ── Transfer (DB-first) ───────────────────────────────────────────────
  const transfer = async () => {
    if (!supabase || !user || !account || amt <= 0) { setMsg('Enter a valid amount'); return; }
    if (amt > fb) { setMsg(`Insufficient (${fmt(fb)} available)`); return; }
    if (from === to) { setMsg('Same wallet'); return; }
    if (FIELD[from] === FIELD[to]) { setMsg('Same balance pool'); return; }
    setSaving(true); setMsg('');
    try {
      const { data: fresh } = await supabase.from('trading_accounts').select('real_balance,mock_balance,spot_live_balance,bot_balance,bot_mock_balance').eq('user_id', user.id).single();
      if (!fresh) throw new Error('Account not found');
      const ff = FIELD[from], tf = FIELD[to];
      const fv = parseFloat((fresh as any)[ff] ?? 0) || 0;
      // For funding, also consider liveSOLUSD
      const actualFrom = (ff === 'real_balance' && liveSOLUSD > fv) ? liveSOLUSD : fv;
      if (amt > actualFrom) { setMsg(`Insufficient (${fmt(actualFrom)})`); setSaving(false); return; }
      const patch: any = { [ff]: Math.max(0, actualFrom - amt), [tf]: (parseFloat((fresh as any)[tf] ?? 0) || 0) + amt };
      await supabase.from('trading_accounts').update(patch).eq('user_id', user.id);
      await supabase.from('wallet_transfers').insert({ user_id: user.id, from_wallet: from, to_wallet: to, amount: amt, is_mock: !WALLETS.find(w => w.id === from)?.live, note: '' });
      await refreshBalance();
      setMsg(`✅ ${fmt(amt)} → ${WALLETS.find(w => w.id === to)?.label}`);
      setAmount(''); await loadHist();
    } catch (e: any) { setMsg(e.message ?? 'Failed'); }
    setSaving(false); setTimeout(() => setMsg(''), 4000);
  };

  // ── Withdraw (reads fresh DB balance for validation) ──────────────────
  const withdraw = async () => {
    const amtUsd = parseFloat(wdAmount) || 0;
    const dest = wdAddress.trim();
    if (!user || !account) { setWdMsg('Not signed in'); return; }
    if (!dest || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(dest)) { setWdMsg('Invalid Solana address'); return; }
    if (amtUsd <= 0) { setWdMsg('Enter an amount'); return; }

    // Read FRESH balance from DB + on-chain to validate
    let availableUsd = 0;
    if (FIELD[wdFrom] === 'real_balance') {
      // Funding wallet: use on-chain SOL as source of truth
      availableUsd = liveSOLUSD > 0 ? liveSOLUSD : (account.real_balance ?? 0);
    } else {
      // Other wallets: read from DB
      try {
        const { data: fresh } = await supabase!.from('trading_accounts').select(FIELD[wdFrom]).eq('user_id', user.id).single();
        availableUsd = parseFloat((fresh as any)?.[FIELD[wdFrom]] ?? 0) || 0;
      } catch {
        availableUsd = bal(wdFrom);
      }
    }

    if (amtUsd > availableUsd) { setWdMsg(`Insufficient — ${fmt(availableUsd)} available`); return; }

    setWdSaving(true); setWdMsg(''); setTxHash(''); setWdStep('Preparing…');

    try {
      // Path A: server-side withdraw
      const { data: { session } } = await supabase!.auth.getSession();
      const tok = session?.access_token ?? '';
      let ok = false;

      if (tok) {
        setWdStep('Server withdraw…');
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/withdraw`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
            body: JSON.stringify({ fromWallet: wdFrom, toAddress: dest, amount: amtUsd, userId: user.id }),
          });
          const d = await r.json();
          if (r.ok && d.txHash) {
            ok = true; setTxHash(d.txHash);
            await refreshBalance();
            setWdMsg(`✅ Sent! Tx: ${d.txHash.slice(0, 16)}…`);
            await supabase!.from('wallet_transfers').insert({ user_id: user.id, from_wallet: wdFrom, to_wallet: 'external', amount: amtUsd, is_mock: false, note: `To:${dest.slice(0, 8)}… Tx:${d.txHash.slice(0, 12)}` });
            setWdAmount(''); setWdAddress(''); await loadHist();
          }
        } catch {}
      }

      // Path B: client-side Phantom sign
      if (!ok) {
        const prov = getProvider();
        if (!prov) throw new Error('Install Phantom wallet or fund your platform wallet for server-side withdrawals.');
        setWdStep('Connecting wallet…');
        if (!prov.isConnected) try { await prov.connect(); } catch { throw new Error('Cancelled'); }
        const pk = prov.publicKey;
        if (!pk) throw new Error('No wallet');

        const price = await fetchSOLPrice();
        if (price <= 0) throw new Error('Cannot get SOL price');
        const solAmt = amtUsd / price;
        const lam = Math.floor(solAmt * LAMPORTS_PER_SOL);
        if (lam <= 0) throw new Error('Amount too small');

        setWdStep('Checking balance…');
        const conn = new Connection(ALCHEMY_RPC, 'confirmed');
        const wb = await conn.getBalance(pk);
        if (wb < lam + 5000) throw new Error(`Need ${solAmt.toFixed(4)} SOL, have ${(wb / LAMPORTS_PER_SOL).toFixed(4)}`);

        setWdStep('Building tx…');
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: pk, toPubkey: new PublicKey(dest), lamports: lam }));
        tx.recentBlockhash = blockhash; tx.lastValidBlockHeight = lastValidBlockHeight; tx.feePayer = pk;

        setWdStep('Sign in wallet…');
        const signed = await prov.signTransaction(tx);
        setWdStep('Broadcasting…');
        const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
        setWdStep('Confirming…');
        await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        setTxHash(sig);

        // Deduct from DB
        const { data: fa } = await supabase!.from('trading_accounts').select('real_balance,mock_balance,spot_live_balance,bot_balance,bot_mock_balance').eq('user_id', user.id).single();
        if (fa) { const nv = Math.max(0, (parseFloat((fa as any)[FIELD[wdFrom]] ?? 0) || 0) - amtUsd); await supabase!.from('trading_accounts').update({ [FIELD[wdFrom]]: nv }).eq('user_id', user.id); }
        await refreshBalance();
        await supabase!.from('wallet_transfers').insert({ user_id: user.id, from_wallet: wdFrom, to_wallet: 'external', amount: amtUsd, is_mock: false, note: `To:${dest.slice(0, 8)}… Tx:${sig.slice(0, 12)}` });
        setWdMsg(`✅ Sent ${solAmt.toFixed(4)} SOL ($${amtUsd.toFixed(2)})`);
        setWdAmount(''); setWdAddress(''); await loadHist();
      }
    } catch (e: any) { setWdMsg(e.message ?? 'Failed'); }
    setWdSaving(false); setWdStep('');
  };

  // ── UI ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-3" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[#0B0E14] border border-white/[0.1] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div><p className="text-sm font-black text-[#F4F6FA]">{mode === 'transfer' ? 'Transfer' : 'Send SOL'}</p><p className="text-[10px] text-[#374151]">{mode === 'transfer' ? 'Move between wallets' : 'On-chain transfer'}</p></div>
          <div className="flex gap-2">
            <button onClick={() => refreshBalance()} className="text-[#4B5563] hover:text-[#2BFFF1] p-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button>
            <button onClick={onClose} className="text-[#4B5563] hover:text-[#A7B0B7] p-1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>
        <div className="flex border-b border-white/[0.06] flex-shrink-0">{(['transfer', 'withdraw'] as const).map(m => (<button key={m} onClick={() => setMode(m)} className={`flex-1 py-2 text-[11px] font-bold capitalize ${mode === m ? 'text-[#2BFFF1] border-b-2 border-[#2BFFF1]' : 'text-[#4B5563]'}`}>{m === 'withdraw' ? 'Send' : m}</button>))}</div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Balances */}
          <div className="space-y-1">
            <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide">Balances</p>
            {WALLETS.map(w => (
              <div key={w.id} className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-white/[0.02]">
                <div className="flex items-center gap-2"><span className={`w-1.5 h-1.5 rounded-full ${w.live ? 'bg-[#2BFFF1]' : 'bg-[#374151]'}`}/><span className="text-[#A7B0B7] text-xs">{w.label}</span></div>
                <span className="font-mono font-bold text-[#F4F6FA] text-xs">${bal(w.id).toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Transfer */}
          {mode === 'transfer' && (<>
            <div><label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase">From</label><select value={from} onChange={e => setFrom(e.target.value as Wallet)} className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none">{WALLETS.map(w => <option key={w.id} value={w.id}>{w.label} — ${bal(w.id).toFixed(2)}</option>)}</select></div>
            <div className="flex justify-center"><button onClick={() => { const t = from; setFrom(to); setTo(t); }} className="p-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.05]"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></button></div>
            <div><label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase">To</label><select value={to} onChange={e => setTo(e.target.value as Wallet)} className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none">{WALLETS.map(w => <option key={w.id} value={w.id}>{w.label} — ${bal(w.id).toFixed(2)}</option>)}</select></div>
            <div><label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase">Amount</label><div className="flex gap-2"><div className="flex-1 flex items-center gap-1.5 bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-[#2BFFF1]/40"><span className="text-[#374151]">$</span><input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="flex-1 bg-transparent text-sm font-mono text-[#F4F6FA] outline-none" style={{ minWidth: 0 }}/></div><button onClick={() => setAmount(fb.toFixed(2))} className="px-3 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#2BFFF1] hover:bg-[#2BFFF1]/10">MAX</button></div><p className="text-[9px] text-[#374151] mt-1">Available: {fmt(fb)}</p></div>
            {msg && <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${msg.startsWith('✅') ? 'text-green-400 bg-green-500/10 border border-green-500/15' : 'text-red-400 bg-red-500/10 border border-red-500/15'}`}>{msg}</div>}
            {confirmT ? (
              <div className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/08 p-3 space-y-2"><p className="text-xs font-bold text-[#F59E0B]">Confirm</p><p className="text-[10px] text-[#A7B0B7]">{fmt(amt)} → <strong className="text-[#F4F6FA]">{WALLETS.find(w => w.id === to)?.label}</strong></p><div className="flex gap-2"><button onClick={() => setConfirmT(false)} className="flex-1 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#A7B0B7]">Cancel</button><button onClick={() => { setConfirmT(false); transfer(); }} className="flex-1 py-2 rounded-xl text-xs font-bold bg-[#2BFFF1]/20 text-[#2BFFF1] border border-[#2BFFF1]/30">Confirm</button></div></div>
            ) : (
              <button onClick={() => amt > 0 && amt <= fb ? setConfirmT(true) : transfer()} disabled={saving || amt <= 0 || amt > fb} className="w-full py-3 rounded-xl text-sm font-black bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 disabled:opacity-40">{saving ? <span className="flex items-center justify-center gap-2"><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"/>…</span> : `Transfer ${amt > 0 ? fmt(amt) : ''}`}</button>
            )}
          </>)}

          {/* Send / Withdraw */}
          {mode === 'withdraw' && (<>
            <div><label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase">From</label><select value={wdFrom} onChange={e => setWdFrom(e.target.value as Wallet)} className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none">{WALLETS.filter(w => w.live).map(w => <option key={w.id} value={w.id}>{w.label} — ${bal(w.id).toFixed(2)}</option>)}</select></div>
            <div><label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase">To Address</label><input type="text" value={wdAddress} onChange={e => setWdAddress(e.target.value)} placeholder="Solana address" className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-[#F4F6FA] outline-none font-mono break-all"/></div>
            <div><label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase">Amount (USD)</label><div className="flex gap-2"><div className="flex-1 flex items-center gap-1.5 bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-[#2BFFF1]/40"><span className="text-[#374151]">$</span><input type="number" value={wdAmount} onChange={e => setWdAmount(e.target.value)} placeholder="0.00" className="flex-1 bg-transparent text-sm font-mono text-[#F4F6FA] outline-none" style={{ minWidth: 0 }}/></div><button onClick={() => setWdAmount(bal(wdFrom).toFixed(2))} className="px-3 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#2BFFF1] hover:bg-[#2BFFF1]/10">MAX</button></div><p className="text-[9px] text-[#374151] mt-1">Available: {fmt(bal(wdFrom))} · Fee ~0.000005 SOL</p></div>
            {wdStep && <div className="rounded-xl px-3 py-2 text-[10px] font-semibold text-[#2BFFF1] bg-[#2BFFF1]/05 border border-[#2BFFF1]/15 flex items-center gap-2"><div className="w-3 h-3 border-2 border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>{wdStep}</div>}
            {wdMsg && <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${wdMsg.startsWith('✅') ? 'text-green-400 bg-green-500/10 border border-green-500/15' : 'text-red-400 bg-red-500/10 border border-red-500/15'}`}>{wdMsg}</div>}
            {txHash && <a href={`https://solscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-[#2BFFF1] hover:underline truncate">View on Solscan →</a>}
            {confirmW ? (
              <div className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/08 p-3 space-y-2"><p className="text-xs font-bold text-[#F59E0B]">Confirm Send</p><p className="text-[10px] text-[#A7B0B7]">{fmt(parseFloat(wdAmount) || 0)} of SOL to:</p><p className="font-mono text-[10px] text-[#2BFFF1] break-all">{wdAddress}</p><div className="rounded-lg bg-red-500/10 border border-red-500/20 px-2 py-1.5"><p className="text-[9px] text-red-400 font-semibold">⚠️ Real on-chain. Irreversible.</p></div><div className="flex gap-2"><button onClick={() => setConfirmW(false)} className="flex-1 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#A7B0B7]">Cancel</button><button onClick={() => { setConfirmW(false); withdraw(); }} className="flex-1 py-2 rounded-xl text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">Send</button></div></div>
            ) : (
              <button onClick={() => { const a = parseFloat(wdAmount); if (a > 0 && wdAddress.trim()) setConfirmW(true); else withdraw(); }} disabled={wdSaving || !wdAddress || !wdAmount || parseFloat(wdAmount) <= 0} className="w-full py-3 rounded-xl text-sm font-black bg-orange-500/15 text-orange-400 border border-orange-500/25 hover:bg-orange-500/25 disabled:opacity-40">{wdSaving ? <span className="flex items-center justify-center gap-2"><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"/>Sending…</span> : `Send ${parseFloat(wdAmount) > 0 ? fmt(parseFloat(wdAmount)) : ''}`}</button>
            )}
            {!getProvider() && !wdSaving && <div className="rounded-xl bg-[#F59E0B]/08 border border-[#F59E0B]/20 px-3 py-2"><p className="text-[10px] text-[#F59E0B]">No Phantom/Solflare. Install a wallet extension for direct sends.</p></div>}
          </>)}

          {history.length > 0 && (<div><p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide mb-2">Recent</p>{history.map(h => (<div key={h.id} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0 text-[10px]"><span className="text-[#6B7280] truncate max-w-[180px]">{WALLETS.find(w => w.id === h.from_wallet)?.label ?? h.from_wallet} → {WALLETS.find(w => w.id === h.to_wallet)?.label ?? h.to_wallet}{h.note ? ` ${h.note}` : ''}</span><span className="font-mono text-[#F4F6FA]">${h.amount}</span></div>))}</div>)}
        </div>
      </div>
    </div>
  );
}
