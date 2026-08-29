import { useMemo, useState } from 'react';
import {
  Button, Chips, Empty, Label, Panel, Skeleton, Stat,
  fmtPct, fmtPrice, fmtUsd, num, surface, t, tone,
} from '../ui';

// ── Xenia — Positions ──────────────────────────────────────────────────────
//
// The screen KuCoin does best and most retail apps do worst. Two jobs:
//
//   1. WHAT AM I EXPOSED TO RIGHT NOW. Open risk, in one screenful, with the
//      distance to liquidation legible at a glance. That last part is what most
//      apps get wrong — they show a liquidation price as a number, which tells
//      you nothing without arithmetic. A bar showing how much of the gap to
//      liquidation you have already spent is readable in the half-second a
//      trader actually has.
//
//   2. AM I ANY GOOD. History with honest statistics.
//
// ── ON THE STATISTICS, WHICH IS WHERE THIS SCREEN EARNS ITS KEEP ───────────
//   Every retail app shows total P&L and win rate. Both are close to useless
//   alone and actively misleading together — a 70% win rate reads as skill and
//   is trivially produced by cutting winners and holding losers.
//
//   So this shows profit factor and average R alongside them, and refuses to
//   show any of it below 20 closed trades. At 10 trades the numbers are noise
//   with a decimal point, and displaying them teaches a user to trust a
//   measurement that has not been made yet. That restraint is the honest
//   version of the same lesson the research engine's promotion gate enforces:
//   a small sample is not a small amount of evidence, it is no evidence.

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entry: number;
  mark: number;
  size: number;
  notionalUsd: number;
  marginUsd: number;
  leverage: number;
  stop?: number;
  target?: number;
  liquidation?: number;
  unrealisedUsd: number;
  openedAt: number;
  mode: 'mock' | 'live';
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entry: number;
  exit: number;
  notionalUsd: number;
  pnlUsd: number;
  /** Result in multiples of initial risk. The only comparable unit across sizes. */
  rMultiple?: number;
  openedAt: number;
  closedAt: number;
  reason?: 'stop' | 'target' | 'manual' | 'liquidation';
  mode: 'mock' | 'live';
}

export interface PositionsPageProps {
  positions: Position[];
  history: ClosedTrade[];
  balanceUsd: number;
  mode: 'mock' | 'live';
  loading?: boolean;
  onClose: (id: string) => void;
  onCloseAll?: () => void;
  onSelectMarket?: (symbol: string) => void;
}

type View = 'open' | 'history';
type Window = '7d' | '30d' | 'all';

const MIN_SAMPLE = 20;

