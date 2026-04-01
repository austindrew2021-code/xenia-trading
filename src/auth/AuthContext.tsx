import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, currentMonth, POINTS_PER_USD } from '../lib/supabase';
import { Position } from '../types';
import { useSolanaBalance } from '../hooks/useSolanaBalance';

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
  id:                 string;
  user_id:            string;
  username:           string | null;
  mock_balance:       number;
  real_balance:       number;
  spot_live_balance:  number;
  bot_balance:        number;
  bot_mock_balance:   number;
  use_real:           boolean;
  sol_address:              string | null;
  evm_address:              string | null;
  platform_wallet_address:  string | null;
  positions:                Position[];
  stats:                    AccountStats;
  monthly_points:           Record<string, MonthPoints>;
  deposits:                 DepositRecord[];
  deposit_wallets:          Record<string, string>;
}

interface AuthCtx {
  user:    User | null;
  session: Session | null;
  account: TradingAccount | null;
  loading: boolean;
  liveSOL:    number;
  liveSOLUSD: number;
  signUp:        (email: string, password: string, username: string) => Promise<string | null>;
  signIn:        (email: string, password: string) => Promise<string | null>;
  signOut:       () => Promise<void>;
  saveAccount:   (patch: Partial<TradingAccount>) => Promise<void>;
  syncPositions: (positions: Position[]) => void;
  recordTrade:   (notionalUsd: number, pnl: number, won: boolean) => void;
  connectWallet: (type: 'sol' | 'evm', address: string) => void;
  addDeposit:    (txHash: string, amountUsd: number, asset: string, chain: string) => Promise<void>;
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

  // ── Flush pending changes to Supabase — ONE update call ───────────────
  const flush = useCallback(async (uid: string, patch: Partial<TradingAccount>) => {
    if (!supabase || Object.keys(patch).length === 0) return;
    await supabase
      .from('trading_accounts')
      .update(patch)
      .eq('user_id', uid);
  }, []);

  // Debounced flush — waits 2 s after last change before writing
  const debouncedFlush = useDebounce(
    (uid: string, patch: Partial<TradingAccount>) => {
      flush(uid, patch);
      pending.current = {};
    },
    2000,
  );

  // ── Queue a change locally + schedule debounced write ─────────────────
  const queue = useCallback((patch: Partial<TradingAccount>) => {
    if (!user) return;
    pending.current = { ...pending.current, ...patch };
    setAccount(prev => prev ? { ...prev, ...patch } : prev);
    debouncedFlush(user.id, pending.current);
  }, [user, debouncedFlush]);

  // ── Fetch account from Supabase ───────────────────────────────────────
  const fetchAccount = useCallback(async (uid: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('trading_accounts')
      .select('*')
      .eq('user_id', uid)
      .single();
    if (data) {
      // Normalize DB column variants: platform_sol_address → platform_wallet_address
      const platformAddr = data.platform_wallet_address ?? data.platform_sol_address ?? null;
      const dw = data.deposit_wallets ?? {};
      // Normalize deposit_wallets keys to lowercase
      const normalizedDW: Record<string, string> = {};
      for (const [k, v] of Object.entries(dw)) normalizedDW[k.toLowerCase()] = v as string;

      setAccount({
        ...data,
        platform_wallet_address: platformAddr,
        deposit_wallets:   normalizedDW,
        spot_live_balance: data.spot_live_balance ?? 0,
        bot_balance:       data.bot_balance       ?? 0,
        bot_mock_balance:  data.bot_mock_balance  ?? 0,
        use_real:          data.use_real           ?? false,
        positions:         data.positions         ?? [],
        stats:             data.stats             ?? { totalPnl: 0, winCount: 0, lossCount: 0, tradeCount: 0 },
        monthly_points:    data.monthly_points    ?? {},
        deposits:          data.deposits          ?? [],
      } as TradingAccount);
    }
  }, []);

  // ── Auth listener ─────────────────────────────────────────────────────
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

