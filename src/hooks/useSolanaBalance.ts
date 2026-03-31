import { useEffect, useRef, useState, useCallback } from 'react';

const RPC_HTTP = 'https://api.mainnet-beta.solana.com';
const RPC_WS   = 'wss://api.mainnet-beta.solana.com';
const LAMPORTS_PER_SOL = 1_000_000_000;

// Module-level SOL price cache (shared across hook instances)
let _solPrice = 0;
let _priceTs  = 0;

async function fetchSOLPrice(): Promise<number> {
  if (_solPrice > 0 && Date.now() - _priceTs < 30_000) return _solPrice;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const d = await r.json();
    const p = d?.solana?.usd;
    if (p && p > 0) { _solPrice = p; _priceTs = Date.now(); }
  } catch {}
  return _solPrice;
}

async function rpcGetBalance(address: string): Promise<number> {
  const r = await fetch(RPC_HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getBalance',
      params: [address, { commitment: 'confirmed' }],
    }),
  });
  const d = await r.json();
  return d?.result?.value ?? 0; // lamports
}

export interface SolanaBalanceResult {
  sol: number;
  usd: number;
  loading: boolean;
  refresh: () => void;
}

export function useSolanaBalance(address: string | null | undefined): SolanaBalanceResult {
  const [sol, setSol]         = useState(0);
  const [usd, setUsd]         = useState(0);
  const [loading, setLoading] = useState(false);
  const wsRef      = useRef<WebSocket | null>(null);
  const subIdRef   = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const applyLamports = useCallback(async (lamports: number) => {
    if (!mountedRef.current) return;
    const price = await fetchSOLPrice();
    if (!mountedRef.current) return;
    const solAmt = lamports / LAMPORTS_PER_SOL;
    setSol(solAmt);
    setUsd(solAmt * price);
  }, []);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const lamports = await rpcGetBalance(address);
      await applyLamports(lamports);
    } catch {}
  }, [address, applyLamports]);

  useEffect(() => {
    mountedRef.current = true;
    if (!address) { setSol(0); setUsd(0); return; }

    // Initial fetch
    setLoading(true);
    rpcGetBalance(address)
      .then(lamports => applyLamports(lamports))
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setLoading(false); });

    // WebSocket subscription for real-time updates
    try {
      const ws = new WebSocket(RPC_WS);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'accountSubscribe',
          params: [address, { encoding: 'base64', commitment: 'confirmed' }],
        }));
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.id === 1 && typeof msg.result === 'number') {
            subIdRef.current = msg.result;
            return;
          }
          if (msg.method === 'accountNotification') {
            const lamports: unknown = msg?.params?.result?.value?.lamports;
            if (typeof lamports === 'number') applyLamports(lamports);
          }
        } catch {}
      };
    } catch {}

    // Polling fallback every 15s
    const timer = setInterval(refresh, 15_000);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      const ws = wsRef.current;
      if (ws) {
        if (subIdRef.current !== null && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({
              jsonrpc: '2.0', id: 2,
              method: 'accountUnsubscribe',
              params: [subIdRef.current],
            }));
          } catch {}
        }
        ws.close();
        wsRef.current = null;
      }
      subIdRef.current = null;
    };
  }, [address, applyLamports, refresh]);

  return { sol, usd, loading, refresh };
}
