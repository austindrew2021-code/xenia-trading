// ── Xenia — Live preflight ─────────────────────────────────────────────────
//
// The gate between "the research says this works" and "this is spending money
// that exists". Every condition here is one that has, in this project, already
// been the thing that made a result untrue. None of them are ceremony.
//
// This runs client-side, which means a determined user can bypass it. That is
// fine and correct — they own the keys and the funds. The gate exists so that
// nobody trades live by accident, not to take the decision away from them.

import { Features, testCausality } from './features';
import { enumerateSpecs, FAMILIES } from './strategy';
import { nullTest, walkForward } from './backtest';
import { Candle, FamilyName, RunConfig, StrategySpec } from './types';

export interface PreflightCheck {
  id: string;
  label: string;
  passed: boolean;
  /** Blocking checks stop live mode. Advisory ones only warn. */
  blocking: boolean;
  detail: string;
}

export interface PreflightInput {
  spec: StrategySpec;
  candles: Candle[];
  cfg: RunConfig;
  symbol: string;
  /** Total backtests ever run on this family/symbol/timeframe. Never reset it. */
  trialsSpent: number;
  /** Out-of-sample results on other pairs, if you ran them. */
  crossPair?: { symbol: string; oosExpectancy: number }[];
  /** ms since paper trading started, or null if it never has. */
  paperElapsedMs: number | null;
  requirePaperDays?: number;
  /** Realised vs modelled cost from runner.reconcile(). */
  costDrift?: number;
  /** True for spot venues, which cannot short and have no liquidation. */
  venueIsSpot: boolean;
  walletBackupConfirmed: boolean;
  walletFundedUsd: number;
  /** What the user says they can afford to lose entirely. */
  disposableUsd: number;
}

