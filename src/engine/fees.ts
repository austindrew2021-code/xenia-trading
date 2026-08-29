// ── Xenia — Fees, margin and liquidation ───────────────────────────────────
//
// ONE FILE, ONE SET OF NUMBERS.
//
// Every fee the user pays, every fee the platform earns, the maintenance margin,
// and the liquidation price all live here. The UI reads them from here. The
// backtest reads them from here. The live engine reads them from here.
//
// That is not tidiness, it is the point. The failure mode this prevents is a
// platform that displays one liquidation price and liquidates at another —
// whether by intent or by two functions drifting apart over six months. Both
// look identical to the user, both are reconstructable from trade history, and
// both end the platform when someone plots it. There is exactly one
// liquidationPrice() and the display calls it.
//
// If you ever find yourself wanting a second one, that is the signal to stop.

// ═══════════════════════════════════════════════════════════════════════════
// SPOT
// ═══════════════════════════════════════════════════════════════════════════
//
// Collected via Jupiter's platformFeeBps on the /quote call. Jupiter charges no
// protocol fee of its own; the bps you set is taken out of the swap and lands in
// a token account you own. No custody, no invoicing, no settlement.
//
// Benchmarks as of early 2026 — verify before you publish a schedule, these move:
//   Jupiter's own UI          0 bps
//   Most Solana wallets    50–85 bps   (Phantom sits near the top of that)
//   Binance spot              10 bps   (but that is a CEX with custody)
//
// 20 bps undercuts every wallet a Solana trader currently uses while being real
// revenue. Going to 0 to "buy users" mostly buys people who leave for the next
// zero. Going above 50 puts you in Phantom's bracket with none of Phantom's
// distribution.

export interface SpotTier {
  name: string;
  /** 30-day volume in USD required to reach this tier. */
  minVolumeUsd: number;
  feeBps: number;
}

export const SPOT_TIERS: SpotTier[] = [
  { name: 'Standard', minVolumeUsd: 0, feeBps: 20 },
  { name: 'Active', minVolumeUsd: 25_000, feeBps: 15 },
  { name: 'Pro', minVolumeUsd: 250_000, feeBps: 10 },
  { name: 'Market maker', minVolumeUsd: 2_000_000, feeBps: 5 },
];

export function spotTierFor(volume30dUsd: number): SpotTier {
  return [...SPOT_TIERS].reverse().find(t => volume30dUsd >= t.minVolumeUsd) ?? SPOT_TIERS[0];
}

/** The number to pass as platformFeeBps on the Jupiter quote. */
export function spotFeeBps(volume30dUsd: number): number {
  return spotTierFor(volume30dUsd).feeBps;
}

// ═══════════════════════════════════════════════════════════════════════════
// LEVERAGE
// ═══════════════════════════════════════════════════════════════════════════

export type LeverageVenue = 'routed' | 'internal';

export interface LeverageSchedule {
  venue: LeverageVenue;
  /** Charged on notional when the position opens. */
  openFeeBps: number;
  /** Charged on notional when it closes normally. */
  closeFeeBps: number;
  /**
   * Fraction of notional that must remain as collateral. Below this the position
   * is liquidated. This is NOT a profit lever — see maintenanceMarginRate().
   */
  maintenanceMarginBps: number;
  /**
   * Charged on notional when a position is liquidated, on top of the loss.
   * Goes to the insurance fund, not to revenue. Disclosed in the fee schedule.
   */
  liquidationFeeBps: number;
  /** Borrow / funding cost per 8h, as bps of notional. Set by the venue. */
  fundingBpsPer8h: number;
  /** Your share of the venue's fee, if routed. Zero if you are the counterparty. */
  referralShareBps: number;
  maxLeverage: number;
}

// Routed: Drift / Jupiter Perps run the book and the liquidation engine. You
// earn a share of their taker fee and set none of these numbers. Confirm the
// current referral terms with the venue before publishing anything — the share
// below is a placeholder, not a quote.
export const ROUTED_PERPS: LeverageSchedule = {
  venue: 'routed',
  openFeeBps: 5,
  closeFeeBps: 5,
  maintenanceMarginBps: 50,
  liquidationFeeBps: 100,
  fundingBpsPer8h: 1,
  referralShareBps: 1,
  maxLeverage: 20,
};

