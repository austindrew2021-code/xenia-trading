// ── Xenia — Velocity Builder Codes (VBC) ──────────────────────────────────
//
// Routed leverage. Positions live on Velocity; they run the book, the oracle and
// the liquidation engine. We attach a builder code to each order and are paid a
// fee per fill, on top of their taker fee, into our own RevenueShareAccount.
//
// We are not the counterparty. We hold no collateral, we set no maintenance
// margin, we do not decide when anyone is liquidated, and we owe nothing when a
// position goes bad. That is the whole reason to route rather than to build.
//
// ─────────────────────────────────────────────────────────────────────────────
// NOTE ON THE PROTOCOL NAME
// Drift's builder-code docs now resolve to Velocity Protocol, which ships a
// "Migrate from Drift" guide. Instruction names below are taken from the live
// Velocity docs (August 2026). Confirm the relationship between the two before
// you register anything, and check the exact SDK method signatures against
// docs.velocity.exchange/developers/velocity-sdk/builder-codes — the instruction
// NAMES here are from the docs, the SDK call SHAPES are behind the adapter
// interface below precisely so a signature change is a one-file edit.
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// UNITS — get this wrong by 10x and you either earn nothing or get rejected
// ═══════════════════════════════════════════════════════════════════════════
//
//   fee_tenth_bps is TENTHS OF A BASIS POINT.
//     10   = 1 bp   = 0.01%
//     100  = 10 bps = 0.1%
//     1000 = 100 bps = 1%   <- protocol hard ceiling
//
//   builder_fee = notional * fee_tenth_bps / 100_000

/** Protocol ceiling. Anything above this is rejected regardless of user approval. */
export const MAX_BUILDER_FEE_TENTH_BPS = 1000;

export const bpsToTenthBps = (bps: number) => Math.round(bps * 10);
export const tenthBpsToBps = (t: number) => t / 10;

export function builderFeeUsd(notionalUsd: number, feeTenthBps: number): number {
  return (notionalUsd * feeTenthBps) / 100_000;
}

/**
 * Our fee. 25 tenth-bps = 2.5 bps.
 *
 * Sizing rationale: the builder fee is charged ON TOP of Velocity's taker fee
 * and does not reduce their cut, so every tenth-bp here is a straight increase
 * in what the user pays versus trading on Velocity's own front end. Perp traders
 * compare across frontends in seconds. At 2.5 bps a round trip costs 5 bps more
 * than going direct — small enough that better tooling justifies it. At 10 bps
 * you have doubled or tripled their cost and they will simply leave.
 *
 * The protocol lets you charge 100 bps. That number is a ceiling, not a target.
 */
export const XENIA_BUILDER_FEE_TENTH_BPS = 25;

/**
 * What we ask the user to approve. Set above the fee we actually charge so that
 * a later increase does not force every existing user through approval again —
 * but not far above, because the approval is the user's protection and a huge
 * headroom request is the kind of thing people are right to refuse.
 */
export const XENIA_APPROVAL_MAX_TENTH_BPS = 50;   // 5 bps ceiling, we charge 2.5

// Do NOT set this equal to XENIA_BUILDER_FEE_TENTH_BPS. An approval cap that
// exactly equals the fee leaves no headroom: the protocol enforces the cap, so
// any future increase — or any rounding in how a venue applies it — rejects the
// order rather than charging less. It also means every existing user must
// re-approve before you can change the fee at all. Headroom is not laxity, it is
// the difference between a fee change and a migration.
if (XENIA_APPROVAL_MAX_TENTH_BPS <= XENIA_BUILDER_FEE_TENTH_BPS) {
  throw new Error('Approval cap must exceed the charged fee. See the note above.');
}

// ═══════════════════════════════════════════════════════════════════════════
// SDK ADAPTER
// ═══════════════════════════════════════════════════════════════════════════
//
// Everything the Velocity SDK does, behind one interface. If their signatures
// move, this is the only file that changes.

