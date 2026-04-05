import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, currentMonth, POINTS_PER_USD } from '../lib/supabase';
import { Position } from '../types';
import { useSolanaBalance } from '../hooks/useSolanaBalance';

interface AccountStats { totalPnl: number; winCount: number; lossCount: number; tradeCount: number; }
interface MonthPoints { points: number; volume: number; trades: number; }
interface DepositRecord { txHash: string; amountUsd: number; asset: string; chain: string; status: 'pending' | 'confirmed'; createdAt: number; }

export interface TradingAccount {
  id: string; user_id: string; username: string | null;
  mock_balance: number; real_balance: number; spot_live_balance: number;
  spot_mock_balance: number; leverage_balance: number;
  bot_balance: number; bot_mock_balance: number; use_real: boolean;
  sol_address: string | null; evm_address: string | null;
  platform_wallet_address: string | null; platform_sol_address: string | null;
  positions: Position[]; stats: AccountStats;
  monthly_points: Record<string, MonthPoints>;
  deposits: DepositRecord[]; deposit_wallets: Record<string, string>;
}

interface AuthCtx {
  user: User | null; session: Session | null; account: TradingAccount | null; loading: boolean;
  liveSOL: number; liveSOLUSD: number;
  signUp: (email: string, password: string, username: string) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  saveAccount: (patch: Partial<TradingAccount>) => Promise<void>;
  refreshBalance: () => Promise<void>;
  syncPositions: (positions: Position[]) => void;
  recordTrade: (notionalUsd: number, pnl: number, won: boolean) => void;
  connectWallet: (type: 'sol' | 'evm', address: string) => void;
  addDeposit: (txHash: string, amountUsd: number, asset: string, chain: string) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
export function useAuth() { const c = useContext(Ctx); if (!c) throw new Error('useAuth must be inside AuthProvider'); return c; }

function useDebounce(fn: (...args: any[]) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  return useCallback((...args: any[]) => { clearTimeout(timer.current); timer.current = setTimeout(() => fn(...args), ms); }, [fn, ms]);
}

const PLATFORM_SOL_ADDRESS = '53NooDTuHXiiCesVgn87rZ76hRYa2GZj4gepSAPRxbAX';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<TradingAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const pending = useRef<Partial<TradingAccount>>({});

  const flush = useCallback(async (uid: string, patch: Partial<TradingAccount>) => {
    if (!supabase || Object.keys(patch).length === 0) return;
    await supabase.from('trading_accounts').update(patch).eq('user_id', uid);
  }, []);

  const debouncedFlush = useDebounce((uid: string, patch: Partial<TradingAccount>) => { flush(uid, patch); pending.current = {}; }, 2000);

  const queue = useCallback((patch: Partial<TradingAccount>) => {
    if (!user) return;
    pending.current = { ...pending.current, ...patch };
    setAccount(prev => prev ? { ...prev, ...patch } : prev);
    debouncedFlush(user.id, pending.current);
  }, [user, debouncedFlush]);

