// ── Xenia Engine — Market data ─────────────────────────────────────────────
//
// The existing usePriceData hook fetches a single page of 300 candles. That is
// nowhere near enough to walk-forward anything: 4 folds need ~1500+ bars before
// the purge gaps, and a 300-bar sample cannot produce 30 out-of-sample trades.
// This module pages backwards until it has real history.
//
// Sources:
//   binance  — deepest history, free, no key. Preferred for majors.
//   kucoin   — matches the venue JARVIS trades on. Use when validating a spec
//              you intend to run live there, since fills and wicks differ.
//   gecko    — Solana DEX pools via GeckoTerminal, for memecoins that only exist
//              on-chain. History is short and thin; treat results with suspicion.

import { Candle } from './types';

export type Source = 'binance' | 'kucoin' | 'gecko';

const BINANCE_IVL: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h', '1d': '1d',
};

const KUCOIN_IVL: Record<string, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
  '1h': '1hour', '2h': '2hour', '4h': '4hour', '6h': '6hour',
  '12h': '12hour', '1d': '1day',
};

const GECKO_IVL: Record<string, { tf: string; agg: number }> = {
  '1m': { tf: 'minute', agg: 1 }, '5m': { tf: 'minute', agg: 5 },
  '15m': { tf: 'minute', agg: 15 }, '30m': { tf: 'minute', agg: 30 },
  '1h': { tf: 'hour', agg: 1 }, '4h': { tf: 'hour', agg: 4 },
  '12h': { tf: 'hour', agg: 12 }, '1d': { tf: 'day', agg: 1 },
};

export const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000,
  '12h': 43_200_000, '1d': 86_400_000,
};

