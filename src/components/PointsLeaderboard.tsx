import { useEffect, useState } from 'react';
import { supabase, currentMonth, getLevel, getLevelProgress, getNextLevel, LEVEL_TIERS } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

interface PointsRow {
  user_id: string;
  username: string | null;
  points: number;
  volume_usd: number;
  trades_count: number;
}

// ── Mini points badge shown in the header ──────────────────────────────────
export function PointsBadge() {
  const { account } = useAuth();
  // Read directly from the account JSONB — no extra Supabase query
  const pts = account?.monthly_points?.[currentMonth()]?.points ?? 0;

  if (!account) return null;

  const tier = getLevel(pts);
  const prog = getLevelProgress(pts);
  const next = getNextLevel(pts);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <span className="text-xs font-bold" style={{ color: tier.color }}>Lv.{tier.level}</span>
      <div className="w-20 h-1 rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full transition-all" style={{ width: `${prog}%`, background: tier.color }} />
      </div>
      <span className="text-[10px] text-[#4B5563]">{pts.toLocaleString()} pts</span>
    </div>
  );
}

// ── Full leaderboard panel ─────────────────────────────────────────────────
export function PointsLeaderboard() {
  const { user } = useAuth();
  const [rows, setRows]   = useState<PointsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRow, setMyRow] = useState<PointsRow | null>(null);
  const month = currentMonth();

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    // Read from single account row — monthly_points JSONB column
    supabase.from('public_leaderboard')
      .select('user_id,username,monthly_points')
      .then(({ data }) => {
        const list: PointsRow[] = ((data as any[]) ?? [])
          .map(r => {
            const mp = r.monthly_points?.[month] ?? { points: 0, volume: 0, trades: 0 };
            return { user_id: r.user_id, username: r.username, points: mp.points, volume_usd: mp.volume, trades_count: mp.trades };
          })
          .filter(r => r.points > 0)
          .sort((a, b) => b.points - a.points)
          .slice(0, 50);
        setRows(list);
        if (user) setMyRow(list.find(r => r.user_id === user.id) ?? null);
        setLoading(false);
      });
  }, [user, month]);

  const monthLabel = new Date(month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div>
          <p className="text-xs font-bold text-[#F4F6FA]">Volume Leaderboard</p>
          <p className="text-[10px] text-[#4B5563]">{monthLabel} · Resets monthly</p>
        </div>
        <div className="flex items-center gap-1 text-[9px] text-[#4B5563] bg-[#2BFFF1]/10 border border-[#2BFFF1]/20 rounded-full px-2 py-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          LIVE
        </div>
      </div>

      {/* Level tiers reference */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-2.5 mb-3 flex-shrink-0">
        <p className="text-[9px] text-[#4B5563] uppercase tracking-wide mb-2">Level Tiers</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {LEVEL_TIERS.map(t => (
            <div key={t.level} className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold w-4" style={{ color: t.color }}>L{t.level}</span>
              <span className="text-[9px] text-[#6B7280]">{t.label}</span>
              <span className="text-[9px] text-[#374151] ml-auto">{t.min.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* My rank */}
      {myRow && (
        <div className="rounded-xl border border-[#2BFFF1]/25 bg-[#2BFFF1]/05 p-3 mb-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#2BFFF1]">#{rows.indexOf(myRow) + 1}</span>
              <span className="text-xs text-[#F4F6FA] font-semibold">{myRow.username ?? 'You'}</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{
                color: getLevel(myRow.points).color,
                background: getLevel(myRow.points).color + '20',
              }}>{getLevel(myRow.points).label}</span>
            </div>
            <span className="text-xs font-bold text-[#2BFFF1]">{myRow.points.toLocaleString()} pts</span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full" style={{
              width: `${getLevelProgress(myRow.points)}%`,
              background: getLevel(myRow.points).color,
            }} />
          </div>
          {getNextLevel(myRow.points) && (
            <p className="text-[9px] text-[#4B5563] mt-1">
              {(getNextLevel(myRow.points)!.min - myRow.points).toLocaleString()} pts to {getNextLevel(myRow.points)!.label}
            </p>
          )}
        </div>
      )}

      {/* Board */}
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-[#4B5563] text-xs">No trades this month yet</div>
        ) : rows.map((r, i) => {
          const tier = getLevel(r.points);
          const isMe = user && r.user_id === user.id;
          const medals: Record<number,string> = { 1:'🥇', 2:'🥈', 3:'🥉' };
          return (
            <div key={r.user_id}
              className={`rounded-xl px-3 py-2.5 border transition-all ${isMe ? 'border-[#2BFFF1]/20 bg-[#2BFFF1]/05' : 'border-white/[0.05] bg-white/[0.015]'}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm w-6 text-center">{medals[i+1] ?? <span className="text-[11px] text-[#4B5563] font-bold">{i+1}</span>}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[#F4F6FA] truncate">{r.username ?? '—'}</span>
                    <span className="text-[9px] font-bold" style={{ color: tier.color }}>Lv.{tier.level}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] text-[#4B5563]">Vol ${r.volume_usd.toLocaleString('en',{maximumFractionDigits:0})}</span>
                    <span className="text-[9px] text-[#4B5563]">·</span>
                    <span className="text-[9px] text-[#4B5563]">{r.trades_count} trades</span>
                  </div>
                </div>
                <span className="text-xs font-bold" style={{ color: tier.color }}>{r.points.toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
