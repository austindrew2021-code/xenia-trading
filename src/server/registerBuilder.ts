#!/usr/bin/env node
// ── Xenia — Master Builder Account registration ───────────────────────────
//
// One-time. Creates the RevenueShareAccount that receives builder fees.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IS VERIFIED HERE AND WHAT IS NOT
//
// Verified from the live protocol docs (Aug 2026):
//   • builders need an existing account on the venue, plus a RevenueShareAccount
//     created via the `initializeRevenueShare` instruction
//   • users approve via `changeApprovedBuilder(builderPubkey, maxFeeTenthBps)`
//   • fees are tenths of a basis point, ceiling 1000 (= 1% of notional)
//
// NOT verified: the exact SDK method signatures. The docs page with code
// examples was not reachable when this was written. So every SDK call sits
// behind `BuilderRegistrationSdk` below, and `preflight()` fails loudly if a
// method is missing rather than throwing something cryptic halfway through
// registration. Fill the adapter in from the SDK's own docs or its .d.ts, run
// against devnet, and only then point it at mainnet.
//
// Do not "fix" a missing-method error by guessing a name that compiles. A
// registration that half-succeeds leaves an account you cannot find and cannot
// re-create.
// ─────────────────────────────────────────────────────────────────────────────
//
// VENUE CHOICE, BEFORE ANY OF THIS
// Velocity is a fork of Drift v2 with its own program deployment. Both offer
// builder codes. A fork with a reduced feature set will usually have less
// liquidity, and on perps that reaches the user as worse fills — which costs
// them more than our 2.5 bps saves them. Compare open interest and book depth on
// the markets you intend to route BEFORE registering.

import { MAX_BUILDER_FEE_TENTH_BPS, XENIA_BUILDER_FEE_TENTH_BPS, tenthBpsToBps } from '../engine/builderCodes';

export interface BuilderRegistrationSdk {
  /** Our wallet's pubkey, base58. */
  getAuthority(): string;
  /** Does a trading account already exist for this authority? */
  hasUserAccount(): Promise<boolean>;
  /** Create the venue trading account. Required before RevenueShare. */
  initializeUserAccount(o: { subAccountId: number; name?: string }): Promise<{ signature: string }>;
  /** Does the RevenueShareAccount already exist? Makes this script re-runnable. */
  hasRevenueShareAccount(): Promise<boolean>;
  /** The registration itself. */
  initializeRevenueShare(): Promise<{ signature: string }>;
  /** Read it back. Never trust a signature as proof the state is what you expect. */
  fetchRevenueShareAccount(): Promise<{
    exists: boolean;
    authority: string;
    builderPubkey: string;
    totalFeesEarned: number;
  } | null>;
  getSolBalance(): Promise<number>;
}

export interface RegistrationResult {
  builderPubkey: string;
  authority: string;
  signatures: string[];
  alreadyExisted: boolean;
}

const REQUIRED_METHODS: (keyof BuilderRegistrationSdk)[] = [
  'getAuthority', 'hasUserAccount', 'initializeUserAccount',
  'hasRevenueShareAccount', 'initializeRevenueShare',
  'fetchRevenueShareAccount', 'getSolBalance',
];

export interface PreflightReport {
  ok: boolean;
  checks: { label: string; passed: boolean; detail: string }[];
}

/**
 * Everything that can be checked without sending a transaction. Registration is
 * one-time and creates on-chain state, so the failure to avoid is the one that
 * happens halfway through.
 */
export async function preflight(
  sdk: BuilderRegistrationSdk, o: { cluster: 'devnet' | 'mainnet-beta'; minSol?: number },
): Promise<PreflightReport> {
  const checks: PreflightReport['checks'] = [];
  const minSol = o.minSol ?? 0.1;

  const missing = REQUIRED_METHODS.filter(m => typeof (sdk as any)[m] !== 'function');
  checks.push({
    label: 'SDK adapter is complete',
    passed: missing.length === 0,
    detail: missing.length
      ? `Not implemented: ${missing.join(', ')}. Fill these in from the SDK docs. `
        + `Do not guess names that happen to compile.`
      : `All ${REQUIRED_METHODS.length} methods present.`,
  });
  if (missing.length) return { ok: false, checks };

  checks.push({
    label: 'Fee is inside the protocol ceiling',
    passed: XENIA_BUILDER_FEE_TENTH_BPS <= MAX_BUILDER_FEE_TENTH_BPS,
    detail: `${XENIA_BUILDER_FEE_TENTH_BPS} tenth-bps = ${tenthBpsToBps(XENIA_BUILDER_FEE_TENTH_BPS)} bps `
      + `of notional. Ceiling is ${MAX_BUILDER_FEE_TENTH_BPS} (100 bps).`,
  });

  // A fee that looks reasonable in bps is brutal on notional. At 10x, 20 bps of
  // notional is 2% of the user's collateral per fill.
  checks.push({
    label: 'Fee is competitive rather than merely legal',
    passed: XENIA_BUILDER_FEE_TENTH_BPS <= 50,
    detail: XENIA_BUILDER_FEE_TENTH_BPS <= 50
      ? `At 10x leverage this costs ${(tenthBpsToBps(XENIA_BUILDER_FEE_TENTH_BPS) * 10 / 100).toFixed(2)}% `
        + `of the user's collateral per fill.`
      : `At 10x this is ${(tenthBpsToBps(XENIA_BUILDER_FEE_TENTH_BPS) * 10 / 100).toFixed(2)}% of the user's `
        + `collateral per fill, on top of the venue's own fee. They will trade elsewhere.`,
  });

  const sol = await sdk.getSolBalance();
  checks.push({
    label: 'Authority funded for fees',
    passed: sol >= minSol,
    detail: `${sol.toFixed(4)} SOL (need ~${minSol} for account rent and fees).`,
  });

  const hasUser = await sdk.hasUserAccount();
  checks.push({
    label: 'Venue trading account exists',
    passed: true,
    detail: hasUser ? 'Present.' : 'Missing — will be created first, as registration requires it.',
  });

  const hasRs = await sdk.hasRevenueShareAccount();
  checks.push({
    label: 'Not already registered',
    passed: true,
    detail: hasRs ? 'RevenueShareAccount already exists. This run will be a no-op.' : 'Not yet registered.',
  });

  checks.push({
    label: 'Cluster',
    passed: o.cluster === 'devnet',
    detail: o.cluster === 'devnet'
      ? 'Devnet. Correct for a first run.'
      : 'Mainnet. Only proceed if the whole flow has already succeeded on devnet.',
  });

  return { ok: checks.every(c => c.passed), checks };
}

