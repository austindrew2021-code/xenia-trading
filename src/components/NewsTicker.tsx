import { useEffect, useState, useRef } from 'react';

interface TickerItem {
  type: 'coin' | 'news';
  text: string;
  change?: number;
  price?: string;
}

const STATIC_NEWS: TickerItem[] = [
  { type: 'news', text: '🔥 Solana memecoin volume hits $2.1B daily — highest in 6 months' },
  { type: 'news', text: '⚡ Pump.fun launches token launchpad v2 with bonding curve upgrades' },
  { type: 'news', text: '📈 Xenia Chain presale live — Stage 1 at $0.001/XEN · xeniachain.com' },
  { type: 'news', text: '🚀 Jupiter DEX aggregator surpasses $50B cumulative volume on Solana' },
  { type: 'news', text: '💡 Raydium announces concentrated liquidity pools for memecoins' },
  { type: 'news', text: '🏆 Xenia Trading platform — mock 100x leverage for Solana memecoins' },
  { type: 'news', text: '📊 SOL ecosystem TVL grows 40% month-over-month as memecoin season continues' },
];

const COINS = [
  { symbol: 'BONKUSDT', label: 'BONK' },
  { symbol: 'WIFUSDT',  label: 'WIF'  },
  { symbol: 'POPCATUSDT', label: 'POPCAT' },
  { symbol: 'MOODENGUSDT', label: 'MOODENG' },
  { symbol: 'PENGUUSDT', label: 'PENGU' },
  { symbol: 'FARTCOINUSDT', label: 'FARTCOIN' },
];

async function fetchCoinData(): Promise<TickerItem[]> {
  try {
    const symbols = COINS.map(c => `"${c.symbol}"`).join(',');
    const r = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbols=[${symbols}]`
    );
    if (!r.ok) throw new Error('fail');
    const data = await r.json() as { symbol: string; lastPrice: string; priceChangePercent: string }[];
    return data.map(d => {
      const coin = COINS.find(c => c.symbol === d.symbol);
      const chg = parseFloat(d.priceChangePercent);
      const price = parseFloat(d.lastPrice);
      const priceStr = price < 0.001 ? price.toExponential(2) : price < 1 ? price.toFixed(5) : price.toFixed(4);
      return {
        type: 'coin' as const,
        text: `${coin?.label || d.symbol}`,
        price: `$${priceStr}`,
        change: chg,
      };
    });
  } catch {
    return [];
  }
}

export function NewsTicker() {
  const [items, setItems] = useState<TickerItem[]>(STATIC_NEWS);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const coins = await fetchCoinData();
      if (coins.length > 0) {
        // interleave coins and news
        const merged: TickerItem[] = [];
        const max = Math.max(coins.length, STATIC_NEWS.length);
        for (let i = 0; i < max; i++) {
          if (coins[i])       merged.push(coins[i]);
          if (STATIC_NEWS[i]) merged.push(STATIC_NEWS[i]);
        }
        setItems(merged);
      }
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Duplicate for seamless loop
  const all = [...items, ...items];

  return (
    <div className="ticker-bar border-b border-white/[0.06] overflow-hidden relative"
      style={{ background: '#080a10', height: '32px' }}>
      {/* Fade edges */}
      <div className="absolute left-0 top-0 bottom-0 w-12 z-10 pointer-events-none"
        style={{ background: 'linear-gradient(90deg, #080a10, transparent)' }} />
      <div className="absolute right-0 top-0 bottom-0 w-12 z-10 pointer-events-none"
        style={{ background: 'linear-gradient(270deg, #080a10, transparent)' }} />

      <div ref={trackRef} className="ticker-track flex items-center h-full"
        style={{ animation: 'ticker 60s linear infinite', whiteSpace: 'nowrap' }}>
        {all.map((item, i) => (
          <div key={i} className="flex items-center flex-shrink-0 px-4">
            {item.type === 'coin' ? (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                <span className="text-[#2BFFF1]">{item.text}</span>
                <span className="text-[#A7B0B7]">{item.price}</span>
                <span style={{ color: (item.change ?? 0) >= 0 ? '#4ADE80' : '#F87171' }}>
                  {(item.change ?? 0) >= 0 ? '▲' : '▼'}{Math.abs(item.change ?? 0).toFixed(2)}%
                </span>
              </span>
            ) : (
              <span className="text-[11px] text-[#6B7280]">{item.text}</span>
            )}
            <span className="ml-4 text-[#1a2030]">|</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track:hover { animation-play-state: paused; }
      `}</style>
    </div>
  );
}
