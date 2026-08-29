// ── Xenia — Marketplace bot fees ──────────────────────────────────────────
//
// Thin client over the settlement function in
// supabase/migrations/20260828_bot_fees.sql.
//
// All the rules live in Postgres, not here, and that is deliberate. A fee that
// is computed client-side is a fee anyone can compute differently — the numbers
// have to be decided in one place that the client cannot talk around. This file
// calls that place and renders what it returns.
//
// The four invariants, enforced by the database:
//   1. profits only        — a losing trade is never charged
//   2. live only           — mock profits never move a real balance
//   3. never self-charge   — running your own bot is free
//   4. exactly once        — unique index on source_trade_id; a replay is a no-op
//
// Verified against PostgreSQL 16: a replayed trade returns null and leaves the
// balance untouched; an underfunded settlement raises and rolls the ledger row
// back rather than recording a charge that never moved.

import { supabase } from './supabase';

/** Xenia's cut, matching the "Xenia adds 0.1%" in the Bot Market copy. */
export const PLATFORM_FEE_PCT = 0.001;

/** Ceiling an author may set. The editor caps here and so does the database. */
export const MAX_AUTHOR_FEE_PCT = 0.05;

export interface FeePreview {
  grossProfitUsd: number;
  authorFeeUsd: number;
  platformFeeUsd: number;
  totalFeeUsd: number;
  netToFollowerUsd: number;
  chargeable: boolean;
  reason: string | null;
}

/**
 * What a trade WOULD cost. Display only — the database recomputes everything at
 * settlement, so a mismatch here changes nothing about what is charged. Useful
 * for showing a follower the cost before they deploy.
 */
export function previewFee(o: {
  grossProfitUsd: number;
  authorFeePct: number;
  isClone: boolean;
  isLive: boolean;
  isOwnBot: boolean;
}): FeePreview {
  const zero = (reason: string): FeePreview => ({
    grossProfitUsd: o.grossProfitUsd, authorFeeUsd: 0, platformFeeUsd: 0,
    totalFeeUsd: 0, netToFollowerUsd: o.grossProfitUsd, chargeable: false, reason,
  });

  if (!o.isClone) return zero('Not a marketplace bot — no fee.');
  if (o.isOwnBot) return zero('Your own bot — no fee.');
  if (!o.isLive) return zero('Mock mode — no fee is charged on practice profits.');
  if (!(o.grossProfitUsd > 0)) return zero('Fees apply to profits only.');

  const authorPct = Math.min(Math.max(o.authorFeePct, 0), MAX_AUTHOR_FEE_PCT);
  let authorFeeUsd = o.grossProfitUsd * authorPct;
  let platformFeeUsd = o.grossProfitUsd * PLATFORM_FEE_PCT;
  let total = authorFeeUsd + platformFeeUsd;

  // Mirrors the database's clamp so the preview cannot promise less than is taken.
  if (total > o.grossProfitUsd) {
    authorFeeUsd = o.grossProfitUsd * (authorFeeUsd / total);
    platformFeeUsd = o.grossProfitUsd - authorFeeUsd;
    total = o.grossProfitUsd;
  }

  return {
    grossProfitUsd: o.grossProfitUsd,
    authorFeeUsd, platformFeeUsd, totalFeeUsd: total,
    netToFollowerUsd: o.grossProfitUsd - total,
    chargeable: true, reason: null,
  };
}

/**
 * Settle a closed trade. Call this once per close, from wherever a bot position
 * is finalised.
 *
 * `tradeId` is the idempotency key and must be STABLE for the trade — a database
 * row id, not a timestamp and not a random value. If it changes between retries,
 * the unique index cannot recognise the replay and the follower is charged twice.
 *
 * Returns the ledger id when a fee was taken, or null when none was due. Null is
 * the common case, not a failure.
 */
export async function settleBotTradeFee(o: {
  tradeId: string;
  cloneBotId: string;
  followerId: string;
  profitUsd: number;
  mode: 'mock' | 'live';
}): Promise<{ ok: boolean; ledgerId: number | null; error?: string }> {
  if (!supabase) return { ok: false, ledgerId: null, error: 'no client' };

  const { data, error } = await supabase.rpc('record_bot_trade_fee', {
    p_trade_id: o.tradeId,
    p_clone_bot_id: o.cloneBotId,
    p_follower_id: o.followerId,
    p_profit_usd: o.profitUsd,
    p_mode: o.mode,
    p_platform_pct: PLATFORM_FEE_PCT,
  });

  if (error) {
    // An underfunded settlement raises rather than silently skipping, so the
    // ledger never records a charge that did not move. Surface it — a follower
    // whose balance cannot cover the fee needs to know, not to be ignored.
    return { ok: false, ledgerId: null, error: error.message };
  }
  return { ok: true, ledgerId: (data as number | null) ?? null };
}

export interface AuthorEarnings {
  earnedUsd: number;
  withdrawnUsd: number;
  claimableUsd: number;
}

export async function getAuthorEarnings(authorId: string): Promise<AuthorEarnings> {
  if (!supabase) return { earnedUsd: 0, withdrawnUsd: 0, claimableUsd: 0 };
  const { data } = await supabase
    .from('bot_earnings')
    .select('earned_usd, withdrawn_usd')
    .eq('author_id', authorId)
    .maybeSingle();
  const earned = Number(data?.earned_usd ?? 0);
  const withdrawn = Number(data?.withdrawn_usd ?? 0);
  return { earnedUsd: earned, withdrawnUsd: withdrawn, claimableUsd: Math.max(earned - withdrawn, 0) };
}

export interface BotEarningsRow {
  sourceBotId: string;
  chargedTrades: number;
  payingFollowers: number;
  followerGrossProfitUsd: number;
  authorFeesUsd: number;
}

export async function getPerBotEarnings(authorId: string): Promise<BotEarningsRow[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('bot_author_summary')
    .select('source_bot_id, charged_trades, paying_followers, follower_gross_profit_usd, author_fees_usd')
    .eq('author_id', authorId);
  return (data ?? []).map((r: any) => ({
    sourceBotId: r.source_bot_id,
    chargedTrades: Number(r.charged_trades ?? 0),
    payingFollowers: Number(r.paying_followers ?? 0),
    followerGrossProfitUsd: Number(r.follower_gross_profit_usd ?? 0),
    authorFeesUsd: Number(r.author_fees_usd ?? 0),
  }));
}

/**
 * Move earned fees into the author's tradable balance.
 *
 * This is a LEDGER move, not a payout. The balance it credits is the same
 * database balance the rest of the app uses; the actual SOL is in the user's own
 * wallet, so getting it out is a separate on-chain withdrawal. Do not tell an
 * author they have "been paid" — they have been credited.
 */
export async function claimEarnings(authorId: string, amountUsd?: number): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.rpc('claim_bot_earnings', {
    p_author_id: authorId,
    p_amount: amountUsd ?? null,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Recent charges, for both sides. RLS restricts rows to the two parties. */
export async function getFeeHistory(userId: string, limit = 50) {
  if (!supabase) return [];
  const { data } = await supabase
    .from('bot_fee_ledger')
    .select('*')
    .or(`author_id.eq.${userId},follower_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    role: r.author_id === userId ? ('author' as const) : ('follower' as const),
    grossProfitUsd: Number(r.gross_profit_usd),
    authorFeeUsd: Number(r.author_fee_usd),
    platformFeeUsd: Number(r.platform_fee_usd),
    createdAt: r.created_at as string,
  }));
}