export function preflight(inp: PreflightInput): {
  checks: PreflightCheck[]; canGoLive: boolean; summary: string;
} {
  const checks: PreflightCheck[] = [];
  const add = (c: PreflightCheck) => checks.push(c);
  const requireDays = inp.requirePaperDays ?? 30;

  // ── 1. the engine is not lying ──────────────────────────────────────────
  const caus = testCausality(inp.candles, 20);
  add({
    id: 'causality', label: 'No lookahead in any feature', blocking: true, passed: caus.ok,
    detail: caus.ok
      ? `${caus.featuresChecked} features verified over ${caus.probes} probes.`
      : `These features can see the future: ${Object.keys(caus.violations).join(', ')}. `
      + `Every result built on them is void.`,
  });

  const specs: StrategySpec[] = [];
  for (const fam of Object.keys(FAMILIES) as FamilyName[]) {
    specs.push(...enumerateSpecs(fam, 3).slice(0, 8));
  }
  const nt = nullTest(specs, inp.cfg, 2500);
  add({
    id: 'null', label: 'No edge manufactured from noise', blocking: true, passed: nt.ok,
    detail: nt.ok
      ? `On a random walk, ${nt.n} specs average ${(nt.mean * 100).toFixed(2)}% per trade `
      + `against a ${(nt.expected * 100).toFixed(2)}% cost floor.`
      : `The engine produces positive expectancy on pure randomness. It has a hole. `
      + `Do not trade any result until it is found.`,
  });

  // ── 2. the strategy survived out of sample ──────────────────────────────
  const f = new Features(inp.candles, { tfHours: inp.cfg.tfHours });
  const wf = walkForward(inp.spec, f, inp.cfg, inp.symbol, Math.max(1, inp.trialsSpent));
  add({
    id: 'walkforward',
    label: 'Cleared the trials-adjusted bar out of sample',
    blocking: true,
    passed: !!wf?.passed,
    detail: wf
      ? `OOS profit factor ${wf.oosPfPooled.toFixed(2)} against a required ${wf.requiredPf.toFixed(2)} `
      + `after ${inp.trialsSpent} trials, on ${wf.oosN} trades, `
      + `${wf.foldsPositive} of ${wf.folds.length} folds positive.`
      : `Not enough out-of-sample trades to judge. Load more history or loosen the spec.`,
  });

  add({
    id: 'sample', label: 'Enough out-of-sample trades to mean anything', blocking: true,
    passed: (wf?.oosN ?? 0) >= 30,
    detail: `${wf?.oosN ?? 0} out-of-sample trades. Below 30, a profit factor is a story, not a measurement.`,
  });

  const pairsOk = (inp.crossPair ?? []).filter(p => p.oosExpectancy > 0).length;
  add({
    id: 'crosspair', label: 'Holds on other pairs', blocking: false,
    passed: pairsOk >= 3,
    detail: inp.crossPair?.length
      ? `Positive on ${pairsOk} of ${inp.crossPair.length}. A strategy that works on one pair `
      + `and no others is usually a coincidence.`
      : `Not tested on other pairs. Run it on at least five before sizing up.`,
  });

  // ── 3. the simulation matches the venue ─────────────────────────────────
  add({
    id: 'venue', label: 'Backtest matches the instrument you will trade', blocking: true,
    passed: !inp.venueIsSpot || inp.cfg.leverage === 1,
    detail: inp.venueIsSpot && inp.cfg.leverage !== 1
      ? `You tested at ${inp.cfg.leverage}× but this venue is spot — no margin, no liquidation. `
      + `You measured a different instrument. Re-run at 1×.`
      : inp.venueIsSpot
        ? `Spot at 1×. Liquidation and funding do not apply here.`
        : `Perpetuals. Liquidation sits ${((1 / inp.cfg.leverage - 0.005) * 100).toFixed(2)}% away at ${inp.cfg.leverage}×.`,
  });

  add({
    id: 'shorts', label: 'Strategy can actually be executed', blocking: true,
    passed: !inp.venueIsSpot || !isShortOnly(inp.spec),
    detail: inp.venueIsSpot && isShortOnly(inp.spec)
      ? `This spec is short-only and spot cannot short. It will never fire.`
      : `Executable on this venue.`,
  });

  // ── 4. paper first ──────────────────────────────────────────────────────
  const paperDays = inp.paperElapsedMs ? inp.paperElapsedMs / 86400000 : 0;
  add({
    id: 'paper', label: `${requireDays} days of paper trading`, blocking: true,
    passed: paperDays >= requireDays,
    detail: inp.paperElapsedMs
      ? `${paperDays.toFixed(1)} of ${requireDays} days complete.`
      : `No paper history. Paper is where you find out whether the fills are real.`,
  });

  if (inp.costDrift !== undefined) {
    add({
      id: 'cost', label: 'Realised costs match the model', blocking: true,
      passed: inp.costDrift < 0.5,
      detail: inp.costDrift < 0.5
        ? `Realised cost is within ${(inp.costDrift * 100).toFixed(0)}% of the modelled figure.`
        : `Realised cost is ${(inp.costDrift * 100).toFixed(0)}% above the model. Re-cost the `
        + `backtest at the real slippage before risking anything.`,
    });
  }

  // ── 5. the money ────────────────────────────────────────────────────────
  add({
    id: 'backup', label: 'Recovery phrase written down and verified', blocking: true,
    passed: inp.walletBackupConfirmed,
    detail: inp.walletBackupConfirmed
      ? `Verified. Nobody but you can restore this wallet — including us.`
      : `Not verified. Do not put funds in a wallet you cannot restore.`,
  });

  add({
    id: 'size', label: 'Only disposable funds in the trading wallet', blocking: true,
    passed: inp.walletFundedUsd <= inp.disposableUsd,
    detail: inp.walletFundedUsd <= inp.disposableUsd
      ? `$${inp.walletFundedUsd.toFixed(2)} funded against $${inp.disposableUsd.toFixed(2)} you said you can lose.`
      : `$${inp.walletFundedUsd.toFixed(2)} is more than the $${inp.disposableUsd.toFixed(2)} you called `
      + `disposable. A browser wallet that signs unattended is a hot wallet. Move the rest out.`,
  });

  const blockers = checks.filter(c => c.blocking && !c.passed);
  return {
    checks,
    canGoLive: blockers.length === 0,
    summary: blockers.length === 0
      ? `All ${checks.filter(c => c.blocking).length} blocking checks passed.`
      : `${blockers.length} blocking ${blockers.length === 1 ? 'check' : 'checks'} failed: `
      + blockers.map(b => b.label.toLowerCase()).join('; ') + '.',
  };
}

function isShortOnly(spec: StrategySpec): boolean {
  const shortTriggers = new Set([
    'sweep_high', 'eqh_sweep', 'pdh_reject', 'choch_down', 'bos_down_retest',
    'bear_fvg_fill', 'bear_ob_tap', 'poc_revert_down', 'avwap_reject',
    'div_bear', 'hidden_div_bear',
  ]);
  return shortTriggers.has(spec.trigger);
}
