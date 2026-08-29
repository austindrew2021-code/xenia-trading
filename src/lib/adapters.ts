import type { MarketRow } from '../pages/MarketListPage';
import type { ClosedTrade, Position } from '../pages/PositionsPage';

// ── Xenia — Adapters ───────────────────────────────────────────────────────
//
// The seam between the existing store/Supabase shapes and the new screens.
//
// WHY A SEAM RATHER THAN CHANGING THE INTERFACES
//   The screens define what they need; the store describes what exists today.
//   Those drift for good reasons — a new venue names a field differently, a
//   column gets renamed in Supabase, the pump pipeline returns a different
//   payload from the spot one. Every one of those changes should touch this
//   file and nothing else. Widening the screen interfaces to accept whatever
//   arrives is how a UI ends up full of `?? 0` and quietly renders zeros where
//   it should render an error.
//
// ON `any` AT THE BOUNDARY
//   The store's own types are not imported here on purpose. This file's job is
//   to be the one place that tolerates an unknown shape and produces a known
//   one. Everything downstream is strict.

/**
 * Store `Position` → screen `Position`. Field names verified against
 * src/store.ts and src/types.ts rather than inferred:
 *   entryPrice, size (margin), leverage, notional, liquidationPrice,
 *   takeProfitPrice, stopLossPrice, openedAt, closedAt, closePrice,
 *   status: 'open' | 'closed' | 'liquidated', pnl, pnlPct, openedBy.
 */
export function toPosition(p: any, markPrice?: number): Position {
  const entry = Number(p.entryPrice ?? 0);
  const size = Number(p.size ?? 0);
  const leverage = Number(p.leverage ?? 1);
  return {
    id: String(p.id),
    symbol: String(p.asset ?? '—'),
    side: p.side === 'SHORT' ? 'short' : 'long',
    entry,
    // The store holds no mark. Pass the live price in; falling back to entry
    // makes an untracked position read as flat rather than as a fabricated
    // number, and flat is the honest answer when there is no quote.
    mark: Number(markPrice ?? entry),
    // `size` is margin in this store; quantity is derived.
    size: entry > 0 ? (size * leverage) / entry : 0,
    notionalUsd: Number(p.notional ?? size * leverage),
    marginUsd: size,
    leverage,
    stop: p.stopLossPrice ?? undefined,
    target: p.takeProfitPrice ?? undefined,
    liquidation: p.liquidationPrice ?? undefined,
    unrealisedUsd: Number(p.pnl ?? 0),
    openedAt: Number(p.openedAt ?? Date.now()),
    mode: (p.mode ?? 'mock') as 'mock' | 'live',
  };
}

/**
 * Store `Position` with status closed/liquidated → `ClosedTrade`.
 *
 * R is computed only when a stop existed. R is a multiple of *defined* risk,
 * and a trade opened without a stop had none — dividing by margin instead would
 * make an undisciplined trade look measurable and quietly flatter the average.
 */
export function toClosedTrade(p: any): ClosedTrade {
  const entry = Number(p.entryPrice ?? 0);
  const size = Number(p.size ?? 0);
  const leverage = Number(p.leverage ?? 1);
  const pnlUsd = Number(p.pnl ?? 0);
  const stop = p.stopLossPrice ?? null;
  const riskUsd = stop && entry > 0
    ? size * leverage * (Math.abs(entry - Number(stop)) / entry)
    : 0;

  return {
    id: String(p.id),
    symbol: String(p.asset ?? '—'),
    side: p.side === 'SHORT' ? 'short' : 'long',
    entry,
    exit: Number(p.closePrice ?? 0),
    notionalUsd: Number(p.notional ?? size * leverage),
    pnlUsd,
    rMultiple: riskUsd > 0 ? pnlUsd / riskUsd : undefined,
    openedAt: Number(p.openedAt ?? 0),
    closedAt: Number(p.closedAt ?? Date.now()),
    reason: p.status === 'liquidated' ? 'liquidation'
      : p.openedBy && p.openedBy !== 'manual' ? 'stop'
      : 'manual',
    mode: (p.mode ?? 'mock') as 'mock' | 'live',
  };
}

/** TOP_ASSETS / searchPumpTokens / MarketsPage rows → MarketRow. */
export function toMarketRow(a: any): MarketRow {
  return {
    id: String(a.id ?? a.address ?? a.symbol),
    symbol: String(a.symbol ?? a.label ?? a.id ?? '—').toUpperCase(),
    name: String(a.name ?? a.label ?? ''),
    mint: a.address ?? a.mint ?? undefined,
    price: Number(a.priceUsd ?? a.price ?? 0),
    change24hPct: Number(a.change24h ?? a.priceChange24h ?? 0),
    volume24hUsd: Number(a.volume24h ?? a.volumeUsd24h ?? a.volume ?? 0),
    liquidityUsd: numOrUndef(a.liquidity ?? a.liquidityUsd),
    marketCapUsd: numOrUndef(a.marketCap ?? a.mcap ?? a.fdv),
    createdAt: numOrUndef(a.createdAt ?? a.pairCreatedAt),
    spark: Array.isArray(a.spark) ? a.spark.map(Number)
      : Array.isArray(a.prices) ? sample(a.prices.map(Number), 24)
      : undefined,
    devHoldingPct: numOrUndef(a.devHoldingPct ?? a.devHolding),
    mintAuthorityLive: typeof a.mintAuthorityLive === 'boolean' ? a.mintAuthorityLive
      : typeof a.mintAuthority === 'string' ? a.mintAuthority.length > 0
      : undefined,
    lpLocked: typeof a.lpLocked === 'boolean' ? a.lpLocked : undefined,
    isWatchlisted: Boolean(a.isWatchlisted),
  };
}

/** Existing account row → the mode the rest of the app should assume. */
export const modeOf = (account: any): 'mock' | 'live' =>
  account?.use_real ? 'live' : 'mock';

/**
 * Total equity the way the header already computes it, kept in one place so the
 * dashboard and the header cannot disagree — they did before.
 */
export function equityOf(account: any): number {
  if (!account) return 0;
  return account.use_real
    ? Number(account.real_balance ?? 0)
      + Number(account.spot_live_balance ?? 0)
      + Number(account.bot_balance ?? 0)
    : Number(account.mock_balance ?? 0) + Number(account.bot_mock_balance ?? 0);
}

export const freeOf = (account: any): number =>
  account ? Number(account.use_real ? account.real_balance : account.mock_balance) || 0 : 0;

// ── helpers ────────────────────────────────────────────────────────────────

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

/** Evenly sample a long price array down to n points for a sparkline. */
function sample(arr: number[], n: number): number[] {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}