// Internal: you are the counterparty. You set every number and you owe the
// shortfall when a liquidation slips past the collateral. Do not enable this
// without an insurance fund, an oracle you are accountable for, an ADL policy,
// and legal advice about offering leveraged derivatives where your users live.
export const INTERNAL_PERPS: LeverageSchedule = {
  venue: 'internal',
  openFeeBps: 6,
  closeFeeBps: 6,
  maintenanceMarginBps: 50,     // 0.5% — see maintenanceMarginRate() for why
  liquidationFeeBps: 75,        // 0.75% of notional, to the insurance fund
  fundingBpsPer8h: 1,
  referralShareBps: 0,
  maxLeverage: 10,
};

/**
 * Maintenance margin, scaled by position size.
 *
 * WHY IT IS ABOVE ZERO, AND WHY THAT IS NOT A FEE
 *
 * Liquidation is not instant. Between the price touching your threshold and the
 * close actually filling, the market moves and the fill slips. If the threshold
 * were zero, every liquidation would fill below zero collateral and the venue
 * would eat the difference. The buffer exists to cover that gap. It is a
 * solvency parameter.
 *
 * Which means the honest way to size it is: how far does a position of this size
 * slip while being closed in this book? Bigger positions slip more, so the
 * requirement rises with size — that is what the tiers below encode. Size it by
 * measuring your own liquidation fills against the mark at trigger, and adjust
 * when the data says to.
 *
 * The dishonest way to size it is: how much can we widen this before people
 * notice. Those two produce different numbers, and only one of them survives a
 * user plotting their liquidations against the quoted price.
 *
 * If you want more revenue from leverage, raise openFeeBps. It is visible, it is
 * comparable, and users can decide about it in advance. That is the difference.
 */
export function maintenanceMarginRate(
  schedule: LeverageSchedule, notionalUsd: number,
): number {
  const base = schedule.maintenanceMarginBps / 10_000;
  // Slippage on close scales with size against book depth. These brackets are
  // placeholders — replace them with measurements from your own fills.
  const sizeMultiplier =
    notionalUsd > 500_000 ? 3.0 :
    notionalUsd > 100_000 ? 2.0 :
    notionalUsd > 25_000 ? 1.5 : 1.0;
  return base * sizeMultiplier;
}

/**
 * THE liquidation price. There is no other one.
 *
 * The UI must render what this returns, unrounded in the direction that flatters
 * the platform. If the displayed number and the engine's number can differ by
 * even a tick, you have built the thing this file exists to prevent.
 */
export function liquidationPrice(o: {
  entry: number;
  side: 1 | -1;
  leverage: number;
  notionalUsd: number;
  schedule: LeverageSchedule;
}): number {
  const mm = maintenanceMarginRate(o.schedule, o.notionalUsd);
  // Collateral is 1/leverage of notional. The position is liquidated when the
  // adverse move has consumed everything above the maintenance requirement,
  // including the fee that closing it will cost.
  const closeCost = (o.schedule.closeFeeBps + o.schedule.liquidationFeeBps) / 10_000;
  const usableMove = 1 / o.leverage - mm - closeCost;
  return o.side > 0
    ? o.entry * (1 - Math.max(usableMove, 0.0005))
    : o.entry * (1 + Math.max(usableMove, 0.0005));
}

// ═══════════════════════════════════════════════════════════════════════════
// ALL-IN COST — what the user actually pays, in one number
// ═══════════════════════════════════════════════════════════════════════════

export interface CostBreakdown {
  platformFeeUsd: number;
  venueFeeUsd: number;
  fundingUsd: number;
  /** Expected AMM/book slippage, not a fee, but it spends the same. */
  slippageUsd: number;
  totalUsd: number;
  /** As a percent of the equity at risk — the only figure that means anything. */
  totalPctOfEquity: number;
  lines: { label: string; amountUsd: number; note?: string }[];
}

/**
 * Used for the pre-trade disclosure AND for the backtest cost model. Same
 * function, so a strategy can never be tested against costs the user does not
 * actually pay.
 */
