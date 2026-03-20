import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

// ── Constants ──────────────────────────────────────────────────────────────
const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL
  || 'https://ofjuiciwmwahdwdagzsj.supabase.co';
const MOCK_FEE_PCT = 0.0025; // 0.25%
const LIVE_FEE_PCT = 0.0035; // 0.35%
const SOL_MINT     = 'So11111111111111111111111111111111111111112';
const USDC_MINT    = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// ── Types ──────────────────────────────────────────────────────────────────
interface TokenResult {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  mcap: number;
  logoUri: string;
  pairAddress: string;
}

interface Holding {
  id: string;
  token_mint: string;
  token_symbol: string;
  token_name: string;
  amount: number;
  avg_cost: number;
  is_mock: boolean;
  currentPrice?: number;
  pnl?: number;
  pnlPct?: number;
}

interface Trade {
  id: string;
  token_symbol: string;
  side: 'buy' | 'sell';
  amount_token: number;
  amount_usd: number;
  price_usd: number;
  fee_usd: number;
  is_mock: boolean;
  status: string;
  created_at: string;
}

// ── Format helpers ─────────────────────────────────────────────────────────
function fmtP(p: number): string {
  if (!p || p <= 0) return '$0';
  if (p >= 1000) return `$${p.toFixed(2)}`;
  if (p >= 1)    return `$${p.toFixed(4)}`;
  if (p >= 0.001) return `$${p.toFixed(6)}`;
  return `$${p.toFixed(9)}`;
}
function fmtUsd(n: number): string {
  if (!n) return '$0';
  if (n >= 1e6)  return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

// ── Token search via DexScreener ───────────────────────────────────────────
async function searchTokens(q: string): Promise<TokenResult[]> {
  if (!q.trim()) return [];
  try {
    const isAddr = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim());
    const url = isAddr
      ? `https://api.dexscreener.com/latest/dex/tokens/${q.trim()}`
      : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const d = await r.json();
    const seen = new Set<string>();
    const results: TokenResult[] = [];
    for (const p of (d.pairs ?? []).slice(0, 40)) {
      if (p.chainId !== 'solana' || !p.baseToken) continue;
      const mint = p.baseToken.address;
      if (seen.has(mint)) continue;
      const price = parseFloat(p.priceUsd ?? '0');
      const mcap  = parseFloat(p.marketCap ?? p.fdv ?? '0');
      if (mcap > 0 && mcap < 30_000) continue;
      const logo = p.info?.imageUrl ?? '';
      if (!logo && !isAddr) continue;
      seen.add(mint);
      results.push({
        mint,
        symbol:      p.baseToken.symbol,
        name:        p.baseToken.name,
        priceUsd:    price,
        change24h:   parseFloat(p.priceChange?.h24 ?? '0'),
        volume24h:   parseFloat(p.volume?.h24 ?? '0'),
        mcap,
        logoUri:     logo,
        pairAddress: p.pairAddress ?? mint,
      });
      if (results.length >= 20) break;
    }
    return results;
  } catch { return []; }
}

// ── Get live price for a single token ─────────────────────────────────────
async function getTokenPrice(mint: string): Promise<number> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (!r.ok) return 0;
    const d = await r.json();
    return parseFloat(d.pairs?.[0]?.priceUsd ?? '0');
  } catch { return 0; }
}

