import { useAuth } from '../auth/AuthContext';
import { useTradingStore, selectOpen } from '../store';

// ── Xenia — Home ───────────────────────────────────────────────────────────
//
// Same export and same props as before (`HomePage`, named), so App.tsx is
// unchanged. What differs is the order of the screen.
//
// Re-ordered around what a returning user opens the app to find out:
//   1. Where do I stand      — equity and change since funding
//   2. What am I exposed to  — open positions, if any
//   3. What can I do         — actions
//
// The wordmark and the tagline block are gone. Branding on a screen someone
// sees fifty times a day is spent attention: they already know which app they
// opened, and every pixel of it pushes the balance below the fold. The logo
// still sits in the header, which is where a returning user expects it.
//
// Density follows the rest of the app: 8px rhythm, mono tabular figures on
// every number, green and red reserved for direction and nothing else.

interface HomePageProps {
  onNavigate: (page: any, sub?: any) => void;
  onShowWallet: () => void;
  onShowAuth: () => void;
}

const num = 'font-mono tabular-nums tracking-tight';
const label = 'text-[9px] uppercase tracking-[0.14em] text-[#4B5563] font-semibold';
const panel = 'rounded-xl border border-white/[0.06] bg-[#0D1117]';

const usd = (v: number) =>
  `$${(Number.isFinite(v) ? v : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

const price = (v: number) => {
  if (!Number.isFinite(v) || v === 0) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return v.toFixed(4);
  if (a >= 0.01) return v.toFixed(5);
  return v.toPrecision(4);
};

const tone = (v: number) => (v >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]');

/* ── quick actions ─────────────────────────────────────────────────────── */

const ACTIONS: { key: string; label: string; page?: string; accent?: boolean }[] = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'trade', label: 'Trade', page: 'trade', accent: true },
  { key: 'markets', label: 'Markets', page: 'markets' },
  { key: 'pump', label: 'Pump', page: 'pump' },
];

const SHORTCUTS: { label: string; page: string; sub?: any }[] = [
  { label: 'Spot', page: 'spot' },
  { label: 'The Lab', page: 'lab' },
  { label: 'Research', page: 'research' },
  { label: 'Copy trade', page: 'copy' },
  { label: 'Earn', page: 'earn' },
  { label: 'Leaderboard', page: 'trade', sub: { rightTab: 'board' } },
];

export function HomePage({ onNavigate, onShowWallet, onShowAuth }: HomePageProps) {
  const { user, account, liveSOL } = useAuth();

  // Subscribe to the raw array and filter through the pure selector. Calling a
  // get()-based store method here would not create a subscription and the list
  // would render stale.
  const positions = useTradingStore(s => s.positions);
  const mode = useTradingStore(s => s.mode);
  const ownerId = useTradingStore(s => s.ownerId);
  const startingCapital = useTradingStore(s => s.startingCapital);
  const open = selectOpen(positions, mode, ownerId);

  const isLive = !!account?.use_real;

  const equity = account
    ? isLive
      ? Number(account.real_balance ?? 0)
        + Number((account as any).spot_live_balance ?? 0)
        + Number((account as any).bot_balance ?? 0)
      : Number(account.mock_balance ?? 0) + Number((account as any).bot_mock_balance ?? 0)
    : 0;

  const free = account ? Number(isLive ? account.real_balance : account.mock_balance) || 0 : 0;
  const unrealised = open.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const changeUsd = startingCapital > 0 ? equity - startingCapital : 0;
  const changePct = startingCapital > 0 ? (changeUsd / startingCapital) * 100 : 0;

  /* ── signed out ── */
  if (!user) {
    return (
      <div className="h-full overflow-y-auto px-4 pt-10 pb-24 max-w-md mx-auto">
        <h1 className="text-[22px] font-black tracking-tight text-[#F4F6FA]">
          Trade Solana with leverage
        </h1>
        <p className="text-[12px] text-[#6B7280] leading-relaxed mt-2">
          Practise on live prices with simulated funds. When you are ready, trade
          from your own wallet — Xenia never holds your keys or your money.
        </p>
        <button
          onClick={onShowAuth}
          className="w-full mt-5 py-3 rounded-xl bg-[#2BFFF1]/12 border border-[#2BFFF1]/30
                     text-[#2BFFF1] text-[12px] font-black uppercase tracking-[0.1em]"
        >
          Create an account
        </button>
        <button
          onClick={() => onNavigate('markets')}
          className="w-full mt-2 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08]
                     text-[#E5E9EF] text-[12px] font-black uppercase tracking-[0.1em]"
        >
          Look around first
        </button>
        <p className="text-[10px] text-[#374151] leading-relaxed mt-6">
          Trading with leverage can lose more than you deposit. Nothing here is advice.
        </p>
      </div>
    );
  }

  /* ── signed in ── */
  return (
    <div className="h-full overflow-y-auto pb-24">

      {/* equity */}
      <div className="px-3 pt-3 pb-2.5">
        <div className="flex items-center justify-between">
          <span className={label}>{isLive ? 'Account value' : 'Mock balance'}</span>
          <button onClick={onShowWallet} className="text-[10px] font-bold text-[#2BFFF1]">
            Wallet
          </button>
        </div>

        <p className={`${num} text-[32px] font-bold leading-none mt-1 text-[#F4F6FA]`}>
          {isLive && liveSOL > 0 ? `${liveSOL.toFixed(4)} SOL` : usd(equity)}
        </p>

        {startingCapital > 0 ? (
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className={`${num} text-[12px] font-semibold ${tone(changeUsd)}`}>
              {changeUsd >= 0 ? '+' : ''}{usd(changeUsd)}
            </span>
            <span className={`${num} text-[11px] ${tone(changeUsd)}`}>
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
            </span>
            <span className={label}>since funding</span>
          </div>
        ) : (
          <p className="text-[10px] text-[#4B5563] mt-1">
            Your change is measured from here once the balance settles.
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 mt-2.5">
          {[
            ['Free', usd(free), ''],
            ['Open P&L', `${unrealised >= 0 ? '+' : ''}${usd(unrealised)}`,
              open.length ? tone(unrealised) : ''],
            ['Positions', String(open.length), open.length ? 'text-[#2BFFF1]' : ''],
          ].map(([l, v, c]) => (
            <div key={l} className="flex flex-col gap-[1px] min-w-0">
              <span className={label}>{l}</span>
              <span className={`${num} text-[11px] font-semibold truncate ${c || 'text-[#E5E9EF]'}`}>
                {v}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-1.5 mt-2.5">
          {ACTIONS.map(a => (
            <button
              key={a.key}
              onClick={() => (a.page ? onNavigate(a.page) : onShowWallet())}
              className={`py-2 rounded-lg border text-[10px] font-bold transition-colors
                          duration-[120ms] active:bg-white/[0.07] ${
                a.accent
                  ? 'text-[#2BFFF1] border-[#2BFFF1]/25 bg-[#2BFFF1]/[0.08]'
                  : 'text-[#9CA3AF] border-white/[0.07] bg-white/[0.03]'}`}
            >
              {a.label}
            </button>
          ))}
        </div>

        {!isLive && (
          <p className="text-[9px] text-[#374151] leading-relaxed mt-2">
            Mock mode. Trades run against live prices with simulated fills — everything you
            learn transfers except the cost of being wrong.
          </p>
        )}
      </div>

      {/* open risk */}
      {open.length > 0 && (
        <div className="px-3 pb-2.5">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className={label}>Open positions</span>
            <button onClick={() => onNavigate('trade')} className="text-[10px] font-bold text-[#2BFFF1]">
              Manage
            </button>
          </div>
          <div className={panel}>
            {open.slice(0, 4).map((p, i) => (
              <button
                key={p.id}
                onClick={() => onNavigate('trade')}
                className={`w-full flex items-center gap-2 px-2.5 py-2 text-left ${
                  i > 0 ? 'border-t border-white/[0.05]' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-[#E5E9EF]">{p.asset}</span>
                    <span className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded ${
                      p.side === 'LONG'
                        ? 'text-[#10B981] bg-[#10B981]/10'
                        : 'text-[#EF4444] bg-[#EF4444]/10'}`}>
                      {p.side} {p.leverage}×
                    </span>
                    {!p.stopLossPrice && (
                      <span className="text-[8px] font-bold uppercase tracking-wider text-[#F59E0B]">
                        No stop
                      </span>
                    )}
                  </div>
                  <span className={`${num} text-[9px] text-[#4B5563]`}>
                    {usd(p.notional)} at {price(p.entryPrice)}
                  </span>
                </div>
                <span className={`${num} text-[13px] font-bold ${tone(p.pnl ?? 0)}`}>
                  {(p.pnl ?? 0) >= 0 ? '+' : ''}{usd(p.pnl ?? 0)}
                </span>
              </button>
            ))}
            {open.length > 4 && (
              <button
                onClick={() => onNavigate('trade')}
                className={`${label} w-full py-1.5 border-t border-white/[0.05] text-[#2BFFF1]`}
              >
                {open.length - 4} more
              </button>
            )}
          </div>
        </div>
      )}

      {/* shortcuts */}
      <div className="px-3 pb-4">
        <span className={label}>Everything else</span>
        <div className={`${panel} mt-1.5`}>
          {SHORTCUTS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => onNavigate(s.page, s.sub)}
              className={`w-full flex items-center gap-2 px-2.5 py-2.5 text-left ${
                i > 0 ? 'border-t border-white/[0.05]' : ''}`}
            >
              <span className="flex-1 text-[12px] font-semibold text-[#E5E9EF]">{s.label}</span>
              <span className="text-[#374151] text-[14px] leading-none">›</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pb-6">
        <p className="text-[9px] text-[#374151] leading-relaxed">
          Xenia is non-custodial. Your keys and funds stay in your own wallet, and we cannot
          freeze, reverse or recover a trade. Trading with leverage can lose more than you
          deposit.
        </p>
      </div>
    </div>
  );
}

export default HomePage;
