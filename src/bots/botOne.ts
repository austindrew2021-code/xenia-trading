import { calcRSI, calcStochastic, hasHiddenDivergence } from './indicators';
import { Bot1Config, TradeSignal } from '../types';

// ── Bot 1: RSI + Stochastic + Hidden Divergence ───────────────────────────
// Original: Polymarket YES/NO 15m direction bets
// Adapted:  LONG/SHORT leverage signals on Solana memecoins
// Logic preserved exactly — only the output action changes

export function bot1Signal(
  prices: number[],
  asset: string,
  cfg: Bot1Config
): TradeSignal | null {
  if (prices.length < 30) return null;

  const rsi = cfg.useRSI ? calcRSI(prices, cfg.rsiPeriod) : 50;
  const { k: stochK, d: stochD } = cfg.useStoch
    ? calcStochastic(prices, cfg.stochKPeriod, cfg.stochSmoothK, cfg.stochSmoothD)
    : { k: 50, d: 50 };

  const momentumUp  = cfg.useMomentum && prices.length >= 5 && prices[prices.length - 1] > prices[prices.length - 5];
  const momentumDn  = cfg.useMomentum && prices.length >= 5 && prices[prices.length - 1] < prices[prices.length - 5];

  let dir = 0;
  let conf = 0;

  // RSI base signal
  if (cfg.useRSI) {
    if (rsi < cfg.rsiOversold) { dir = 1; conf += 1; }
    else if (rsi > cfg.rsiOverbought) { dir = -1; conf += 1; }
  }

  // Stochastic crossover
  if (cfg.useStoch) {
    if (stochK > stochD && stochK < cfg.stochOversold) {
      if (dir === 1 || dir === 0) { dir = 1; conf += 2; }
    } else if (stochK < stochD && stochK > cfg.stochOverbought) {
      if (dir === -1 || dir === 0) { dir = -1; conf += 2; }
    }
  }

  // Momentum confirmation
  if (cfg.useMomentum) {
    if (momentumUp && dir === 1) conf += 1;
    if (momentumDn && dir === -1) conf += 1;
  }

  // Hidden divergence boost
  const div = cfg.useDivergence ? hasHiddenDivergence(prices) : 0;
  if (div === dir && div !== 0) conf += 2;

  if (dir === 0 || conf < 2) return null;

  return {
    asset,
    side: dir === 1 ? 'LONG' : 'SHORT',
    confidence: conf,
    rsi,
    stochK,
    stochD,
    divergence: div,
    atr: 0,
    description: `RSI ${rsi.toFixed(1)} | Stoch K/D ${stochK.toFixed(1)}/${stochD.toFixed(1)} | Mom ${momentumUp ? '↑' : momentumDn ? '↓' : '—'} | Div ${div} | Conf ${conf}`,
  };
}

export function bot1PositionSize(conf: number, cfg: Bot1Config): number {
  const size = cfg.betSize + conf * cfg.sizeScaleExtra;
  return Math.min(size, cfg.maxSize);
}
