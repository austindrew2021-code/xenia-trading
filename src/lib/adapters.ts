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

/** Existing store position: LONG/SHORT, `pnl`, `status`, `source`. */
export function toPosition(p: any, mode: 'mock' | 'live'): Position {
  const entry = Number(p.entry ?? p.entryPrice ?? 0);
  const mark = Number(p.mark ?? p.currentPrice ?? p.markPrice ?? entry);
  const leverage = Number(p.leverage ?? p.lev ?? 1);
  const marginUsd = Number(p.size ?? p.margin ?? p.marginUsd ?? 0);
  return {
    id: String(p.id ?? `${p.asset ?? p.symbol}-${p.openedAt ?? p.createdAt ?? 0}`),
    symbol: String(p.asset ?? p.symbol ?? '—'),
    side: String(p.side).toUpperCase() === 'SHORT' ? 'short' : 'long',
    entry,
    mark,
    size: Number(p.qty ?? p.size ?? 0),
    notionalUsd: marginUsd * leverage,
    marginUsd,
    leverage,
    stop: numOrUndef(p.sl ?? p.stop ?? p.stopLoss),
    target: numOrUndef(p.tp ?? p.target ?? p.takeProfit),
    liquidation: numOrUndef(p.liq ?? p.liquidation ?? p.liqPrice)
      ?? liqFrom(entry, leverage, String(p.side).toUpperCase() === 'SHORT'),
    unrealisedUsd: Number(p.pnl ?? 0),
    openedAt: Number(p.openedAt ?? p.createdAt ?? Date.now()),
    mode,
  };
}

export function toClosedTrade(p: any, mode: 'mock' | 'live'): ClosedTrade {
  const entry = Number(p.entry ?? p.entryPrice ?? 0);
  const exit = Number(p.exit ?? p.exitPrice ?? p.closePrice ?? 0);
  const marginUsd = Number(p.size ?? p.margin ?? 0);
  const leverage = Number(p.leverage ?? p.lev ?? 1);
  const pnlUsd = Number(p.pnl ?? 0);
  const stop = numOrUndef(p.sl ?? p.stop);

  // R is only meaningful when a stop existed — it is the unit of risk, and
  // without one there was no defined risk to divide by. Inventing a denominator
  // would make an undisciplined trade look measurable.
  const riskUsd = stop && entry
    ? marginUsd * leverage * (Math.abs(entry - stop) / entry)
    : 0;

  return {
    id: String(p.id ?? `${p.asset ?? p.symbol}-${p.closedAt ?? 0}`),
    symbol: String(p.asset ?? p.symbol ?? '—'),
    side: String(p.side).toUpperCase() === 'SHORT' ? 'short' : 'long',
    entry,
    exit,
    notionalUsd: marginUsd * leverage,
    pnlUsd,
    rMultiple: riskUsd > 0 ? pnlUsd / riskUsd : undefined,
    openedAt: Number(p.openedAt ?? p.createdAt ?? 0),
    closedAt: Number(p.closedAt ?? p.updatedAt ?? Date.now()),
    reason: reasonOf(p),
    mode,
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

/** Maintenance margin 0.5%. Replace with the venue's real figure before live. */
function liqFrom(entry: number, leverage: number, isShort: boolean): number | undefined {
  if (!entry || leverage <= 1) return undefined;
  const d = 1 / leverage - 0.005;
  return isShort ? entry * (1 + d) : entry * (1 - d);
}

function reasonOf(p: any): ClosedTrade['reason'] {
  const s = String(p.status ?? p.closeReason ?? p.reason ?? '').toLowerCase();
  if (s.includes('liq')) return 'liquidation';
  if (s.includes('stop') || s === 'sl') return 'stop';
  if (s.includes('target') || s.includes('tp')) return 'target';
  return 'manual';
}

/** Evenly sample a long price array down to n points for a sparkline. */
function sample(arr: number[], n: number): number[] {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}
