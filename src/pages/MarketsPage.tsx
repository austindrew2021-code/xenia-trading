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
}

function fmt(n: number): string {
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(p: number): string {
  if (p === 0) return '$0';
  if (p >= 1) return `$${p.toFixed(4)}`;
  const s = p.toExponential(3);
  return `$${s}`;
}

async function fetchFromDex(url: string): Promise<Token[]> {
  try {
    const r = await fetch(url);
    const d = await r.json();
    return (d.pairs || [])
      .filter((p: any) => p.chainId === 'solana' && p.baseToken && p.priceUsd)
      .slice(0, 50)
      .map((p: any): Token => ({
        address:    p.baseToken.address,
        name:       p.baseToken.name,
        symbol:     p.baseToken.symbol,
        price:      parseFloat(p.priceUsd || '0'),
        change24h:  parseFloat(p.priceChange?.h24 || '0'),
        volume24h:  parseFloat(p.volume?.h24 || '0'),
        mcap:       parseFloat(p.marketCap || '0'),
        liquidity:  parseFloat(p.liquidity?.usd || '0'),
        age:        p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3_600_000 : 0,
        dexUrl:     p.url || '',
        pairAddress:p.pairAddress,
      }));
  } catch { return []; }
}

const TABS: { id: MarketTab; label: string }[] = [
  { id:'favourites', label:'★ Favourites' },
  { id:'hot',        label:'🔥 Hot' },
  { id:'new',        label:'🆕 New' },
  { id:'gainers',    label:'▲ Gainers' },
  { id:'losers',     label:'▼ Losers' },
  { id:'volume',     label:'📊 Volume' },
  { id:'marketcap',  label:'💰 Mktcap' },
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
  const [sort,    setSort]    = useState<'change'|'volume'|'mcap'|'price'|'age'>('volume');

  const load = useCallback(async () => {
    setLoading(true);
    let url = '';
    switch (tab) {
      case 'hot':      url = 'https://api.dexscreener.com/token-boosts/top/v1?chainId=solana'; break;
      case 'new':      url = 'https://api.dexscreener.com/token-profiles/latest/v1?chainId=solana'; break;
      case 'gainers':
      case 'losers':
      case 'volume':
      case 'marketcap':
      case 'favourites':
        url = 'https://api.dexscreener.com/latest/dex/search?q=pump.fun+solana';
        break;
    }
    const all = url ? await fetchFromDex(url) : [];
    setTokens(all);
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); const iv = setInterval(load, 30_000); return () => clearInterval(iv); }, [load]);

  const sorted = [...tokens]
    .filter(t => {
      if (tab === 'favourites') return favourites.includes(t.address);
      if (search) return t.symbol.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase());
      return true;
    })
    .sort((a, b) => {
      if (tab === 'gainers')   return b.change24h - a.change24h;
      if (tab === 'losers')    return a.change24h - b.change24h;
      if (tab === 'volume')    return b.volume24h - a.volume24h;
      if (tab === 'marketcap') return b.mcap - a.mcap;
      if (tab === 'new')       return a.age - b.age;
      return b.volume24h - a.volume24h;
    });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-4 pt-4 overflow-x-auto flex-shrink-0 pb-3 border-b border-white/[0.06]">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${tab === t.id ? 'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {t.label}
          </button>
        ))}
        <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
          className="ml-auto w-32 bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 flex-shrink-0" />
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[24px_1fr_100px_90px_90px_80px_80px] gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-[#4B5563] flex-shrink-0 border-b border-white/[0.04]">
        <div />
        <div>Token</div>
        <div className="text-right">Price</div>
        <div className="text-right">24h %</div>
        <div className="text-right">Volume</div>
        <div className="text-right">MCap</div>
        <div className="text-right">Action</div>
      </div>

      {/* Token list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-[#4B5563] text-sm">
            <div className="w-4 h-4 border-2 border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />
            Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[#4B5563] text-sm">
            {tab === 'favourites' ? 'No favourites yet — star tokens to add them' : 'No tokens found'}
          </div>
        ) : sorted.map(t => {
          const isFav = favourites.includes(t.address);
          const up    = t.change24h >= 0;
          return (
            <div key={t.pairAddress}
              className="grid grid-cols-[24px_1fr_100px_90px_90px_80px_80px] gap-2 px-4 py-2.5 hover:bg-white/[0.025] transition-all items-center border-b border-white/[0.03]">
              <button onClick={() => onToggleFav(t.address)}
                className={`text-sm transition-colors ${isFav ? 'text-yellow-400' : 'text-[#374151] hover:text-yellow-400'}`}>
                ★
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-6 rounded-lg bg-[#2BFFF1]/10 flex items-center justify-center text-[9px] font-black text-[#2BFFF1] flex-shrink-0">
                    {t.symbol[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#F4F6FA] truncate">{t.symbol}</p>
                    <p className="text-[9px] text-[#4B5563] truncate">{t.name}</p>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-[#F4F6FA]">{fmtPrice(t.price)}</p>
              </div>
              <div className="text-right">
                <span className={`text-xs font-bold ${up ? 'text-green-400' : 'text-red-400'}`}>
                  {up ? '+' : ''}{t.change24h.toFixed(2)}%
                </span>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#A7B0B7]">{fmt(t.volume24h)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#A7B0B7]">{t.mcap > 0 ? fmt(t.mcap) : '—'}</p>
              </div>
              <div className="text-right">
                <button onClick={() => onTrade(t.address, t.address)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">
                  Trade
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2 text-[10px] text-[#374151] flex-shrink-0 border-t border-white/[0.04]">
        Data from DexScreener · Solana memecoins · Updates every 30s
      </div>
    </div>
  );
}
