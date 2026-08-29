// ── Xenia Engine — shared types ────────────────────────────────────────────
// Candle matches the shape already used by usePriceData / SpotTradingPage.

export interface Candle {
  time: number;      // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Side = 1 | -1;

export type Regime = 'trend_up' | 'trend_down' | 'range' | 'highvol';

export type ExitReason = 'stop' | 'target' | 'liquidation' | 'timeout' | 'eod';

export interface StopSpec {
  kind: 'swing' | 'atr' | 'bar' | 'structure';
  padAtr?: number;
  mult?: number;
}

export interface ExitSpec {
  kind: 'rr' | 'poc' | 'avwap' | 'opposite' | 'valueEdge';
  rr?: number;
}

export interface StrategySpec {
  family: FamilyName;
  trigger: string;
  context: string[];
  confirm: string;
  stop: StopSpec;
  exit: ExitSpec;
  params: SpecParams;
}

export interface SpecParams {
  minSweepDepthAtr: number;
  minPocDist: number;
  maxHoldBars: number;
  [k: string]: number;
}

export type FamilyName =
  | 'sweep_reclaim'
  | 'structure'
  | 'imbalance'
  | 'value'
  | 'momentum';

export interface Signal {
  side: Side;
  entry: number;
  stop: number;
  target: number;
  riskDist: number;
  reason: string;
  regime: Regime;
  maxHoldBars: number;
}

export interface Trade {
  entryBar: number;
  exitBar: number;
  entryTime: number;
  exitTime: number;
  side: Side;
  entry: number;
  exit: number;
  reason: ExitReason;
  rMultiple: number;      // in units of initial risk
  equityReturn: number;   // fraction of account equity, after all costs
  regime: Regime;
  barsHeld: number;
  riskDistPct?: number;   // entry risk as a fraction of entry price
}

export interface Stats {
  n: number;
  pf: number;
  expectancy: number;
  winRate: number;
  medianR: number;
  maxR: number;
  nLosses: number;
  maxDrawdownPct: number;
  reasons: Record<ExitReason, number>;
  byRegime: Record<string, { n: number; expectancy: number }>;
  skippedStopOutsideLiq: number;
}

export interface BacktestResult {
  trades: Trade[];
  stats: Stats;
  equityCurve: { time: number; equity: number }[];
  finalEquity: number;
}

export interface FoldResult {
  fold: number;
  train: [number, number];
  test: [number, number];
  isPf: number;
  oosPf: number;
  oosExpectancy: number;
  oosN: number;
}

export interface WalkForwardResult {
  specId: string;
  family: FamilyName;
  symbol: string;
  folds: FoldResult[];
  isPfMean: number;
  oosPfPooled: number;
  oosN: number;
  oosExpectancy: number;
  foldsPositive: number;
  overfitGap: number;
  requiredPf: number;
  trialsWhenTested: number;
  passed: boolean;
  byRegime: Record<string, { n: number; expectancy: number }>;
}

export interface CostModel {
  feePctPerSide: number;       // e.g. 0.06  (percent)
  slippagePctPerSide: number;  // e.g. 0.05  (percent)
  fundingPctPer8h: number;     // e.g. 0.01  (percent)
  maintMarginPct: number;      // e.g. 0.5   (percent)
}

export const DEFAULT_COSTS: CostModel = {
  feePctPerSide: 0.06,
  slippagePctPerSide: 0.05,
  fundingPctPer8h: 0.01,
  maintMarginPct: 0.5,
};

export interface RunConfig {
  leverage: number;
  marginFraction: number;   // fraction of equity posted as margin per trade
  startEquity: number;
  costs: CostModel;
  beAtR: number | null;     // move stop to break-even after this R (null = off)
  trailAtr: number | null;  // ATR multiple to trail after 1.5R (null = off)
  tfHours: number;
}

export const DEFAULT_RUN: RunConfig = {
  leverage: 10,
  marginFraction: 0.5,
  startEquity: 50,
  costs: DEFAULT_COSTS,
  beAtR: 1.0,
  trailAtr: null,
  tfHours: 4,
};

export const TF_HOURS: Record<string, number> = {
  '1m': 1 / 60, '5m': 5 / 60, '15m': 0.25, '30m': 0.5,
  '1h': 1, '2h': 2, '4h': 4, '6h': 6, '12h': 12, '1d': 24,
};

export function liqDistance(leverage: number, maintMarginPct = 0.5): number {
  return Math.max(1 / leverage - maintMarginPct / 100, 0.001);
}

/** Round-trip cost as a fraction of ACCOUNT EQUITY (not notional, not margin). */
export function roundTripCostEquity(cfg: RunConfig): number {
  const perSide = (cfg.costs.feePctPerSide + cfg.costs.slippagePctPerSide) / 100;
  return 2 * perSide * cfg.leverage * cfg.marginFraction;
}
