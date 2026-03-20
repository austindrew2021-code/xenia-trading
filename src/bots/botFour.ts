/**
 * ── Bot 4: Inverse Fair Value Gap (IFVG) ─────────────────────────────────
 * 
 * ICT / Smart Money Concepts strategy.
 * 
 * STEP 1 — Detect Fair Value Gaps (FVGs)
 *   A 3-candle imbalance where the middle candle moves so fast it leaves
 *   a gap in liquidity:
 *   • Bullish FVG: candle[i-2].high < candle[i].low  (gap between i-2 high and i low)
 *   • Bearish FVG: candle[i-2].low  > candle[i].high (gap between i-2 low  and i high)
 *
 * STEP 2 — Mark Inversions (IFVG)
 *   When price fully trades THROUGH an FVG, that gap flips its role:
 *   • Bullish FVG that is fully breached below → now RESISTANCE (short zone)
 *   • Bearish FVG that is fully breached above → now SUPPORT    (long zone)
 *
 * STEP 3 — Enter on return / retest
 *   Price often pulls back to test the IFVG zone:
 *   • Price returns to a bullish IFVG (now resistance) → SHORT
 *   • Price returns to a bearish IFVG (now support)    → LONG
 *
 * STEP 4 — Additional ICT confirmations
 *   • Displacement candle (large body) confirming the flip
 *   • Structure Break (BOS / CHoCH) in the direction of the trade
 *   • Volume spike on the inversion candle
 *   • Optional: require price to have swept a nearby liquidity level first
 *
 * INVALIDATION: 
 *   If price closes fully beyond the IFVG zone, the level is broken.
 *
 * BEST ON: 1m–15m for scalping, 1h for swing. Works best on volatile memecoins.
 */

export interface Bot4Config {
  enabled: boolean;
  lookback: number;         // candles to scan for FVGs (default 80)
  betSize: number;          // base position size $
  maxSize: number;
  leverage: number;
  fvgMinBodyPct: number;    // min body size as % of range to count as displacement (default 0.3)
  fvgMaxAge: number;        // max candles ago an FVG can be (default 30)
  requireBOS: boolean;      // require structure break before entry
  requireVolSpike: boolean; // require volume spike on inversion
  retestTolerance: number;  // how close price must be to IFVG midpoint (0–1, default 0.3)
  stopBeyondZone: boolean;  // place SL just beyond the IFVG zone
  tpMultiple: number;       // TP = entry + (zone_size * tpMultiple), default 2.0
  edgeThreshold: number;    // min confidence to trade (0–1)
}

export const DEFAULT_BOT4: Bot4Config = {
  enabled: false,
  lookback: 80,
  betSize: 15,
  maxSize: 150,
  leverage: 10,
  fvgMinBodyPct: 0.25,
  fvgMaxAge: 25,
  requireBOS: true,
  requireVolSpike: false,
  retestTolerance: 0.4,
  stopBeyondZone: true,
  tpMultiple: 2.0,
  edgeThreshold: 0.55,
};

// ── Candle type (same fields as Candle but passed as OHLCV arrays) ─────────
interface CandleOHLCV {
  open: number; high: number; low: number; close: number; volume: number;
}

// ── A detected FVG zone ───────────────────────────────────────────────────
interface FVGZone {
  type: 'bullish' | 'bearish';
  top: number;    // upper boundary
  bottom: number; // lower boundary
  mid: number;    // midpoint
  age: number;    // candles since formed
  inverted: boolean;
  inversionConfidence: number;
}

// ── Detect all FVGs in a candle array ─────────────────────────────────────
function detectFVGs(candles: CandleOHLCV[], minBodyPct: number): FVGZone[] {
  const zones: FVGZone[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i-2]; // oldest
    const c1 = candles[i-1]; // middle (the displacement candle)
    const c2 = candles[i];   // newest

    // Middle candle body ratio
    const range = c1.high - c1.low;
    if (range === 0) continue;
    const body = Math.abs(c1.close - c1.open);
    const bodyRatio = body / range;
    if (bodyRatio < minBodyPct) continue; // not enough displacement

    // Bullish FVG: gap between c0.high and c2.low
    if (c2.low > c0.high) {
      zones.push({
        type: 'bullish',
        top: c2.low,
        bottom: c0.high,
        mid: (c2.low + c0.high) / 2,
        age: candles.length - 1 - i,
        inverted: false,
        inversionConfidence: 0,
      });
    }

    // Bearish FVG: gap between c2.high and c0.low
    if (c2.high < c0.low) {
      zones.push({
        type: 'bearish',
        top: c0.low,
        bottom: c2.high,
        mid: (c0.low + c2.high) / 2,
        age: candles.length - 1 - i,
        inverted: false,
        inversionConfidence: 0,
      });
    }
  }
  return zones;
}

// ── Check if a zone has been inverted (price fully traded through it) ──────
function checkInversion(zone: FVGZone, candles: CandleOHLCV[], fromIdx: number): FVGZone {
  let conf = 0;
  let inverted = false;
  let inversionVolume = 0;
  const avgVol = candles.slice(-20).reduce((s,c)=>s+c.volume,0)/20;

  for (let i = fromIdx; i < candles.length; i++) {
    const c = candles[i];

    if (zone.type === 'bullish') {
      // Bullish FVG inverted: close fully below zone.bottom
      if (c.close < zone.bottom) {
        inverted = true;
        inversionVolume = c.volume;
        conf += 0.4;
        // Extra confidence: large displacement candle
        const range = c.high - c.low;
        if (range > 0 && Math.abs(c.close-c.open)/range > 0.5) conf += 0.2;
        // Volume spike
        if (c.volume > avgVol * 1.5) conf += 0.2;
        break;
      }
    } else {
      // Bearish FVG inverted: close fully above zone.top
      if (c.close > zone.top) {
        inverted = true;
        inversionVolume = c.volume;
        conf += 0.4;
        const range = c.high - c.low;
        if (range > 0 && Math.abs(c.close-c.open)/range > 0.5) conf += 0.2;
        if (c.volume > avgVol * 1.5) conf += 0.2;
        break;
      }
    }
  }

  return { ...zone, inverted, inversionConfidence: Math.min(conf, 1.0) };
}

