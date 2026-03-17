import { calcRSI, calcStochastic, calcATR, getRecentCandlesDirection } from './indicators';
import { Bot3Config, TradeSignal, Side } from '../types';

function calcEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const mult = 2 / (period + 1);
  let ema = prices.slice(-period).reduce((a, b) => a + b, 0) / period;
  for (const p of prices.slice(-period + 1)) ema = (p - ema) * mult + ema;
  return ema;
}

function detectCandlePatterns(prices: number[]): { dir: number; desc: string } {
  if (prices.length < 6) return { dir: 0, desc: 'None' };
  const [p6, p5, , p3, p2, p1] = prices.slice(-6);
  void p5;
  let dir = 0;
  const descs: string[] = [];
  const body = Math.abs(p1 - p2);
  const lowerWick = Math.min(p1, p2) - p3;
  const upperWick = p3 - Math.max(p1, p2);
  if (lowerWick > 2.0 * body) { dir += 1; descs.push('Hammer'); }
  if (upperWick > 2.0 * body) { dir -= 1; descs.push('Shooting Star'); }
  if (p3 < p2 && p1 > p3)    { dir += 1; descs.push('Bull Engulf'); }
  if (p3 > p2 && p1 < p3)    { dir -= 1; descs.push('Bear Engulf'); }
  const s3Up = p1 > p2 && p2 > p3 && p3 > p6;
  const s3Dn = p1 < p2 && p2 < p3 && p3 < p6;
  if (s3Up) { dir += 1; descs.push('3-Up'); }
  if (s3Dn) { dir -= 1; descs.push('3-Dn'); }
  return { dir, desc: descs.join(' + ') || 'None' };
}

export function bot3Signal(prices: number[], asset: string, cfg: Bot3Config): TradeSignal | null {
  if (prices.length < 50) return null;

  const rsi     = cfg.useRSI ? calcRSI(prices) : 50;
  const rsiPrev = cfg.useRSI && prices.length > 1 ? calcRSI(prices.slice(0, -1)) : rsi;
  const { k: stochK, d: stochD } = cfg.useStoch ? calcStochastic(prices) : { k: 50, d: 50 };
  const { k: skPrev, d: sdPrev } = cfg.useStoch && prices.length > 1 ? calcStochastic(prices.slice(0, -1)) : { k: stochK, d: stochD };

  const ema20 = cfg.useEMA ? calcEMA(prices, 18) : 0;
  const ema50 = cfg.useEMA ? calcEMA(prices, 45) : 0;
  const atrPct = calcATR(prices) * 100;
  if (atrPct < cfg.minAtrPct || atrPct > cfg.maxAtrPct) return null;

  const { dir: recentDir } = cfg.useMomentum ? getRecentCandlesDirection(prices, 5, 3) : { dir: 0 };
  const { dir: patDir, desc: patDesc } = cfg.useCandlePatterns ? detectCandlePatterns(prices) : { dir: 0, desc: '' };

  let dir = recentDir;
  let conf = 0.0;

  if (cfg.useRSI && cfg.useStoch) {
    if (rsi > 70 && stochK > 80) { dir = -1; conf += 4.5; }
    else if (rsi < 28 && stochK < 22) { dir = 1; conf += 6.0; }
  }
  if (cfg.useRSI && ((dir === 1 && rsi < 42) || (dir === -1 && rsi > 58))) conf += 4.0;

  if (cfg.useStoch) {
    const rising  = stochK > stochD && skPrev <= sdPrev;
    const falling = stochK < stochD && skPrev >= sdPrev;
    if (dir === 1 && rising  && stochK < 42) conf += 6.0;
    if (dir === -1 && falling && stochK > 58) conf += 6.5;
    if (rising  && rsi > rsiPrev + 1) conf += 6.0;
    if (falling && rsi < rsiPrev - 1) { conf += 6.5; if (dir === 1) dir = -1; }
  }

  if (cfg.useMomentum && prices.length >= 4) {
    const sUp = [1,2,3].every(i => prices[prices.length-i] > prices[prices.length-i-1]);
    const sDn = [1,2,3].every(i => prices[prices.length-i] < prices[prices.length-i-1]);
    if ((dir === 1 && sUp) || (dir === -1 && sDn)) conf += 8.0;
  }

  if (cfg.useEMA && ema20 > 0 && ema50 > 0) {
    if ((dir === 1 && ema20 > ema50) || (dir === -1 && ema20 < ema50)) conf += 5.0;
  }

  if (cfg.useMomentum && recentDir === dir) conf += 4.0;

  if (cfg.useCandlePatterns && patDir !== 0) {
    if (patDir === dir) conf += patDir === 1 ? 5.5 : 6.0;
    else conf -= 0.6;
  }

  // Oversold override
  if (cfg.useRSI && rsi < 22 && dir !== 1) {
    const bullCount = [1,2,3,4,5].filter(i => prices.length > i+1 && prices[prices.length-i] > prices[prices.length-i-1]).length;
    if (bullCount >= 2) { dir = 1; conf += 6.0; }
  }

  // Price acceleration proxy (replaces WebSocket order flow)
  if (prices.length >= 3) {
    const lc = (prices[prices.length-1] - prices[prices.length-2]) / prices[prices.length-2];
    const pc = (prices[prices.length-2] - prices[prices.length-3]) / prices[prices.length-3];
    if ((dir === 1 && (lc > 0.0008 || pc > 0.0006)) || (dir === -1 && (lc < -0.0008 || pc < -0.0006))) conf += 5.5;
  }

  if (dir === 0 || conf < cfg.minConf) return null;

  return {
    asset,
    side: dir === 1 ? 'LONG' : 'SHORT' as Side,
    confidence: conf,
    rsi, stochK, stochD,
    divergence: 0, atr: atrPct,
    description: `RSI ${rsi.toFixed(1)} Stoch ${stochK.toFixed(1)}/${stochD.toFixed(1)} EMA ${ema20.toFixed(2)}/${ema50.toFixed(2)} ATR ${atrPct.toFixed(2)}% ${patDesc} Conf ${conf.toFixed(1)}`,
  };
}

