import { useEffect, useState, useRef, useMemo } from 'react';
import { Candle } from '../types';
import { TOP_ASSETS } from '../hooks/usePriceData';

interface Props {
  candles: Candle[];
  livePrice: number;
  asset: string;
  assetId?: string;
  // Pass the DexScreener pair address for DEX tokens
  pairAddress?: string;
}

// ── On-chain trade from GeckoTerminal ─────────────────────────────────────
interface OnChainTrade {
  type: 'buy' | 'sell';
  priceUsd: number;
  amountUsd: number;
  txHash: string;
  time: number;
}

// ── AMM Depth level (simulated from liquidity) ────────────────────────────
interface DepthLevel { price: number; liquidity: number; pct: number; cumPct: number; }

function fmtPrice(p: number): string {
  if (!p || p <= 0) return '$0';
  if (p >= 1000)   return `$${p.toFixed(2)}`;
  if (p >= 1)      return `$${p.toFixed(4)}`;
  if (p >= 0.001)  return `$${p.toFixed(6)}`;
  return `$${p.toFixed(9)}`;
}
function fmtUsd(n: number): string {
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// ── Resolve pool address for GeckoTerminal ────────────────────────────────
async function resolvePool(tokenAddress: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    if (!r.ok) return null;
    const d = await r.json();
    const best = (d.pairs ?? [])
      .filter((p: any) => p.chainId === 'solana')
      .sort((a: any, b: any) => parseFloat(b.liquidity?.usd ?? 0) - parseFloat(a.liquidity?.usd ?? 0))[0];
    return best?.pairAddress ?? null;
  } catch { return null; }
}

