import { useState, useEffect, useCallback } from 'react';

type MarketTab = 'favourites' | 'hot' | 'new' | 'gainers' | 'losers' | 'volume' | 'marketcap';

interface Token {
  address:    string;
  name:       string;
  symbol:     string;
  price:      number;
  change24h:  number;
  volume24h:  number;
  mcap:       number;
  liquidity:  number;
  age:        number;
  dexUrl:     string;
  pairAddress:string;
  imageUrl?:  string;
  isSafe:     boolean; // no mint/freeze authority
}

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `$${(n/1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `$${(n/1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `$${(n/1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(p: number): string {
  if (p === 0) return '$0';
  if (p >= 1)  return `$${p.toFixed(4)}`;
  if (p >= 0.001) return `$${p.toFixed(6)}`;
  // Show scientific for very small
  const str = p.toExponential(2);
  return `$${str}`;
}

function TokenImage({ imageUrl, symbol }: { imageUrl?: string; symbol: string }) {
  const [err, setErr] = useState(false);
  if (imageUrl && !err) {
    return <img src={imageUrl} alt={symbol} className="w-7 h-7 rounded-full object-cover"
      onError={() => setErr(true)} />;
  }
  return (
    <div className="w-7 h-7 rounded-full bg-[#2BFFF1]/10 flex items-center justify-center text-[10px] font-black text-[#2BFFF1]">
      {symbol.slice(0,3)}
    </div>
  );
}

async function fetchDex(url: string): Promise<Token[]> {
  try {
    const r = await fetch(url, { headers:{ Accept:'application/json' } });
    if (!r.ok) throw new Error('fail');
    const d = await r.json();
    const pairs = d.pairs || d.data?.pairs || [];
    return pairs
      .filter((p: any) =>
        p.chainId === 'solana' &&
        p.baseToken &&
        parseFloat(p.priceUsd || '0') > 0 &&
        parseFloat(p.liquidity?.usd || '0') > 1000 // min $1k liquidity
      )
      .map((p: any): Token => ({
        address:    p.baseToken.address,
        name:       p.baseToken.name || p.baseToken.symbol,
        symbol:     p.baseToken.symbol,
        price:      parseFloat(p.priceUsd || '0'),
        change24h:  parseFloat(p.priceChange?.h24 || '0'),
        volume24h:  parseFloat(p.volume?.h24 || '0'),
        mcap:       parseFloat(p.marketCap || '0'),
        liquidity:  parseFloat(p.liquidity?.usd || '0'),
        age:        p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3_600_000 : 999,
        dexUrl:     p.url || `https://dexscreener.com/solana/${p.pairAddress}`,
        pairAddress:p.pairAddress || p.baseToken.address,
        imageUrl:   p.info?.imageUrl || p.baseToken.imageUrl,
        // DexScreener marks tokens with mint/freeze as "high risk" — we filter them
        isSafe:     !p.risks?.some((r:any) => r.name?.toLowerCase().includes('mint') || r.name?.toLowerCase().includes('freeze')),
      }));
  } catch { return []; }
}

const ENDPOINTS: Record<MarketTab, string> = {
  hot:       'https://api.dexscreener.com/token-boosts/top/v1',
  new:       'https://api.dexscreener.com/latest/dex/search?q=pump&chainIds=solana',
  gainers:   'https://api.dexscreener.com/latest/dex/search?q=solana+meme&chainIds=solana',
  losers:    'https://api.dexscreener.com/latest/dex/search?q=solana+token&chainIds=solana',
  volume:    'https://api.dexscreener.com/latest/dex/search?q=solana+defi&chainIds=solana',
  marketcap: 'https://api.dexscreener.com/latest/dex/search?q=solana+coin&chainIds=solana',
  favourites:'https://api.dexscreener.com/latest/dex/search?q=solana&chainIds=solana',
};

const TABS: { id: MarketTab; label: string }[] = [
  { id:'favourites', label:'★ Favs' },
  { id:'hot',        label:'🔥 Hot' },
  { id:'new',        label:'🆕 New' },
  { id:'gainers',    label:'▲ Gainers' },
  { id:'losers',     label:'▼ Losers' },
  { id:'volume',     label:'Vol' },
  { id:'marketcap',  label:'MCap' },
];

interface Props {
  onTrade: (id: string, address: string) => void;
  favourites: string[];
  onToggleFav: (address: string) => void;
}