export function bot3PositionSize(conf: number, capital: number, cfg: Bot3Config): number {
  const scale = 1.0 + (capital / 50) * 0.4;
  let size = cfg.betSizeBase * scale;
  if (conf > 18) size *= 2.0;
  else if (conf > 15) size *= 1.8;
  return Math.min(size, cfg.betSizeMax);
}

export function bot3CheckTP(
  entryPrice: number, currentPrice: number, side: Side,
  peakPrice: number, openedAtMs: number, partialClosed: boolean, cfg: Bot3Config
): { action: 'full' | 'partial' | null; fraction: number; reason: string } {
  const mins = (Date.now() - openedAtMs) / 60_000;
  const gain = side === 'LONG'
    ? (currentPrice - entryPrice) / entryPrice
    : (entryPrice - currentPrice) / entryPrice;

  if (gain <= -cfg.hardStopLossPct) return { action: 'full', fraction: 1, reason: `Stop -${(cfg.hardStopLossPct*100).toFixed(1)}%` };

  if (cfg.useTrailingStop && gain >= cfg.trailActivateAt) {
    const drop = side === 'LONG' ? (currentPrice - peakPrice) / peakPrice : (peakPrice - currentPrice) / peakPrice;
    if (drop <= -cfg.trailDropPct) return { action: 'full', fraction: 1, reason: 'Trail stop' };
  }

  if (!cfg.useMultiTPTiers) return { action: null, fraction: 0, reason: '' };
  if (gain >= cfg.tp60Pct) return { action: 'partial', fraction: cfg.tp60Frac, reason: `TP60 +${(gain*100).toFixed(0)}%` };
  if (gain >= cfg.tp40Pct) return { action: 'partial', fraction: cfg.tp40Frac, reason: `TP40 +${(gain*100).toFixed(0)}%` };
  if (gain >= cfg.tp25Pct && mins > 1.5) return { action: 'partial', fraction: cfg.tp25Frac, reason: `TP25` };
  if (gain >= cfg.tp18Pct && mins > 1.2) return { action: 'partial', fraction: cfg.tp18Frac, reason: `TP18` };
  if (gain >= cfg.tp12Pct && mins > 1.0) return { action: 'partial', fraction: cfg.tp12Frac, reason: `TP12` };
  if (gain >= cfg.tp08Pct && mins > 0.8) return { action: 'partial', fraction: cfg.tp08Frac, reason: `TP8` };
  if (gain >= cfg.tp05Pct && mins > 0.5) return { action: 'partial', fraction: cfg.tp05Frac, reason: `MicroScalp` };
  if (gain >= cfg.tp03Pct && mins > 0.3 && !partialClosed) return { action: 'partial', fraction: cfg.tp03Frac, reason: `NanoScalp` };
  return { action: null, fraction: 0, reason: '' };
}