export interface VelocityAdapter {
  /** One-time, for us: creates the RevenueShareAccount that receives fees. */
  initializeRevenueShare(): Promise<{ signature: string }>;

  /** One-time, per user: creates their RevenueShareEscrow. numOrders >= 1. */
  initializeRevenueShareEscrow(o: { numOrders: number }): Promise<{ signature: string }>;

  /** Per user: approves us as a builder with a maximum fee they consent to. */
  changeApprovedBuilder(o: {
    builderPubkey: string;
    maxFeeTenthBps: number;
  }): Promise<{ signature: string }>;

  /** Reads the user's escrow so we know whether they have approved us, and at what cap. */
  getRevenueShareEscrow(userPubkey: string): Promise<{
    exists: boolean;
    approvedBuilders: { builderPubkey: string; maxFeeTenthBps: number }[];
    accruedRows: { orderId: number; feesAccrued: number; marketIndex: number; complete: boolean }[];
  } | null>;

  placePerpOrder(o: {
    marketIndex: number;
    direction: 'long' | 'short';
    baseAssetAmount: bigint;
    price?: bigint;
    orderType: 'market' | 'limit';
    reduceOnly?: boolean;
    builderIdx: number;
    builderFeeTenthBps: number;
  }): Promise<{ signature: string; orderId: number }>;

  /** Builder-coded orders cannot be modified — this is the replacement. */
  cancelAndPlaceOrders(o: {
    cancelOrderIds: number[];
    place: Parameters<VelocityAdapter['placePerpOrder']>[0][];
  }): Promise<{ signature: string }>;

  /**
   * Our collection path. Anyone can call it; we call it for ourselves.
   * The real SDK signature is
   *   settleRevenueShare(escrowAuthority, escrow: RevenueShareEscrowAccount, marketIndex)
   * — it needs the DECODED ESCROW ACCOUNT, not a sub-account count. The adapter
   * fetches it. Earlier drafts of this passed `numSubAccounts` and would not
   * have compiled against the SDK.
   */
  settleRevenueShare(o: {
    escrowOwner: string;
    marketIndex: number;
  }): Promise<{ signature: string }>;

