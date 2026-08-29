import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, currentMonth, POINTS_PER_USD } from '../lib/supabase';
import { Position } from '../types';
import { useSolanaBalance } from '../hooks/useSolanaBalance';

interface AccountStats { totalPnl: number; winCount: number; lossCount: number; tradeCount: number; }
interface MonthPoints { points: number; volume: number; trades: number; }
interface DepositRecord { txHash: string; amountUsd: number; asset: string; chain: string; status: 'pending' | 'confirmed'; createdAt: number; }

// NEW: what refreshBalance hands back. See the comment on refreshBalance for why
// returning this matters.
export interface BalanceSnapshot {
  real_balance: number;
  mock_balance: number;
  spot_live_balance: number;
  spot_mock_balance: number;
  leverage_balance: number;
  bot_balance: number;
  bot_mock_balance: number;
  use_real: boolean;
}

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
  // NEW: columns added in the build guide's schema step.
  wallet_backup_confirmed: boolean;
  strategy_specs: unknown[];
  research_trials: Record<string, number>;
}

interface AuthCtx {
  user: User | null; session: Session | null; account: TradingAccount | null; loading: boolean;
  liveSOL: number; liveSOLUSD: number;
  signUp: (email: string, password: string, username: string) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  saveAccount: (patch: Partial<TradingAccount>) => Promise<void>;
  // CHANGED: was Promise<void>. Now returns the fresh values.
  refreshBalance: () => Promise<BalanceSnapshot | null>;
  syncPositions: (positions: Position[]) => void;
  recordTrade: (notionalUsd: number, pnl: number, won: boolean) => void;
  connectWallet: (type: 'sol' | 'evm', address: string) => void;
  addDeposit: (txHash: string, amountUsd: number, asset: string, chain: string) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
export function useAuth() { const c = useContext(Ctx); if (!c) throw new Error('useAuth must be inside AuthProvider'); return c; }

function useDebounce(fn: (...args: any[]) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return useCallback((...args: any[]) => { clearTimeout(timer.current); timer.current = setTimeout(() => fn(...args), ms); }, [fn, ms]);
}

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
        // NEW: defaults so a row created before the migration still reads safely.
        // Backup defaults to FALSE — never infer that a wallet is backed up.
        wallet_backup_confirmed: data.wallet_backup_confirmed ?? false,
        strategy_specs: data.strategy_specs ?? [],
        research_trials: data.research_trials ?? {},
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
          // NEW
          wallet_backup_confirmed: d.wallet_backup_confirmed ?? prev.wallet_backup_confirmed,
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