// ── GeckoTerminal: recent trades for a Solana pool ────────────────────────
async function fetchGeckoTrades(poolAddress: string): Promise<OnChainTrade[]> {
  try {
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/trades?trade_volume_in_usd_greater_than=0`,
      { headers: { Accept: 'application/json;version=20230302' } }
    );
    if (!r.ok) return [];
    const d = await r.json();
    return (d.data ?? []).map((t: any) => ({
      type:       t.attributes?.kind === 'buy' ? 'buy' : 'sell',
      priceUsd:   parseFloat(t.attributes?.price_to_in_usd ?? 0),
      amountUsd:  parseFloat(t.attributes?.volume_in_usd ?? 0),
      txHash:     t.attributes?.tx_hash ?? '',
      time:       t.attributes?.block_timestamp
        ? new Date(t.attributes.block_timestamp).getTime()
        : Date.now(),
    })) as OnChainTrade[];
  } catch { return []; }
}

// ── DexScreener: get pool liquidity + price for AMM depth sim ─────────────
async function fetchPoolData(tokenAddress: string): Promise<{
  price: number; liquidity: number; volume24h: number;
  priceChange1h: number; priceChange24h: number;
  buyVolume: number; sellVolume: number;
  poolAddress: string | null;
} | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    if (!r.ok) return null;
    const d = await r.json();
    const best = (d.pairs ?? [])
      .filter((p: any) => p.chainId === 'solana')
      .sort((a: any, b: any) => parseFloat(b.liquidity?.usd ?? 0) - parseFloat(a.liquidity?.usd ?? 0))[0];
    if (!best) return null;
    // txns give us buy/sell counts
    const buys  = (best.txns?.h1?.buys  ?? 0) + (best.txns?.h24?.buys  ?? 0);
    const sells = (best.txns?.h1?.sells ?? 0) + (best.txns?.h24?.sells ?? 0);
    const vol   = parseFloat(best.volume?.h24 ?? 0);
    const total = buys + sells;
    return {
      price:         parseFloat(best.priceUsd ?? 0),
      liquidity:     parseFloat(best.liquidity?.usd ?? 0),
      volume24h:     vol,
      priceChange1h: parseFloat(best.priceChange?.h1 ?? 0),
      priceChange24h:parseFloat(best.priceChange?.h24 ?? 0),
      buyVolume:     total > 0 ? vol * (buys / total) : vol * 0.5,
      sellVolume:    total > 0 ? vol * (sells / total) : vol * 0.5,
      poolAddress:   best.pairAddress ?? null,
    };
  } catch { return null; }
}

// ── Build simulated AMM depth from liquidity constant ─────────────────────
// For x*y=k AMM, price impact at each level can be computed
function buildAmmDepth(price: number, liquidityUsd: number, isBid: boolean, steps = 6): DepthLevel[] {
  if (!price || !liquidityUsd) return [];
  // Each level is what it costs to move price by this %
  const pcts = [0.5, 1.0, 2.0, 3.5, 5.0, 8.0];
  const levels: DepthLevel[] = pcts.map((pct, i) => {
    // dx = liquidity * sqrt(new_price) - sqrt(old_price) from constant product formula
    const priceAtLevel = isBid
      ? price * (1 - pct/100)
      : price * (1 + pct/100);
    // Amount of token to move price by pct%: k = x*y, dx ≈ liquidity * pct/100
    const liqAtLevel = liquidityUsd * (pct / 100) * 0.7; // 70% utilization factor
    return { price: priceAtLevel, liquidity: liqAtLevel, pct: pct, cumPct: 0 };
  });
  // Cumulative
  const max = Math.max(...levels.map(l => l.liquidity));
  let cum = 0;
  levels.forEach(l => {
    cum += l.liquidity;
    l.cumPct = max > 0 ? (l.liquidity / max) * 100 : 0;
  });
  return levels;
}

// ── Candle-based pressure ─────────────────────────────────────────────────
function calcCandlePressure(candles: Candle[]) {
  const recent = candles.slice(-30);
  if (!recent.length) return { buyPct: 50, buyCnt: 0, sellCnt: 0, trend: 'neutral' as const };
  let buyVol = 0, sellVol = 0, buyCnt = 0, sellCnt = 0;
  for (const c of recent) {
    if (c.close >= c.open) { buyVol += c.volume; buyCnt++; }
    else                    { sellVol += c.volume; sellCnt++; }
  }
  const total = buyVol + sellVol;
  const buyPct = total > 0 ? (buyVol / total) * 100 : 50;
  const last5 = candles.slice(-5);
  const trend = last5[last5.length-1]?.close > last5[0]?.open ? 'bullish'
    : last5[last5.length-1]?.close < last5[0]?.open ? 'bearish' : 'neutral';
  return { buyPct, buyCnt, sellCnt, trend };
}

// ── Resolve token address from assetId ────────────────────────────────────
const KNOWN_ADDRESSES: Record<string, string> = {
  sol:     'So11111111111111111111111111111111111111112',
  bonk:    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  wif:     'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  popcat:  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
  mew:     'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREkzUo8THF',
  bome:    'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',
  goat:    'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump',
  pnut:    '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump',
  moodeng: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzc8yy',
  jup:     'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  jto:     'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
};

// ── Binance WebSocket for listed tokens ──────────────────────────────────
const BINANCE_SYMBOLS: Record<string, string> = {
  sol:'solusdt', bonk:'bonkusdt', wif:'wifusdt', popcat:'popcatusdt',
  mew:'mewusdt', bome:'bomeusdt', goat:'goatusdt', pnut:'pnutusdt',
  moodeng:'moodengusdt', jup:'jupusdt', jto:'jtousdt',
};

interface BookLevel { price: number; qty: number; pct: number; }
interface LiveBook { bids: BookLevel[]; asks: BookLevel[]; spread: number; connected: boolean; }

function useLiveCexBook(symbol: string | null): LiveBook {
  const [book, setBook] = useState<LiveBook>({ bids:[], asks:[], spread:0, connected:false });
  const wsRef = useRef<WebSocket | null>(null);
  const snapRef = useRef<{ bids: Map<string,string>; asks: Map<string,string> }>({ bids: new Map(), asks: new Map() });

  const rebuild = () => {
    const bidArr = [...snapRef.current.bids.entries()].filter(([,q])=>parseFloat(q)>0).sort((a,b)=>parseFloat(b[0])-parseFloat(a[0])).slice(0,6);
    const askArr = [...snapRef.current.asks.entries()].filter(([,q])=>parseFloat(q)>0).sort((a,b)=>parseFloat(a[0])-parseFloat(b[0])).slice(0,6);
    const maxBid = bidArr.length ? parseFloat(bidArr[0][1]) : 1;
    const maxAsk = askArr.length ? parseFloat(askArr[0][1]) : 1;
    const bids: BookLevel[] = bidArr.map(([p,q])=>({ price:parseFloat(p), qty:parseFloat(q), pct:(parseFloat(q)/maxBid)*100 }));
    const asks: BookLevel[] = askArr.map(([p,q])=>({ price:parseFloat(p), qty:parseFloat(q), pct:(parseFloat(q)/maxAsk)*100 }));
    const spread = askArr.length && bidArr.length ? parseFloat(askArr[0][0]) - parseFloat(bidArr[0][0]) : 0;
    setBook({ bids, asks, spread, connected: true });
  };

  useEffect(() => {
    if (!symbol) return;
    fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=10`)
      .then(r=>r.json()).then(d => {
        snapRef.current.bids = new Map(d.bids ?? []);
        snapRef.current.asks = new Map(d.asks ?? []);
        rebuild();
      }).catch(()=>{});

    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@depth@100ms`);
    ws.onopen  = () => setBook(b=>({...b, connected:true}));
    ws.onclose = () => setBook(b=>({...b, connected:false}));
    ws.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        for (const [p,q] of d.b??[]) { parseFloat(q)===0 ? snapRef.current.bids.delete(p) : snapRef.current.bids.set(p,q); }
        for (const [p,q] of d.a??[]) { parseFloat(q)===0 ? snapRef.current.asks.delete(p) : snapRef.current.asks.set(p,q); }
        rebuild();
      } catch {}
    };
    wsRef.current = ws;
    return () => { ws.close(); wsRef.current = null; };
  }, [symbol]);

  return book;
}

export function BuySellPressure({ candles, livePrice, asset, assetId, pairAddress }: Props) {
  const [trades,   setTrades]   = useState<OnChainTrade[]>([]);
  const [poolData, setPoolData] = useState<Awaited<ReturnType<typeof fetchPoolData>>>(null);
  const [poolAddr, setPoolAddr] = useState<string|null>(pairAddress ?? null);
  const [loading,  setLoading]  = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const tokenAddress = assetId ? (KNOWN_ADDRESSES[assetId] ?? null) : null;
  const binanceSym   = assetId ? (BINANCE_SYMBOLS[assetId] ?? null) : null;
  const cexBook      = useLiveCexBook(binanceSym);

  // Load DEX pool data + trades
  useEffect(() => {
    if (!tokenAddress) { setLoading(false); return; }

    const load = async () => {
      setLoading(true);
      // Get pool data from DexScreener
      const pd = await fetchPoolData(tokenAddress);
      setPoolData(pd);

      // Resolve pool address if not yet known
      let pool = poolAddr ?? pd?.poolAddress ?? null;
      if (!pool) { pool = await resolvePool(tokenAddress); }
      if (pool) {
        setPoolAddr(pool);
        const t = await fetchGeckoTrades(pool);
        setTrades(t.slice(0, 20));
      }
      setLoading(false);
    };

    load();
    pollRef.current = setInterval(load, 15_000); // refresh every 15s
    return () => clearInterval(pollRef.current);
  }, [tokenAddress, pairAddress]);

  const candleP = useMemo(() => calcCandlePressure(candles), [candles]);

  // Determine buy/sell from on-chain trades if available
  const onChainBuyUsd  = trades.filter(t=>t.type==='buy').reduce((s,t)=>s+t.amountUsd,0);
  const onChainSellUsd = trades.filter(t=>t.type==='sell').reduce((s,t)=>s+t.amountUsd,0);
  const onChainTotal   = onChainBuyUsd + onChainSellUsd;
  const buyPct  = onChainTotal > 0 ? (onChainBuyUsd / onChainTotal) * 100 : candleP.buyPct;
  const sellPct = 100 - buyPct;

  // Use DexScreener txn data if available
  const dsBuyPct = poolData
    ? ((poolData.buyVolume / (poolData.buyVolume + poolData.sellVolume + 0.001)) * 100)
    : buyPct;

  const finalBuyPct  = onChainTotal > 0 ? buyPct : poolData ? dsBuyPct : candleP.buyPct;
  const finalSellPct = 100 - finalBuyPct;

  const trendColor = candleP.trend === 'bullish' ? '#4ADE80' : candleP.trend === 'bearish' ? '#F87171' : '#A7B0B7';

  // AMM depth levels
  const liquidity = poolData?.liquidity ?? 0;
  const bidDepth  = buildAmmDepth(livePrice, liquidity, true);
  const askDepth  = buildAmmDepth(livePrice, liquidity, false);

  const hasCexBook  = binanceSym && cexBook.bids.length > 0;
  const hasOnChain  = poolData !== null;
  const dataSource  = hasCexBook ? 'Binance' : poolAddr ? 'GeckoTerminal + DexScreener' : 'DexScreener';

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Pressure & Depth</p>
        <div className="flex items-center gap-1.5">
          <span className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
            (hasCexBook && cexBook.connected) || (!hasCexBook && !loading)
              ? 'text-green-400 bg-green-400/10' : 'text-[#4B5563] bg-white/[0.04]'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${!loading && (hasCexBook ? cexBook.connected : true) ? 'bg-green-400 animate-pulse' : 'bg-[#374151]'}`}/>
            {loading ? 'Loading…' : 'LIVE'}
          </span>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ color:trendColor, background:trendColor+'20', border:`1px solid ${trendColor}40` }}>
            {candleP.trend.charAt(0).toUpperCase()+candleP.trend.slice(1)}
          </span>
        </div>
      </div>

      {/* Source tag */}
      <p className="text-[9px] text-[#374151]">Data: {dataSource} · Solana on-chain</p>

      {/* Buy/Sell pressure bar */}
      <div>
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-green-400 font-bold">▲ BUY {finalBuyPct.toFixed(1)}%</span>
          <span className="text-red-400 font-bold">▼ SELL {finalSellPct.toFixed(1)}%</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex">
          <div className="h-full bg-green-500/60 transition-all duration-500" style={{ width:`${finalBuyPct}%` }}/>
          <div className="h-full bg-red-500/50 flex-1"/>
        </div>
        {poolData && (
          <div className="flex justify-between text-[9px] text-[#374151] mt-1">
            <span>Buy vol: {fmtUsd(poolData.buyVolume)}</span>
            <span>Liq: {fmtUsd(poolData.liquidity)}</span>
            <span>Sell vol: {fmtUsd(poolData.sellVolume)}</span>
          </div>
        )}
      </div>

      {/* Dual arc charts */}
      <div className="flex items-center justify-around">
        {([['BUY', finalBuyPct, '#4ADE80'], ['SELL', finalSellPct, '#F87171']] as const).map(([label, pct, color]) => (
          <div key={label} className="relative flex items-center justify-center">
            <svg width="68" height="68" viewBox="0 0 68 68">
              <circle cx="34" cy="34" r="26" fill="none" stroke={`${color}20`} strokeWidth="6"/>
              <circle cx="34" cy="34" r="26" fill="none" stroke={color} strokeWidth="6"
                strokeDasharray={`${2*Math.PI*26*(pct as number)/100} ${2*Math.PI*26*(1-(pct as number)/100)}`}
                strokeDashoffset={2*Math.PI*26*0.25} strokeLinecap="round"
                style={{ transition:'stroke-dasharray 0.5s ease' }}/>
            </svg>
            <div className="absolute text-center">
              <p className="text-[11px] font-black" style={{ color }}>{(pct as number).toFixed(0)}%</p>
              <p className="text-[8px] text-[#4B5563]">{label}</p>
            </div>
          </div>
        ))}
        <div className="text-center space-y-0.5">
          <p className="text-[9px] text-[#4B5563]">Candles</p>
          <p className="text-[11px] font-bold text-green-400">{candleP.buyCnt} ▲</p>
          <p className="text-[11px] font-bold text-red-400">{candleP.sellCnt} ▼</p>
          {trades.length > 0 && (
            <>
              <p className="text-[9px] text-[#4B5563] mt-1">On-chain txns</p>
              <p className="text-[10px] text-green-400">{trades.filter(t=>t.type==='buy').length} buys</p>
              <p className="text-[10px] text-red-400">{trades.filter(t=>t.type==='sell').length} sells</p>
            </>
          )}
        </div>
      </div>

      {/* ORDER BOOK / DEPTH */}
      {hasCexBook ? (
        // ── CEX Order Book (Binance) ─────────────────────────────────────
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-[#4B5563] uppercase tracking-wide font-semibold">Live Order Book · Binance</p>
          </div>
          <div className="space-y-0.5 mb-1">
            {[...cexBook.asks].reverse().slice(0,4).map((l,i) => (
              <div key={i} className="relative flex items-center gap-2 px-1.5 py-0.5 rounded overflow-hidden">
                <div className="absolute inset-0 bg-red-500/10" style={{ width:`${l.pct}%`, right:0, left:'auto' }}/>
                <span className="text-[10px] font-mono text-red-400 flex-1 relative z-10">{fmtPrice(l.price)}</span>
                <span className="text-[10px] text-[#4B5563] relative z-10">{l.qty.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between px-1.5 py-1 border-y border-white/[0.06] my-1">
            <span className="text-xs font-bold" style={{ color:trendColor }}>{fmtPrice(livePrice)}</span>
            <span className="text-[9px] text-[#4B5563]">spread: {fmtPrice(cexBook.spread)}</span>
          </div>
          <div className="space-y-0.5">
            {cexBook.bids.slice(0,4).map((l,i) => (
              <div key={i} className="relative flex items-center gap-2 px-1.5 py-0.5 rounded overflow-hidden">
                <div className="absolute inset-0 bg-green-500/10" style={{ width:`${l.pct}%` }}/>
                <span className="text-[10px] font-mono text-green-400 flex-1 relative z-10">{fmtPrice(l.price)}</span>
                <span className="text-[10px] text-[#4B5563] relative z-10">{l.qty.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : hasOnChain ? (
        // ── AMM Depth (DEX tokens) ────────────────────────────────────────
        <div>
          <p className="text-[10px] text-[#4B5563] uppercase tracking-wide font-semibold mb-2">AMM Liquidity Depth · Raydium/Pump.fun</p>
          <p className="text-[9px] text-[#374151] mb-2">Shows USD cost to move price by each % — AMM pools don't have traditional order books</p>
          <div className="space-y-0.5 mb-2">
            {[...askDepth].reverse().slice(0,3).map((l,i) => (
              <div key={i} className="relative flex items-center gap-2 px-1.5 py-0.5 rounded overflow-hidden">
                <div className="absolute inset-0 bg-red-500/10" style={{ width:`${l.cumPct}%`, right:0, left:'auto' }}/>
                <span className="text-[10px] font-mono text-red-400 flex-1 relative z-10">+{l.pct}% → {fmtPrice(l.price)}</span>
                <span className="text-[10px] text-[#4B5563] relative z-10">{fmtUsd(l.liquidity)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between px-1.5 py-1 border-y border-white/[0.06] my-1">
            <span className="text-xs font-bold" style={{ color:trendColor }}>{fmtPrice(livePrice)}</span>
            <span className="text-[9px] text-[#4B5563]">liq: {fmtUsd(liquidity)}</span>
          </div>
          <div className="space-y-0.5">
            {bidDepth.slice(0,3).map((l,i) => (
              <div key={i} className="relative flex items-center gap-2 px-1.5 py-0.5 rounded overflow-hidden">
                <div className="absolute inset-0 bg-green-500/10" style={{ width:`${l.cumPct}%` }}/>
                <span className="text-[10px] font-mono text-green-400 flex-1 relative z-10">-{l.pct}% → {fmtPrice(l.price)}</span>
                <span className="text-[10px] text-[#4B5563] relative z-10">{fmtUsd(l.liquidity)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center py-3 gap-2 text-[#4B5563] text-[10px]">
          <div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>
          {loading ? 'Fetching on-chain data…' : 'No pool data available'}
        </div>
      )}

      {/* Recent on-chain trades */}
      {trades.length > 0 && (
        <div>
          <p className="text-[10px] text-[#4B5563] uppercase tracking-wide font-semibold mb-1.5">Recent On-Chain Trades</p>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {trades.slice(0,8).map((t,i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] py-0.5">
                <span className={`font-bold w-6 ${t.type==='buy'?'text-green-400':'text-red-400'}`}>{t.type==='buy'?'B':'S'}</span>
                <span className="font-mono text-[#A7B0B7] flex-1">{fmtPrice(t.priceUsd)}</span>
                <span className="text-[#6B7280]">{fmtUsd(t.amountUsd)}</span>
                <span className="text-[#374151]">{new Date(t.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 24h stats from DexScreener */}
      {poolData && (
        <div className="grid grid-cols-2 gap-2">
          {[
            ['24h Volume', fmtUsd(poolData.volume24h)],
            ['1h Change', `${poolData.priceChange1h >= 0 ? '+' : ''}${poolData.priceChange1h.toFixed(2)}%`],
          ].map(([l,v]) => (
            <div key={l} className="rounded-xl bg-[#0B0E14] px-2.5 py-2 text-center">
              <p className="text-[9px] text-[#4B5563]">{l}</p>
              <p className="text-xs font-bold text-[#F4F6FA]">{v}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
