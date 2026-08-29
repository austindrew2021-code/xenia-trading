// ── Xenia — Velocity SDK adapter ──────────────────────────────────────────
//
// Signatures below are read from the SHIPPED TYPE DEFINITIONS of
// @velocity-exchange/sdk@0.17.0, not from prose docs. Verify after any SDK
// upgrade with:
//
//   grep -n "initializeRevenueShare\|changeApprovedBuilder\|settleRevenueShare" \
//     node_modules/@velocity-exchange/sdk/lib/node/velocityClient.d.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// VERIFIED SIGNATURES (velocityClient.d.ts)
//
//   initializeRevenueShare(authority: PublicKey, txParams?): Promise<TransactionSignature>
//   initializeRevenueShareEscrow(authority: PublicKey, numOrders: number, txParams?)
//   changeApprovedBuilder(builder: PublicKey, maxFeeTenthBps: number, add: boolean, txParams?)
//   settleRevenueShare(escrowAuthority: PublicKey, escrow: RevenueShareEscrowAccount,
//                      marketIndex: number, txParams?)
//   forfeitRevenueShareOrder(escrowAuthority, escrow, marketIndex, orderIndex, txParams?)
//
// Three things this corrects:
//
//   1. changeApprovedBuilder takes FOUR arguments. The third, `add: boolean`, is
//      what distinguishes granting an approval from revoking one. Any two-arg
//      call is wrong.
//   2. settleRevenueShare takes the DECODED ESCROW ACCOUNT, not a sub-account
//      count. You must fetch the escrow before you can sweep it — which the
//      sweeper already does during discovery, so pass the object through rather
//      than re-deriving anything.
//   3. Amounts are BN at QUOTE_PRECISION (1e6). `feesAccrued` is a BN, so any
//      comparison against a dollar figure has to convert first. This is the
//      units bug, again, now with a type that makes it obvious.
//
// The npm package is @velocity-exchange/sdk. @velocity-protocol/sdk does not
// exist — it 404s on the registry.
// ─────────────────────────────────────────────────────────────────────────────

import type { PublicKey } from '@solana/web3.js';
import type { VelocityAdapter } from './builderCodes';

/** QUOTE_PRECISION. Every fee amount in the SDK is a BN at this scale. */
export const QUOTE_PRECISION = 1_000_000;

/** BN | bigint | number -> dollars. The only sanctioned conversion. */
export function quoteToUsd(v: { toString(): string } | number | bigint): number {
  return Number(v.toString()) / QUOTE_PRECISION;
}

/** Bit set on RevenueShareOrder.bitFlags when the slot has been completed. */
export const ORDER_FLAG_COMPLETED = 0b100;

/**
 * Structural type for the SDK client. Typed loosely on purpose: pinning the real
 * VelocityClient type here would couple the build to one SDK version, and the
 * point of the adapter is that it does not.
 */
export interface VelocityClientLike {
  initializeRevenueShare(authority: PublicKey, txParams?: unknown): Promise<string>;
  initializeRevenueShareEscrow(authority: PublicKey, numOrders: number, txParams?: unknown): Promise<string>;
  changeApprovedBuilder(builder: PublicKey, maxFeeTenthBps: number, add: boolean, txParams?: unknown): Promise<string>;
  settleRevenueShare(escrowAuthority: PublicKey, escrow: any, marketIndex: number, txParams?: unknown): Promise<string>;
  forfeitRevenueShareOrder(escrowAuthority: PublicKey, escrow: any, marketIndex: number, orderIndex: number, txParams?: unknown): Promise<string>;
  placePerpOrder(orderParams: any, txParams?: unknown): Promise<string>;
  cancelAndPlaceOrders(...args: any[]): Promise<string>;
  program: { account: { revenueShareEscrow: { fetchNullable(addr: PublicKey): Promise<any> } } };
}

export interface AdapterDeps {
  client: VelocityClientLike;
  /** Our registered builder authority. */
  builderAuthority: PublicKey;
  toPublicKey(base58: string): PublicKey;
  /** Derive the escrow PDA from a user pubkey. From the SDK's own helper. */
  deriveEscrowPda(userAuthority: PublicKey): PublicKey;
}

