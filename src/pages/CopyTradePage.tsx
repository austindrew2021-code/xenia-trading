import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';
const COPY_FEE_PCT = 0.1; // 10% of profits go to Xenia

interface Trader {
  id: string;
  user_id: string;
  display_name: string;
  bio: string;
  win_rate: number;
  total_pnl: number;
  monthly_pnl: number;
  follower_count: number;
  copy_fee_pct: number;
  is_active: boolean;
  verified: boolean;
}

interface Sub {
  id: string;
  trader_id: string;
  copy_amount_usd: number;
  is_active: boolean;
  is_mock: boolean;
  total_pnl: number;
  fees_paid: number;
  trader: Trader;
}

function StatBadge({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className="text-[9px] text-[#4B5563] mb-0.5">{label}</p>
      <p className="text-xs font-bold font-mono" style={{ color: color ?? '#F4F6FA' }}>{value}</p>
    </div>
  );
}

// Become a trader panel
function BecomeTrader({ userId }: { userId: string }) {
  const [displayName, setDisplayName] = useState('');
  const [bio,         setBio]         = useState('');
  const [feePct,      setFeePct]      = useState('5');
  const [saving,      setSaving]      = useState(false);
  const [done,        setDone]        = useState(false);
  const [msg,         setMsg]         = useState('');

  const submit = async () => {
    if (!supabase || !displayName.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('copy_traders').insert({
      user_id: userId, display_name: displayName.trim(), bio: bio.trim(),
      copy_fee_pct: parseFloat(feePct) / 100,
    });
    if (error) setMsg('Error: ' + error.message);
    else setDone(true);
    setSaving(false);
  };

  if (done) return (
    <div className="rounded-2xl border border-green-500/20 bg-green-500/05 p-5 text-center">
      <svg className="mx-auto mb-2 text-green-400" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <p className="text-sm font-bold text-green-400">You're listed as a copy trader!</p>
      <p className="text-[10px] text-[#6B7280] mt-1">Others can now follow your trades.</p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-[#F4F6FA]">Become a Copy Trader</p>
        <p className="text-[10px] text-[#4B5563]">Let others follow your trades. Earn fees on their profits.</p>
      </div>
      <input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Display name"
        className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40"/>
      <textarea value={bio} onChange={e=>setBio(e.target.value)} placeholder="Short bio — your strategy, experience…"
        rows={2} className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 resize-none"/>
      <div>
        <label className="text-[10px] text-[#4B5563] block mb-1">Your fee on followers' profits (%)</label>
        <div className="flex gap-1.5">
          {[0,5,10,15,20].map(f => (
            <button key={f} onClick={() => setFeePct(String(f))}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${feePct===String(f)?'bg-[#2BFFF1]/15 text-[#2BFFF1] border-[#2BFFF1]/30':'border-white/[0.07] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
              {f}%
            </button>
          ))}
        </div>
      </div>
      {msg && <p className="text-[10px] text-red-400">{msg}</p>}
      <div className="rounded-xl bg-[#F59E0B]/05 border border-[#F59E0B]/20 px-3 py-2">
        <p className="text-[10px] text-[#F59E0B]/80">Xenia collects an additional 10% of all copy-trade profits to fund platform development.</p>
      </div>
      <button onClick={submit} disabled={saving||!displayName.trim()}
        className="w-full py-2.5 rounded-xl text-sm font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
        {saving ? 'Creating profile…' : 'List as Copy Trader'}
      </button>
    </div>
  );
}

export function CopyTradePage() {
  const { user, account } = useAuth();
  const [tab,      setTab]      = useState<'discover'|'following'|'become'>('discover');
  const [traders,  setTraders]  = useState<Trader[]>([]);
  const [subs,     setSubs]     = useState<Sub[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [copyAmt,  setCopyAmt]  = useState<Record<string,string>>({});
  const [isMock,   setIsMock]   = useState(true);
  const [following,setFollowing]= useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [tr, sb] = await Promise.all([
      supabase.from('copy_traders').select('*').eq('is_active', true).order('monthly_pnl', { ascending: false }).limit(20),
      user ? supabase.from('copy_subscriptions').select('*, trader:copy_traders(*)').eq('follower_id', user.id) : Promise.resolve({ data: [] }),
    ]);
    // Add mock traders if DB is empty
    const mockTraders: Trader[] = [
      { id:'mock1', user_id:'', display_name:'SolWhale', bio:'ICT methodology, swing trades only. 3+ years on-chain.', win_rate:0.72, total_pnl:184200, monthly_pnl:28400, follower_count:847, copy_fee_pct:0.1, is_active:true, verified:true },
      { id:'mock2', user_id:'', display_name:'PumpKing', bio:'Pump.fun sniper. Fast entries, faster exits. Scalper.', win_rate:0.61, total_pnl:92100, monthly_pnl:15600, follower_count:423, copy_fee_pct:0.05, is_active:true, verified:true },
      { id:'mock3', user_id:'', display_name:'DegenAlpha', bio:'High risk high reward. 50-300x leverage. DYOR.', win_rate:0.55, total_pnl:210000, monthly_pnl:41000, follower_count:1204, copy_fee_pct:0.15, is_active:true, verified:false },
      { id:'mock4', user_id:'', display_name:'XeniaBot7', bio:'Bot-assisted momentum trading. Automated entries.', win_rate:0.68, total_pnl:67000, monthly_pnl:9800, follower_count:312, copy_fee_pct:0.08, is_active:true, verified:true },
    ];
    const all = [...(tr.data ?? []), ...mockTraders.filter(m => !(tr.data ?? []).some((r: any) => r.id === m.id))];
    setTraders(all);
    setSubs((sb.data ?? []) as any);
    setFollowing(new Set((sb.data ?? []).map((s: any) => s.trader_id)));
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const follow = async (trader: Trader) => {
    if (!supabase || !user) return;
    const amt = parseFloat(copyAmt[trader.id] || '100');
    if (isNaN(amt) || amt <= 0) return;
    await supabase.from('copy_subscriptions').upsert({
      follower_id: user.id, trader_id: trader.user_id || trader.id,
      copy_amount_usd: amt, is_active: true, is_mock: isMock,
    });
    setFollowing(prev => new Set([...prev, trader.id]));
    await load();
  };

  const unfollow = async (traderId: string) => {
    if (!supabase || !user) return;
    await supabase.from('copy_subscriptions').update({ is_active: false }).eq('follower_id', user.id).eq('trader_id', traderId);
    setFollowing(prev => { const s = new Set(prev); s.delete(traderId); return s; });
    await load();
  };

  const fmtUsd = (n: number) => n >= 1000 ? `$${(n/1000).toFixed(1)}K` : `$${n.toFixed(0)}`;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#05060B]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
        <div className="flex-1">
          <p className="text-sm font-black text-[#F4F6FA]">Copy Trading</p>
          <p className="text-[10px] text-[#374151]">Mirror top traders automatically</p>
        </div>
        <button onClick={() => setIsMock(m => !m)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[11px] font-black transition-all ${isMock?'border-white/[0.1] text-[#6B7280]':'border-[#2BFFF1]/50 bg-[#2BFFF1]/15 text-[#2BFFF1]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isMock?'bg-[#374151]':'bg-[#2BFFF1] animate-pulse'}`}/>
          {isMock ? 'Mock' : 'Live'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.05] flex-shrink-0">
        {(['discover','following','become'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[11px] font-semibold capitalize transition-all ${tab===t?'text-[#2BFFF1] border-b-2 border-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {t === 'discover' ? 'Discover' : t === 'following' ? `Following (${subs.filter(s=>s.is_active).length})` : 'Become a Trader'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* DISCOVER */}
        {tab === 'discover' && (
          <div className="p-4 space-y-3">
            <div className="rounded-xl border border-[#2BFFF1]/15 bg-[#2BFFF1]/05 px-4 py-3">
              <p className="text-xs font-semibold text-[#2BFFF1]">How Copy Trading works</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">Set your copy amount. When a trader opens a position, Xenia opens an equivalent position for you automatically. Fees: trader's % of your profits + 10% to Xenia.</p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10 gap-2 text-[#4B5563]">
                <div className="w-5 h-5 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>
                <span className="text-xs">Loading traders…</span>
              </div>
            ) : traders.map(t => (
              <div key={t.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#2BFFF1]/20 to-[#A78BFA]/20 border border-white/[0.1] flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-black text-[#2BFFF1]">{t.display_name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-[#F4F6FA]">{t.display_name}</span>
                      {t.verified && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="#2BFFF1"><path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg>
                      )}
                      <span className="text-[9px] text-[#4B5563] ml-auto">{t.follower_count} followers</span>
                    </div>
                    <p className="text-[10px] text-[#6B7280] mt-0.5 truncate">{t.bio}</p>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 py-2 border-y border-white/[0.05]">
                  <StatBadge label="Win Rate" value={`${(t.win_rate*100).toFixed(0)}%`} color={t.win_rate>=0.6?'#4ADE80':'#F59E0B'}/>
                  <StatBadge label="30d PnL"  value={fmtUsd(t.monthly_pnl)} color={t.monthly_pnl>=0?'#4ADE80':'#F87171'}/>
                  <StatBadge label="Total"    value={fmtUsd(t.total_pnl)} color={t.total_pnl>=0?'#4ADE80':'#F87171'}/>
                  <StatBadge label="Fee"      value={`${(t.copy_fee_pct*100).toFixed(0)}%`}/>
                </div>

                {following.has(t.id) ? (
                  <button onClick={() => unfollow(t.id)}
                    className="w-full py-2 rounded-xl text-xs font-bold text-red-400 border border-red-500/25 hover:bg-red-500/10 transition-all">
                    Unfollow
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex items-center gap-1.5 flex-1 bg-[#05060B] border border-white/[0.08] rounded-xl px-2.5 py-1.5 focus-within:border-[#2BFFF1]/40">
                      <span className="text-[#374151] text-xs">$</span>
                      <input type="number" placeholder="Copy amount" value={copyAmt[t.id]??''} onChange={e=>setCopyAmt(prev=>({...prev,[t.id]:e.target.value}))}
                        className="flex-1 bg-transparent text-xs text-[#F4F6FA] outline-none" style={{minWidth:0}}/>
                    </div>
                    <button onClick={() => follow(t)} disabled={!user}
                      className="px-4 py-1.5 rounded-xl text-xs font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-40">
                      {user ? 'Follow' : 'Sign in'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* FOLLOWING */}
        {tab === 'following' && (
          <div className="p-4 space-y-3">
            {subs.length === 0 ? (
              <div className="text-center py-12">
                <svg className="mx-auto opacity-20 mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                <p className="text-sm text-[#4B5563]">Not following anyone yet</p>
                <button onClick={() => setTab('discover')} className="mt-3 text-xs text-[#2BFFF1] underline">Discover traders</button>
              </div>
            ) : subs.map(s => (
              <div key={s.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-[#F4F6FA]">{(s.trader as any)?.display_name ?? 'Trader'}</p>
                    <p className="text-[10px] text-[#4B5563]">Allocated: ${s.copy_amount_usd} · {s.is_mock?'Mock':'Live'}</p>
                  </div>
                  <div className={`text-sm font-bold ${s.total_pnl>=0?'text-green-400':'text-red-400'}`}>{s.total_pnl>=0?'+':''}{fmtUsd(s.total_pnl)}</div>
                </div>
                <div className="flex justify-between text-[9px] text-[#4B5563]">
                  <span>Fees paid: ${s.fees_paid.toFixed(2)}</span>
                  <span className={`font-semibold ${s.is_active?'text-green-400':'text-[#374151]'}`}>{s.is_active?'Active':'Paused'}</span>
                </div>
                <button onClick={() => unfollow(s.trader_id)}
                  className="w-full py-1.5 rounded-xl text-[10px] font-bold text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all">
                  Stop Copying
                </button>
              </div>
            ))}
          </div>
        )}

        {/* BECOME */}
        {tab === 'become' && (
          <div className="p-4">
            {user ? <BecomeTrader userId={user.id}/> : (
              <div className="text-center py-12">
                <p className="text-sm text-[#4B5563]">Sign in to become a copy trader</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