// ── Token image with fallback ──────────────────────────────────────────────
function TokenImg({ src, symbol, size = 32 }: { src: string; symbol: string; size?: number }) {
  const [err, setErr] = useState(false);
  const cls = `rounded-full flex-shrink-0 bg-[#0D1117] border border-white/[0.05] flex items-center justify-center overflow-hidden`;
  return (
    <div className={cls} style={{ width: size, height: size }}>
      {!err && src
        ? <img src={src} alt={symbol} className="w-full h-full object-cover" onError={() => setErr(true)}/>
        : <span className="text-[#2BFFF1] font-black" style={{ fontSize: size * 0.28 }}>{symbol.slice(0,3)}</span>}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
interface Props { isMock: boolean; onToggleMock: () => void; }

export function SpotTradingPage({ isMock, onToggleMock }: Props) {
  const { user, account } = useAuth();

  // Search
  const [searchQ,       setSearchQ]       = useState('');
  const [searchResults, setSearchResults] = useState<TokenResult[]>([]);
  const [searching,     setSearching]     = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  // Selected token
  const [token,         setToken]         = useState<TokenResult | null>(null);
  const [livePrice,     setLivePrice]     = useState(0);
  const priceTimer = useRef<ReturnType<typeof setInterval>>();

  // Trade form
  const [side,          setSide]          = useState<'buy'|'sell'>('buy');
  const [amountUsd,     setAmountUsd]     = useState('');
  const [executing,     setExecuting]     = useState(false);
  const [txStatus,      setTxStatus]      = useState<{type:'success'|'error'; msg:string}|null>(null);

  // Portfolio
  const [holdings,      setHoldings]      = useState<Holding[]>([]);
  const [trades,        setTrades]        = useState<Trade[]>([]);
  const [tab,           setTab]           = useState<'swap'|'portfolio'|'history'>('swap');
  const [loadingData,   setLoadingData]   = useState(false);

  const amtN  = parseFloat(amountUsd) || 0;
  const feeP  = isMock ? MOCK_FEE_PCT : LIVE_FEE_PCT;
  const feeUsd = amtN * feeP;
  const netUsd = side === 'buy' ? amtN + feeUsd : amtN - feeUsd;
  const tokensOut = livePrice > 0 ? amtN / livePrice : 0;
  const balance = account ? (isMock ? account.mock_balance : account.real_balance) : 0;

  // Selected token holding
  const currentHolding = holdings.find(h => h.token_mint === token?.mint && h.is_mock === isMock);

  // ── Token search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); return; }
    clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const res = await searchTokens(searchQ);
      setSearchResults(res);
      setSearching(false);
    }, 350);
  }, [searchQ]);

  // ── Price polling for selected token ────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    setLivePrice(token.priceUsd);
    clearInterval(priceTimer.current);
    priceTimer.current = setInterval(async () => {
      const p = await getTokenPrice(token.mint);
      if (p > 0) setLivePrice(p);
    }, 10_000);
    return () => clearInterval(priceTimer.current);
  }, [token?.mint]);

  // ── Load portfolio / history ─────────────────────────────────────────────
  const loadPortfolio = useCallback(async () => {
    if (!supabase || !user) return;
    setLoadingData(true);
    const [holdRes, tradeRes] = await Promise.all([
      supabase.from('spot_holdings').select('*').eq('user_id', user.id).eq('is_mock', isMock).order('updated_at', { ascending:false }),
      supabase.from('spot_trades').select('*').eq('user_id', user.id).eq('is_mock', isMock).order('created_at', { ascending:false }).limit(50),
    ]);
    const rawHoldings = (holdRes.data ?? []) as Holding[];

    // Enrich with live prices
    const enriched = await Promise.all(rawHoldings.map(async (h) => {
      const p = await getTokenPrice(h.token_mint);
      const pnl    = p > 0 ? (p - h.avg_cost) * h.amount : 0;
      const pnlPct = h.avg_cost > 0 ? ((p - h.avg_cost) / h.avg_cost) * 100 : 0;
      return { ...h, currentPrice: p, pnl, pnlPct };
    }));

    setHoldings(enriched.filter(h => h.amount > 0.000001));
    setTrades((tradeRes.data ?? []) as Trade[]);
    setLoadingData(false);
  }, [user, isMock]);

  useEffect(() => { loadPortfolio(); }, [loadPortfolio, isMock]);

  // ── Execute trade ──────────────────────────────────────────────────────
  const executeTrade = async () => {
    if (!user || !token || amtN <= 0) return;
    if (amtN > balance) { setTxStatus({ type:'error', msg:'Insufficient balance' }); return; }
    setExecuting(true);
    setTxStatus(null);

    try {
      const { data:{ session } } = await supabase!.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      if (isMock) {
        // ── Mock trade ──────────────────────────────────────────────────
        const r = await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}` },
          body: JSON.stringify({
            action: 'mock_trade',
            isMock: true,
            inputMint:   side === 'buy' ? USDC_MINT : token.mint,
            outputMint:  side === 'buy' ? token.mint : USDC_MINT,
            amountUsd:   amtN,
            tokenSymbol: token.symbol,
            tokenName:   token.name,
            priceUsd:    livePrice,
            side,
          }),
        });
        const res = await r.json();
        if (!r.ok) throw new Error(res.error ?? 'Mock trade failed');
        setTxStatus({ type:'success', msg: `Mock ${side.toUpperCase()} ${tokensOut.toFixed(4)} ${token.symbol} — fee $${feeUsd.toFixed(4)}` });

      } else {
        // ── Live trade via Jupiter ──────────────────────────────────────
        const phantom = (window as any).solana;
        if (!phantom?.isPhantom) throw new Error('Phantom wallet required for live trading');
        if (!phantom.isConnected) {
          await phantom.connect();
        }
        const userWallet = phantom.publicKey?.toBase58();
        if (!userWallet) throw new Error('No wallet connected');

        // 1. Get quote
        const qRes = await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}` },
          body: JSON.stringify({
            action: 'quote',
            inputMint:   side === 'buy' ? USDC_MINT : token.mint,
            outputMint:  side === 'buy' ? token.mint : USDC_MINT,
            amountUsd:   amtN,
            tokenSymbol: token.symbol,
            tokenName:   token.name,
            priceUsd:    livePrice,
            userWallet,
            side,
          }),
        });
        const { quote, error: qErr } = await qRes.json();
        if (qErr) throw new Error(qErr);

        // 2. Get swap transaction
        const swapRes = await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}` },
          body: JSON.stringify({
            action: 'swap',
            quote,
            inputMint:   side === 'buy' ? USDC_MINT : token.mint,
            outputMint:  side === 'buy' ? token.mint : USDC_MINT,
            amountUsd:   amtN,
            tokenSymbol: token.symbol,
            tokenName:   token.name,
            priceUsd:    livePrice,
            userWallet,
            side,
          }),
        });
        const { swapTransaction, tradeId, error: swErr } = await swapRes.json();
        if (swErr) throw new Error(swErr);

        // 3. Sign with Phantom
        const txBuf = Buffer.from(swapTransaction, 'base64');
        const { Transaction, VersionedTransaction } = await import('@solana/web3.js');
        let tx: any;
        try { tx = VersionedTransaction.deserialize(txBuf); }
        catch { tx = Transaction.from(txBuf); }
        const signed   = await phantom.signTransaction(tx);
        const { Connection } = await import('@solana/web3.js');
        const conn = new Connection('https://api.mainnet-beta.solana.com');
        const txHash = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment:'confirmed' });
        await conn.confirmTransaction(txHash, 'confirmed');

        // 4. Confirm on backend
        await fetch(`${SUPABASE_URL}/functions/v1/spot-swap`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}` },
          body: JSON.stringify({ action:'confirm', tradeId, txHash, outputMint: token.mint, tokenSymbol: token.symbol, tokenName: token.name, amountUsd: amtN, priceUsd: livePrice, tokenAmount: tokensOut }),
        });

        setTxStatus({ type:'success', msg:`Live ${side.toUpperCase()} confirmed! tx: ${txHash.slice(0,8)}…` });
      }

      setAmountUsd('');
      await loadPortfolio();
    } catch (e: any) {
      setTxStatus({ type:'error', msg: e.message ?? 'Trade failed' });
    }
    setExecuting(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#05060B]">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
        <div className="flex-1">
          <h2 className="text-sm font-black text-[#F4F6FA]">Spot Trading</h2>
          <p className="text-[10px] text-[#4B5563]">Jupiter · Pump.fun · Raydium · All Solana DEXes</p>
        </div>

        {/* Mock / Live toggle */}
        <button onClick={onToggleMock}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-black transition-all ${
            isMock
              ? 'border-white/[0.12] bg-white/[0.04] text-[#6B7280] hover:text-[#A7B0B7]'
              : 'border-[#2BFFF1]/50 bg-[#2BFFF1]/15 text-[#2BFFF1]'
          }`}>
          <span className={`w-2 h-2 rounded-full ${isMock ? 'bg-[#374151]' : 'bg-[#2BFFF1] shadow-[0_0_6px_#2BFFF1]'}`}/>
          {isMock ? 'MOCK' : 'LIVE'}
        </button>

        {/* Fee info */}
        <div className="text-right hidden sm:block">
          <p className="text-[9px] text-[#374151]">Platform fee</p>
          <p className="text-[10px] font-bold text-[#4B5563]">{isMock ? '0.25%' : '0.35%'}</p>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex border-b border-white/[0.05] flex-shrink-0">
        {(['swap','portfolio','history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs font-semibold capitalize transition-all ${
              tab === t ? 'text-[#2BFFF1] border-b-2 border-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'
            }`}>
            {t === 'swap' ? '⇄ Swap' : t === 'portfolio' ? '📊 Portfolio' : '🕐 History'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ══════════════════ SWAP TAB ════════════════════════════════ */}
        {tab === 'swap' && (
          <div className="p-4 space-y-3 max-w-lg mx-auto">

            {/* Token search */}
            <div className="relative">
              <div className="flex items-center gap-2 bg-[#0B0E14] border border-white/[0.08] rounded-2xl px-3 py-2.5 focus-within:border-[#2BFFF1]/40 transition-all">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search any token — name, symbol, or paste address…"
                  className="flex-1 bg-transparent text-sm text-[#F4F6FA] outline-none placeholder-[#374151]"
                />
                {searching && <div className="w-3.5 h-3.5 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>}
              </div>

              {/* Search dropdown */}
              {searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#0B0E14] border border-white/[0.1] rounded-2xl shadow-2xl z-[200] overflow-hidden max-h-64 overflow-y-auto">
                  {searchResults.map(t => (
                    <button key={t.mint} onClick={() => { setToken(t); setSearchQ(''); setSearchResults([]); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-all text-left">
                      <TokenImg src={t.logoUri} symbol={t.symbol} size={32}/>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-[#F4F6FA]">{t.symbol}</p>
                        <p className="text-[10px] text-[#374151] truncate">{t.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono text-[#A7B0B7]">{fmtP(t.priceUsd)}</p>
                        <p className={`text-[10px] font-semibold ${t.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {t.change24h >= 0 ? '+' : ''}{t.change24h.toFixed(2)}%
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected token card */}
            {token ? (
              <div className="rounded-2xl border border-white/[0.07] bg-[#0B0E14] p-4">
                <div className="flex items-center gap-3 mb-3">
                  <TokenImg src={token.logoUri} symbol={token.symbol} size={40}/>
                  <div className="flex-1">
                    <p className="text-sm font-black text-[#F4F6FA]">{token.symbol}</p>
                    <p className="text-[10px] text-[#4B5563]">{token.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-black font-mono text-[#F4F6FA]">{fmtP(livePrice)}</p>
                    <p className={`text-xs font-bold ${token.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {token.change24h >= 0 ? '▲' : '▼'} {Math.abs(token.change24h).toFixed(2)}% 24h
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="bg-white/[0.03] rounded-xl px-2.5 py-2">
                    <p className="text-[#4B5563]">24h Volume</p>
                    <p className="font-semibold text-[#A7B0B7]">{fmtUsd(token.volume24h)}</p>
                  </div>
                  <div className="bg-white/[0.03] rounded-xl px-2.5 py-2">
                    <p className="text-[#4B5563]">Market Cap</p>
                    <p className="font-semibold text-[#A7B0B7]">{token.mcap > 0 ? fmtUsd(token.mcap) : '—'}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/[0.08] p-8 text-center">
                <p className="text-2xl mb-2">🔍</p>
                <p className="text-sm text-[#4B5563]">Search any Solana token above</p>
                <p className="text-[10px] text-[#374151] mt-1">Pump.fun · Raydium · Jupiter · Any $30k+ MCap token</p>
              </div>
            )}

            {/* Trade form */}
            {token && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">

                {/* Buy / Sell toggle */}
                <div className="flex rounded-xl overflow-hidden border border-white/[0.07]">
                  {(['buy','sell'] as const).map(s => (
                    <button key={s} onClick={() => setSide(s)}
                      className={`flex-1 py-2.5 text-xs font-bold transition-all capitalize ${
                        side === s
                          ? s === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                          : 'text-[#4B5563] hover:text-[#A7B0B7]'
                      }`}>
                      {s === 'buy' ? '▲ Buy' : '▼ Sell'} {token.symbol}
                    </button>
                  ))}
                </div>

                {/* Amount input */}
                <div>
                  <label className="text-[10px] text-[#4B5563] mb-1 block">Amount (USD)</label>
                  <div className="flex items-center gap-2 bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-[#2BFFF1]/40">
                    <span className="text-[#4B5563] text-sm">$</span>
                    <input
                      type="number"
                      value={amountUsd}
                      onChange={e => setAmountUsd(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 bg-transparent text-sm font-mono text-[#F4F6FA] outline-none"
                    />
                    <button onClick={() => setAmountUsd(String(Math.floor(balance * 0.25)))}
                      className="text-[9px] text-[#2BFFF1] hover:text-[#2BFFF1]/70 font-bold border border-[#2BFFF1]/20 px-1.5 py-0.5 rounded-md">25%</button>
                    <button onClick={() => setAmountUsd(String(Math.floor(balance * 0.5)))}
                      className="text-[9px] text-[#2BFFF1] hover:text-[#2BFFF1]/70 font-bold border border-[#2BFFF1]/20 px-1.5 py-0.5 rounded-md">50%</button>
                    <button onClick={() => setAmountUsd(String(Math.floor(balance)))}
                      className="text-[9px] text-[#2BFFF1] hover:text-[#2BFFF1]/70 font-bold border border-[#2BFFF1]/20 px-1.5 py-0.5 rounded-md">MAX</button>
                  </div>
                </div>

                {/* If selling, show current holding */}
                {side === 'sell' && currentHolding && (
                  <div className="rounded-xl bg-[#0B0E14] px-3 py-2 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-[#4B5563]">Available to sell</span>
                      <span className="text-[#F4F6FA] font-mono">{currentHolding.amount.toFixed(4)} {token.symbol}</span>
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[#4B5563]">≈ Value</span>
                      <span className="text-[#A7B0B7]">{fmtUsd(currentHolding.amount * livePrice)}</span>
                    </div>
                  </div>
                )}

                {/* Order summary */}
                {amtN > 0 && livePrice > 0 && (
                  <div className="rounded-xl bg-[#0B0E14] px-3 py-2.5 space-y-1.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#4B5563]">{side === 'buy' ? 'You receive' : 'Tokens sold'}</span>
                      <span className="font-mono text-[#F4F6FA]">{tokensOut.toFixed(6)} {token.symbol}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#4B5563]">Price per token</span>
                      <span className="font-mono text-[#A7B0B7]">{fmtP(livePrice)}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#4B5563]">Platform fee ({isMock ? '0.25%' : '0.35%'})</span>
                      <span className="font-mono text-[#F59E0B]">${feeUsd.toFixed(4)}</span>
                    </div>
                    <div className="border-t border-white/[0.06] pt-1.5">
                      <div className="flex justify-between text-[10px] font-bold">
                        <span className="text-[#4B5563]">Total {side === 'buy' ? 'cost' : 'received'}</span>
                        <span className="text-[#F4F6FA]">${netUsd.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#4B5563]">Balance after</span>
                      <span className={`font-mono ${balance - (side==='buy'?netUsd:0) < 0 ? 'text-red-400' : 'text-[#A7B0B7]'}`}>
                        ${(balance - (side === 'buy' ? netUsd : 0)).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Fee destination notice */}
                {!isMock && (
                  <div className="rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/05 px-3 py-2">
                    <p className="text-[9px] text-[#F59E0B]/70">
                      ⚡ 0.35% platform fee is sent on-chain to Xenia's fee wallet via Jupiter swap execution. Requires Phantom wallet.
                    </p>
                  </div>
                )}

                {/* Status message */}
                {txStatus && (
                  <div className={`rounded-xl px-3 py-2.5 text-xs font-semibold ${txStatus.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                    {txStatus.type === 'success' ? '✅' : '❌'} {txStatus.msg}
                  </div>
                )}

                {/* Execute button */}
                <button
                  onClick={executeTrade}
                  disabled={executing || !user || amtN <= 0 || amtN > balance || (side==='sell' && (!currentHolding || amtN > currentHolding.amount * livePrice))}
                  className={`w-full py-3.5 rounded-xl text-sm font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    side === 'buy'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                      : 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                  }`}>
                  {executing ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"/>
                      {isMock ? 'Simulating…' : 'Signing & Sending…'}
                    </span>
                  ) : !user ? 'Sign in to trade' : (
                    `${side === 'buy' ? '▲ Buy' : '▼ Sell'} ${token.symbol} ${isMock ? '(Mock)' : '(Live)'}`
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ PORTFOLIO TAB ══════════════════════════ */}
        {tab === 'portfolio' && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Holdings · {isMock ? 'Mock' : 'Live'}</p>
              <button onClick={loadPortfolio} className="text-[10px] text-[#4B5563] hover:text-[#2BFFF1] transition-all">↻ Refresh</button>
            </div>

            {loadingData ? (
              <div className="flex items-center justify-center py-12 gap-2 text-[#4B5563]">
                <div className="w-5 h-5 border-2 border-[#2BFFF1]/20 border-t-[#2BFFF1] rounded-full animate-spin"/>
                <span className="text-xs">Loading portfolio…</span>
              </div>
            ) : holdings.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-3xl mb-3">📭</p>
                <p className="text-sm text-[#4B5563]">No holdings yet</p>
                <p className="text-[10px] text-[#374151] mt-1">Make a {isMock ? 'mock' : 'live'} trade to start</p>
              </div>
            ) : (
              <>
                {/* Summary */}
                {(() => {
                  const totalValue = holdings.reduce((s,h) => s + (h.currentPrice ?? 0) * h.amount, 0);
                  const totalCost  = holdings.reduce((s,h) => s + h.avg_cost * h.amount, 0);
                  const totalPnl   = totalValue - totalCost;
                  const totalPnlPct = totalCost > 0 ? (totalPnl/totalCost)*100 : 0;
                  return (
                    <div className="rounded-2xl border border-white/[0.07] bg-[#0B0E14] p-4 mb-3">
                      <p className="text-[10px] text-[#4B5563] mb-2">Portfolio Value</p>
                      <p className="text-2xl font-black text-[#F4F6FA]">{fmtUsd(totalValue)}</p>
                      <p className={`text-sm font-bold mt-0.5 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {totalPnl >= 0 ? '▲' : '▼'} {fmtUsd(Math.abs(totalPnl))} ({Math.abs(totalPnlPct).toFixed(2)}%)
                      </p>
                    </div>
                  );
                })()}

                {/* Holdings list */}
                <div className="space-y-2">
                  {holdings.map(h => (
                    <div key={h.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#0B0E14] border border-white/[0.05] flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-black text-[#2BFFF1]">{h.token_symbol.slice(0,3)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-[#F4F6FA]">{h.token_symbol}</p>
                        <p className="text-[10px] text-[#374151]">{h.amount.toFixed(4)} tokens · avg {fmtP(h.avg_cost)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono text-[#F4F6FA]">{fmtUsd((h.currentPrice ?? 0) * h.amount)}</p>
                        <p className={`text-[10px] font-bold ${(h.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(h.pnl ?? 0) >= 0 ? '+' : ''}{fmtUsd(h.pnl ?? 0)} ({(h.pnlPct ?? 0).toFixed(1)}%)
                        </p>
                      </div>
                      <button
                        onClick={() => { const t: TokenResult = { mint:h.token_mint, symbol:h.token_symbol, name:h.token_name, priceUsd:h.currentPrice??0, change24h:0, volume24h:0, mcap:0, logoUri:'', pairAddress:h.token_mint }; setToken(t); setLivePrice(h.currentPrice??0); setSide('sell'); setTab('swap'); }}
                        className="flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all">
                        Sell
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════ HISTORY TAB ════════════════════════════ */}
        {tab === 'history' && (
          <div className="p-4 space-y-2">
            <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-2">Trade History · {isMock ? 'Mock' : 'Live'}</p>
            {trades.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-3xl mb-3">🕐</p>
                <p className="text-sm text-[#4B5563]">No trades yet</p>
              </div>
            ) : trades.map(t => (
              <div key={t.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-black ${t.side==='buy'?'bg-green-500/15 text-green-400':'bg-red-500/15 text-red-400'}`}>
                  {t.side==='buy'?'B':'S'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-[#F4F6FA]">{t.side.toUpperCase()} {t.token_symbol}</p>
                  <p className="text-[9px] text-[#374151]">{new Date(t.created_at).toLocaleString()} · fee ${t.fee_usd.toFixed(4)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono text-[#A7B0B7]">${t.amount_usd.toFixed(2)}</p>
                  <p className="text-[9px] text-[#374151]">{t.amount_token.toFixed(4)} @ {fmtP(t.price_usd)}</p>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${t.status==='completed'?'text-green-400 bg-green-500/10':'text-yellow-400 bg-yellow-500/10'}`}>
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