export function roundTripCost(o: {
  notionalUsd: number;
  equityUsd: number;
  volume30dUsd: number;
  slippagePctPerSide: number;
  leverage?: number;
  schedule?: LeverageSchedule;
  holdHours?: number;
}): CostBreakdown {
  const lines: CostBreakdown['lines'] = [];
  const lev = o.leverage ?? 1;
  const isLeveraged = lev > 1 && !!o.schedule;

  const platBps = isLeveraged ? 0 : spotFeeBps(o.volume30dUsd) * 2;
  const platformFeeUsd = (platBps / 10_000) * o.notionalUsd;
  if (platformFeeUsd > 0) {
    lines.push({
      label: 'Xenia fee',
      amountUsd: platformFeeUsd,
      note: `${spotFeeBps(o.volume30dUsd)} bps each way, ${spotTierFor(o.volume30dUsd).name} tier`,
    });
  }

  let venueFeeUsd = 0;
  let fundingUsd = 0;
  if (isLeveraged && o.schedule) {
    venueFeeUsd = ((o.schedule.openFeeBps + o.schedule.closeFeeBps) / 10_000) * o.notionalUsd;
    fundingUsd = (o.schedule.fundingBpsPer8h / 10_000) * o.notionalUsd
      * ((o.holdHours ?? 8) / 8);
    lines.push({
      label: o.schedule.venue === 'routed' ? 'Exchange fee' : 'Trading fee',
      amountUsd: venueFeeUsd,
      note: `${o.schedule.openFeeBps} bps open, ${o.schedule.closeFeeBps} bps close`,
    });
    if (fundingUsd > 0) {
      lines.push({
        label: 'Funding',
        amountUsd: fundingUsd,
        note: `${o.schedule.fundingBpsPer8h} bps per 8h held`,
      });
    }
  }

  const slippageUsd = (o.slippagePctPerSide / 100) * o.notionalUsd * 2;
  lines.push({
    label: 'Expected slippage',
    amountUsd: slippageUsd,
    note: 'Estimate. Thin pools cost more than this.',
  });

  const totalUsd = platformFeeUsd + venueFeeUsd + fundingUsd + slippageUsd;
  return {
    platformFeeUsd, venueFeeUsd, fundingUsd, slippageUsd, totalUsd,
    totalPctOfEquity: o.equityUsd > 0 ? (totalUsd / o.equityUsd) * 100 : 0,
    lines,
  };
}

/**
 * The sentence to put under the trade button. Generated from the same constants
 * the engine uses, so it cannot describe a different product than the one that
 * executes.
 */
