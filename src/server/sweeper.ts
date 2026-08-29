#!/usr/bin/env node
// ── Xenia — Revenue sweeper daemon ────────────────────────────────────────
//
// Builder fees accrue into each USER's RevenueShareEscrow, not into our account.
// They move only on settlePnl (the user's call, and only while they still have
// PnL to settle on that market) or settleRevenueShare (permissionless — ours).
//
// A user who opens, closes, withdraws and never returns strands our fee forever.
// So collection is a daemon, not an event handler. Run it on a schedule.
//
// ─────────────────────────────────────────────────────────────────────────────
// BUGS THIS AVOIDS, ALL FROM THE OBVIOUS VERSION OF THIS SCRIPT
//
// 1. GUESSED ACCOUNT SIZE. A getProgramAccounts filter with a hardcoded
//    `dataSize: 450` returns exactly nothing the moment that guess is wrong, and
//    it fails SILENTLY — an empty result is indistinguishable from "no fees to
//    collect". You would watch a working dashboard and collect nothing for
//    weeks. Discovery here is driven by our OWN record of who we onboarded,
//    which we already have because we ran the approval flow for them.
//
// 2. UNIT MISMATCH ON THE THRESHOLD. `row.feesAccrued > 0.50` compares a raw
//    on-chain integer against dollars. USDC has 6 decimals, so $0.50 is 500_000
//    and every dust row passes the check. You then spend a transaction fee to
//    collect a fraction of a cent, on every row, forever. Convert first.
//
// 3. ONE TRANSACTION PER ROW. settleRevenueShare takes a marketIndex and sweeps
//    the rows for that market in one call. Looping per row sends N transactions
//    where one would do, and pays N fees.
//
// 4. NO BACKOFF, NO IDEMPOTENCY. A failing escrow retried every 10 minutes
//    forever burns fees and rate limit. Failures here back off exponentially and
//    a sweep already in flight is not re-sent.
// ─────────────────────────────────────────────────────────────────────────────
//
// VERIFY BEFORE RUNNING AGAINST MAINNET
// The SDK call shapes live behind VelocityAdapter (see builderCodes.ts). Check
// them against docs.velocity.exchange/developers/velocity-sdk/builder-codes.
// Run against devnet first and confirm the swept amount matches what the escrow
// reported before it was swept.

import {
  SweepTarget, VelocityAdapter, sweepRevenueShare,
} from '../engine/builderCodes';

const USDC_DECIMALS = 6;
const RAW_PER_USDC = 10 ** USDC_DECIMALS;

/** Raw on-chain integer -> dollars. Bug 2 lives wherever this is skipped. */
export const rawToUsdc = (raw: number | bigint): number =>
  Number(raw) / RAW_PER_USDC;

export interface SweeperConfig {
  /** Skip rows below this. Each sweep costs a transaction fee. */
  minUsdcPerSweep: number;
  /** Cap per run so one pass cannot exhaust the RPC rate limit. */
  maxSweepsPerRun: number;
  intervalMs: number;
  /** Give up on an escrow after this many consecutive failures. */
  maxRetries: number;
  dryRun: boolean;
}

export const DEFAULT_SWEEPER_CONFIG: SweeperConfig = {
  minUsdcPerSweep: 0.50,
  maxSweepsPerRun: 50,
  intervalMs: 15 * 60_000,
  maxRetries: 6,
  dryRun: true,          // deliberately safe. Flip it once devnet reconciles.
};

/**
 * Where the list of users comes from.
 *
 * We know every user we onboarded, because we ran initializeRevenueShareEscrow
 * and changeApprovedBuilder for them and stored the pubkey. That list is
 * authoritative and cheap. Scraping the chain for escrows with a guessed layout
 * is neither.
 */
export interface OnboardedUserStore {
  /** Every pubkey that has ever approved us as a builder. */
  listApprovedUsers(): Promise<{ pubkey: string }[]>;
  /** Markets we have ever routed an order on. Rows are per market. */
  listRoutedMarkets(): Promise<number[]>;
  recordSweep(r: { owner: string; marketIndex: number; usdc: number; signature?: string }): Promise<void>;
}

interface FailureState { consecutive: number; nextAttemptAt: number }

export class RevenueSweeper {
  private failures = new Map<string, FailureState>();
  private inFlight = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private totalCollected = 0;

  constructor(
    private sdk: VelocityAdapter,
    private store: OnboardedUserStore,
    private cfg: SweeperConfig = DEFAULT_SWEEPER_CONFIG,
    private log: (m: string, level?: 'info' | 'warn' | 'error') => void = console.log,
  ) {}

  private key(owner: string, market: number) { return `${owner}:${market}`; }

  /** Exponential backoff, capped. Bug 4. */
  private shouldSkip(k: string): boolean {
    if (this.inFlight.has(k)) return true;
    const f = this.failures.get(k);
    if (!f) return false;
    if (f.consecutive >= this.cfg.maxRetries) return true;
    return Date.now() < f.nextAttemptAt;
  }

  private noteFailure(k: string) {
    const f = this.failures.get(k) ?? { consecutive: 0, nextAttemptAt: 0 };
    f.consecutive++;
    const backoff = Math.min(2 ** f.consecutive * 60_000, 6 * 3600_000);
    f.nextAttemptAt = Date.now() + backoff;
    this.failures.set(k, f);
    if (f.consecutive >= this.cfg.maxRetries) {
      this.log(`giving up on ${k} after ${f.consecutive} failures — inspect manually`, 'warn');
    }
  }

