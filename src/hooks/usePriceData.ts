import { useState, useEffect, useRef, useCallback } from 'react';
import { Candle } from '../types';

// ── Static top assets ─────────────────────────────────────────────────────
export const TOP_ASSETS = [
  { id: 'sol',    symbol: 'SOLUSDT',   label: 'SOL/USDT',   coingecko: 'solana',     isPump: false },
  { id: 'bonk',   symbol: 'BONKUSDT',  label: 'BONK/USDT',  coingecko: 'bonk',       isPump: true  },
  { id: 'wif',    symbol: 'WIFUSDT',   label: 'WIF/USDT',   coingecko: 'dogwifhat',  isPump: true  },
  { id: 'popcat', symbol: 'POPCATUSDT',label: 'POPCAT/USDT',coingecko: 'popcat',     isPump: true  },
  { id: 'mew',    symbol: 'MEWUSDT',   label: 'MEW/USDT',   coingecko: 'cat-in-a-dogs-world', isPump: true },
  { id: 'bome',   symbol: 'BOMEUSDT',  label: 'BOME/USDT',  coingecko: 'book-of-meme', isPump: true },
  { id: 'slerf',  symbol: 'SLERFUSDT', label: 'SLERF/USDT', coingecko: 'slerf',      isPump: true  },
  { id: 'goat',   symbol: 'GOATUSDT',  label: 'GOAT/USDT',  coingecko: 'goatseus-maximus', isPump: true },
  { id: 'moodeng',symbol: 'MOODENGUSDT',label:'MOODENG/USDT',coingecko:'moo-deng',   isPump: true  },
  { id: 'pnut',   symbol: 'PNUTUSDT',  label: 'PNUT/USDT',  coingecko: 'peanut-the-squirrel', isPump: true },
];

export interface SearchAsset {
  id: string;
  symbol: string;
  label: string;
  address?: string;
  priceUsd?: number;
  volume24h?: number;
  isPump: boolean;
}

export type AssetId = string;

async function fetchCandles(symbol: string, interval = '15m', limit = 200): Promise<Candle[]> {
  try {
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    if (!r.ok) throw new Error('fail');
    const data = await r.json() as [number,string,string,string,string,string][];
    return data.map(c => ({
      time: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
    }));
  } catch { return []; }
}

// Search Pump.fun / Solana tokens via DexScreener
export async function searchPumpTokens(query: string): Promise<SearchAsset[]> {
  if (query.length < 2) return [];
  try {
    const r = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`
    );
    const data = await r.json();
    return (data.pairs || [])
      .filter((p: any) => p.chainId === 'solana' && p.baseToken)
      .slice(0, 20)
      .map((p: any) => ({
        id:       p.baseToken.address,
        symbol:   p.baseToken.symbol + '/USD',
        label:    `${p.baseToken.symbol}/USD`,
        address:  p.baseToken.address,
        priceUsd: parseFloat(p.priceUsd || '0'),
        volume24h:p.volume?.h24 || 0,
        isPump:   true,
      }));
  } catch { return []; }
}

// Fetch live price for a DexScreener token
async function fetchDexPrice(address: string): Promise<number> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const d = await r.json();
    return parseFloat(d.pairs?.[0]?.priceUsd || '0');
  } catch { return 0; }
}

export function usePriceData(assetId: AssetId, interval = '15m', customAddress?: string) {
  const asset      = TOP_ASSETS.find(a => a.id === assetId) ?? TOP_ASSETS[0];
  const isDex      = !!customAddress;

  const [candles,   setCandles]   = useState<Candle[]>([]);
  const [livePrice, setLivePrice] = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [change24h, setChange24h] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    if (isDex) {
      // DexScreener token — no candles available, just price
      const price = await fetchDexPrice(customAddress!);
      setLivePrice(price);
      setLoading(false);
      return;
    }
    const c = await fetchCandles(asset.symbol, interval);
    if (c.length > 0) {
      setCandles(c);
      setLivePrice(c[c.length - 1].close);
      const first = c[0].open;
      const last  = c[c.length - 1].close;
      setChange24h(first > 0 ? ((last - first) / first) * 100 : 0);
    }
    setLoading(false);
  }, [asset.symbol, interval, isDex, customAddress]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);

    if (!isDex) {
      try {
        const ws = new WebSocket(
          `wss://stream.binance.com:9443/ws/${asset.symbol.toLowerCase()}@trade`
        );
        ws.onmessage = e => {
          const d = JSON.parse(e.data);
          const p = parseFloat(d.p);
          if (p > 0) setLivePrice(p);
        };
        ws.onerror = () => ws.close();
        wsRef.current = ws;
      } catch { /* no ws */ }
    }

    return () => {
      clearInterval(iv);
      wsRef.current?.close();
    };
  }, [asset.symbol, interval, isDex, customAddress, load]);

  const prices = candles.map(c => c.close);
  return { candles, livePrice, loading, change24h, prices, asset };
}