export function disclosure(o: {
  cost: CostBreakdown;
  entry?: number;
  side?: 1 | -1;
  leverage?: number;
  notionalUsd?: number;
  schedule?: LeverageSchedule;
}): string[] {
  const out = [
    `Round trip costs $${o.cost.totalUsd.toFixed(2)} — `
    + `${o.cost.totalPctOfEquity.toFixed(2)}% of your account.`,
  ];
  if (o.schedule && o.leverage && o.leverage > 1 && o.entry && o.side && o.notionalUsd) {
    const liq = liquidationPrice({
      entry: o.entry, side: o.side, leverage: o.leverage,
      notionalUsd: o.notionalUsd, schedule: o.schedule,
    });
    const mm = maintenanceMarginRate(o.schedule, o.notionalUsd) * 100;
    out.push(
      `Liquidation at ${liq.toFixed(6)}. `
      + `That is ${Math.abs((liq - o.entry) / o.entry * 100).toFixed(2)}% against you.`,
      `Maintenance margin ${mm.toFixed(2)}% of position size. `
      + `Liquidation costs a further ${(o.schedule.liquidationFeeBps / 100).toFixed(2)}% `
      + `of position size, which goes to the insurance fund.`,
    );
    if (o.schedule.venue === 'routed') {
      out.push(`Position is held on the exchange we route to. They set the margin and run the liquidation.`);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// INSURANCE FUND — only relevant if venue is 'internal'
// ═══════════════════════════════════════════════════════════════════════════

/**
 * When a liquidation fills worse than the maintenance threshold, somebody covers
 * the gap. In order: the insurance fund, then you, then — if you have no fund
 * and no capital — the winning traders, via auto-deleveraging.
 *
 * ADL means closing a profitable user's position against their will to make the
 * book balance. It is a legitimate mechanism and every perps venue has one. It
 * is also the single thing users are angriest about, so if you enable internal
 * leverage, say plainly and in advance that it exists and how positions are
 * ranked for it. Discovering ADL for the first time when it happens to you is
 * how a platform loses its users in a day.
 *
 * Rough sizing: the fund should cover the worst liquidation cascade you can
 * plausibly see. Model it as (largest position) x (worst gap you have observed
 * on this asset) x (number that could liquidate together in one move). On a
 * volatile alt that is not a small number.
 */
export function insuranceFundHealth(o: {
  fundUsd: number;
  openInterestUsd: number;
  worstObservedGapPct: number;
}): { ratio: number; ok: boolean; note: string } {
  const exposure = o.openInterestUsd * (o.worstObservedGapPct / 100);
  const ratio = exposure > 0 ? o.fundUsd / exposure : Infinity;
  return {
    ratio,
    ok: ratio >= 1,
    note: ratio >= 1
      ? `Fund covers ${ratio.toFixed(1)}x the modelled worst cascade.`
      : `Fund covers ${(ratio * 100).toFixed(0)}% of the modelled worst cascade. `
      + `The rest lands on you or on ADL. Cap open interest or stop offering leverage `
      + `until the fund catches up.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-FUNDING INSURANCE RESERVE
// ═══════════════════════════════════════════════════════════════════════════
//
// The fund is built from a fixed share of ordinary trading fees, starting on day
// one with riskless spot revenue, rather than from capital you do not have.
//
// Everything below uses integer MINOR UNITS (USDC has 6 decimals, so 1_000_000
// = $1). A float64 balance that is incremented on every trade drifts, and the
// number it drifts on is the one that decides whether you are solvent. If you
// port this to Go, use int64 or a decimal type and put a mutex on the balance —
// it is mutated concurrently by every liquidation.

export const USDC_UNITS = 1_000_000;
export const usd = (units: number) => units / USDC_UNITS;
export const units = (dollars: number) => Math.round(dollars * USDC_UNITS);

/** Share of every fee routed to the fund instead of to revenue. */
export const INSURANCE_RESERVE_RATE = 0.20;

export interface FeeSplit {
  totalUnits: number;
  operatingUnits: number;
  insuranceUnits: number;
}

export function splitFee(totalUnits: number, rate = INSURANCE_RESERVE_RATE): FeeSplit {
  const insuranceUnits = Math.floor(totalUnits * rate);
  return {
    totalUnits,
    insuranceUnits,
    operatingUnits: totalUnits - insuranceUnits,   // remainder to operating, never lost
  };
}

// ── dynamic risk tiers ─────────────────────────────────────────────────────
//
// When the fund is empty a gap you cannot cover becomes debt you cannot pay, so
// the buffer has to be wide. As the cushion grows it narrows toward competitive.
//
// This is legitimate — undercapitalised venues genuinely do need wider margins —
// but only if it is on the public fee page with the thresholds named. Early users
// are being charged more risk buffer to build your balance sheet. Say so. A
// schedule that quietly tightens as you get richer, discovered later, reads
// exactly like a schedule designed to be discovered later.

export interface RiskTier {
  name: string;
  minFundUsd: number;
  baseMaintenanceBps: number;
  liquidationFeeBps: number;
  maxLeverage: number;
}

export const RISK_TIERS: RiskTier[] = [
  { name: 'Bootstrap',  minFundUsd: 0,      baseMaintenanceBps: 400, liquidationFeeBps: 150, maxLeverage: 3 },
  { name: 'Building',   minFundUsd: 10_000, baseMaintenanceBps: 250, liquidationFeeBps: 100, maxLeverage: 5 },
  { name: 'Established',minFundUsd: 50_000, baseMaintenanceBps: 150, liquidationFeeBps: 75,  maxLeverage: 10 },
  { name: 'Mature',     minFundUsd: 250_000,baseMaintenanceBps: 100, liquidationFeeBps: 50,  maxLeverage: 20 },
];

export function riskTierFor(fundUsd: number): RiskTier {
  return [...RISK_TIERS].reverse().find(t => fundUsd >= t.minFundUsd) ?? RISK_TIERS[0];
}

/**
 * Maintenance margin scaled by BOTH volatility and size.
 *
 * Size alone is not enough: a 2% position in a token that moves 40% a day gaps
 * past its buffer while a 10% position in BTC does not. The requirement has to
 * track how far price travels between the trigger firing and the close filling,
 * and that distance is volatility x size-against-depth.
 *
 * Calibrate `realised24hVolPct` from the same OHLCV the engine already loads.
 */
export function dynamicMaintenanceRate(o: {
  fundUsd: number;
  realised24hVolPct: number;
  notionalUsd: number;
  /** Depth within 2% of mid, from the venue book or the AMM pool. */
  bookDepthUsd?: number;
}): { rate: number; tier: RiskTier; reason: string } {
  const tier = riskTierFor(o.fundUsd);
  const base = tier.baseMaintenanceBps / 10_000;

  // A day's move is the honest yardstick for how far a fill can run away during
  // a cascade. 5% daily is calm for crypto; 40% is a normal week for an alt.
  const volMultiplier = Math.min(Math.max(o.realised24hVolPct / 10, 0.5), 4.0);

  const depth = o.bookDepthUsd ?? Infinity;
  const sizeMultiplier = Number.isFinite(depth)
    ? Math.min(Math.max(1 + (o.notionalUsd / depth) * 3, 1), 4)
    : (o.notionalUsd > 500_000 ? 3 : o.notionalUsd > 100_000 ? 2 : o.notionalUsd > 25_000 ? 1.5 : 1);

  const rate = Math.min(base * volMultiplier * sizeMultiplier, 0.25);
  return {
    rate, tier,
    reason: `${tier.name} tier ${(base * 100).toFixed(2)}% base, `
      + `x${volMultiplier.toFixed(2)} for ${o.realised24hVolPct.toFixed(1)}% daily volatility, `
      + `x${sizeMultiplier.toFixed(2)} for size against depth.`,
  };
}

// ── liquidation settlement ─────────────────────────────────────────────────

export interface LiquidationOutcome {
  triggered: boolean;
  /** Price at which the close actually filled. NOT the mark. */
  fillPrice: number;
  /** Slippage between trigger and fill, in percent. The whole risk, measured. */
  slipPct: number;
  /** Penalty charged to the user, to the fund. Disclosed in advance. */
  penaltyUnits: number;
  /** Collateral returned to the user. This is the line that matters. */
  returnedToUserUnits: number;
  /** Shortfall the fund must cover when the fill ran past bankruptcy. */
  fundDrawUnits: number;
  adlRequired: boolean;
  note: string;
}

/**
 * Settle a liquidation against the price it ACTUALLY FILLED AT.
 *
 * The version of this that takes the mark price as the fill cannot see slippage,
 * which is the only reason the buffer exists — so it reports every liquidation
 * as profitable right up until the one that bankrupts you. Pass the real fill.
 *
 * ON RESIDUAL COLLATERAL. When the fill lands above bankruptcy there is margin
 * left over. Seizing all of it is possible, and some venues do, but consider the
 * size of it here: at a 4% maintenance rate on a 3x position, bankruptcy is 33%
 * away and the trigger fires at 5.5%. The user has lost a sixth of their margin
 * and the residual is five sixths. Taking that is not a fee, it is the position.
 *
 * So: the user pays the disclosed penalty and gets the rest back. That is what
 * Drift and GMX do, it is what makes the penalty defensible as a fee, and it
 * costs you almost nothing — the penalty is the revenue, the residual never was.
 */
export function settleLiquidation(o: {
  entryPrice: number;
  fillPrice: number;
  triggerPrice: number;
  sizeUnits: number;           // position size in base units of the asset
  marginUnits: number;         // collateral posted, minor units
  isLong: boolean;
  liquidationFeeBps: number;
  notionalUsd: number;
}): LiquidationOutcome {
  const dir = o.isLong ? 1 : -1;
  const pnlUsd = dir * (o.fillPrice - o.entryPrice) * o.sizeUnits;
  const pnlUnits = units(pnlUsd);

  const penaltyUnits = Math.floor((o.liquidationFeeBps / 10_000) * units(o.notionalUsd));
  const remaining = o.marginUnits + pnlUnits - penaltyUnits;

  const slipPct = Math.abs((o.fillPrice - o.triggerPrice) / o.triggerPrice) * 100;

  if (remaining >= 0) {
    return {
      triggered: true, fillPrice: o.fillPrice, slipPct,
      penaltyUnits,
      returnedToUserUnits: remaining,
      fundDrawUnits: 0,
      adlRequired: false,
      note: `Closed at ${o.fillPrice.toFixed(6)} after ${slipPct.toFixed(2)}% slippage. `
        + `Penalty $${usd(penaltyUnits).toFixed(2)} to the insurance fund, `
        + `$${usd(remaining).toFixed(2)} returned.`,
    };
  }

  // Fill ran past bankruptcy. This is the case the buffer is sized to prevent
  // and the case the mark-price version of this function cannot detect.
  const shortfall = -remaining;
  return {
    triggered: true, fillPrice: o.fillPrice, slipPct,
    penaltyUnits: Math.max(o.marginUnits + pnlUnits, 0),
    returnedToUserUnits: 0,
    fundDrawUnits: shortfall,
    adlRequired: false,      // caller decides, once it knows the fund balance
    note: `Fill ran ${slipPct.toFixed(2)}% past the trigger and through bankruptcy. `
      + `Shortfall $${usd(shortfall).toFixed(2)} must come from the insurance fund.`,
  };
}

/** Apply an outcome to the fund. Returns whether ADL is now unavoidable. */
export function applyToFund(
  fundUnits: number, outcome: LiquidationOutcome,
): { fundUnits: number; adlRequired: boolean; adlAmountUnits: number } {
  let f = fundUnits + outcome.penaltyUnits;
  if (outcome.fundDrawUnits > 0) {
    const covered = Math.min(f, outcome.fundDrawUnits);
    f -= covered;
    const uncovered = outcome.fundDrawUnits - covered;
    if (uncovered > 0) {
      return { fundUnits: 0, adlRequired: true, adlAmountUnits: uncovered };
    }
  }
  return { fundUnits: f, adlRequired: false, adlAmountUnits: 0 };
}

/**
 * THE GEOMETRY CHECK — run before offering a leverage level on an asset.
 *
 * Found by simulating cascades against the tiers above: on a 40%-daily-volatility
 * token the maintenance requirement lands at 4.6%, while 20x leverage posts only
 * 5% margin. Maintenance plus the close fee exceeds the collateral, so the
 * trigger clamps to a few basis points from entry and the position is liquidated
 * almost immediately. The user is not being unlucky, the product is impossible.
 *
 * Leverage caps therefore cannot key on fund balance alone, which is what the
 * fund-tier ladder alone would do. They have to key on the asset too.
 */
export function maxSafeLeverage(o: {
  fundUsd: number; realised24hVolPct: number; notionalUsd: number; bookDepthUsd?: number;
}): { maxLeverage: number; tierCap: number; reason: string } {
  const tier = riskTierFor(o.fundUsd);
  const mm = dynamicMaintenanceRate(o);
  const closeCost = tier.liquidationFeeBps / 10_000;

  // Require the trigger to sit at least 1.5x the maintenance rate inside
  // bankruptcy, so there is room for the position to be wrong before it is dead.
  const needed = (mm.rate + closeCost) * 2.5;
  const geometricCap = Math.floor(1 / needed);
  const maxLeverage = Math.max(1, Math.min(tier.maxLeverage, geometricCap));

  return {
    maxLeverage, tierCap: tier.maxLeverage,
    reason: geometricCap < tier.maxLeverage
      ? `Capped at ${maxLeverage}x by the asset, not by the fund. At ${o.realised24hVolPct.toFixed(0)}% `
        + `daily volatility the maintenance requirement is ${(mm.rate * 100).toFixed(2)}%, so anything `
        + `above ${geometricCap}x liquidates before the trade has room to be right.`
      : `${maxLeverage}x, the ${tier.name} tier cap. Asset geometry allows up to ${geometricCap}x.`,
  };
}
