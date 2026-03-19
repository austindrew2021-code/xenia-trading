import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, currentMonth, POINTS_PER_USD } from '../lib/supabase';
import { Position } from '../types';

// ── What we store in Supabase (one row per user) ──────────────────────────
interface AccountStats {
  totalPnl:   number;
  winCount:   number;
  lossCount:  number;
  tradeCount: number;
}

interface MonthPoints {
  points:   number;
  volume:   number;
  trades:   number;
}

interface DepositRecord {
  txHash:    string;
  amountUsd: number;
  asset:     string;
  chain:     string;
  status:    'pending' | 'confirmed';
  createdAt: number;
}

export interface TradingAccount {
  id:            string;
  user_id:       string;
  username:      string | null;
  mock_balance:  number;
  real_balance:  number;
  use_real:      boolean;
  sol_address:   string | null;
  evm_address:   string | null;
  positions:     Position[];
  stats:         AccountStats;
  monthly_points: Record<string, MonthPoints>;
  deposits:      DepositRecord[];
  deposit_wallets: Record<string,string>;
}

interface AuthCtx {
  user:    User | null;
  session: Session | null;
  account: TradingAccount | null;
  loading: boolean;
  signUp:       (email: string, password: string, username: string) => Promise<string | null>;
  signIn:       (email: string, password: string) => Promise<string | null>;
  signOut:      () => Promise<void>;
  saveAccount:  (patch: Partial<TradingAccount>) => Promise<void>;
  syncPositions:(positions: Position[]) => void;
  recordTrade:  (notionalUsd: number, pnl: number, won: boolean) => void;
  connectWallet:(type: 'sol' | 'evm', address: string) => void;
  addDeposit:   (txHash: string, amountUsd: number, asset: string, chain: string) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be inside AuthProvider');
  return c;
}