  /**
   * Read every approved user's escrow and build the list worth sweeping.
   * Amounts are converted from raw units here, once, so nothing downstream can
   * compare an integer to a dollar figure.
   */
  async discover(): Promise<SweepTarget[]> {
    const users = await this.store.listApprovedUsers();
    const targets: SweepTarget[] = [];

    for (const u of users) {
      let escrow;
      try {
        escrow = await this.sdk.getRevenueShareEscrow(u.pubkey);
      } catch (e) {
        this.log(`could not read escrow for ${u.pubkey.slice(0, 8)}…: ${(e as Error).message}`, 'warn');
        continue;
      }
      if (!escrow?.exists) continue;

      // Rows are per market, and settleRevenueShare sweeps a market at a time.
      // So aggregate by market and send one call each — not one per row. Bug 3.
      const byMarket = new Map<number, number>();
      for (const row of escrow.accruedRows) {
        if (row.complete) continue;
        const usdc = rawToUsdc(row.feesAccrued);
        byMarket.set(row.marketIndex, (byMarket.get(row.marketIndex) ?? 0) + usdc);
      }

      for (const [marketIndex, accruedUsdc] of byMarket) {
        const k = this.key(u.pubkey, marketIndex);
        if (this.shouldSkip(k)) continue;
        targets.push({ escrowOwner: u.pubkey, marketIndex, accruedUsdc });
      }
    }
    return targets;
  }

  async runOnce(): Promise<{ collectedUsdc: number; swept: number; pending: number }> {
    const targets = await this.discover();
    const worth = targets.filter(t => t.accruedUsdc >= this.cfg.minUsdcPerSweep);
    const pendingUsdc = targets
      .filter(t => t.accruedUsdc < this.cfg.minUsdcPerSweep)
      .reduce((a, t) => a + t.accruedUsdc, 0);

    this.log(`discovered ${targets.length} escrow/market pairs — `
      + `${worth.length} above $${this.cfg.minUsdcPerSweep.toFixed(2)}, `
      + `$${pendingUsdc.toFixed(2)} accumulating below threshold`);

    if (this.cfg.dryRun) {
      const total = worth.reduce((a, t) => a + t.accruedUsdc, 0);
      this.log(`DRY RUN — would sweep $${total.toFixed(2)} across ${worth.length} calls. `
        + `Set dryRun: false once devnet reconciles.`, 'warn');
      return { collectedUsdc: 0, swept: 0, pending: targets.length };
    }

    for (const t of worth) this.inFlight.add(this.key(t.escrowOwner, t.marketIndex));

    const result = await sweepRevenueShare(this.sdk, worth, {
      minUsdcPerSweep: this.cfg.minUsdcPerSweep,
      maxPerRun: this.cfg.maxSweepsPerRun,
      onLog: m => this.log(m),
    });

    for (const t of worth) {
      const k = this.key(t.escrowOwner, t.marketIndex);
      this.inFlight.delete(k);
      const failed = result.failures.some(
        f => f.owner === t.escrowOwner && f.marketIndex === t.marketIndex,
      );
      if (failed) this.noteFailure(k);
      else {
        this.failures.delete(k);
        await this.store.recordSweep({
          owner: t.escrowOwner, marketIndex: t.marketIndex, usdc: t.accruedUsdc,
        });
      }
    }

    this.totalCollected += result.collectedUsdc;
    for (const f of result.failures) {
      this.log(`sweep failed ${f.owner.slice(0, 8)}… market ${f.marketIndex}: ${f.error}`, 'error');
    }
    return {
      collectedUsdc: result.collectedUsdc,
      swept: result.succeeded,
      pending: targets.length - result.succeeded,
    };
  }

  /**
   * Reconciliation. The on-chain balance is the truth; our running total is a
   * belief. If they diverge, believe the chain and find out why — a sweeper that
   * reports collections it did not make is worse than one that does not run.
   */
  async reconcile(): Promise<{ onChainUsdc: number; expectedUsdc: number; driftUsdc: number; ok: boolean }> {
    const { balanceUsdc } = await this.sdk.getRevenueShareAccountBalance();
    const drift = balanceUsdc - this.totalCollected;
    return {
      onChainUsdc: balanceUsdc,
      expectedUsdc: this.totalCollected,
      driftUsdc: drift,
      ok: Math.abs(drift) < 1,
    };
  }

  start() {
    if (this.timer) return;
    this.log(`sweeper starting — every ${this.cfg.intervalMs / 60_000} min, `
      + `min $${this.cfg.minUsdcPerSweep}, ${this.cfg.dryRun ? 'DRY RUN' : 'LIVE'}`);
    void this.runOnce();
    this.timer = setInterval(() => { void this.runOnce(); }, this.cfg.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.log('sweeper stopped');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRYPOINT
// ═══════════════════════════════════════════════════════════════════════════
//
// The wallet this runs as needs SOL for transaction fees and nothing else. It
// signs settleRevenueShare, which moves fees from escrow to our RevenueShare
// account and can do nothing else — so give it a dedicated keypair, not the
// treasury key, and fund it with a few SOL.
//
// Env:
//   VELOCITY_RPC_URL         paid RPC endpoint
//   SWEEPER_KEYPAIR_PATH     dedicated keypair, fee-payer only
//   BUILDER_PUBKEY           our registered builder account
//   SWEEPER_DRY_RUN          'false' to actually send. Defaults to dry run.

export function configFromEnv(env: Record<string, string | undefined>): SweeperConfig {
  return {
    ...DEFAULT_SWEEPER_CONFIG,
    dryRun: env.SWEEPER_DRY_RUN !== 'false',
    minUsdcPerSweep: Number(env.SWEEPER_MIN_USDC ?? DEFAULT_SWEEPER_CONFIG.minUsdcPerSweep),
    intervalMs: Number(env.SWEEPER_INTERVAL_MS ?? DEFAULT_SWEEPER_CONFIG.intervalMs),
  };
}
