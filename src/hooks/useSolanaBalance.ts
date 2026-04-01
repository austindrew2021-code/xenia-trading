import { useEffect, useRef, useState, useCallback } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';

const ALCHEMY_RPC = 'https://solana-mainnet.g.alchemy.com/v2/7iiXgQQtGUhyi7a-fC0Sd';

const RPC_ENDPOINTS = [
  ALCHEMY_RPC,
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
];
const LAMPORTS_PER_SOL = 1_000_000_000;
const FALLBACK_ADDRESS = '53NooDTuHXiiCesVgn87rZ76hRYa2GZj4gepSAPRxbAX';

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
  if (_solPrice === 0) {
    try {
      const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
      const d = await r.json();
      const p = parseFloat(d?.pairs?.[0]?.priceUsd ?? '0');
      if (p > 0) { _solPrice = p; _priceTs = Date.now(); }
    } catch {}
  }
  return _solPrice;
}

export { fetchSOLPrice, ALCHEMY_RPC, LAMPORTS_PER_SOL };

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

  const rpcIdx = useRef(0);
  const refresh = useCallback(async () => {
    if (!addr) return;
    for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
      try {
        const idx = (rpcIdx.current + i) % RPC_ENDPOINTS.length;
        const conn = new Connection(RPC_ENDPOINTS[idx], 'confirmed');
        const lamports = await conn.getBalance(new PublicKey(addr));
        connRef.current = conn;
        rpcIdx.current = idx;
        await applyLamports(lamports);
        return;
      } catch {}
    }
  }, [addr, applyLamports]);

  useEffect(() => {
    mountedRef.current = true;
    if (!addr) { setSol(0); setUsd(0); return; }

    const conn = new Connection(ALCHEMY_RPC, { commitment: 'confirmed' });
    connRef.current = conn;
    const pubkey = new PublicKey(addr);

    setLoading(true);
    (async () => {
      for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
        try {
          const idx = (rpcIdx.current + i) % RPC_ENDPOINTS.length;
          const c = i === 0 ? conn : new Connection(RPC_ENDPOINTS[idx], 'confirmed');
          const lamports = await c.getBalance(pubkey);
          if (i > 0) { connRef.current = c; rpcIdx.current = idx; }
          await applyLamports(lamports);
          return;
        } catch {}
      }
    })().finally(() => { if (mountedRef.current) setLoading(false); });

    let subId: number | undefined;
    try {
      subId = conn.onAccountChange(pubkey, (accountInfo) => {
        applyLamports(accountInfo.lamports);
      }, 'confirmed');
    } catch {}

    const timer = setInterval(refresh, 10_000);

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
