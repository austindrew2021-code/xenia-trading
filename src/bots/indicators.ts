// ── Technical indicators ported from the Python bot logic ────────────────

export function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  const deltas = prices.slice(1).map((p, i) => p - prices[i]);
  const recent = deltas.slice(-period);
  const gains = recent.map(d => Math.max(d, 0));
  const losses = recent.map(d => Math.max(-d, 0));
  const avgGain = gains.reduce((a, b) => a + b, 0) / period || 0;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period || 0.0001;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calcStochastic(
  prices: number[],
  kPeriod = 14,
  smoothK = 3,
  smoothD = 3
): { k: number; d: number } {
  if (prices.length < kPeriod) return { k: 50, d: 50 };

  const kRaw: number[] = prices.map((_, i) => {
    const slice = prices.slice(Math.max(0, i - kPeriod + 1), i + 1);
    const lo = Math.min(...slice);
    const hi = Math.max(...slice);
    return hi !== lo ? (100 * (prices[i] - lo)) / (hi - lo) : 50;
  });

  const kSmooth: number[] = kRaw.map((_, i) => {
    const slice = kRaw.slice(Math.max(0, i - smoothK + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  const dSmooth: number[] = kSmooth.map((_, i) => {
    const slice = kSmooth.slice(Math.max(0, i - smoothD + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  return { k: kSmooth[kSmooth.length - 1], d: dSmooth[dSmooth.length - 1] };
}

export function calcATR(prices: number[], period = 5): number {
  if (prices.length < period) return 0;
  const slice = prices.slice(-period);
  const hi = Math.max(...slice);
  const lo = Math.min(...slice);
  return prices[prices.length - 1] > 0 ? (hi - lo) / prices[prices.length - 1] : 0;
}

export function hasHiddenDivergence(
  prices: number[],
  lookback = 8
): number {
  if (prices.length < lookback + 2) return 0;

  const rsiSeries = prices.map((_, i) => calcRSI(prices.slice(0, i + 1)));
  const stochSeries = prices.map((_, i) => calcStochastic(prices.slice(0, i + 1)).k);

  const pSlice = prices.slice(-lookback);
  const rSlice = rsiSeries.slice(-lookback);
  const sSlice = stochSeries.slice(-lookback);

  const priceLowIdx = pSlice.indexOf(Math.min(...pSlice));
  const priceHighIdx = pSlice.indexOf(Math.max(...pSlice));

  // Bullish hidden divergence: higher price low + lower oscillator low
  if (priceLowIdx > 0) {
    const prevLow = Math.min(...pSlice.slice(0, priceLowIdx));
    const prevLowIdx = pSlice.indexOf(prevLow);
    if (prevLowIdx >= 0) {
      const priceHigherLow = pSlice[priceLowIdx] > prevLow;
      const rsiLowerLow = rSlice[priceLowIdx] < rSlice[prevLowIdx];
      const stochLowerLow = sSlice[priceLowIdx] < sSlice[prevLowIdx];
      if (priceHigherLow && (rsiLowerLow || stochLowerLow)) return 1;
    }
  }

  // Bearish hidden divergence: lower price high + higher oscillator high
  if (priceHighIdx > 0) {
    const prevHigh = Math.max(...pSlice.slice(0, priceHighIdx));
    const prevHighIdx = pSlice.indexOf(prevHigh);
    if (prevHighIdx >= 0) {
      const priceLowerHigh = pSlice[priceHighIdx] < prevHigh;
      const rsiHigherHigh = rSlice[priceHighIdx] > rSlice[prevHighIdx];
      const stochHigherHigh = sSlice[priceHighIdx] > sSlice[prevHighIdx];
      if (priceLowerHigh && (rsiHigherHigh || stochHigherHigh)) return -1;
    }
  }

  return 0;
}

export function getRecentCandlesDirection(
  prices: number[],
  numCandles = 5,
  minMajority = 3
): { dir: number; bullish: number; bearish: number } {
  if (prices.length < numCandles + 1) return { dir: 0, bullish: 0, bearish: 0 };
  let bullish = 0, bearish = 0;
  for (let i = 1; i <= numCandles; i++) {
    if (prices[prices.length - i] > prices[prices.length - i - 1]) bullish++;
    else if (prices[prices.length - i] < prices[prices.length - i - 1]) bearish++;
  }
  const dir = bullish >= minMajority ? 1 : bearish >= minMajority ? -1 : 0;
  return { dir, bullish, bearish };
}