function dedupeSort(candles: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of candles) {
    if (c.open > 0 && c.close > 0 && c.high >= c.low) map.set(c.time, c);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/** Page backwards through Binance klines until `want` bars are collected. */
async function fetchBinance(symbol: string, interval: string, want: number): Promise<Candle[]> {
  const ivl = BINANCE_IVL[interval] ?? '4h';
  const sym = symbol.replace(/[-/]/g, '').toUpperCase();
  const out: Candle[] = [];
  let endTime: number | undefined;
  for (let page = 0; page < 12 && out.length < want; page++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${ivl}&limit=1000`
      + (endTime ? `&endTime=${endTime}` : '');
    const r = await fetch(url);
    if (!r.ok) break;
    const data = (await r.json()) as [number, string, string, string, string, string][];
    if (!Array.isArray(data) || !data.length) break;
    for (const k of data) {
      out.push({
        time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
      });
    }
    endTime = data[0][0] - 1;
    if (data.length < 1000) break;
  }
  return dedupeSort(out);
}

/** KuCoin caps at 1500 per request and uses startAt/endAt in SECONDS. */
async function fetchKucoin(symbol: string, interval: string, want: number): Promise<Candle[]> {
  const ivl = KUCOIN_IVL[interval] ?? '4hour';
  const sym = symbol.includes('-') ? symbol.toUpperCase()
    : symbol.toUpperCase().replace(/USDT$/, '-USDT');
  const step = (INTERVAL_MS[interval] ?? 14_400_000) / 1000;
  const out: Candle[] = [];
  let endAt = Math.floor(Date.now() / 1000);
  for (let page = 0; page < 10 && out.length < want; page++) {
    const startAt = endAt - step * 1500;
    const url = `https://api.kucoin.com/api/v1/market/candles?type=${ivl}`
      + `&symbol=${sym}&startAt=${startAt}&endAt=${endAt}`;
    const r = await fetch(url);
    if (!r.ok) break;
    const j = await r.json();
    const rows: string[][] = j?.data ?? [];
    if (!rows.length) break;
    // KuCoin: [time, open, close, high, low, volume, turnover] — note the ordering
    for (const k of rows) {
      out.push({
        time: +k[0] * 1000, open: +k[1], close: +k[2],
        high: +k[3], low: +k[4], volume: +k[5],
      });
    }
    endAt = startAt - 1;
  }
  return dedupeSort(out);
}

async function fetchGecko(poolAddress: string, interval: string, want: number): Promise<Candle[]> {
  const { tf, agg } = GECKO_IVL[interval] ?? { tf: 'hour', agg: 4 };
  const out: Candle[] = [];
  let before: number | undefined;
  for (let page = 0; page < 6 && out.length < want; page++) {
    const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}`
      + `/ohlcv/${tf}?aggregate=${agg}&limit=1000&currency=usd&token=base`
      + (before ? `&before_timestamp=${before}` : '');
    const r = await fetch(url, { headers: { Accept: 'application/json;version=20230302' } });
    if (!r.ok) break;
    const d = await r.json();
    const list: [number, string, string, string, string, string][] =
      d?.data?.attributes?.ohlcv_list ?? [];
    if (!list.length) break;
    for (const k of list) {
      out.push({
        time: k[0] * 1000, open: +k[1], high: +k[2],
        low: +k[3], close: +k[4], volume: +k[5],
      });
    }
    before = Math.min(...list.map(k => k[0])) - 1;
    if (list.length < 1000) break;
  }
  return dedupeSort(out);
}

export interface HistoryRequest {
  symbol: string;          // 'BTCUSDT' | 'BTC-USDT' | a Solana pool address for gecko
  interval: string;        // '4h'
  bars?: number;           // default 3000
  source?: Source;         // default 'binance'
}

export interface HistoryResult {
  candles: Candle[];
  source: Source;
  symbol: string;
  interval: string;
  warnings: string[];
}

/**
 * Fetch deep history, with a warning when the sample is too small to trust.
 *
 * Rule of thumb: walk-forward needs roughly 1,500 bars minimum. Below that you
 * cannot generate enough out-of-sample trades for the profit factor to mean
 * anything, and any result should be treated as untested.
 */
export async function fetchHistory(req: HistoryRequest): Promise<HistoryResult> {
  const bars = req.bars ?? 3000;
  const source = req.source ?? 'binance';
  const warnings: string[] = [];
  let candles: Candle[] = [];

  try {
    if (source === 'binance') candles = await fetchBinance(req.symbol, req.interval, bars);
    else if (source === 'kucoin') candles = await fetchKucoin(req.symbol, req.interval, bars);
    else candles = await fetchGecko(req.symbol, req.interval, bars);
  } catch (e) {
    warnings.push(`fetch failed: ${(e as Error).message}`);
  }

  if (!candles.length && source === 'binance') {
    warnings.push('binance returned nothing, falling back to kucoin');
    try { candles = await fetchKucoin(req.symbol, req.interval, bars); } catch { /* ignore */ }
  }

  candles = candles.slice(-bars);

  if (candles.length < 1500) {
    warnings.push(
      `only ${candles.length} bars — walk-forward needs ~1500+. Results below that `
      + `are not out-of-sample tested and should not be trusted.`);
  }
  const gap = INTERVAL_MS[req.interval];
  if (gap && candles.length > 2) {
    let missing = 0;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].time - candles[i - 1].time > gap * 1.5) missing++;
    }
    if (missing > candles.length * 0.02) {
      warnings.push(`${missing} gaps in the series — thin or halted market, treat with caution`);
    }
  }

  return { candles, source, symbol: req.symbol, interval: req.interval, warnings };
}

/** Realised ATR as a percent of price — used to sanity-check leverage geometry. */
export function atrPctEstimate(candles: Candle[], period = 14): number {
  if (candles.length < period + 2) return 0;
  const tail = candles.slice(-200);
  let sum = 0, n = 0;
  for (let i = 1; i < tail.length; i++) {
    const pc = tail[i - 1].close;
    const tr = Math.max(tail[i].high - tail[i].low,
      Math.abs(tail[i].high - pc), Math.abs(tail[i].low - pc));
    sum += tr / tail[i].close; n++;
  }
  return n ? (sum / n) * 100 : 0;
}

/**
 * The geometric constraint that overrides every setup: a stop must sit inside the
 * liquidation distance or it does not exist. Returns the widest usable stop in ATR
 * multiples at a given leverage.
 */
export function leverageGeometry(atrPct: number, leverage: number, maintMarginPct = 0.5) {
  const liqPct = Math.max(1 / leverage - maintMarginPct / 100, 0.001) * 100;
  const maxStopAtr = atrPct > 0 ? liqPct / atrPct : 0;
  return {
    liqPct,
    atrPct,
    maxStopAtr,
    usable: maxStopAtr >= 1.2,
    note: maxStopAtr < 1.2
      ? `At ${leverage}x, liquidation sits ${liqPct.toFixed(2)}% away but 1 ATR is `
      + `${atrPct.toFixed(2)}%. Any stop wider than ${maxStopAtr.toFixed(1)} ATR is `
      + `decorative — the exchange closes you first. Lower the leverage or the timeframe.`
      : `At ${leverage}x you can use stops up to ${maxStopAtr.toFixed(1)} ATR `
      + `(liquidation ${liqPct.toFixed(2)}%, 1 ATR ${atrPct.toFixed(2)}%).`,
  };
}
