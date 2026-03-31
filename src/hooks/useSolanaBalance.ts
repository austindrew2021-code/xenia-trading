import { useEffect, useRef, useState, useCallback } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const LAMPORTS_PER_SOL = 1_000_000_000;
const FALLBACK_ADDRESS = '53NooDTuHXiiCesVgn87rZ76hRYa2GZj4gepSAPRxbAX';

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

export interface SolanaBalanceResult {
  sol: number;
  usd: number;
  loading: boolean;
  refresh: () => void;
}

export function useSolanaBalance(address: string | null | undefined): SolanaBalanceResult {
  const addr = address || FALLBACK_ADDRESS;
  const [sol, setSol]         = useState(0);
  const [usd, setUsd]         = useState(0);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const connRef    = useRef<Connection | null>(null);

  const applyLamports = useCallback(async (lamports: number) => {
    if (!mountedRef.current) return;
    const price = await fetchSOLPrice();
    if (!mountedRef.current) return;
    const solAmt = lamports / LAMPORTS_PER_SOL;
    setSol(solAmt);
    setUsd(solAmt * price);
  }, []);

  const refresh = useCallback(async () => {
    if (!addr) return;
    try {
      if (!connRef.current) connRef.current = new Connection(RPC_URL, 'confirmed');
      const lamports = await connRef.current.getBalance(new PublicKey(addr));
      await applyLamports(lamports);
    } catch {}
  }, [addr, applyLamports]);

  useEffect(() => {
    mountedRef.current = true;
    if (!addr) { setSol(0); setUsd(0); return; }

    const conn = new Connection(RPC_URL, {
      commitment: 'confirmed',
      wsEndpoint: 'wss://api.mainnet-beta.solana.com',
    });
    connRef.current = conn;
    const pubkey = new PublicKey(addr);

    // Initial fetch via Connection.getBalance()
    setLoading(true);
    conn.getBalance(pubkey)
      .then(lamports => applyLamports(lamports))
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setLoading(false); });

    // Real-time WebSocket via Connection.onAccountChange()
    let subId: number | undefined;
    try {
      subId = conn.onAccountChange(pubkey, (accountInfo) => {
        applyLamports(accountInfo.lamports);
      }, 'confirmed');
    } catch {}

    // Polling fallback every 15s (handles WebSocket drops)
    const timer = setInterval(refresh, 15_000);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      if (subId !== undefined) {
        try { conn.removeAccountChangeListener(subId); } catch {}
      }
      connRef.current = null;
    };
  }, [addr, applyLamports, refresh]);

  return { sol, usd, loading, refresh };
}
