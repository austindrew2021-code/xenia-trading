import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';
type Wallet = 'funding'|'spot_live'|'spot_mock'|'leverage_live'|'leverage_mock'|'bot_live'|'bot_mock';

const WALLETS: {id:Wallet;label:string;live:boolean}[] = [
  {id:'funding',label:'Funding',live:true},{id:'spot_live',label:'Spot (Live)',live:true},
  {id:'spot_mock',label:'Spot (Mock)',live:false},{id:'leverage_live',label:'Leverage (Live)',live:true},
  {id:'leverage_mock',label:'Leverage (Mock)',live:false},{id:'bot_live',label:'Bots (Live)',live:true},
  {id:'bot_mock',label:'Bots (Mock)',live:false},
];
const FIELD: Record<Wallet,string> = {
  funding:'real_balance',spot_live:'spot_live_balance',spot_mock:'mock_balance',
  leverage_live:'real_balance',leverage_mock:'mock_balance',bot_live:'bot_balance',bot_mock:'bot_mock_balance',
};

interface Props { onClose:()=>void; defaultFrom?:Wallet; defaultTo?:Wallet; }

export function WalletTransfer({ onClose, defaultFrom, defaultTo }: Props) {
  const { user, account, saveAccount, refreshBalance, liveSOL, liveSOLUSD } = useAuth();
  const [mode, setMode] = useState<'deposit'|'transfer'|'send'>('transfer');
  const [from, setFrom] = useState<Wallet>(defaultFrom ?? 'funding');
  const [to, setTo]     = useState<Wallet>(defaultTo ?? 'spot_live');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState('');
  const [history, setHistory] = useState<any[]>([]);

  // Send state
  const [sendAddr, setSendAddr]     = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sending, setSending]       = useState(false);
  const [sendMsg, setSendMsg]       = useState('');
  const [sendStep, setSendStep]     = useState('');
  const [txHash, setTxHash]         = useState('');
  const [confirmSend, setConfirmSend] = useState(false);

  // Deposit state
  const [depositAddr, setDepositAddr] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`;

  // Platform balance — uses on-chain SOL for funding, DB for others
  function bal(w: Wallet): number {
    if (!account) return 0;
    const dbVal = parseFloat(account[FIELD[w] as keyof typeof account] as any ?? 0) || 0;
    if ((w === 'funding' || w === 'leverage_live') && liveSOLUSD > 0) return Math.max(liveSOLUSD, dbVal);
    return dbVal;
  }

  const totalLive = bal('funding') + bal('spot_live') + bal('bot_live');
  const totalMock = bal('spot_mock') + bal('leverage_mock') + bal('bot_mock');
  const fb = bal(from);
  const amt = parseFloat(amount) || 0;

  const loadHist = useCallback(async () => {
    if (!supabase || !user) return;
    const { data } = await supabase.from('wallet_transfers').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(15);
    setHistory(data ?? []);
  }, [user]);

  useEffect(() => { refreshBalance(); loadHist(); }, [refreshBalance, loadHist]);

  // ── Load deposit address ──────────────────────────────────────────────
  const loadDeposit = async () => {
    if (!user || depositAddr) return;
    setDepositLoading(true);
    try {
      // Try from account first
      const addr = account?.platform_wallet_address || account?.deposit_wallets?.sol;
      if (addr) { setDepositAddr(addr); setDepositLoading(false); return; }
      // Generate via edge function
      const { data: { session } } = await supabase!.auth.getSession();
      const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-deposit-wallets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: '{}',
      });
      const d = await r.json();
      setDepositAddr(d.sol ?? '');
    } catch { setDepositAddr('Error loading address'); }
    setDepositLoading(false);
  };

  useEffect(() => { if (mode === 'deposit') loadDeposit(); }, [mode]);

  // ── Internal transfer (DB-first) ──────────────────────────────────────
  const transfer = async () => {
    if (!supabase || !user || !account) return;
    if (amt <= 0) { setMsg('Enter an amount'); return; }
    if (amt > fb) { setMsg(`Insufficient — ${fmt(fb)} available`); return; }
    if (from === to) { setMsg('Same wallet'); return; }
    if (FIELD[from] === FIELD[to]) { setMsg('Same balance pool'); return; }
    setSaving(true); setMsg('');
    try {
      const { data: fresh } = await supabase.from('trading_accounts')
        .select('real_balance,mock_balance,spot_live_balance,bot_balance,bot_mock_balance')
        .eq('user_id', user.id).single();
      if (!fresh) throw new Error('Account not found');
      const ff = FIELD[from], tf = FIELD[to];
      const fv = parseFloat((fresh as any)[ff] ?? 0) || 0;
      // For funding wallet, use max of DB and on-chain
      const actualFrom = (ff === 'real_balance' && liveSOLUSD > fv) ? liveSOLUSD : fv;
      if (amt > actualFrom) { setMsg(`Insufficient — ${fmt(actualFrom)} available`); setSaving(false); return; }
      const patch: any = { [ff]: Math.max(0, actualFrom - amt), [tf]: (parseFloat((fresh as any)[tf] ?? 0) || 0) + amt };
      await supabase.from('trading_accounts').update(patch).eq('user_id', user.id);
      await supabase.from('wallet_transfers').insert({ user_id: user.id, from_wallet: from, to_wallet: to, amount: amt, is_mock: !WALLETS.find(w => w.id === from)?.live, note: '' });
      await refreshBalance();
      setMsg(`✅ Transferred ${fmt(amt)} → ${WALLETS.find(w => w.id === to)?.label}`);
      setAmount(''); await loadHist();
    } catch (e: any) { setMsg(e.message ?? 'Transfer failed'); }
    setSaving(false); setTimeout(() => setMsg(''), 5000);
  };

  // ── Send SOL (server-side — platform hot wallet signs) ────────────────
  const send = async () => {
    const amtUsd = parseFloat(sendAmount) || 0;
    const dest = sendAddr.trim();
    if (!user || !account) { setSendMsg('Not signed in'); return; }
    if (!dest || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(dest)) { setSendMsg('Invalid Solana address'); return; }
    if (amtUsd <= 0) { setSendMsg('Enter an amount'); return; }
    const available = bal('funding');
    if (amtUsd > available) { setSendMsg(`Insufficient — ${fmt(available)} in Funding`); return; }

    setSending(true); setSendMsg(''); setTxHash(''); setSendStep('Submitting withdrawal…');
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const tok = session?.access_token ?? '';
      if (!tok) throw new Error('Session expired — sign in again');

      const r = await fetch(`${SUPABASE_URL}/functions/v1/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ fromWallet: 'funding', toAddress: dest, amount: amtUsd, userId: user.id }),
      });
      const d = await r.json();

      if (!r.ok) {
        throw new Error(d.error ?? 'Withdrawal failed. The platform processes sends from the hot wallet — ensure the withdraw edge function is deployed.');
      }

      if (d.txHash) setTxHash(d.txHash);
      await refreshBalance();
      await supabase!.from('wallet_transfers').insert({
        user_id: user.id, from_wallet: 'funding', to_wallet: 'external',
        amount: amtUsd, is_mock: false,
        note: `To:${dest.slice(0,8)}…${d.txHash ? ' Tx:'+d.txHash.slice(0,12) : ''}`,
      });
      setSendMsg(`✅ Sent ${fmt(amtUsd)}${d.txHash ? ' · Tx: '+d.txHash.slice(0,16)+'…' : ''}`);
      setSendAmount(''); setSendAddr(''); await loadHist();
    } catch (e: any) { setSendMsg(e.message ?? 'Send failed'); }
    setSending(false); setSendStep('');
  };

  // ── UI ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-3" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[#0B0E14] border border-white/[0.1] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div>
            <p className="text-sm font-black text-[#F4F6FA]">Wallet</p>
            <p className="text-[10px] text-[#374151]">
              Live: {fmt(totalLive)} · Mock: {fmt(totalMock)}
              {liveSOL > 0 && <span className="text-[#2BFFF1]"> · {liveSOL.toFixed(4)} SOL</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => refreshBalance()} className="text-[#4B5563] hover:text-[#2BFFF1] p-1" title="Refresh">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            </button>
            <button onClick={onClose} className="text-[#4B5563] hover:text-[#A7B0B7] p-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Tabs: Deposit · Transfer · Send */}
        <div className="flex border-b border-white/[0.06] flex-shrink-0">
          {(['deposit','transfer','send'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-2.5 text-[11px] font-bold capitalize transition-all ${mode === m ? 'text-[#2BFFF1] border-b-2 border-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
              {m}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── Balances overview ────────────────────────── */}
          <div className="space-y-1">
            <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide mb-1">Wallet Balances</p>
            {WALLETS.map(w => (
              <div key={w.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${w.live ? 'bg-[#2BFFF1]' : 'bg-[#374151]'}`}/>
                  <span className="text-xs text-[#A7B0B7]">{w.label}</span>
                </div>
                <span className="font-mono font-bold text-[#F4F6FA] text-xs">${bal(w.id).toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* ═══════ DEPOSIT ═══════ */}
          {mode === 'deposit' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#2BFFF1]/20 bg-[#2BFFF1]/05 p-4 space-y-3">
                <p className="text-xs font-bold text-[#2BFFF1]">Deposit SOL</p>
                <p className="text-[10px] text-[#A7B0B7]">Send SOL to your platform wallet address below. Deposits are auto-detected and credited to your Funding balance.</p>
                {depositLoading ? (
                  <div className="flex items-center gap-2 py-3"><div className="w-4 h-4 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/><span className="text-xs text-[#4B5563]">Loading address…</span></div>
                ) : depositAddr ? (
                  <div className="space-y-2">
                    <div className="bg-[#05060B] border border-white/[0.08] rounded-xl p-3">
                      <p className="font-mono text-xs text-[#2BFFF1] break-all select-all">{depositAddr}</p>
                    </div>
                    <button onClick={() => { navigator.clipboard.writeText(depositAddr); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                      className="w-full py-2.5 rounded-xl border border-[#2BFFF1]/25 text-xs font-bold text-[#2BFFF1] hover:bg-[#2BFFF1]/10 transition-all">
                      {copied ? '✓ Copied to clipboard' : 'Copy Deposit Address'}
                    </button>
                  </div>
                ) : (
                  <button onClick={loadDeposit} className="w-full py-2.5 rounded-xl border border-[#2BFFF1]/25 text-xs font-bold text-[#2BFFF1] hover:bg-[#2BFFF1]/10">
                    Load Deposit Address
                  </button>
                )}
                <div className="rounded-lg bg-[#F59E0B]/08 border border-[#F59E0B]/15 px-3 py-2">
                  <p className="text-[9px] text-[#F59E0B]/80">Only send <strong>SOL</strong> on the <strong>Solana</strong> network. Other tokens/chains will be lost.</p>
                </div>
              </div>
              {liveSOL > 0 && (
                <div className="rounded-xl bg-green-500/08 border border-green-500/20 px-3 py-2">
                  <p className="text-[10px] text-green-400 font-semibold">On-chain: {liveSOL.toFixed(4)} SOL (${liveSOLUSD.toFixed(2)})</p>
                </div>
              )}
            </div>
          )}

          {/* ═══════ TRANSFER ═══════ */}
          {mode === 'transfer' && (<>
            <div>
              <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">From</label>
              <select value={from} onChange={e => setFrom(e.target.value as Wallet)}
                className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40">
                {WALLETS.map(w => <option key={w.id} value={w.id}>{w.label} — ${bal(w.id).toFixed(2)}</option>)}
              </select>
            </div>
            <div className="flex justify-center">
              <button onClick={() => { const t = from; setFrom(to); setTo(t); }}
                className="p-2 rounded-lg border border-white/[0.08] hover:bg-white/[0.05] transition-all">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="2"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
              </button>
            </div>
            <div>
              <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">To</label>
              <select value={to} onChange={e => setTo(e.target.value as Wallet)}
                className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40">
                {WALLETS.map(w => <option key={w.id} value={w.id}>{w.label} — ${bal(w.id).toFixed(2)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">Amount</label>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-1.5 bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-[#2BFFF1]/40">
                  <span className="text-[#374151]">$</span>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
                    className="flex-1 bg-transparent text-sm font-mono text-[#F4F6FA] outline-none" style={{ minWidth: 0 }}/>
                </div>
                <button onClick={() => setAmount(fb.toFixed(2))}
                  className="px-3 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#2BFFF1] hover:bg-[#2BFFF1]/10 transition-all">MAX</button>
              </div>
              <p className="text-[9px] text-[#374151] mt-1">Available: {fmt(fb)}</p>
            </div>

            {msg && <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${msg.startsWith('✅') ? 'text-green-400 bg-green-500/10 border border-green-500/15' : 'text-red-400 bg-red-500/10 border border-red-500/15'}`}>{msg}</div>}

            <button onClick={() => { if (amt > 0 && amt <= fb) transfer(); else setMsg(amt > fb ? `Insufficient — ${fmt(fb)} available` : 'Enter an amount'); }}
              disabled={saving || amt <= 0}
              className="w-full py-3 rounded-xl text-sm font-black bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
              {saving
                ? <span className="flex items-center justify-center gap-2"><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"/>Transferring…</span>
                : `Transfer ${amt > 0 ? fmt(amt) : ''}`}
            </button>

            {/* Quick transfer shortcuts */}
            {bal('funding') > 0 && (
              <div className="space-y-1.5">
                <p className="text-[9px] text-[#374151] uppercase tracking-wide font-semibold">Quick Transfer from Funding</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {[{w:'spot_live' as Wallet,l:'→ Spot'},{w:'leverage_live' as Wallet,l:'→ Leverage'},{w:'bot_live' as Wallet,l:'→ Bots'}].map(({w,l}) => (
                    <button key={w} onClick={() => { setFrom('funding'); setTo(w); }}
                      className={`py-2 rounded-xl border text-[10px] font-bold transition-all ${to === w && from === 'funding' ? 'border-[#2BFFF1]/40 bg-[#2BFFF1]/10 text-[#2BFFF1]' : 'border-white/[0.06] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>)}

          {/* ═══════ SEND ═══════ */}
          {mode === 'send' && (<>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="text-[10px] text-[#A7B0B7] leading-relaxed">
                Send SOL from your <strong className="text-[#F4F6FA]">Funding wallet</strong> to any Solana address.
                The platform signs and broadcasts the transaction — no external wallet needed.
              </p>
              <p className="text-xs font-mono font-bold text-[#2BFFF1] mt-2">Available: {fmt(bal('funding'))}</p>
              {liveSOL > 0 && <p className="text-[9px] text-[#374151] mt-0.5">{liveSOL.toFixed(4)} SOL on-chain</p>}
            </div>

            {bal('funding') <= 0 && (
              <div className="rounded-xl bg-[#F59E0B]/08 border border-[#F59E0B]/20 px-3 py-2.5">
                <p className="text-xs font-bold text-[#F59E0B]">No funds to send</p>
                <p className="text-[10px] text-[#F59E0B]/70 mt-1">Deposit SOL to your platform wallet first. Go to the <button onClick={() => setMode('deposit')} className="underline font-bold">Deposit</button> tab to get your address.</p>
              </div>
            )}

            <div>
              <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">Recipient Address</label>
              <input type="text" value={sendAddr} onChange={e => setSendAddr(e.target.value)} placeholder="Solana wallet address (Base58)"
                className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-[#F4F6FA] outline-none font-mono focus:border-[#2BFFF1]/40 break-all"/>
            </div>
            <div>
              <label className="text-[10px] text-[#4B5563] block mb-1 font-semibold uppercase tracking-wide">Amount (USD)</label>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-1.5 bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-[#2BFFF1]/40">
                  <span className="text-[#374151]">$</span>
                  <input type="number" value={sendAmount} onChange={e => setSendAmount(e.target.value)} placeholder="0.00"
                    className="flex-1 bg-transparent text-sm font-mono text-[#F4F6FA] outline-none" style={{ minWidth: 0 }}/>
                </div>
                <button onClick={() => setSendAmount(Math.max(0, bal('funding') - 0.01).toFixed(2))}
                  className="px-3 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#2BFFF1] hover:bg-[#2BFFF1]/10">MAX</button>
              </div>
              <p className="text-[9px] text-[#374151] mt-1">Network fee ~$0.01 SOL · Min send: $0.10</p>
            </div>

            {sendStep && <div className="rounded-xl px-3 py-2 text-[10px] font-semibold text-[#2BFFF1] bg-[#2BFFF1]/05 border border-[#2BFFF1]/15 flex items-center gap-2"><div className="w-3 h-3 border-2 border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>{sendStep}</div>}
            {sendMsg && <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${sendMsg.startsWith('✅') ? 'text-green-400 bg-green-500/10 border border-green-500/15' : 'text-red-400 bg-red-500/10 border border-red-500/15'}`}>{sendMsg}</div>}
            {txHash && <a href={`https://solscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-[#2BFFF1] hover:underline truncate">View on Solscan: {txHash.slice(0, 24)}… →</a>}

            {confirmSend ? (
              <div className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/08 p-3 space-y-2">
                <p className="text-xs font-bold text-[#F59E0B]">Confirm Send</p>
                <p className="text-[10px] text-[#A7B0B7]">Send <strong className="text-[#F4F6FA]">{fmt(parseFloat(sendAmount) || 0)}</strong> of SOL to:</p>
                <p className="font-mono text-[10px] text-[#2BFFF1] break-all">{sendAddr}</p>
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-2 py-1.5">
                  <p className="text-[9px] text-red-400 font-semibold">⚠️ This is a real on-chain transaction. It cannot be reversed. Double-check the address.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmSend(false)} className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs font-bold text-[#A7B0B7]">Cancel</button>
                  <button onClick={() => { setConfirmSend(false); send(); }}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/25">Confirm Send</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  const a = parseFloat(sendAmount) || 0;
                  if (a <= 0 || !sendAddr.trim()) { send(); return; }
                  setConfirmSend(true);
                }}
                disabled={sending || bal('funding') <= 0}
                className="w-full py-3 rounded-xl text-sm font-black bg-orange-500/15 text-orange-400 border border-orange-500/25 hover:bg-orange-500/25 transition-all disabled:opacity-40">
                {sending
                  ? <span className="flex items-center justify-center gap-2"><div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin"/>Sending…</span>
                  : `Send ${parseFloat(sendAmount) > 0 ? fmt(parseFloat(sendAmount)) : 'SOL'}`}
              </button>
            )}
          </>)}

          {/* ── Transaction History ───────────────────────── */}
          {history.length > 0 && (
            <div>
              <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-wide mb-2">Recent Activity</p>
              <div className="space-y-0">
                {history.map(h => (
                  <div key={h.id} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${h.to_wallet === 'external' ? 'bg-orange-500/20 text-orange-400' : 'bg-[#2BFFF1]/15 text-[#2BFFF1]'}`}>
                        {h.to_wallet === 'external' ? '↗' : '↔'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-[#A7B0B7] truncate">
                          {WALLETS.find(w => w.id === h.from_wallet)?.label ?? h.from_wallet} → {WALLETS.find(w => w.id === h.to_wallet)?.label ?? (h.to_wallet === 'external' ? 'External' : h.to_wallet)}
                        </p>
                        {h.note && <p className="text-[8px] text-[#374151] truncate">{h.note}</p>}
                      </div>
                    </div>
                    <span className="font-mono font-bold text-[#F4F6FA] text-xs flex-shrink-0">${h.amount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
