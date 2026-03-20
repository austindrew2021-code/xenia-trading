import { useEffect, useState, useRef } from 'react';
import { Candle } from '../types';

interface Props {
  candles: Candle[];
  livePrice: number;
  asset: string;
}

interface PressureData {
  buyVolume: number;
  sellVolume: number;
  buyCandleCount: number;
  sellCandleCount: number;
  avgBuyBody: number;
  avgSellBody: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  momentum: number; // -100 to +100
  levels: { price: number; type: 'support' | 'resistance'; strength: number }[];
}

function calcPressure(candles: Candle[], price: number): PressureData {
  if (!candles.length) return { buyVolume:0, sellVolume:0, buyCandleCount:0, sellCandleCount:0, avgBuyBody:0, avgSellBody:0, trend:'neutral', momentum:0, levels:[] };

  const recent = candles.slice(-50);
  let buyVol = 0, sellVol = 0, buyCnt = 0, sellCnt = 0, buyBodySum = 0, sellBodySum = 0;

  for (const c of recent) {
    const body = Math.abs(c.close - c.open);
    if (c.close >= c.open) {
      buyVol += c.volume; buyCnt++; buyBodySum += body;
    } else {
      sellVol += c.volume; sellCnt++; sellBodySum += body;
    }
  }

  const totalVol = buyVol + sellVol;
  const momentum = totalVol > 0 ? Math.round(((buyVol - sellVol) / totalVol) * 100) : 0;

  // Identify key levels from highs/lows
  const levels: PressureData['levels'] = [];
  const window = 5;
  for (let i = window; i < recent.length - window; i++) {
    const c = recent[i];
    const leftHighs  = recent.slice(i-window, i).every(x => x.high  <= c.high);
    const rightHighs = recent.slice(i+1, i+window+1).every(x => x.high  <= c.high);
    const leftLows   = recent.slice(i-window, i).every(x => x.low   >= c.low);
    const rightLows  = recent.slice(i+1, i+window+1).every(x => x.low   >= c.low);
    if (leftHighs && rightHighs) levels.push({ price:c.high, type:'resistance', strength: Math.min(100, c.volume / (totalVol/recent.length) * 30) });
    if (leftLows  && rightLows ) levels.push({ price:c.low,  type:'support',    strength: Math.min(100, c.volume / (totalVol/recent.length) * 30) });
  }

  // Keep only levels near current price (within 5%)
  const nearLevels = levels
    .filter(l => Math.abs((l.price - price) / price) < 0.05)
    .sort((a,b) => b.strength - a.strength)
    .slice(0, 6);

  const last5 = candles.slice(-5);
  const trend = last5[last5.length-1].close > last5[0].open ? 'bullish' : last5[last5.length-1].close < last5[0].open ? 'bearish' : 'neutral';

  return {
    buyVolume: buyVol, sellVolume: sellVol,
    buyCandleCount: buyCnt, sellCandleCount: sellCnt,
    avgBuyBody: buyCnt > 0 ? buyBodySum / buyCnt : 0,
    avgSellBody: sellCnt > 0 ? sellBodySum / sellCnt : 0,
    trend, momentum, levels: nearLevels,
  };
}