  const fetchAccount = useCallback(async (uid: string) => {
    if (!supabase) return;
    let { data } = await supabase.from('trading_accounts').select('*').eq('user_id', uid).single();
    
    // Auto-create if row doesn't exist (safety net)
    if (!data) {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData?.user?.email ?? '';
      await supabase.from('trading_accounts').insert({
        user_id: uid, username: email.split('@')[0],
        mock_balance: 1000, real_balance: 0, funding_balance: 0,
        spot_live_balance: 0, spot_mock_balance: 1000, leverage_balance: 0,
        bot_balance: 0, bot_mock_balance: 0, use_real: false,
        positions: [], stats: { totalPnl: 0, winCount: 0, lossCount: 0, tradeCount: 0 },
        monthly_points: {}, deposits: [], deposit_wallets: { sol: null, evm: null },
      });
      const res = await supabase.from('trading_accounts').select('*').eq('user_id', uid).single();
      data = res.data;
    }
    
    if (data) {
      const platformAddr = data.platform_wallet_address ?? data.platform_sol_address ?? null;
      const dw = data.deposit_wallets ?? {};
      const normalizedDW: Record<string, string> = {};
      for (const [k, v] of Object.entries(dw)) normalizedDW[k.toLowerCase()] = v as string;
      setAccount({
        ...data, platform_wallet_address: platformAddr, deposit_wallets: normalizedDW,
        spot_live_balance: data.spot_live_balance ?? 0, spot_mock_balance: data.spot_mock_balance ?? 1000,
        leverage_balance: data.leverage_balance ?? 0, bot_balance: data.bot_balance ?? 0,
        bot_mock_balance: data.bot_mock_balance ?? 0, use_real: data.use_real ?? false,
        positions: data.positions ?? [], stats: data.stats ?? { totalPnl: 0, winCount: 0, lossCount: 0, tradeCount: 0 },
        monthly_points: data.monthly_points ?? {}, deposits: data.deposits ?? [],
      } as TradingAccount);
    }
  }, []);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session); setUser(data.session?.user ?? null);
      if (data.session?.user) fetchAccount(data.session.user.id).then(() => setLoading(false));
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => {
      setSession(sess); setUser(sess?.user ?? null);
      if (sess?.user) fetchAccount(sess.user.id); else setAccount(null);
    });
    return () => subscription.unsubscribe();
  }, [fetchAccount]);

  // Realtime balance sync from DB changes (other tabs, edge functions, etc.)
  useEffect(() => {
    if (!supabase || !user) return;
    const channel = supabase.channel(`account:${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trading_accounts', filter: `user_id=eq.${user.id}` }, (payload) => {
        const d = payload.new as any;
        setAccount(prev => prev ? {
          ...prev,
          mock_balance: d.mock_balance ?? prev.mock_balance,
          real_balance: d.real_balance ?? prev.real_balance,
          spot_live_balance: d.spot_live_balance ?? prev.spot_live_balance,
          spot_mock_balance: d.spot_mock_balance ?? prev.spot_mock_balance,
          leverage_balance: d.leverage_balance ?? prev.leverage_balance,
          bot_balance: d.bot_balance ?? prev.bot_balance,
          bot_mock_balance: d.bot_mock_balance ?? prev.bot_mock_balance,
          use_real: d.use_real ?? prev.use_real,
          platform_wallet_address: d.platform_wallet_address ?? d.platform_sol_address ?? prev.platform_wallet_address,
          deposit_wallets: d.deposit_wallets ?? prev.deposit_wallets,
        } : prev);
      }).subscribe();
    return () => { supabase?.removeChannel(channel); };
  }, [user]);

  const signUp = async (email: string, password: string, username: string): Promise<string | null> => {
    if (!supabase) return 'Supabase not configured';
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    if (data.user) {
      await supabase.from('trading_accounts').insert({
        user_id: data.user.id, username, mock_balance: 1000, real_balance: 0,
        spot_live_balance: 0, bot_balance: 0, bot_mock_balance: 0, use_real: false,
        positions: [], stats: { totalPnl: 0, winCount: 0, lossCount: 0, tradeCount: 0 },
        monthly_points: {}, deposits: [],
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
    if (user && Object.keys(pending.current).length > 0) { await flush(user.id, pending.current); pending.current = {}; }
    await supabase.auth.signOut(); setAccount(null);
  };

  // saveAccount: optimistic local update + immediate DB persist (not debounced)
  const saveAccount = useCallback(async (patch: Partial<TradingAccount>) => {
    if (!user || !supabase) return;
    setAccount(prev => prev ? { ...prev, ...patch } : prev);
    try {
      await supabase.from('trading_accounts').update(patch).eq('user_id', user.id);
    } catch (e) {
      console.error('saveAccount failed:', e);
    }
  }, [user]);

  // refreshBalance: reads ALL balance fields + use_real from DB
  const refreshBalance = useCallback(async () => {
    if (!user || !supabase) return;
    const { data } = await supabase.from('trading_accounts')
      .select('real_balance,mock_balance,spot_live_balance,spot_mock_balance,leverage_balance,bot_balance,bot_mock_balance,use_real')
      .eq('user_id', user.id).single();
    if (data) {
      setAccount(prev => prev ? {
        ...prev,
        real_balance: data.real_balance ?? prev.real_balance,
        mock_balance: data.mock_balance ?? prev.mock_balance,
        spot_live_balance: data.spot_live_balance ?? prev.spot_live_balance,
        spot_mock_balance: data.spot_mock_balance ?? prev.spot_mock_balance,
        leverage_balance: data.leverage_balance ?? prev.leverage_balance,
        bot_balance: data.bot_balance ?? prev.bot_balance,
        bot_mock_balance: data.bot_mock_balance ?? prev.bot_mock_balance,
        use_real: data.use_real ?? prev.use_real,
      } : prev);
    }
  }, [user]);

  const syncPositions = useCallback((positions: Position[]) => {
    const open = positions.filter(p => p.status === 'open');
    const closed = positions.filter(p => p.status !== 'open').slice(-100);
    queue({ positions: [...open, ...closed] });
  }, [queue]);

  const recordTrade = useCallback((notionalUsd: number, pnl: number, won: boolean) => {
    if (!account) return;
    const month = currentMonth();
    const pts = Math.floor(notionalUsd * POINTS_PER_USD);
    const prevMonth = account.monthly_points[month] ?? { points: 0, volume: 0, trades: 0 };
    const newMonthly = { ...account.monthly_points, [month]: { points: prevMonth.points + pts, volume: prevMonth.volume + notionalUsd, trades: prevMonth.trades + 1 } };
    const ps = account.stats;
    const newStats: AccountStats = { totalPnl: ps.totalPnl + pnl, winCount: ps.winCount + (won ? 1 : 0), lossCount: ps.lossCount + (won ? 0 : 1), tradeCount: ps.tradeCount + 1 };
    queue({ monthly_points: newMonthly, stats: newStats });
  }, [account, queue]);

  // ── On-chain balance monitoring ─────────────────────────────────────────
  // Monitor user's deposit address. Falls back to platform address for users
  // who haven't generated a personal wallet yet (common during initial setup).
  const userDepositAddress: string =
    account?.platform_wallet_address ||
    account?.platform_sol_address ||
    account?.deposit_wallets?.sol ||
    account?.deposit_wallets?.SOL ||
    PLATFORM_SOL_ADDRESS;

  const { sol: liveSOL, usd: liveSOLUSD } = useSolanaBalance(userDepositAddress);

  // DEPOSIT DETECTION: only credit when on-chain > DB (new deposit arrived).
  // NEVER overwrite DB balance downward — that would refund trade deductions.
  const lastCreditedUSD = useRef(0);
  useEffect(() => {
    if (!user || !supabase) return;
    if (liveSOLUSD <= 0) return;

    const currentDB = account?.real_balance ?? 0;

    // Only credit if on-chain is HIGHER than DB (new deposit)
    if (liveSOLUSD > currentDB && liveSOLUSD !== lastCreditedUSD.current) {
      lastCreditedUSD.current = liveSOLUSD;
      console.log(`[Deposit] +$${(liveSOLUSD - currentDB).toFixed(2)} credited (on-chain: $${liveSOLUSD.toFixed(2)})`);

      setAccount(prev => prev ? { ...prev, real_balance: liveSOLUSD } : prev);
      supabase.from('trading_accounts')
        .update({ real_balance: liveSOLUSD })
        .eq('user_id', user.id)
        .then(({ error }) => { if (error) console.error('[Deposit write failed]', error); });
    }
  }, [liveSOL, liveSOLUSD, user]);

  const connectWallet = useCallback((type: 'sol' | 'evm', address: string) => {
    queue(type === 'sol' ? { sol_address: address } : { evm_address: address });
  }, [queue]);

  const addDeposit = async (txHash: string, amountUsd: number, asset: string, chain: string) => {
    if (!account || !user || !supabase) return;
    const nd: DepositRecord = { txHash, amountUsd, asset, chain, status: 'pending', createdAt: Date.now() };
    await saveAccount({ deposits: [...account.deposits, nd], real_balance: account.real_balance + amountUsd });
  };

  return (
    <Ctx.Provider value={{ user, session, account, loading, liveSOL, liveSOLUSD, signUp, signIn, signOut, saveAccount, refreshBalance, syncPositions, recordTrade, connectWallet, addDeposit }}>
      {children}
    </Ctx.Provider>
  );
}
