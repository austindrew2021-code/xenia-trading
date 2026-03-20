import { useState, useEffect, useRef, useCallback } from 'react';
import { Candle } from '../types';

// ── Top assets — Binance symbols for those listed there ───────────────────
export const TOP_ASSETS = [
  { id:'sol',    symbol:'SOLUSDT',    label:'SOL/USDT',    coingecko:'solana',              isPump:false },
  { id:'bonk',   symbol:'BONKUSDT',   label:'BONK/USDT',   coingecko:'bonk',                isPump:true  },
  { id:'wif',    symbol:'WIFUSDT',    label:'WIF/USDT',    coingecko:'dogwifhat',           isPump:true  },
  { id:'popcat', symbol:'POPCATUSDT', label:'POPCAT/USDT', coingecko:'popcat',              isPump:true  },
  { id:'mew',    symbol:'MEWUSDT',    label:'MEW/USDT',    coingecko:'cat-in-a-dogs-world', isPump:true  },
  { id:'bome',   symbol:'BOMEUSDT',   label:'BOME/USDT',   coingecko:'book-of-meme',        isPump:true  },
  { id:'goat',   symbol:'GOATUSDT',   label:'GOAT/USDT',   coingecko:'goatseus-maximus',    isPump:true  },
  { id:'pnut',   symbol:'PNUTUSDT',   label:'PNUT/USDT',   coingecko:'peanut-the-squirrel', isPump:true  },
  { id:'moodeng',symbol:'MOODENGUSDT',label:'MOODENG/USDT',coingecko:'moo-deng',            isPump:true  },
  { id:'jup',    symbol:'JUPUSDT',    label:'JUP/USDT',    coingecko:'jupiter-exchange',    isPump:false },
] as const;

export interface SearchAsset {
  id:        string;
  symbol:    string;
  label:     string;
  address?:  string;
  pairAddress?: string; // DexScreener pair address for GeckoTerminal OHLCV
  priceUsd?: number;
  volume24h?:number;
  isPump:    boolean;
}

export type AssetId = string;

// ── Interval helpers ──────────────────────────────────────────────────────
// Maps UI interval string to Binance kline interval
const BINANCE_INTERVAL: Record<string, string> = {
  '1m':'1m', '3m':'3m', '5m':'5m', '15m':'15m', '30m':'30m',
  '1h':'1h', '2h':'2h', '4h':'4h', '6h':'6h', '12h':'12h',
  '1d':'1d', '1w':'1w',
};

// Maps UI interval to GeckoTerminal timeframe + aggregate
const GECKO_INTERVAL: Record<string, { timeframe: string; aggregate: number }> = {
  '1m':  { timeframe:'minute', aggregate:1  },
  '3m':  { timeframe:'minute', aggregate:3  },
  '5m':  { timeframe:'minute', aggregate:5  },
  '15m': { timeframe:'minute', aggregate:15 },
  '30m': { timeframe:'minute', aggregate:30 },
  '1h':  { timeframe:'hour',   aggregate:1  },
  '2h':  { timeframe:'hour',   aggregate:2  },
  '4h':  { timeframe:'hour',   aggregate:4  },
  '6h':  { timeframe:'hour',   aggregate:6  },
  '12h': { timeframe:'hour',   aggregate:12 },
  '1d':  { timeframe:'day',    aggregate:1  },
  '1w':  { timeframe:'week',   aggregate:1  },
};

// ── Fetch candles from Binance ────────────────────────────────────────────
async function fetchBinanceCandles(symbol: string, interval: string, limit = 300): Promise<Candle[]> {
  try {
    const ivl = BINANCE_INTERVAL[interval] ?? '15m';
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${ivl}&limit=${limit}`
    );
    if (!r.ok) return [];
    const data = await r.json() as [number,string,string,string,string,string][];
    return data.map(c => ({
      time: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
    }));
  } catch { return []; }
}

// ── Fetch candles from GeckoTerminal (for DEX tokens) ────────────────────
// Requires a Solana pool address (pair address from DexScreener)
async function fetchGeckoCandles(poolAddress: string, interval: string, limit = 300): Promise<Candle[]> {
  try {
    const { timeframe, aggregate } = GECKO_INTERVAL[interval] ?? { timeframe:'minute', aggregate:15 };
    const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${Math.min(limit, 1000)}&currency=usd&token=base`;
    const r = await fetch(url, { headers: { Accept: 'application/json;version=20230302' } });
    if (!r.ok) return [];
    const d = await r.json();
    const list: [number, string, string, string, string, string][] =
      d?.data?.attributes?.ohlcv_list ?? [];
    return list
      .map(c => ({
        time:   c[0] * 1000, // GeckoTerminal returns seconds, convert to ms
        open:   parseFloat(c[1]),
        high:   parseFloat(c[2]),
        low:    parseFloat(c[3]),
        close:  parseFloat(c[4]),
        volume: parseFloat(c[5]),
      }))
      .reverse() // GeckoTerminal returns newest first
      .filter(c => c.open > 0 && c.close > 0);
  } catch { return []; }
}

// ── Get pair address from DexScreener for a token address ─────────────────
async function getPairAddress(tokenAddress: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    if (!r.ok) return null;
    const d = await r.json();
    const pairs: any[] = d.pairs ?? [];
    // Prefer highest liquidity Solana pair
    const best = pairs
      .filter(p => p.chainId === 'solana')
      .sort((a, b) => parseFloat(b.liquidity?.usd ?? '0') - parseFloat(a.liquidity?.usd ?? '0'))[0];
    return best?.pairAddress ?? null;
  } catch { return null; }
}