  /* ── refreshBalance ──────────────────────────────────────────────────
     CHANGED: now RETURNS the fresh values as well as setting state.

     Why. setAccount schedules a re-render; it does not update the `account`
     variable already captured by whatever called this. So code shaped like

         await refreshBalance();
         setCapital(newMode ? account.real_balance : account.mock_balance);

     reads the PRE-refresh balance, because `account` there is a closure value
     from the render that started the call. That was the bug in App.tsx's
     LiveMockToggle — the user switched to live and saw the wrong number.

     Returning the data lets a caller use it directly:

         const fresh = await refreshBalance();
         setCapital(useReal ? fresh.real_balance : fresh.mock_balance);

     Existing callers that ignore the return value are unaffected.
     ─────────────────────────────────────────────────────────────────── */
  const refreshBalance = useCallback(async (): Promise<BalanceSnapshot | null> => {
    if (!user || !supabase) return null;
    const { data } = await supabase.from('trading_accounts')
      .select('real_balance,mock_balance,spot_live_balance,spot_mock_balance,leverage_balance,bot_balance,bot_mock_balance,use_real')
      .eq('user_id', user.id).single();
    if (!data) return null;

    let snapshot: BalanceSnapshot | null = null;
    setAccount(prev => {
      if (!prev) return prev;
      const next = {
        ...prev,
        real_balance: data.real_balance ?? prev.real_balance,
        mock_balance: data.mock_balance ?? prev.mock_balance,
        spot_live_balance: data.spot_live_balance ?? prev.spot_live_balance,
        spot_mock_balance: data.spot_mock_balance ?? prev.spot_mock_balance,
        leverage_balance: data.leverage_balance ?? prev.leverage_balance,
        bot_balance: data.bot_balance ?? prev.bot_balance,
        bot_mock_balance: data.bot_mock_balance ?? prev.bot_mock_balance,
        use_real: data.use_real ?? prev.use_real,
      };
      snapshot = {
        real_balance: next.real_balance, mock_balance: next.mock_balance,
        spot_live_balance: next.spot_live_balance, spot_mock_balance: next.spot_mock_balance,
        leverage_balance: next.leverage_balance, bot_balance: next.bot_balance,
        bot_mock_balance: next.bot_mock_balance, use_real: next.use_real,
      };
      return next;
    });

    // If there was no prior account object the updater above never ran, so fall
    // back to the row we just read rather than returning null.
    return snapshot ?? {
      real_balance: data.real_balance ?? 0, mock_balance: data.mock_balance ?? 0,
      spot_live_balance: data.spot_live_balance ?? 0, spot_mock_balance: data.spot_mock_balance ?? 0,
      leverage_balance: data.leverage_balance ?? 0, bot_balance: data.bot_balance ?? 0,
      bot_mock_balance: data.bot_mock_balance ?? 0, use_real: data.use_real ?? false,
    };
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
  // Only monitor user's OWN generated wallet. No fallback to shared platform address.
  // If no wallet exists, liveSOL/liveSOLUSD will be 0 and UI prompts to generate.
  const userDepositAddress: string =
    account?.platform_wallet_address ||
    account?.platform_sol_address ||
    account?.deposit_wallets?.sol ||
    account?.deposit_wallets?.SOL ||
    '';

  const { sol: liveSOL, usd: liveSOLUSD } = useSolanaBalance(userDepositAddress);

  /* ── DEPOSIT DETECTION ───────────────────────────────────────────────
     REWRITTEN. The previous version compared the on-chain USD VALUE against
     the DB balance and credited the difference:

         if (liveSOLUSD > currentDB && liveSOLUSD !== lastCreditedUSD.current) {
           setAccount(... real_balance: liveSOLUSD)
           supabase.update({ real_balance: liveSOLUSD })
         }

     Two problems, and the first one costs real money.

     1. SOL PRICE MOVEMENT IS TREATED AS A DEPOSIT. The USD value of a fixed
        amount of SOL changes every poll. When SOL rises, liveSOLUSD exceeds the
        DB balance and the user is credited for the price move as if they had
        deposited. When SOL falls nothing reduces it, because the condition is
        one-directional. So the balance RATCHETS UPWARD with volatility, and the
        user can withdraw money that was never deposited. On a 10% SOL day that
        is 10% of every live balance on the platform.

     2. It ASSIGNS rather than adds: `real_balance = liveSOLUSD` overwrites the
        whole balance with the wallet's value. Any funds moved out to
        spot_live_balance or bot_balance get silently re-credited on the next
        poll, so an internal transfer duplicates money.

     The fix: a deposit is an increase in the QUANTITY of SOL held, not in its
     USD value. Price moves do not change quantity. So track lamports, and credit
     only the USD value of an actual increase — as a delta, added to the existing
     balance rather than replacing it.

     Note this still leaves live balances denominated in USD while the asset is
     SOL, so an unrealised price move is not reflected until the next deposit.
     That is a modelling decision to make deliberately, not to fix by accident
     here. The safe version is the one that cannot invent money.
     ─────────────────────────────────────────────────────────────────── */
  const lastSeenSol = useRef<number | null>(null);
  const DUST_SOL = 0.0005;   // ignore rent-exempt noise and fee dust

  useEffect(() => {
    if (!user || !supabase || !userDepositAddress) return;
    if (!Number.isFinite(liveSOL) || liveSOL < 0) return;

    // First reading for this wallet: record the baseline, credit nothing.
    // Otherwise a returning user's whole balance would look like a fresh deposit.
    if (lastSeenSol.current === null) { lastSeenSol.current = liveSOL; return; }

    const deltaSol = liveSOL - lastSeenSol.current;
    lastSeenSol.current = liveSOL;

    // Only an INCREASE in quantity is a deposit. Decreases are withdrawals or
    // trades, which the edge function already accounts for.
    if (deltaSol <= DUST_SOL) return;

    const solPriceUsd = liveSOL > 0 ? liveSOLUSD / liveSOL : 0;
    const creditUsd = deltaSol * solPriceUsd;
    if (creditUsd <= 0) return;

    const nextBalance = (account?.real_balance ?? 0) + creditUsd;
    console.log(`[Deposit] +${deltaSol.toFixed(6)} SOL = $${creditUsd.toFixed(2)} credited`);

    setAccount(prev => prev ? { ...prev, real_balance: nextBalance } : prev);
    supabase.from('trading_accounts')
      .update({ real_balance: nextBalance })
      .eq('user_id', user.id)
      .then(({ error }) => { if (error) console.error('[Deposit write failed]', error); });
  }, [liveSOL, liveSOLUSD, user, userDepositAddress]);

  // Reset the baseline when the watched wallet changes, so a new address does
  // not inherit the previous one's quantity.
  useEffect(() => { lastSeenSol.current = null; }, [userDepositAddress]);

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