export function BuySellPressure({ candles, livePrice, asset }: Props) {
  const [data, setData] = useState<PressureData | null>(null);
  const [obData, setObData] = useState<{buyRatio:number;asks:number[],bids:number[]}>({ buyRatio:50, asks:[], bids:[] });

  useEffect(() => {
    setData(calcPressure(candles, livePrice));
  }, [candles, livePrice]);

  // Simulate order book data from recent candle analysis
  useEffect(() => {
    if (!candles.length || !livePrice) return;
    const recent10 = candles.slice(-10);
    const avgVol = recent10.reduce((s,c)=>s+c.volume,0)/recent10.length;
    const buyCandles = recent10.filter(c=>c.close>=c.open);
    const buyRatio = Math.round((buyCandles.length / recent10.length) * 100);

    // Generate simulated bid/ask walls based on nearby price levels
    const spread = livePrice * 0.001;
    const asks = Array.from({length:5},(_,i) => livePrice + spread*(i+1)*0.8 + Math.random()*spread*0.2);
    const bids = Array.from({length:5},(_,i) => livePrice - spread*(i+1)*0.8 - Math.random()*spread*0.2);
    setObData({ buyRatio, asks, bids });
  }, [candles, livePrice]);

  if (!data) return null;

  const buyPct = data.buyVolume + data.sellVolume > 0
    ? (data.buyVolume / (data.buyVolume + data.sellVolume)) * 100
    : 50;
  const sellPct = 100 - buyPct;

  const trendColor  = data.trend === 'bullish' ? '#4ADE80' : data.trend === 'bearish' ? '#F87171' : '#A7B0B7';
  const momentumAbs = Math.abs(data.momentum);

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Buy/Sell Pressure</p>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color:trendColor, background:trendColor+'20', border:`1px solid ${trendColor}40` }}>
          {data.trend.charAt(0).toUpperCase()+data.trend.slice(1)}
        </span>
      </div>

      {/* Main pressure bar */}
      <div>
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-green-400 font-bold">BUY {buyPct.toFixed(1)}%</span>
          <span className="text-red-400 font-bold">SELL {sellPct.toFixed(1)}%</span>
        </div>
        <div className="h-4 rounded-full overflow-hidden bg-red-500/20 relative">
          <div className="h-full bg-green-500/60 transition-all duration-500 rounded-full" style={{ width:`${buyPct}%` }}/>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-black text-white drop-shadow">{buyPct >= 50 ? '▲' : '▼'} {momentumAbs}%</span>
          </div>
        </div>
      </div>

      {/* Volume circles */}
      <div className="flex items-center justify-around">
        {/* Buy circle */}
        <div className="relative flex items-center justify-center">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(74,222,128,0.1)" strokeWidth="8"/>
            <circle cx="40" cy="40" r="32" fill="none" stroke="#4ADE80" strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 32 * buyPct / 100} ${2 * Math.PI * 32 * (1 - buyPct/100)}`}
              strokeDashoffset={2 * Math.PI * 32 * 0.25}
              strokeLinecap="round"/>
          </svg>
          <div className="absolute text-center">
            <p className="text-[10px] font-black text-green-400">{buyPct.toFixed(0)}%</p>
            <p className="text-[8px] text-[#4B5563]">BUY</p>
          </div>
        </div>

        {/* Center stats */}
        <div className="text-center space-y-1">
          <p className="text-[9px] text-[#4B5563]">Candles</p>
          <p className="text-xs font-bold text-green-400">{data.buyCandleCount} ▲</p>
          <p className="text-xs font-bold text-red-400">{data.sellCandleCount} ▼</p>
          <p className="text-[9px] text-[#4B5563] pt-1">Buy pressure</p>
          <div className="w-2 h-2 rounded-full mx-auto" style={{ background:trendColor, boxShadow:`0 0 6px ${trendColor}` }}/>
        </div>

        {/* Sell circle */}
        <div className="relative flex items-center justify-center">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(248,113,113,0.1)" strokeWidth="8"/>
            <circle cx="40" cy="40" r="32" fill="none" stroke="#F87171" strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 32 * sellPct / 100} ${2 * Math.PI * 32 * (1 - sellPct/100)}`}
              strokeDashoffset={2 * Math.PI * 32 * 0.25}
              strokeLinecap="round"/>
          </svg>
          <div className="absolute text-center">
            <p className="text-[10px] font-black text-red-400">{sellPct.toFixed(0)}%</p>
            <p className="text-[8px] text-[#4B5563]">SELL</p>
          </div>
        </div>
      </div>

      {/* Key levels */}
      {data.levels.length > 0 && (
        <div>
          <p className="text-[10px] text-[#4B5563] uppercase tracking-wide mb-2">Key Levels</p>
          <div className="space-y-1">
            {data.levels.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${l.type === 'support' ? 'bg-green-400' : 'bg-red-400'}`}/>
                <div className="flex-1 h-1 rounded-full bg-white/[0.05]">
                  <div className="h-full rounded-full" style={{ width:`${l.strength}%`, background: l.type==='support'?'#4ADE80':'#F87171' }}/>
                </div>
                <span className="text-[9px] text-[#4B5563] w-20 text-right font-mono">{l.type==='support'?'S':'R'} ${l.price.toFixed(getPriceFormat(l.price).precision > 6 ? 8 : 4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order book simulation */}
      <div>
        <p className="text-[10px] text-[#4B5563] uppercase tracking-wide mb-2">Order Book (Simulated)</p>
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <p className="text-[9px] text-green-400 font-semibold mb-1">BIDS</p>
            {obData.bids.slice(0,3).map((b,i) => (
              <div key={i} className="flex items-center gap-1 mb-0.5">
                <div className="flex-1 h-1.5 rounded bg-green-500/20">
                  <div className="h-full bg-green-500/50 rounded" style={{ width:`${85-i*15}%` }}/>
                </div>
                <span className="text-[9px] font-mono text-green-400 w-16 text-right">{formatPrice(b)}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[9px] text-red-400 font-semibold mb-1">ASKS</p>
            {obData.asks.slice(0,3).map((a,i) => (
              <div key={i} className="flex items-center gap-1 mb-0.5">
                <span className="text-[9px] font-mono text-red-400 w-16">{formatPrice(a)}</span>
                <div className="flex-1 h-1.5 rounded bg-red-500/20">
                  <div className="h-full bg-red-500/50 rounded ml-auto" style={{ width:`${85-i*15}%` }}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Re-export formatPrice for use in BuySellPressure
function getPriceFormat(price: number) {
  if (!price || price <= 0) return { precision: 2 };
  if (price >= 1000)  return { precision: 2 };
  if (price >= 1)     return { precision: 4 };
  if (price >= 0.001) return { precision: 8 };
  return               { precision: 10 };
}
function formatPrice(price: number): string {
  if (!price || price <= 0) return '$0';
  const { precision } = getPriceFormat(price);
  return `$${price.toFixed(Math.min(precision, 12))}`;
}
