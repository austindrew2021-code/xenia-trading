import {
  calcRSI, calcStochastic, calcATR,
  hasHiddenDivergence, getRecentCandlesDirection
} from './indicators';
import { Bot2Config, TradeSignal } from '../types';

// ── Bot 2: Advanced — Kelly sizing + ATR trailing + partial exits ─────────
// Original: Polymarket with position management, reversal flips, redemption
// Adapted:  LONG/SHORT with ATR-based trailing stop, partial take-profit,
//           hard stop-loss, and Kelly position sizing

export function bot2Signal(
  prices: number[],
  asset: string,
  cfg: Bot2Config
): TradeSignal | null {
  if (prices.length < 30) return null;

  const rsi = cfg.useRSI ? calcRSI(prices) : 50;
  const { k: stochK, d: stochD } = cfg.useStoch
    ? calcStochastic(prices)
    : { k: 50, d: 50 };

  // ATR volatility filter
  let atrPct = 0;
  if (cfg.useATR && prices.length >= 5) {
    const atr = calcATR(prices);
    atrPct = atr * 100;
    if (atrPct < cfg.minAtrPct) return null; // choppy — skip
    if (atrPct > cfg.maxAtrPct) return null; // too volatile — skip
  }

  // Recent candles direction (primary signal)
  const { dir: recentDir } = cfg.useMomentum
    ? getRecentCandlesDirection(prices, cfg.recentCandles, cfg.minMajority)
    : { dir: 0 };

  let dir = recentDir;
  if (dir === 0) {
    if (cfg.useRSI && rsi < 45) dir = 1;
    else if (cfg.useRSI && rsi > 55) dir = -1;
  }
  if (dir === 0) return null;

  let conf = 0.0;

  // RSI confirmation (looser ranges)
  if (cfg.useRSI && ((dir === 1 && rsi < 45) || (dir === -1 && rsi > 55))) conf += 1.5;

  // Stochastic
  if (cfg.useStoch) {
    if (dir === 1 && stochK > stochD && stochK < 40) conf += 1.5;
    else if (dir === -1 && stochK < stochD && stochK > 60) conf += 1.5;
  }

  // Strong momentum chain
  const strongUp  = prices.length >= 3 && [1, 2].every(i => prices[prices.length - i] > prices[prices.length - i - 1]);
  const strongDn  = prices.length >= 3 && [1, 2].every(i => prices[prices.length - i] < prices[prices.length - i - 1]);
  if (cfg.useMomentum && ((dir === 1 && strongUp) || (dir === -1 && strongDn))) conf += 2.0;

  // Acceleration
  const lastChange = prices.length >= 2 ? (prices[prices.length - 1] - prices[prices.length - 2]) / prices[prices.length - 2] : 0;
  const prevChange = prices.length >= 3 ? (prices[prices.length - 2] - prices[prices.length - 3]) / prices[prices.length - 3] : 0;
  const accelUp = lastChange > 0.0008 || prevChange > 0.0006;
  const accelDn = lastChange < -0.0008 || prevChange < -0.0006;
  if ((dir === 1 && accelUp) || (dir === -1 && accelDn)) conf += 1.5;

  // Hidden divergence
  const div = cfg.useDivergence ? hasHiddenDivergence(prices) : 0;
  if (div === dir) conf += 1.5;

  // Recent candles boost
  if (cfg.useMomentum && recentDir === dir) conf += 1.0;

  if (conf < cfg.minConf) return null;

  return {
    asset,
    side: dir === 1 ? 'LONG' : 'SHORT',
    confidence: conf,
    rsi,
    stochK,
    stochD,
    divergence: div,
    atr: atrPct,
    description: `RSI ${rsi.toFixed(1)} | Stoch ${stochK.toFixed(1)}/${stochD.toFixed(1)} | ATR ${atrPct.toFixed(2)}% | Div ${div} | Conf ${conf.toFixed(1)}`,
  };
}

// Kelly criterion position sizing
export function bot2KellySize(price: number, cfg: Bot2Config, capital: number): number {
  const b = price > 0 ? 1 / price - 1 : 0;
  const f = b > 0 ? (cfg.expectedWinProb * b - (1 - cfg.expectedWinProb)) / b : 0;
  const kellySize = Math.max(0.01 * cfg.betSize, Math.min(f * capital, cfg.maxSize));
  return Math.min(kellySize, cfg.betSize);
}

// ATR-based trailing stop for open positions
export function bot2ShouldExit(
  entryPrice: number,
  currentPrice: number,
  peakPrice: number,
  side: 'LONG' | 'SHORT',
  prices: number[],
  cfg: Bot2Config
): { exit: boolean; reason: string } {
  const unrealizedPct = side === 'LONG'
    ? (currentPrice - entryPrice) / entryPrice
    : (entryPrice - currentPrice) / entryPrice;

  // Hard stop loss
  if (unrealizedPct <= -cfg.hardStopLossPct) {
    return { exit: true, reason: `Hard stop -${(cfg.hardStopLossPct * 100).toFixed(0)}%` };
  }

  // ATR trailing stop
  if (cfg.useTrailingStop && cfg.useATR && prices.length >= 5) {
    const atr = calcATR(prices);
    const trailStop = side === 'LONG'
      ? peakPrice - cfg.atrTrailMultiplier * atr * currentPrice
      : peakPrice + cfg.atrTrailMultiplier * atr * currentPrice;
    if ((side === 'LONG' && currentPrice < trailStop) || (side === 'SHORT' && currentPrice > trailStop)) {
      const rsi = calcRSI(prices);
      const rsiCross = side === 'LONG' ? rsi < 50 : rsi > 50;
      if (rsiCross) return { exit: true, reason: `ATR trail stop` };
    }
  }

  return { exit: false, reason: '' };
}

export function bot2ShouldPartialExit(
  entryPrice: number,
  currentPrice: number,
  side: 'LONG' | 'SHORT',
  cfg: Bot2Config,
  alreadyPartial: boolean
): boolean {
  if (!cfg.usePartialExit || alreadyPartial) return false;
  const gain = side === 'LONG'
    ? (currentPrice - entryPrice) / entryPrice
    : (entryPrice - currentPrice) / entryPrice;
  return gain >= cfg.partialExitAtGain;
}
