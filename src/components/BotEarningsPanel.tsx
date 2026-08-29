import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  getAuthorEarnings, getPerBotEarnings, claimEarnings, getFeeHistory,
  PLATFORM_FEE_PCT, type AuthorEarnings, type BotEarningsRow,
} from '../lib/botFees';

/**
 * Author earnings from public bots. Drop into BotLabPage's Market tab, or give
 * it its own tab.
 *
 * The copy here is deliberately careful about one thing: claiming moves fees
 * into the tradable balance. It is not a withdrawal — the SOL is in the user's
 * own wallet and getting it out is a separate on-chain step. Calling this
 * "paid" would be the kind of small wording choice that becomes a support
 * problem later.
 */
export function BotEarningsPanel() {
  const { user, refreshBalance } = useAuth();
  const [earnings, setEarnings] = useState<AuthorEarnings|null>(null);
  const [perBot,   setPerBot]   = useState<BotEarningsRow[]>([]);
  const [history,  setHistory]  = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [msg,      setMsg]      = useState('');
  const [showHist, setShowHist] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const [e, p, h] = await Promise.all([
      getAuthorEarnings(user.id), getPerBotEarnings(user.id), getFeeHistory(user.id, 30),
    ]);
    setEarnings(e); setPerBot(p); setHistory(h); setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const claim = async () => {
    if (!user || !earnings || earnings.claimableUsd <= 0) return;
    setClaiming(true); setMsg('');
    try {
      const got = await claimEarnings(user.id);
      setMsg(`$${got.toFixed(2)} moved to your tradable balance.`);
      await refreshBalance().catch(() => {});
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setClaiming(false);
  };

  if (!user) return null;

  if (loading) return (
    <div className="flex items-center justify-center py-8 gap-2 text-[#4B5563]">
      <div className="w-4 h-4 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>
      <span className="text-xs">Loading earnings…</span>
    </div>
  );

  const nothingYet = (earnings?.earnedUsd ?? 0) === 0;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-black text-[#F4F6FA]">Bot Earnings</p>
          <p className="text-[10px] text-[#4B5563]">Fees from others using your public bots</p>
        </div>
        <button onClick={load} className="text-[9px] text-[#374151] hover:text-[#6B7280] px-2 py-1 rounded border border-white/[0.05]">Refresh</button>
      </div>

      {nothingYet ? (
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-4 text-center">
          <p className="text-xs text-[#4B5563]">No earnings yet</p>
          <p className="text-[10px] text-[#374151] mt-1 leading-snug">
            You earn a fee only when someone else runs your public bot in live mode
            and it closes a profitable trade. Mock runs and losing trades are never charged.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Earned',    earnings!.earnedUsd,    '#F4F6FA'],
              ['Claimed',   earnings!.withdrawnUsd, '#6B7280'],
              ['Claimable', earnings!.claimableUsd, '#4ADE80'],
            ].map(([l, v, c]) => (
              <div key={l as string} className="rounded-xl bg-[#05060B] border border-white/[0.06] px-3 py-2.5">
                <p className="text-[9px] text-[#4B5563]">{l as string}</p>
                <p className="text-sm font-bold font-mono" style={{ color: c as string }}>${(v as number).toFixed(2)}</p>
              </div>
            ))}
          </div>

          <button onClick={claim} disabled={claiming || (earnings!.claimableUsd <= 0)}
            className="w-full py-2.5 rounded-xl text-xs font-black bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all disabled:opacity-30">
            {claiming ? 'Moving…' : `Move $${earnings!.claimableUsd.toFixed(2)} to tradable balance`}
          </button>
          <p className="text-[9px] text-[#374151] leading-snug">
            This moves fees into your Xenia balance. It is not an on-chain withdrawal —
            use the Wallet screen to send funds out.
          </p>
          {msg && <p className="text-[10px] text-[#2BFFF1]">{msg}</p>}

          {perBot.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-white/[0.05]">
              <p className="text-[9px] text-[#4B5563] uppercase tracking-wide font-semibold">By bot</p>
              {perBot.map(b => (
                <div key={b.sourceBotId} className="flex items-center justify-between text-[10px]">
                  <span className="text-[#6B7280] font-mono truncate max-w-[45%]">{b.sourceBotId.slice(0, 8)}…</span>
                  <span className="text-[#4B5563]">{b.payingFollowers} user{b.payingFollowers !== 1 ? 's' : ''} · {b.chargedTrades} trades</span>
                  <span className="font-bold text-green-400">${b.authorFeesUsd.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          <button onClick={() => setShowHist(v => !v)} className="text-[10px] text-[#4B5563] hover:text-[#A7B0B7] underline">
            {showHist ? 'Hide' : 'Show'} fee history ({history.length})
          </button>
          {showHist && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between text-[9px] py-1 border-b border-white/[0.03]">
                  <span className={h.role === 'author' ? 'text-green-400' : 'text-[#F59E0B]'}>
                    {h.role === 'author' ? 'Earned' : 'Paid'}
                  </span>
                  <span className="text-[#4B5563]">on ${h.grossProfitUsd.toFixed(2)} profit</span>
                  <span className="font-mono text-[#A7B0B7]">
                    ${(h.role === 'author' ? h.authorFeeUsd : h.authorFeeUsd + h.platformFeeUsd).toFixed(2)}
                  </span>
                  <span className="text-[#374151]">{new Date(h.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="text-[9px] text-[#374151] leading-snug pt-1 border-t border-white/[0.05]">
        Fees apply to profits only, in live mode only, and never when you run your own bot.
        Xenia takes {(PLATFORM_FEE_PCT * 100).toFixed(1)}% on top of your rate.
      </p>
    </div>
  );
}
