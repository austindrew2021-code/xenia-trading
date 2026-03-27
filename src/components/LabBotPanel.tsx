/**
 * LabBotPanel — shows active Lab bots for a given target (spot|leverage|both)
 * Used in SpotTradingPage and the Leverage trade section
 */
import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

interface LabBot {
  id: string; name: string; description: string; status: string;
  target: string; indicators: any[]; candle_patterns: string[];
  entry_rules: any; exit_rules: any; win_rate: number|null; total_pnl: number;
}

interface Props {
  target: 'spot' | 'leverage';
  isMock?: boolean;
  compact?: boolean;
}

export function LabBotPanel({ target, isMock=true, compact=false }: Props) {
  const { user } = useAuth();
  const [bots,    setBots]    = useState<LabBot[]>([]);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !user) { setLoading(false); return; }
    supabase.from('custom_bots')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .then(({ data }) => {
        const filtered = (data ?? []).filter((b: any) =>
          b.target === target || b.target === 'both'
        );
        setBots(filtered as LabBot[]);
        setLoading(false);
      });
  }, [user?.id, target]);

  // Listen for new bots being deployed
  useEffect(() => {
    const handler = () => {
      if (!supabase || !user) return;
      supabase.from('custom_bots').select('*').eq('user_id', user.id).eq('status','active')
        .then(({ data }) => setBots((data ?? []).filter((b:any) => b.target===target||b.target==='both') as LabBot[]));
    };
    window.addEventListener('xenia:bot-created', handler);
    return () => window.removeEventListener('xenia:bot-created', handler);
  }, [user?.id, target]);

  const toggleBot = (id: string) => {
    setRunning(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  if (loading) return null;
  if (!user) return null;
  if (!bots.length) return (
    <div className={`border-t border-white/[0.05] ${compact?'px-3 py-2':'p-3'}`}>
      <p className="text-[9px] text-[#374151]">No active Lab bots for {target}. Deploy one in The Lab.</p>
    </div>
  );

  return (
    <div className={`border-t border-white/[0.05] ${compact?'':'p-3'} space-y-1.5`}>
      <div className={`flex items-center justify-between ${compact?'px-3 pt-2':'pb-1'}`}>
        <p className="text-[9px] text-[#4B5563] font-semibold uppercase tracking-wide">
          Your Lab Bots · {target.charAt(0).toUpperCase()+target.slice(1)}
        </p>
        <span className="text-[8px] text-[#374151]">{isMock?'Mock':'Live'}</span>
      </div>
      {bots.map(b => (
        <div key={b.id} className={`flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] ${compact?'mx-3 px-2.5 py-2':'px-2.5 py-2'}`}>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-[#F4F6FA] truncate">{b.name}</p>
            <p className="text-[9px] text-[#4B5563]">
              {b.indicators?.length ?? 0} ind
              {b.win_rate != null && ` · ${(b.win_rate*100).toFixed(0)}% WR`}
              {b.total_pnl !== 0 && ` · ${b.total_pnl>=0?'+':''}$${Math.abs(b.total_pnl).toFixed(0)}`}
            </p>
          </div>
          <button
            onClick={() => toggleBot(b.id)}
            className={`flex-shrink-0 ml-2 px-2.5 py-1.5 rounded-lg text-[9px] font-bold transition-all border ${
              running.has(b.id)
                ? 'bg-[#2BFFF1]/15 text-[#2BFFF1] border-[#2BFFF1]/30'
                : 'border-white/[0.08] text-[#4B5563] hover:text-[#A7B0B7] hover:border-white/20'
            }`}>
            {running.has(b.id) ? (
              <span className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-[#2BFFF1] animate-pulse"/>Running
              </span>
            ) : 'Start'}
          </button>
        </div>
      ))}
    </div>
  );
}