  getRevenueShareAccountBalance(): Promise<{ balanceUsdc: number }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════════════════════════════════════════

export type OnboardingState =
  | 'no_escrow'          // user has never set up revenue share
  | 'not_approved'       // escrow exists, we are not in approvedBuilders
  | 'cap_too_low'        // approved, but below the fee we charge
  | 'ready';

export interface OnboardingStatus {
  state: OnboardingState;
  approvedMaxTenthBps: number | null;
  builderIdx: number | null;
  /** What to show the user. Written for them, not for us. */
  message: string;
  actionLabel: string | null;
}

export async function checkOnboarding(
  sdk: VelocityAdapter, userPubkey: string, builderPubkey: string,
): Promise<OnboardingStatus> {
  const escrow = await sdk.getRevenueShareEscrow(userPubkey);

  if (!escrow || !escrow.exists) {
    return {
      state: 'no_escrow', approvedMaxTenthBps: null, builderIdx: null,
      message: 'One-time setup before your first leveraged trade. This creates the '
        + 'account that tracks fees on Velocity.',
      actionLabel: 'Set up',
    };
  }

  const idx = escrow.approvedBuilders.findIndex(b => b.builderPubkey === builderPubkey);
  if (idx === -1) {
    return {
      state: 'not_approved', approvedMaxTenthBps: null, builderIdx: null,
      message: `Approve Xenia to route your orders. We charge `
        + `${tenthBpsToBps(XENIA_BUILDER_FEE_TENTH_BPS)} bps of position size per fill, on top of `
        + `Velocity's own fee. You set the ceiling and the protocol rejects anything above it.`,
      actionLabel: 'Approve',
    };
  }

  const approved = escrow.approvedBuilders[idx].maxFeeTenthBps;
  if (approved < XENIA_BUILDER_FEE_TENTH_BPS) {
    return {
      state: 'cap_too_low', approvedMaxTenthBps: approved, builderIdx: idx,
      message: `Your approved ceiling is ${tenthBpsToBps(approved)} bps, below our `
        + `${tenthBpsToBps(XENIA_BUILDER_FEE_TENTH_BPS)} bps fee, so orders would be rejected. `
        + `Raise it or trade spot instead.`,
      actionLabel: 'Raise ceiling',
    };
  }

  return {
    state: 'ready', approvedMaxTenthBps: approved, builderIdx: idx,
    message: `Approved up to ${tenthBpsToBps(approved)} bps. We charge `
      + `${tenthBpsToBps(XENIA_BUILDER_FEE_TENTH_BPS)} bps.`,
    actionLabel: null,
  };
}

export async function runOnboarding(
  sdk: VelocityAdapter, status: OnboardingStatus, builderPubkey: string,
): Promise<void> {
  if (status.state === 'no_escrow') {
    await sdk.initializeRevenueShareEscrow({ numOrders: 8 });
  }
  if (status.state === 'no_escrow' || status.state === 'not_approved' || status.state === 'cap_too_low') {
    await sdk.changeApprovedBuilder({
      builderPubkey, maxFeeTenthBps: XENIA_APPROVAL_MAX_TENTH_BPS,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════

export const CANNOT_MODIFY_BUILDER_ORDER = 6366;   // 0x18de

/**
 * Place an order carrying our builder code.
 *
 * The RevenueShareEscrow account must be in the transaction or the fill fails.
 * The SDK derives it from the user pubkey with no extra RPC call, but if you
 * ever hand-roll the instruction, that account is the thing you will forget.
 */
export async function placeRoutedOrder(
  sdk: VelocityAdapter,
  o: {
    marketIndex: number;
    direction: 'long' | 'short';
    baseAssetAmount: bigint;
    price?: bigint;
    orderType: 'market' | 'limit';
    reduceOnly?: boolean;
    builderIdx: number;
  },
): Promise<{ signature: string; orderId: number }> {
  return sdk.placePerpOrder({
    ...o,
    builderIdx: o.builderIdx,
    builderFeeTenthBps: XENIA_BUILDER_FEE_TENTH_BPS,
  });
}

/**
 * A builder-coded order CANNOT be modified — modifyOrder rejects it with 6366.
 *
 * The reason is worth knowing rather than just routing around: fee attribution
 * lives in an escrow row keyed to the order id. A modify cancels and re-places
 * under a new id, which orphans the row and silently drops the fee. So the
 * protocol refuses rather than letting you lose money quietly.
 *
 * Any "edit order" affordance in the UI must call this, in one transaction, or
 * the user is briefly flat during a leveraged trade.
 */
export async function amendRoutedOrder(
  sdk: VelocityAdapter,
  o: {
    cancelOrderIds: number[];
    replacements: Omit<Parameters<typeof placeRoutedOrder>[1], 'builderIdx'> & { builderIdx: number }[];
  },
): Promise<{ signature: string }> {
  const place = (o.replacements as unknown as Parameters<VelocityAdapter['placePerpOrder']>[0][])
    .map(r => ({ ...r, builderFeeTenthBps: XENIA_BUILDER_FEE_TENTH_BPS }));
  return sdk.cancelAndPlaceOrders({ cancelOrderIds: o.cancelOrderIds, place });
}

// ═══════════════════════════════════════════════════════════════════════════
// WHEN THE FEE IS NOT CHARGED
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The builder fee is a transfer out of the taker's account, so it clears the
 * same gate a withdrawal clears. It is waived — the fill still happens, we just
 * are not paid — when:
 *
 *   • the taker is below INITIAL margin at fill time
 *   • any liability oracle is invalid, or fails the conservative price/TWAP test
 *   • the fill is a liquidation
 *
 * This matters for forecasting. A user running near their margin limit, which
 * describes most leveraged retail, generates fills you do not earn on. Model
 * revenue on the fills you are actually paid for, not on gross volume, and treat
 * any projection that assumes 100% capture as optimistic.
 */
export function expectedCaptureRate(o: {
  /** Share of fills where the taker sits comfortably above initial margin. */
  healthyMarginShare: number;
  /** Share of fills that are liquidations. */
  liquidationShare: number;
  /** Oracle staleness/invalidity rate. Small, but not zero on volatile alts. */
  oracleFailShare?: number;
}): { rate: number; note: string } {
  const oracle = o.oracleFailShare ?? 0.01;
  const rate = Math.max(0, o.healthyMarginShare * (1 - o.liquidationShare) * (1 - oracle));
  return {
    rate,
    note: `Expect to be paid on ${(rate * 100).toFixed(0)}% of fills. `
      + `Gross notional x fee overstates revenue by ${((1 - rate) * 100).toFixed(0)}%.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION — the part that is easy to skip and expensive to skip
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fees accrue into the USER's escrow, not into our account. They move only when
 * someone calls settlePnl or settleRevenueShare.
 *
 * settlePnl is the user's call and it only sweeps while they still have PnL to
 * settle on that market. So a user who opens, closes, takes their money and
 * never returns leaves our fee sitting in escrow permanently. The docs are
 * explicit that builders should not wait on users for this.
 *
 * settleRevenueShare is permissionless — we call it for ourselves. That makes
 * collection a scheduled job, not an event handler. If you ship VBC without this
 * running, you will accrue revenue you never receive and the dashboard will
 * happily show it as earned.
 */
export interface SweepTarget {
  escrowOwner: string;
  marketIndex: number;
  accruedUsdc: number;
}

export interface SweepResult {
  attempted: number;
  succeeded: number;
  collectedUsdc: number;
  skippedBelowThreshold: number;
  failures: { owner: string; marketIndex: number; error: string }[];
}

/**
 * Each sweep is a transaction and costs a fee, so sweeping a $0.004 row loses
 * money. Batch by owner+market and skip anything under the threshold until it
 * accumulates.
 */
export async function sweepRevenueShare(
  sdk: VelocityAdapter,
  targets: SweepTarget[],
  o: { minUsdcPerSweep?: number; maxPerRun?: number; onLog?: (m: string) => void } = {},
): Promise<SweepResult> {
  const min = o.minUsdcPerSweep ?? 0.50;
  const max = o.maxPerRun ?? 50;
  const log = o.onLog ?? (() => {});

  const worth = targets
    .filter(t => t.accruedUsdc >= min)
    .sort((a, b) => b.accruedUsdc - a.accruedUsdc)
    .slice(0, max);

  const result: SweepResult = {
    attempted: worth.length, succeeded: 0, collectedUsdc: 0,
    skippedBelowThreshold: targets.length - worth.length, failures: [],
  };

  for (const t of worth) {
    try {
      await sdk.settleRevenueShare({
        escrowOwner: t.escrowOwner,
        marketIndex: t.marketIndex,
      });
      result.succeeded++;
      result.collectedUsdc += t.accruedUsdc;
      log(`swept $${t.accruedUsdc.toFixed(2)} from ${t.escrowOwner.slice(0, 6)}… market ${t.marketIndex}`);
    } catch (e) {
      result.failures.push({
        owner: t.escrowOwner, marketIndex: t.marketIndex, error: (e as Error).message,
      });
    }
  }

  log(`sweep complete: $${result.collectedUsdc.toFixed(2)} from ${result.succeeded}/${result.attempted}, `
    + `${result.skippedBelowThreshold} rows left to accumulate`);
  return result;
}

/**
 * A row can become unpayable — a delisted market, a beneficiary with no payout
 * account, a closed pool smaller than the row. Those block the market's
 * pendingRevenueShare from reaching zero, which blocks the delist. Writing them
 * off moves no tokens; it is housekeeping, and the protocol rejects the call if
 * the row could still be paid.
 *
 * Run it rarely, and never as a way to tidy up rows you simply have not swept.
 */
export const FORFEIT_GUIDANCE =
  'Only forfeit rows the protocol confirms are unpayable. If settleRevenueShare '
  + 'would still work, forfeiting is throwing away your own revenue.';
