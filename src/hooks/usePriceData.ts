import { useState, useEffect, useRef, useCallback } from 'react';
import { Candle } from '../types';

export const ASSETS = [
  { id: 'sol',   symbol: 'SOLUSDT',  label: 'SOL/USDT',  coingecko: 'solana' },
  { id: 'bonk',  symbol: 'BONKUSDT', label: 'BONK/USDT', coingecko: 'bonk' },
  { id: 'wif',   symbol: 'WIFUSDT',  label: 'WIF/USDT',  coingecko: 'dogwifhat' },
  { id: 'popcat',symbol: 'POPCATUSDT',label:'POPCAT/USDT',coingecko: 'popcat' },
  { id: 'btc',   symbol: 'BTCUSDT',  label: 'BTC/USDT',  coingecko: 'bitcoin' },
  { id: 'eth',   symbol: 'ETHUSDT',  label: 'ETH/USDT',  coingecko: 'ethereum' },
];

export type AssetId = typeof ASSETS[number]['id'];

async function fetchCandles(symbol: string, interval = '15m', limit = 100): Promise<Candle[]> {
  try {
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    if (!r.ok) throw new Error('binance fail');
    const data = await r.json() as [number,string,string,string,string,string][];
    return data.map(c => ({
      time: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));
  } catch {
    return [];
  }
}

export function usePriceData(assetId: AssetId, interval = '15m') {
  const asset = ASSETS.find(a => a.id === assetId)!;
  const [candles, setCandles]       = useState<Candle[]>([]);
  const [livePrice, setLivePrice]   = useState(0);
  const [loading, setLoading]       = useState(true);
  const [change24h, setChange24h]   = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const c = await fetchCandles(asset.symbol, interval);
    if (c.length > 0) {
      setCandles(c);
      setLivePrice(c[c.length - 1].close);
      const first = c[0].open;
      const last  = c[c.length - 1].close;
      setChange24h(first > 0 ? ((last - first) / first) * 100 : 0);
    }
    setLoading(false);
  }, [asset.symbol, interval]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000); // re-fetch candles every 60s

    // WebSocket for live tick
    try {
      const ws = new WebSocket(
        `wss://stream.binance.com:9443/ws/${asset.symbol.toLowerCase()}@trade`
      );
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        const price = parseFloat(d.p);
        if (price > 0) setLivePrice(price);
      };
      ws.onerror = () => ws.close();
      wsRef.current = ws;
    } catch { /* websocket not available */ }

    return () => {
      clearInterval(iv);
      wsRef.current?.close();
    };
  }, [asset.symbol, load]);

  const prices = candles.map(c => c.close);

  return { candles, livePrice, loading, change24h, prices, asset };
}