/**
 * Escrow accounts are needed twice — to read accruals, and to pass into
 * settleRevenueShare. Caching the decoded account per sweep cycle avoids
 * fetching the same account twice per user.
 */
export function createVelocityAdapter(deps: AdapterDeps): VelocityAdapter & {
  rawEscrow(userPubkey: string): Promise<any | null>;
} {
  const escrowCache = new Map<string, any>();

  async function rawEscrow(userPubkey: string): Promise<any | null> {
    if (escrowCache.has(userPubkey)) return escrowCache.get(userPubkey);
    const pda = deps.deriveEscrowPda(deps.toPublicKey(userPubkey));
    const acct = await deps.client.program.account.revenueShareEscrow.fetchNullable(pda);
    escrowCache.set(userPubkey, acct);
    return acct;
  }

  return {
    rawEscrow,

    async initializeRevenueShare() {
      const signature = await deps.client.initializeRevenueShare(deps.builderAuthority);
      return { signature };
    },

    async initializeRevenueShareEscrow({ numOrders }) {
      // numOrders sizes a ring buffer of in-flight fee slots. Too small and
      // accruals from concurrent orders overwrite each other's slots; 32 is
      // cheap and comfortably above what a retail account will have open.
      const signature = await deps.client.initializeRevenueShareEscrow(
        deps.builderAuthority, Math.max(numOrders, 1),
      );
      return { signature };
    },

    async changeApprovedBuilder({ builderPubkey, maxFeeTenthBps }) {
      // The fourth argument is the one the prose docs omit. `true` grants;
      // `false` revokes. Passing nothing is not "default true", it is a
      // signature mismatch.
      const signature = await deps.client.changeApprovedBuilder(
        deps.toPublicKey(builderPubkey), maxFeeTenthBps, true,
      );
      return { signature };
    },

    async getRevenueShareEscrow(userPubkey) {
      const acct = await rawEscrow(userPubkey);
      if (!acct) return null;
      return {
        exists: true,
        approvedBuilders: (acct.approvedBuilders ?? [])
          // maxFeeTenthBps === 0 means the approval was REVOKED, not that it is
          // unset. Treating a revoked builder as approved makes every order fail.
          .filter((b: any) => b && b.maxFeeTenthBps > 0)
          .map((b: any) => ({
            builderPubkey: b.authority.toBase58(),
            maxFeeTenthBps: b.maxFeeTenthBps,
          })),
        accruedRows: (acct.orders ?? []).map((r: any) => ({
          orderId: r.orderId,
          // BN at 1e6 -> raw number. The sweeper converts to dollars once.
          feesAccrued: Number(r.feesAccrued.toString()),
          marketIndex: r.marketIndex,
          complete: (r.bitFlags & ORDER_FLAG_COMPLETED) !== 0,
        })),
      };
    },

    async placePerpOrder(o) {
      const signature = await deps.client.placePerpOrder({
        marketIndex: o.marketIndex,
        direction: o.direction,
        baseAssetAmount: o.baseAssetAmount,
        price: o.price,
        orderType: o.orderType,
        reduceOnly: o.reduceOnly,
        builderIdx: o.builderIdx,
        builderFeeTenthBps: o.builderFeeTenthBps,
      });
      return { signature, orderId: -1 };   // read the real id from the event/account
    },

    async cancelAndPlaceOrders(o) {
      const signature = await deps.client.cancelAndPlaceOrders(o.cancelOrderIds, o.place);
      return { signature };
    },

    async settleRevenueShare({ escrowOwner, marketIndex }) {
      const escrow = await rawEscrow(escrowOwner);
      if (!escrow) throw new Error(`No escrow account for ${escrowOwner}`);
      const signature = await deps.client.settleRevenueShare(
        deps.toPublicKey(escrowOwner), escrow, marketIndex,
      );
      escrowCache.delete(escrowOwner);   // stale after a sweep
      return { signature };
    },

    async getRevenueShareAccountBalance() {
      // RevenueShareAccount.totalBuilderRewards is a BN at QUOTE_PRECISION.
      const acct = await (deps.client as any).program?.account?.revenueShare
        ?.fetchNullable?.(deps.builderAuthority);
      return { balanceUsdc: acct ? quoteToUsd(acct.totalBuilderRewards) : 0 };
    },
  };
}
