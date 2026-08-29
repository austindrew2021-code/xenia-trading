import { Empty, Label, Panel, Skeleton, Stat, fmtPct, fmtPrice, fmtUsd, num, surface, t, tone } from '../ui';
import type { MarketRow } from './MarketListPage';
import type { Position } from './PositionsPage';
import { ActionRow, type FlowKind } from './MoneyFlowSheet';

// ── Xenia — Home ───────────────────────────────────────────────────────────
//
// Kept as the landing screen, but re-ordered around what a returning user
// actually opens the app to find out. In priority order that is:
//
//   1. Where do I stand      — equity and today's change
//   2. What am I exposed to  — open positions, if any
//   3. What is moving        — the reason to open a chart
//   4. What can I do         — actions
//
// The previous version led with a logo lockup and a row of icon buttons, which
// answers none of those. Branding on a screen the user sees fifty times a day
// is spent attention: they already know which app they opened. The wordmark
// moves to onboarding and the app bar, and this screen opens on the number.
//
// The movers strip is the hook. It is the only place on Home that leads
// somewhere, and every row is one tap from a chart.

export interface HomePageProps {
  displayName: string;
  mode: 'mock' | 'live';
  equityUsd: number;
  freeUsd: number;
  /** Change in equity over the last 24h, in dollars. */
  change24hUsd: number;
  positions: Position[];
  movers: MarketRow[];
  loading?: boolean;
  onOpenFlow: (k: Exclude<FlowKind, null> | 'trade') => void;
  onSelectMarket: (symbol: string) => void;
  onSeeAllPositions: () => void;
  onSeeAllMarkets: () => void;
}

export default function HomePage(props: HomePageProps) {
  const {
    displayName, mode, equityUsd, freeUsd, change24hUsd, positions, movers,
    loading, onOpenFlow, onSelectMarket, onSeeAllPositions, onSeeAllMarkets,
  } = props;

  const open = positions.filter(p => p.mode === mode);
  const unrealised = open.reduce((s, p) => s + p.unrealisedUsd, 0);
  const changePct = equityUsd - change24hUsd !== 0
    ? (change24hUsd / Math.abs(equityUsd - change24hUsd)) * 100
    : 0;

  // Largest absolute movers first — a −40% is as much a reason to look as a
  // +40%, and sorting by signed value would bury every short setup.
  const ranked = [...movers]
    .filter(m => Number.isFinite(m.change24hPct))
    .sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct))
    .slice(0, 6);

  return (
    <div className="flex flex-col h-full overflow-y-auto thin-scrollbar">

      {/* ── equity ── */}
      <div className="px-3 pt-3 pb-2.5">
        <div className="flex items-center justify-between">
          <Label>{mode === 'live' ? 'Account value' : 'Mock balance'}</Label>
          <span className={`${t.label} normal-case tracking-normal`}>{displayName}</span>
        </div>

        <p className={`${num} text-[32px] font-bold leading-none mt-1`}>
          {fmtUsd(equityUsd, false)}
        </p>

        <div className="flex items-baseline gap-1.5 mt-1">
          <span className={`${num} text-[12px] font-semibold ${tone(change24hUsd)}`}>
            {change24hUsd >= 0 ? '+' : ''}{fmtUsd(change24hUsd, false)}
          </span>
          <span className={`${num} text-[11px] ${tone(change24hUsd)}`}>
            {fmtPct(changePct, 2)}
          </span>
          <span className={t.label}>24h</span>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-2.5">
          <Stat label="Free" value={fmtUsd(freeUsd, false)} />
          <Stat label="Open P&L"
            value={`${unrealised >= 0 ? '+' : ''}${fmtUsd(unrealised, false)}`}
            tone={open.length ? (unrealised >= 0 ? 'up' : 'down') : undefined} />
          <Stat label="Positions" value={String(open.length)}
            tone={open.length ? 'accent' : undefined} />
        </div>

        <div className="mt-2.5">
          <ActionRow mode={mode} onAction={onOpenFlow} />
        </div>
      </div>

      {/* ── open risk ── */}
      {open.length > 0 && (
        <div className="px-3 pb-2.5">
          <div className="flex items-baseline justify-between mb-1.5">
            <Label>Open positions</Label>
            <button onClick={onSeeAllPositions} className="text-[10px] font-bold text-[#2BFFF1]">
              Manage
            </button>
          </div>
          <Panel pad={false}>
            {open.slice(0, 3).map((p, i) => (
              <button
                key={p.id}
                onClick={() => onSelectMarket(p.symbol)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 text-left ${
                  i > 0 ? 'border-t border-white/[0.05]' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={t.row}>{p.symbol}</span>
                    <span className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded ${
                      p.side === 'long'
                        ? 'text-[#10B981] bg-[#10B981]/10'
                        : 'text-[#EF4444] bg-[#EF4444]/10'}`}>
                      {p.side} {p.leverage}×
                    </span>
                    {!p.stop && (
                      <span className="text-[8px] font-bold uppercase tracking-wider text-[#F59E0B]">
                        No stop
                      </span>
                    )}
                  </div>
                  <span className={`${num} text-[9px] text-[#4B5563]`}>
                    {fmtUsd(p.notionalUsd)} at {fmtPrice(p.entry)}
                  </span>
                </div>
                <span className={`${num} text-[13px] font-bold ${tone(p.unrealisedUsd)}`}>
                  {p.unrealisedUsd >= 0 ? '+' : ''}{fmtUsd(p.unrealisedUsd, false)}
                </span>
              </button>
            ))}
            {open.length > 3 && (
              <button onClick={onSeeAllPositions}
                className={`${t.label} w-full py-1.5 border-t border-white/[0.05] text-[#2BFFF1]`}>
                {open.length - 3} more
              </button>
            )}
          </Panel>
        </div>
      )}

      {/* ── movers ── */}
      <div className="px-3 pb-4">
        <div className="flex items-baseline justify-between mb-1.5">
          <Label>Biggest moves today</Label>
          <button onClick={onSeeAllMarkets} className="text-[10px] font-bold text-[#2BFFF1]">
            All markets
          </button>
        </div>

        {loading ? (
          <Skeleton rows={5} />
        ) : ranked.length === 0 ? (
          <Empty
            message="No market data yet."
            actionLabel="Browse markets"
            onAction={onSeeAllMarkets}
          />
        ) : (
          <Panel pad={false}>
            {ranked.map((m, i) => {
              const up = m.change24hPct >= 0;
              return (
                <button
                  key={m.id}
                  onClick={() => onSelectMarket(m.symbol)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 text-left ${
                    i > 0 ? 'border-t border-white/[0.05]' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <span className={`${t.row} block truncate`}>{m.symbol}</span>
                    <span className="text-[9px] text-[#374151] truncate block">{m.name}</span>
                  </div>
                  <span className={`${num} text-[11px] font-semibold w-[70px] text-right`}>
                    {fmtPrice(m.price)}
                  </span>
                  <span className={`${num} text-[11px] font-bold w-[56px] text-right ${
                    up ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                    {up ? '+' : ''}{m.change24hPct.toFixed(1)}%
                  </span>
                </button>
              );
            })}
          </Panel>
        )}
      </div>

      {mode === 'mock' && (
        <div className="px-3 pb-4">
          <div className={`${surface.inset} p-2.5`}>
            <p className="text-[10px] text-[#6B7280] leading-relaxed">
              Mock mode. Trades execute against live prices with simulated fills, and no funds
              move. Everything you learn here transfers except the cost of being wrong.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
