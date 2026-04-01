import { useEffect, useRef, useState, useCallback } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';

// ── RPC endpoints — Alchemy (real key) is always tried first ──────────────
const ALCHEMY_HTTP = 'https://solana-mainnet.g.alchemy.com/v2/7iiXgQQtGUhyi7a-fC0Sd';
const ALCHEMY_WSS  = 'wss://solana-mainnet.g.alchemy.com/v2/7iiXgQQtGUhyi7a-fC0Sd';

const RPC_FALLBACKS = [
  'https://rpc.ankr.com/solana',
  'https://api.mainnet-beta.solana.com',
];

const LAMPORTS_PER_SOL = 1_000_000_000;

// ── Module-level SOL price cache (shared across all hook instances) ────────
let _solPrice = 0;
let _priceTs  = 0;

async function fetchSOLPrice(): Promise<number> {
  if (_solPrice > 0 && Date.now() - _priceTs < 30_000) return _solPrice;
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    );
    const d = await r.json();
    const p = d?.solana?.usd;
    if (p && p > 0) { _solPrice = p; _priceTs = Date.now(); }
  } catch { /* keep last known price */ }
  return _solPrice;
}

export interface SolanaBalanceResult {
  sol:     number;
  usd:     number;
  loading: boolean;
  refresh: () => void;
}

export function useSolanaBalance(
  address: string | null | undefined,
): SolanaBalanceResult {
  const [sol,     setSol]     = useState(0);
  const [usd,     setUsd]     = useState(0);
  const [loading, setLoading] = useState(false);

  const mountedRef = useRef(true);
  // Keep one persistent Alchemy connection for WebSocket subscriptions
  const alchemyConnRef = useRef<Connection | null>(null);
  const subIdRef       = useRef<number | undefined>(undefined);

  // ── Convert lamports → SOL + USD and push to state ───────────────────
  const applyLamports = useCallback(async (lamports: number) => {
    if (!mountedRef.current) return;
    const price  = await fetchSOLPrice();
    if (!mountedRef.current) return;
    const solAmt = lamports / LAMPORTS_PER_SOL;
    setSol(solAmt);
    setUsd(solAmt * price);
  }, []);

  // ── One-shot balance fetch: Alchemy first, fallbacks on error ─────────
  const refresh = useCallback(async () => {
    if (!address) return;
    const pubkey = new PublicKey(address);

    // Always try Alchemy first
    try {
      const conn    = new Connection(ALCHEMY_HTTP, 'confirmed');
      const lamports = await conn.getBalance(pubkey);
      await applyLamports(lamports);
      return;
    } catch (err) {
      console.warn('[useSolanaBalance] Alchemy HTTP failed, trying fallbacks', err);
    }

    // Fallback RPCs
    for (const rpc of RPC_FALLBACKS) {
      try {
        const conn     = new Connection(rpc, 'confirmed');
        const lamports = await conn.getBalance(pubkey);
        await applyLamports(lamports);
        return;
      } catch { /* try next */ }
    }

    console.error('[useSolanaBalance] All RPC endpoints failed for', address);
  }, [address, applyLamports]);

  // ── Main effect: mount connection, fetch balance, subscribe WS ────────
  useEffect(() => {
    if (!address) {
      setSol(0); setUsd(0);
      return;
    }

    mountedRef.current = true;
    let pollingTimer: ReturnType<typeof setInterval> | undefined;

    // Validate address before hitting the network
    let pubkey: PublicKey;
    try { pubkey = new PublicKey(address); }
    catch { console.error('[useSolanaBalance] Invalid address:', address); return; }

    // ── Initial fetch ───────────────────────────────────────────────────
    setLoading(true);
    refresh().finally(() => {
      if (mountedRef.current) setLoading(false);
    });

    // ── WebSocket subscription via Alchemy ──────────────────────────────
    const setupWS = () => {
      try {
        const conn = new Connection(ALCHEMY_HTTP, {
          commitment: 'confirmed',
          wsEndpoint: ALCHEMY_WSS,
        });
        alchemyConnRef.current = conn;

        subIdRef.current = conn.onAccountChange(
          pubkey,
          (accountInfo) => {
            applyLamports(accountInfo.lamports);
          },
          'confirmed',
        );
      } catch (err) {
        console.warn('[useSolanaBalance] WebSocket setup failed:', err);
        // Polling will cover this case
      }
    };

    setupWS();

    // ── Polling fallback every 15 s (covers WS drops / rate limits) ─────
    pollingTimer = setInterval(refresh, 15_000);

    return () => {
      mountedRef.current = false;
      clearInterval(pollingTimer);

      // Clean up WebSocket subscription
      const conn  = alchemyConnRef.current;
      const subId = subIdRef.current;
      if (conn && subId !== undefined) {
        try { conn.removeAccountChangeListener(subId); } catch { /* ignore */ }
      }
      alchemyConnRef.current = null;
      subIdRef.current       = undefined;
    };
  }, [address, applyLamports, refresh]);

  return { sol, usd, loading, refresh };
}