// ── Debounce helper — batches rapid writes into one ───────────────────────
function useDebounce(fn: (...args: any[]) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  return useCallback((...args: any[]) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), ms);
  }, [fn, ms]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<TradingAccount | null>(null);
  const [loading, setLoading] = useState(true);

  // Local pending state — accumulated between debounced writes
  const pending = useRef<Partial<TradingAccount>>({});

  // ── Flush pending changes to Supabase — ONE update call ────────────────
  const flush = useCallback(async (uid: string, patch: Partial<TradingAccount>) => {
    if (!supabase || Object.keys(patch).length === 0) return;
    await supabase
      .from('trading_accounts')
      .update(patch)
      .eq('user_id', uid);
  }, []);

  // Debounced flush — waits 2s after last change before writing
  const debouncedFlush = useDebounce(
    (uid: string, patch: Partial<TradingAccount>) => {
      flush(uid, patch);
      pending.current = {};
    },
    2000
  );

  // ── Queue a change locally + schedule debounced write ─────────────────
  const queue = useCallback((patch: Partial<TradingAccount>) => {
    if (!user) return;
    pending.current = { ...pending.current, ...patch };
    setAccount(prev => prev ? { ...prev, ...patch } : prev);
    debouncedFlush(user.id, pending.current);
  }, [user, debouncedFlush]);

  // ── Fetch account from Supabase ────────────────────────────────────────
  const fetchAccount = useCallback(async (uid: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('trading_accounts')
      .select('*')
      .eq('user_id', uid)
      .single();
    if (data) {
      setAccount({
        ...data,
        positions:      data.positions      ?? [],
        stats:          data.stats          ?? { totalPnl:0, winCount:0, lossCount:0, tradeCount:0 },
        monthly_points: data.monthly_points ?? {},
        deposits:       data.deposits       ?? [],
      } as TradingAccount);
    }
  }, []);

  // ── Auth listener ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        fetchAccount(data.session.user.id).then(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) fetchAccount(sess.user.id);
      else { setAccount(null); }
    });

    return () => subscription.unsubscribe();
  }, [fetchAccount]);

  // ── Auth actions ───────────────────────────────────────────────────────
  const signUp = async (email: string, password: string, username: string): Promise<string | null> => {
    if (!supabase) return 'Supabase not configured';
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    if (data.user) {
      await supabase.from('trading_accounts').insert({
        user_id:        data.user.id,
        username,
        mock_balance:   1000,
        real_balance:   0,
        positions:      [],
        stats:          { totalPnl:0, winCount:0, lossCount:0, tradeCount:0 },
        monthly_points: {},
        deposits:       [],
      });
      await fetchAccount(data.user.id);
    }
    return null;
  };

  const signIn = async (email: string, password: string): Promise<string | null> => {
    if (!supabase) return 'Supabase not configured';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  };

  const signOut = async () => {
    if (!supabase) return;
    // Flush any pending writes before signing out
    if (user && Object.keys(pending.current).length > 0) {
      await flush(user.id, pending.current);
      pending.current = {};
    }
    await supabase.auth.signOut();
    setAccount(null);
  };

  // ── Direct save (immediate, bypasses debounce) ─────────────────────────
  const saveAccount = async (patch: Partial<TradingAccount>) => {
    if (!user || !supabase) return;
    setAccount(prev => prev ? { ...prev, ...patch } : prev);
    await supabase.from('trading_accounts').update(patch).eq('user_id', user.id);
  };

  // ── Sync positions — debounced ─────────────────────────────────────────
  // Called after every open/close — batches rapid bot activity into one write
  const syncPositions = useCallback((positions: Position[]) => {
    // Keep only last 100 closed + all open to cap JSONB size
    const open   = positions.filter(p => p.status === 'open');
    const closed = positions.filter(p => p.status !== 'open').slice(-100);
    queue({ positions: [...open, ...closed] });
  }, [queue]);

  // ── Record trade stats + points — debounced ───────────────────────────
  // Accumulates into the existing monthly_points and stats, then queues one write
  const recordTrade = useCallback((notionalUsd: number, pnl: number, won: boolean) => {
    if (!account) return;
    const month = currentMonth();
    const pts   = Math.floor(notionalUsd * POINTS_PER_USD);

    const prevMonth = account.monthly_points[month] ?? { points: 0, volume: 0, trades: 0 };
    const newMonthly = {
      ...account.monthly_points,
      [month]: {
        points:  prevMonth.points  + pts,
        volume:  prevMonth.volume  + notionalUsd,
        trades:  prevMonth.trades  + 1,
      },
    };

    const prevStats = account.stats;
    const newStats: AccountStats = {
      totalPnl:   prevStats.totalPnl   + pnl,
      winCount:   prevStats.winCount   + (won ? 1 : 0),
      lossCount:  prevStats.lossCount  + (won ? 0 : 1),
      tradeCount: prevStats.tradeCount + 1,
    };

    queue({ monthly_points: newMonthly, stats: newStats });
  }, [account, queue]);

  // ── Connect wallet — immediate write ──────────────────────────────────
  const connectWallet = useCallback((type: 'sol' | 'evm', address: string) => {
    const patch = type === 'sol'
      ? { sol_address: address }
      : { evm_address: address };
    queue(patch);
  }, [queue]);

  // ── Add deposit — immediate write ─────────────────────────────────────
  const addDeposit = async (txHash: string, amountUsd: number, asset: string, chain: string) => {
    if (!account || !user || !supabase) return;
    const newDeposit: DepositRecord = {
      txHash, amountUsd, asset, chain, status: 'pending', createdAt: Date.now(),
    };
    const newDeposits = [...account.deposits, newDeposit];
    const newBalance  = account.real_balance + amountUsd;
    // Immediate write for financial data
    await saveAccount({ deposits: newDeposits, real_balance: newBalance });
  };

  return (
    <Ctx.Provider value={{
      user, session, account, loading,
      signUp, signIn, signOut, saveAccount,
      syncPositions, recordTrade, connectWallet, addDeposit,
    }}>
      {children}
    </Ctx.Provider>
  );
}