// ── Get live price + 24h change from DexScreener ──────────────────────────
async function fetchDexPrice(address: string): Promise<{ price: number; change24h: number }> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const d = await r.json();
    const p = d.pairs?.[0];
    return {
      price:    parseFloat(p?.priceUsd ?? '0'),
      change24h:parseFloat(p?.priceChange?.h24 ?? '0'),
    };
  } catch { return { price: 0, change24h: 0 }; }
}

// ── Search Pump.fun / Solana tokens ────────────────────────────────────────
export async function searchPumpTokens(query: string): Promise<SearchAsset[]> {
  if (query.length < 2) return [];
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
    const data = await r.json();
    return (data.pairs || [])
      .filter((p: any) => p.chainId === 'solana' && p.baseToken)
      .slice(0, 20)
      .map((p: any) => ({
        id:          p.baseToken.address,
        symbol:      `${p.baseToken.symbol}/USD`,
        label:       `${p.baseToken.symbol}/USD`,
        address:     p.baseToken.address,
        pairAddress: p.pairAddress,
        priceUsd:    parseFloat(p.priceUsd || '0'),
        volume24h:   p.volume?.h24 || 0,
        isPump:      true,
      }));
  } catch { return []; }
}

// ── Main hook ─────────────────────────────────────────────────────────────
export function usePriceData(
  assetId: AssetId,
  interval = '15m',
  customAddress?: string,
  customPairAddress?: string,
) {
  const asset   = TOP_ASSETS.find(a => a.id === assetId) ?? TOP_ASSETS[0];
  const isDex   = !!customAddress;

  const [candles,   setCandles]   = useState<Candle[]>([]);
  const [livePrice, setLivePrice] = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [change24h, setChange24h] = useState(0);
  const wsRef      = useRef<WebSocket | null>(null);
  const pairRef    = useRef<string | null>(customPairAddress ?? null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    if (isDex && customAddress) {
      // ── DEX token ─────────────────────────────────────────────────────
      // 1. Get pair address if we don't have it
      if (!pairRef.current) {
        pairRef.current = await getPairAddress(customAddress);
      }

      // 2. Fetch candles from GeckoTerminal
      if (pairRef.current) {
        const candles = await fetchGeckoCandles(pairRef.current, interval);
        if (candles.length > 0) {
          setCandles(candles);
          const last = candles[candles.length - 1].close;
          setLivePrice(last);
          // 24h change: compare last close to close 24 candles ago (rough)
          if (candles.length > 1) {
            const first = candles[0].open;
            setChange24h(first > 0 ? ((last - first) / first) * 100 : 0);
          }
        }
      }

      // 3. Also fetch fresh price from DexScreener
      const { price, change24h: ch } = await fetchDexPrice(customAddress);
      if (price > 0) {
        setLivePrice(price);
        if (ch !== 0) setChange24h(ch);
      }
    } else {
      // ── Binance token ─────────────────────────────────────────────────
      let c = await fetchBinanceCandles(asset.symbol, interval);
      if (c.length > 0) {
        setCandles(c);
        setLivePrice(c[c.length - 1].close);
        const first = c[0].open;
        const last  = c[c.length - 1].close;
        setChange24h(first > 0 ? ((last - first) / first) * 100 : 0);
      } else {
        // Fallback: look up the token on DexScreener and try GeckoTerminal
        const knownAddresses: Record<string, string> = {
          'WIFUSDT':     'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
          'POPCATUSDT':  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
          'MEWUSDT':     'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREkzUo8THF',
          'BOMEUSDT':    'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',
          'GOATUSDT':    'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump',
          'PNUTUSDT':    '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump',
          'MOODENGUSDT': 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzc8yy',
          'BONKUSDT':    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
          'JUPUSDT':     'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
        };
        const tokenAddr = knownAddresses[asset.symbol];
        if (tokenAddr) {
          const pair = await getPairAddress(tokenAddr);
          if (pair) {
            c = await fetchGeckoCandles(pair, interval);
            if (c.length > 0) {
              setCandles(c);
              const last = c[c.length-1].close;
              setLivePrice(last);
              setChange24h(c.length > 1 ? ((last - c[0].open) / c[0].open) * 100 : 0);
            }
          }
        }
      }
    }

    setLoading(false);
    loadingRef.current = false;
  }, [asset.symbol, interval, isDex, customAddress]);

  useEffect(() => {
    // Reset when asset/interval changes
    setCandles([]);
    pairRef.current = customPairAddress ?? null;
    loadingRef.current = false;
    load();

    // Refresh every 60s
    const iv = setInterval(load, 60_000);

    // WebSocket for live price (Binance only)
    wsRef.current?.close();
    if (!isDex) {
      try {
        const ws = new WebSocket(
          `wss://stream.binance.com:9443/ws/${asset.symbol.toLowerCase()}@aggTrade`
        );
        ws.onmessage = e => {
          const d = JSON.parse(e.data);
          const p = parseFloat(d.p);
          if (p > 0) setLivePrice(p);
        };
        ws.onerror = () => ws.close();
        wsRef.current = ws;
      } catch { /* skip */ }
    }

    return () => {
      clearInterval(iv);
      wsRef.current?.close();
    };
  }, [asset.symbol, interval, isDex, customAddress, customPairAddress, load]);

  const prices = candles.map(c => c.close);
  return { candles, livePrice, loading, change24h, prices, asset };
}

// Available intervals for UI
export const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d'] as const;
export type Interval = typeof INTERVALS[number];

// Alias for backward compat
export const ASSETS = TOP_ASSETS;