  // ── Realtime balance sync from Supabase Realtime ──────────────────────
  useEffect(() => {
    if (!supabase || !user) return;
    const channel = supabase
      .channel(`account:${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'trading_accounts',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const d = payload.new as any;
        setAccount(prev => prev ? {
          ...prev,
          mock_balance:      d.mock_balance      ?? prev.mock_balance,
          real_balance:      d.real_balance      ?? prev.real_balance,
          spot_live_balance: d.spot_live_balance ?? prev.spot_live_balance,
          bot_balance:       d.bot_balance       ?? prev.bot_balance,
          bot_mock_balance:  d.bot_mock_balance  ?? prev.bot_mock_balance,
          use_real:          d.use_real           ?? prev.use_real,
          platform_wallet_address: d.platform_wallet_address ?? d.platform_sol_address ?? prev.platform_wallet_address,
          deposit_wallets:   d.deposit_wallets   ?? prev.deposit_wallets,
        } : prev);
      })
      .subscribe();
    return () => { supabase?.removeChannel(channel); };
  }, [user]);

  // ── Live on-chain SOL balance ─────────────────────────────────────────
  // Preference order: platform_wallet_address > deposit_wallets.sol > hardcoded platform address
  const PLATFORM_SOL_ADDRESS = '53NooDTuHXiiCesVgn87rZ76hRYa2GZj4gepSAPRxbAX';
  const solDepositAddress: string =
    account?.platform_wallet_address ||
    account?.deposit_wallets?.sol ||
    account?.deposit_wallets?.SOL ||
    PLATFORM_SOL_ADDRESS;
  const { sol: liveSOL, usd: liveSOLUSD } = useSolanaBalance(solDepositAddress);

  // ── Sync on-chain SOL balance → Supabase when it changes ─────────────
  const lastSyncedSOL = useRef(-1);

  useEffect(() => {
    void (async () => {
      if (!user || !supabase) return;
      // Never push a zero — hook hasn't resolved yet
      if (liveSOL <= 0) return;
      // Skip if unchanged since last successful sync
      if (Math.abs(liveSOL - lastSyncedSOL.current) < 0.000001) return;
      lastSyncedSOL.current = liveSOL;

      const { error } = await supabase
        .from('trading_accounts')
        .update({ real_balance: liveSOLUSD })
        .eq('user_id', user.id);

      if (error) {
        console.error('[AuthContext] real_balance sync failed:', error.message, error.details);
      } else {
        setAccount(prev => prev ? { ...prev, real_balance: liveSOLUSD } : prev);
      }
    })();
  // liveSOLUSD always moves with liveSOL; [liveSOL] is the correct dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSOL]);

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
    await saveAccount({ deposits: newDeposits, real_balance: newBalance });
  };

  // ── Auth actions ──────────────────────────────────────────────────────
  const signUp = async (email: string, password: string, username: string): Promise<string | null> => {
    if (!supabase) return 'Supabase not configured';
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    if (data.user) {
      await supabase.from('trading_accounts').insert({
        user_id:           data.user.id,
        username,
        mock_balance:      1000,
        real_balance:      0,
        spot_live_balance: 0,
        bot_balance:       0,
        bot_mock_balance:  0,
        use_real:          false,
        positions:         [],
        stats:             { totalPnl: 0, winCount: 0, lossCount: 0, tradeCount: 0 },
        monthly_points:    {},
        deposits:          [],
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

  // ── Direct save (immediate, bypasses debounce) ────────────────────────
  const saveAccount = async (patch: Partial<TradingAccount>) => {
    if (!user || !supabase) return;
    setAccount(prev => prev ? { ...prev, ...patch } : prev);
    const { error } = await supabase
      .from('trading_accounts')
      .update(patch)
      .eq('user_id', user.id);
    if (error) {
      console.error('[AuthContext] saveAccount failed:', error.message, error.details);
    }
  };

  // ── Sync positions — debounced ────────────────────────────────────────
  const syncPositions = useCallback((positions: Position[]) => {
    const open   = positions.filter(p => p.status === 'open');
    const closed = positions.filter(p => p.status !== 'open').slice(-100);
    queue({ positions: [...open, ...closed] });
  }, [queue]);

  // ── Record trade stats + points — debounced ───────────────────────────
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

  return (
    <Ctx.Provider value={{
      user, session, account, loading,
      liveSOL, liveSOLUSD,
      signUp, signIn, signOut, saveAccount,
      syncPositions, recordTrade, connectWallet, addDeposit,
    }}>
      {children}
    </Ctx.Provider>
  );
}
