export type Side = 'LONG' | 'SHORT';
export type PositionStatus = 'open' | 'closed' | 'liquidated';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Position {
  id: string;
  asset: string;
  side: Side;
  entryPrice: number;
  size: number;
  leverage: number;
  notional: number;
  liquidationPrice: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  openedAt: number;
  closedAt: number | null;
  closePrice: number | null;
  status: PositionStatus;
  pnl: number;
  pnlPct: number;
  openedBy: 'manual' | 'bot1' | 'bot2' | 'bot3';
  peakPrice?: number;
  partialClosed?: boolean;
  flips?: number;
}

export interface TradeSignal {
  asset: string;
  side: Side;
  confidence: number;
  rsi: number;
  stochK: number;
  stochD: number;
  divergence: number;
  atr: number;
  description: string;
}

export interface Bot1Config {
  enabled: boolean;
  lookback: number; // candles to look back for signals
  betSize: number;
  sizeScaleExtra: number;
  edgeThreshold: number;
  maxSize: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  stochKPeriod: number;
  stochSmoothK: number;
  stochSmoothD: number;
  stochOversold: number;
  stochOverbought: number;
  leverage: number;
  useRSI: boolean;
  useStoch: boolean;
  useMomentum: boolean;
  useDivergence: boolean;
}

export interface Bot2Config {
  enabled: boolean;
  lookback: number;
  betSize: number;
  maxSize: number;
  edgeThreshold: number;
  minConf: number;
  minAtrPct: number;
  maxAtrPct: number;
  partialExitAtGain: number;
  hardStopLossPct: number;
  atrTrailMultiplier: number;
  expectedWinProb: number;
  recentCandles: number;
  minMajority: number;
  leverage: number;
  useRSI: boolean;
  useStoch: boolean;
  useMomentum: boolean;
  useDivergence: boolean;
  useATR: boolean;
  useKelly: boolean;
  useTrailingStop: boolean;
  usePartialExit: boolean;
}

export interface Bot3Config {
  enabled: boolean;
  lookback: number;
  betSizeBase: number;
  betSizeMax: number;
  edgeThreshold: number;
  minConf: number;
  minAtrPct: number;
  maxAtrPct: number;
  hardStopLossPct: number;
  trailActivateAt: number;
  trailDropPct: number;
  tp03Pct: number; tp03Frac: number;
  tp05Pct: number; tp05Frac: number;
  tp08Pct: number; tp08Frac: number;
  tp12Pct: number; tp12Frac: number;
  tp18Pct: number; tp18Frac: number;
  tp25Pct: number; tp25Frac: number;
  tp40Pct: number; tp40Frac: number;
  tp60Pct: number; tp60Frac: number;
  leverage: number;
  useRSI: boolean;
  useStoch: boolean;
  useEMA: boolean;
  useCandlePatterns: boolean;
  useMomentum: boolean;
  useTrailingStop: boolean;
  useMultiTPTiers: boolean;
}

export interface BotConfigs {
  bot1: Bot1Config;
  bot2: Bot2Config;
  bot3: Bot3Config;
}

export const DEFAULT_BOT1: Bot1Config = {
  enabled: false,
  lookback: 50,
  betSize: 20, sizeScaleExtra: 8, edgeThreshold: 0.07, maxSize: 200,
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  stochKPeriod: 14, stochSmoothK: 3, stochSmoothD: 3,
  stochOversold: 30, stochOverbought: 70,
  leverage: 5,
  useRSI: true, useStoch: true, useMomentum: true, useDivergence: true,
};

export const DEFAULT_BOT2: Bot2Config = {
  enabled: false,
  lookback: 80,
  betSize: 10, maxSize: 100, edgeThreshold: 0.065, minConf: 3,
  minAtrPct: 0.08, maxAtrPct: 1.2,
  partialExitAtGain: 0.5, hardStopLossPct: 0.1, atrTrailMultiplier: 1.5,
  expectedWinProb: 0.55, recentCandles: 5, minMajority: 3,
  leverage: 10,
  useRSI: true, useStoch: true, useMomentum: true, useDivergence: true,
  useATR: true, useKelly: true, useTrailingStop: true, usePartialExit: true,
};

export const DEFAULT_BOT3: Bot3Config = {
  enabled: false,
  lookback: 100,
  betSizeBase: 5.5, betSizeMax: 45, edgeThreshold: 0.005,
  minConf: 2.2, minAtrPct: 0.08, maxAtrPct: 2.8,
  hardStopLossPct: 0.045, trailActivateAt: 0.18, trailDropPct: 0.06,
  tp03Pct: 0.03, tp03Frac: 0.25,
  tp05Pct: 0.05, tp05Frac: 0.30,
  tp08Pct: 0.08, tp08Frac: 0.35,
  tp12Pct: 0.12, tp12Frac: 0.40,
  tp18Pct: 0.18, tp18Frac: 0.45,
  tp25Pct: 0.25, tp25Frac: 0.50,
  tp40Pct: 0.40, tp40Frac: 0.60,
  tp60Pct: 0.60, tp60Frac: 0.70,
  leverage: 15,
  useRSI: true, useStoch: true, useEMA: true, useCandlePatterns: true,
  useMomentum: true, useTrailingStop: true, useMultiTPTiers: true,
};