export async function registerBuilder(
  sdk: BuilderRegistrationSdk,
  o: { cluster: 'devnet' | 'mainnet-beta'; force?: boolean; log?: (m: string) => void },
): Promise<RegistrationResult> {
  const log = o.log ?? console.log;
  const signatures: string[] = [];

  const pre = await preflight(sdk, { cluster: o.cluster });
  for (const c of pre.checks) log(`  ${c.passed ? 'ok  ' : 'FAIL'} ${c.label} — ${c.detail}`);
  if (!pre.ok && !o.force) {
    throw new Error('Preflight failed. Fix the checks above, or pass force for the cluster warning only.');
  }

  if (await sdk.hasRevenueShareAccount()) {
    const acct = await sdk.fetchRevenueShareAccount();
    log('Already registered — nothing to do.');
    return {
      builderPubkey: acct?.builderPubkey ?? sdk.getAuthority(),
      authority: sdk.getAuthority(),
      signatures: [],
      alreadyExisted: true,
    };
  }

  if (!(await sdk.hasUserAccount())) {
    log('Creating venue trading account…');
    const r = await sdk.initializeUserAccount({ subAccountId: 0, name: 'Xenia Builder' });
    signatures.push(r.signature);
  }

  log('Creating RevenueShareAccount…');
  const r = await sdk.initializeRevenueShare();
  signatures.push(r.signature);

  // Read the state back. A confirmed signature means the transaction landed, not
  // that the account holds what you think it holds.
  const acct = await sdk.fetchRevenueShareAccount();
  if (!acct?.exists) {
    throw new Error(
      `Transaction ${r.signature} confirmed but no RevenueShareAccount is readable. `
      + `Do NOT re-run blindly — inspect the transaction first.`,
    );
  }
  if (acct.authority !== sdk.getAuthority()) {
    throw new Error(
      `RevenueShareAccount authority is ${acct.authority} but we signed as ${sdk.getAuthority()}. `
      + `Fees would accrue to an account we do not control. Stop and investigate.`,
    );
  }

  log(`Registered. Builder pubkey: ${acct.builderPubkey}`);
  log('Put this in BUILDER_PUBKEY. It is what users approve and what the sweeper collects to.');

  return {
    builderPubkey: acct.builderPubkey,
    authority: sdk.getAuthority(),
    signatures,
    alreadyExisted: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GO-LIVE GATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The sweeper ships with dryRun: true. This is the check that earns turning it
 * off — not "the code looks clean", but "a real sweep on devnet moved the amount
 * the escrow said it would".
 *
 * The reason to insist: a sweeper that sends transactions against wrong
 * assumptions burns SOL on every cycle and reports success while collecting
 * nothing. The dry run costs one devnet session. Skipping it costs however long
 * it takes someone to notice.
 */
export interface GoLiveEvidence {
  registeredOnDevnet: boolean;
  approvalFlowTested: boolean;
  /** Deliberately approve below our fee and confirm the order is rejected. */
  lowCapRejectionTested: boolean;
  devnetSweepCount: number;
  devnetSweptUsdc: number;
  /** What the escrow reported before the sweep. */
  devnetExpectedUsdc: number;
}

export function canDisableDryRun(e: GoLiveEvidence): { ok: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!e.registeredOnDevnet) blockers.push('builder account not registered on devnet');
  if (!e.approvalFlowTested) blockers.push('user approval flow not run end to end');
  if (!e.lowCapRejectionTested) {
    blockers.push('the too-low-cap rejection path has not been seen — test it before a user finds it');
  }
  // Without this, a variance of 0 from ZERO sweeps passes the variance check.
  // A gate that only compares numbers is satisfied by never producing any.
  if (e.devnetSweepCount < 1) blockers.push('no successful devnet sweep — zero variance from zero sweeps is not evidence');
  const drift = Math.abs(e.devnetSweptUsdc - e.devnetExpectedUsdc);
  if (e.devnetSweepCount > 0 && drift > 0.01) {
    blockers.push(
      `devnet sweep moved $${e.devnetSweptUsdc.toFixed(4)} but the escrow reported `
      + `$${e.devnetExpectedUsdc.toFixed(4)} — reconcile before trusting the accounting`,
    );
  }
  return { ok: blockers.length === 0, blockers };
}