export default function PositionsPage(props: PositionsPageProps) {
  const { positions, history, balanceUsd, mode, loading, onClose, onCloseAll, onSelectMarket } = props;
  const [view, setView] = useState<View>('open');
  const [window, setWindow] = useState<Window>('30d');

  const open = useMemo(() => positions.filter(p => p.mode === mode), [positions, mode]);

  const closed = useMemo(() => {
    const cutoff = window === 'all' ? 0
      : Date.now() - (window === '7d' ? 7 : 30) * 86400_000;
    return history
      .filter(h => h.mode === mode && h.closedAt >= cutoff)
      .sort((a, b) => b.closedAt - a.closedAt);
  }, [history, mode, window]);

  const unrealised = open.reduce((s, p) => s + p.unrealisedUsd, 0);
  const marginUsed = open.reduce((s, p) => s + p.marginUsd, 0);
  const equity = balanceUsd + unrealised;

  const stats = useMemo(() => {
    const n = closed.length;
    if (n === 0) return null;
    const wins = closed.filter(c => c.pnlUsd > 0);
    const losses = closed.filter(c => c.pnlUsd < 0);
    const grossWin = wins.reduce((s, c) => s + c.pnlUsd, 0);
    const grossLoss = Math.abs(losses.reduce((s, c) => s + c.pnlUsd, 0));
    const rs = closed.map(c => c.rMultiple).filter((r): r is number => typeof r === 'number');
    return {
      n,
      net: closed.reduce((s, c) => s + c.pnlUsd, 0),
      winRate: (wins.length / n) * 100,
      // Infinity when there are no losses at all — which at a small sample is a
      // sign of too few trades, not of a perfect system.
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : Infinity,
      avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
      liquidations: closed.filter(c => c.reason === 'liquidation').length,
      enough: n >= MIN_SAMPLE,
    };
  }, [closed]);

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── equity ── */}
      <div className="px-3 pt-2 pb-2 border-b border-white/[0.06]">
        <Label>Equity</Label>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className={`${num} text-[26px] font-bold leading-none`}>{fmtUsd(equity, false)}</span>
          {open.length > 0 && (
            <span className={`${num} text-[12px] font-semibold ${tone(unrealised)}`}>
              {unrealised >= 0 ? '+' : ''}{fmtUsd(unrealised, false)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <Stat label="Free" value={fmtUsd(balanceUsd, false)} />
          <Stat label="In use" value={fmtUsd(marginUsed, false)} />
          <Stat label="Open" value={String(open.length)} tone={open.length ? 'accent' : undefined} />
        </div>
      </div>

      <div className="flex border-y border-white/[0.06] shrink-0">
        {(['open', 'history'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em]
                        border-b-2 transition-colors duration-[120ms] ${
              view === v ? 'border-[#2BFFF1] text-[#2BFFF1]' : 'border-transparent text-[#4B5563]'}`}
          >
            {v === 'open' ? `Open${open.length ? ` (${open.length})` : ''}` : 'History'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar px-3 py-2 space-y-2">

        {loading && <Skeleton rows={4} />}

        {/* ── open ── */}
        {!loading && view === 'open' && (
          open.length === 0 ? (
            <Empty message={`No open positions in ${mode} mode. Nothing at risk right now.`} />
          ) : (
            <>
              {open.map(p => {
                // How much of the room between entry and liquidation has been
                // used. This is the number that decides whether to act, and it
                // is arithmetic no user should have to do under pressure.
                const liqUsed = p.liquidation
                  ? Math.min(100, Math.max(0,
                      (Math.abs(p.mark - p.entry) / Math.abs(p.liquidation - p.entry)) * 100
                      * (((p.side === 'long' && p.mark < p.entry) ||
                          (p.side === 'short' && p.mark > p.entry)) ? 1 : 0)))
                  : 0;
                const danger = liqUsed > 60;
                return (
                  <Panel key={p.id}>
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => onSelectMarket?.(p.symbol)}
                        className="flex items-center gap-1.5 min-w-0"
                      >
                        <span className={t.row}>{p.symbol}</span>
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1 rounded ${
                          p.side === 'long'
                            ? 'text-[#10B981] bg-[#10B981]/10'
                            : 'text-[#EF4444] bg-[#EF4444]/10'}`}>
                          {p.side} {p.leverage}×
                        </span>
                      </button>
                      <div className="text-right">
                        <span className={`${num} text-[14px] font-bold ${tone(p.unrealisedUsd)}`}>
                          {p.unrealisedUsd >= 0 ? '+' : ''}{fmtUsd(p.unrealisedUsd, false)}
                        </span>
                        <span className={`${num} block text-[10px] ${tone(p.unrealisedUsd)}`}>
                          {fmtPct((p.unrealisedUsd / Math.max(p.marginUsd, 1e-9)) * 100, 1)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 mt-2">
                      <Stat label="Entry" value={fmtPrice(p.entry)} />
                      <Stat label="Mark" value={fmtPrice(p.mark)} />
                      <Stat label="Stop" value={p.stop ? fmtPrice(p.stop) : 'None'}
                        tone={p.stop ? undefined : 'warn'} />
                      <Stat label="Size" value={fmtUsd(p.notionalUsd)} />
                    </div>

                    {p.liquidation && (
                      <div className="mt-2">
                        <div className="flex items-baseline justify-between">
                          <Label>Distance to liquidation</Label>
                          <span className={`${num} text-[10px] font-semibold ${
                            danger ? 'text-[#EF4444]' : 'text-[#6B7280]'}`}>
                            {fmtPrice(p.liquidation)}
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-white/[0.06] mt-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${danger ? 'bg-[#EF4444]' : 'bg-[#F59E0B]'}`}
                            style={{ width: `${liqUsed}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {!p.stop && (
                      <p className="text-[10px] text-[#F59E0B] leading-snug mt-2">
                        No stop on this position. It closes when you close it or when it liquidates.
                      </p>
                    )}

                    <div className="mt-2">
                      <Button variant="ghost" size="sm" onClick={() => onClose(p.id)}>
                        Close position
                      </Button>
                    </div>
                  </Panel>
                );
              })}

              {open.length > 1 && onCloseAll && (
                <Button variant="danger" onClick={onCloseAll}>
                  Close all {open.length} positions
                </Button>
              )}
            </>
          )
        )}

        {/* ── history ── */}
        {!loading && view === 'history' && (
          <>
            <Chips
              value={window}
              onChange={setWindow}
              options={[
                { key: '7d', label: '7 days' },
                { key: '30d', label: '30 days' },
                { key: 'all', label: 'All time' },
              ]}
            />

            {stats && (
              <Panel>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Net P&L" value={`${stats.net >= 0 ? '+' : ''}${fmtUsd(stats.net, false)}`}
                    tone={stats.net >= 0 ? 'up' : 'down'} />
                  <Stat label="Trades" value={String(stats.n)} />
                  <Stat label="Win rate" value={`${stats.winRate.toFixed(0)}%`} />
                </div>

                <div className={`${surface.divider} my-2`} />

                {stats.enough ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="Profit factor"
                        value={Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}
                        tone={stats.profitFactor >= 1 ? 'up' : 'down'} />
                      <Stat label="Avg R"
                        value={stats.avgR !== null ? `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R` : '—'}
                        tone={stats.avgR !== null ? (stats.avgR >= 0 ? 'up' : 'down') : undefined} />
                      <Stat label="Liquidated" value={String(stats.liquidations)}
                        tone={stats.liquidations > 0 ? 'warn' : undefined} />
                    </div>
                    <p className="text-[10px] text-[#6B7280] leading-snug mt-2">
                      Profit factor is gross wins divided by gross losses. Below 1.0 the account
                      shrinks regardless of win rate.
                    </p>
                  </>
                ) : (
                  <p className="text-[10px] text-[#6B7280] leading-snug">
                    Profit factor and average R appear after {MIN_SAMPLE} closed trades.
                    You have {stats.n}. Below that the numbers move too much between trades
                    to describe anything — a high win rate over {stats.n} trades is as likely
                    to be luck as skill.
                  </p>
                )}
              </Panel>
            )}

            {closed.length === 0 ? (
              <Empty message={
                window === 'all'
                  ? 'No closed trades yet. Your history builds as positions close.'
                  : `No trades closed in the last ${window === '7d' ? '7' : '30'} days.`
              } />
            ) : closed.map(c => (
              <div key={c.id}
                className="flex items-center gap-2 py-1.5 border-b border-white/[0.035]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold">{c.symbol}</span>
                    <span className={`text-[8px] font-bold uppercase tracking-wider ${
                      c.side === 'long' ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                      {c.side}
                    </span>
                    {c.reason === 'liquidation' && (
                      <span className="text-[8px] font-bold uppercase tracking-wider
                                       text-[#EF4444] bg-[#EF4444]/10 px-1 rounded">
                        Liquidated
                      </span>
                    )}
                  </div>
                  <span className={`${num} text-[9px] text-[#4B5563]`}>
                    {fmtPrice(c.entry)} → {fmtPrice(c.exit)}
                    {c.reason && c.reason !== 'liquidation' ? ` · ${c.reason}` : ''}
                  </span>
                </div>
                <div className="text-right">
                  <span className={`${num} text-[12px] font-bold ${tone(c.pnlUsd)}`}>
                    {c.pnlUsd >= 0 ? '+' : ''}{fmtUsd(c.pnlUsd, false)}
                  </span>
                  {c.rMultiple !== undefined && (
                    <span className={`${num} block text-[9px] ${tone(c.rMultiple)}`}>
                      {c.rMultiple >= 0 ? '+' : ''}{c.rMultiple.toFixed(2)}R
                    </span>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