export function MarketsPage({ onTrade, favourites, onToggleFav }: Props) {
  const [tab,     setTab]     = useState<MarketTab>('hot');
  const [tokens,  setTokens]  = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const url = ENDPOINTS[tab];
    const all = await fetchDex(url);
    // Filter to safe tokens only (no mint/freeze)
    const safe = all.filter(t => t.isSafe);
    setTokens(safe.length > 5 ? safe : all); // fallback if too few safe tokens
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); const iv = setInterval(load, 30_000); return ()=>clearInterval(iv); }, [load]);

  const sorted = [...tokens]
    .filter(t => {
      if (tab === 'favourites') return favourites.includes(t.address);
      if (search) return t.symbol.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase());
      return true;
    })
    .sort((a,b) => {
      if (tab === 'gainers')   return b.change24h - a.change24h;
      if (tab === 'losers')    return a.change24h - b.change24h;
      if (tab === 'volume')    return b.volume24h - a.volume24h;
      if (tab === 'marketcap') return b.mcap - a.mcap;
      if (tab === 'new')       return a.age - b.age;
      return b.volume24h - a.volume24h;
    })
    .slice(0, 100);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tabs + search */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 overflow-x-auto flex-shrink-0 border-b border-white/[0.06]">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${tab===t.id?'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {t.label}
          </button>
        ))}
        <input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}
          className="ml-auto w-28 bg-[#0B0E14] border border-white/[0.08] rounded-xl px-2.5 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 flex-shrink-0"/>
      </div>

      {/* Table header — FIXED alignment matching rows */}
      <div className="grid items-center px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-[#4B5563] flex-shrink-0 border-b border-white/[0.04]"
        style={{ gridTemplateColumns:'20px 1fr 90px 72px 80px 72px 64px' }}>
        <div/>
        <div>Token</div>
        <div className="text-right">Price</div>
        <div className="text-right">24h</div>
        <div className="text-right">Volume</div>
        <div className="text-right">MCap</div>
        <div className="text-right">Action</div>
      </div>

      {/* Token rows */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-[#4B5563] text-sm">
            <div className="w-4 h-4 border-2 border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>
            Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[#4B5563] text-sm">
            {tab==='favourites'?'Star tokens to add favourites':'No tokens found'}
          </div>
        ) : sorted.map(t => {
          const isFav = favourites.includes(t.address);
          const up    = t.change24h >= 0;
          return (
            <div key={t.pairAddress}
              className="grid items-center px-3 py-2.5 hover:bg-white/[0.025] transition-all border-b border-white/[0.03] cursor-default"
              style={{ gridTemplateColumns:'20px 1fr 90px 72px 80px 72px 64px' }}>

              {/* Fav star */}
              <button onClick={()=>onToggleFav(t.address)}
                className={`text-sm transition-colors leading-none ${isFav?'text-yellow-400':'text-[#2D3748] hover:text-yellow-400'}`}>
                ★
              </button>

              {/* Token name + image */}
              <div className="flex items-center gap-2 min-w-0">
                <TokenImage imageUrl={t.imageUrl} symbol={t.symbol}/>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#F4F6FA] truncate">{t.symbol}</p>
                  <p className="text-[9px] text-[#374151] truncate">{t.name}</p>
                </div>
              </div>

              {/* Price */}
              <div className="text-right">
                <p className="text-xs font-semibold text-[#F4F6FA]">{fmtPrice(t.price)}</p>
              </div>

              {/* 24h change */}
              <div className="text-right">
                <span className={`text-xs font-bold ${up?'text-green-400':'text-red-400'}`}>
                  {up?'+':''}{t.change24h.toFixed(2)}%
                </span>
              </div>

              {/* Volume */}
              <div className="text-right">
                <p className="text-xs text-[#A7B0B7]">{fmt(t.volume24h)}</p>
              </div>

              {/* MCap */}
              <div className="text-right">
                <p className="text-xs text-[#A7B0B7]">{t.mcap>0?fmt(t.mcap):'—'}</p>
              </div>

              {/* Trade button */}
              <div className="text-right">
                <button onClick={()=>onTrade(t.address, t.address)}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">
                  Trade
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-1.5 text-[9px] text-[#374151] flex-shrink-0 border-t border-white/[0.04] flex items-center justify-between">
        <span>DexScreener · Solana · {sorted.length} tokens · Updates every 30s</span>
        <span className="text-[#2BFFF1]/50">✓ Filtered: no mint/freeze authority</span>
      </div>
    </div>
  );
}