// ── Detect Break of Structure (BOS) ───────────────────────────────────────
// A BOS is when price takes out a recent swing high (bullish) or low (bearish)
function detectBOS(candles: CandleOHLCV[], lookback = 15): { bullishBOS: boolean; bearishBOS: boolean } {
  if (candles.length < lookback) return { bullishBOS:false, bearishBOS:false };
  const recent = candles.slice(-lookback);
  const current = candles[candles.length-1];
  const prev    = candles.slice(-lookback, -1);

  const swingHigh = Math.max(...prev.map(c=>c.high));
  const swingLow  = Math.min(...prev.map(c=>c.low));

  return {
    bullishBOS: current.close > swingHigh,
    bearishBOS: current.close < swingLow,
  };
}

// ── Main signal function ───────────────────────────────────────────────────
export interface IFVGSignal {
  side: 'LONG' | 'SHORT';
  confidence: number;
  zone: FVGZone;
  suggestedTP: number;
  suggestedSL: number;
  description: string;
}

export function bot4Signal(
  prices: number[],
  candles: CandleOHLCV[],
  asset: string,
  cfg: Bot4Config
): IFVGSignal | null {
  if (candles.length < 30 || prices.length < 30) return null;

  const livePrice = prices[prices.length - 1];
  const recent    = candles.slice(-(cfg.lookback));

  // Step 1: Detect all FVGs
  const rawFVGs = detectFVGs(recent, cfg.fvgMinBodyPct);

  // Step 2: Filter by age and check for inversion
  const invertedFVGs: FVGZone[] = [];
  for (const zone of rawFVGs) {
    if (zone.age > cfg.fvgMaxAge) continue;
    const startIdx = recent.length - zone.age;
    const checked  = checkInversion(zone, recent, startIdx);
    if (checked.inverted) invertedFVGs.push(checked);
  }

  if (!invertedFVGs.length) return null;

  // Step 3: Detect BOS
  const { bullishBOS, bearishBOS } = detectBOS(recent, 15);

  // Step 4: Find the best setup for the current price
  let bestSignal: IFVGSignal | null = null;
  let bestConf = 0;

  for (const zone of invertedFVGs) {
    const zoneSize = zone.top - zone.bottom;
    if (zoneSize <= 0) continue;

    // Check if price is retesting the IFVG zone
    const distToMid = Math.abs(livePrice - zone.mid) / zoneSize;
    if (distToMid > cfg.retestTolerance + 0.5) continue; // too far away

    // Price must be near or inside the zone
    const inZone    = livePrice >= zone.bottom && livePrice <= zone.top;
    const nearBelow = livePrice >= zone.bottom * (1 - 0.02) && livePrice < zone.bottom;
    const nearAbove = livePrice > zone.top && livePrice <= zone.top * (1 + 0.02);

    let conf = zone.inversionConfidence;
    let side: 'LONG' | 'SHORT' | null = null;

    // Inverted BULLISH FVG → now resistance → SHORT on retest
    if (zone.type === 'bullish' && (inZone || nearAbove)) {
      side = 'SHORT';
      conf += 0.3; // price returning to resistance
      if (bearishBOS) conf += 0.2;
      if (cfg.requireBOS && !bearishBOS) continue;
    }

    // Inverted BEARISH FVG → now support → LONG on retest
    if (zone.type === 'bearish' && (inZone || nearBelow)) {
      side = 'LONG';
      conf += 0.3;
      if (bullishBOS) conf += 0.2;
      if (cfg.requireBOS && !bullishBOS) continue;
    }

    if (!side) continue;
    conf = Math.min(conf, 1.0);
    if (conf < cfg.edgeThreshold) continue;

    // Calculate TP and SL
    let suggestedTP: number;
    let suggestedSL: number;

    if (side === 'SHORT') {
      suggestedSL = zone.top   * 1.005; // just above zone top
      suggestedTP = zone.bottom - (zoneSize * cfg.tpMultiple);
    } else {
      suggestedSL = zone.bottom * 0.995; // just below zone bottom
      suggestedTP = zone.top   + (zoneSize * cfg.tpMultiple);
    }

    if (conf > bestConf) {
      bestConf = conf;
      bestSignal = {
        side,
        confidence: conf,
        zone,
        suggestedTP,
        suggestedSL,
        description: `IFVG ${side} | ${zone.type === 'bullish' ? '🔴 Inverted Bullish FVG (now resistance)' : '🟢 Inverted Bearish FVG (now support)'} | conf ${(conf*100).toFixed(0)}% | zone $${zone.bottom.toFixed(6)}–$${zone.top.toFixed(6)}`,
      };
    }
  }

  return bestSignal;
}

export function bot4PositionSize(confidence: number, capital: number, cfg: Bot4Config): number {
  const scaled = cfg.betSize + (confidence - cfg.edgeThreshold) / (1 - cfg.edgeThreshold) * (cfg.maxSize - cfg.betSize);
  return Math.min(Math.max(scaled, cfg.betSize), Math.min(cfg.maxSize, capital * 0.25));
}
