/**
 * Chart Indicators Menu — TradingView-style searchable indicator browser
 * Groups indicators by category, supports search, shows description
 */
import { useState, useMemo } from 'react';

export interface IndicatorConfig {
  id: string;
  name: string;
  shortName: string;
  category: string;
  description: string;
  params: { key: string; label: string; default: number; min: number; max: number }[];
  popular?: boolean;
}

export const ALL_INDICATORS: IndicatorConfig[] = [
  // ── Moving Averages ────────────────────────────────────────────────
  { id:'sma',      name:'Simple Moving Average',        shortName:'SMA',     category:'Moving Averages', popular:true,  description:'Average of closing prices over N periods. Most widely used trend indicator.', params:[{key:'period',label:'Length',default:20,min:2,max:500}] },
  { id:'ema',      name:'Exponential Moving Average',   shortName:'EMA',     category:'Moving Averages', popular:true,  description:'Weighted MA that reacts faster to recent price changes. Popular: EMA 9, 21, 50, 200.', params:[{key:'period',label:'Length',default:20,min:2,max:500}] },
  { id:'wma',      name:'Weighted Moving Average',      shortName:'WMA',     category:'Moving Averages', description:'Emphasizes recent data more than SMA but less than EMA.', params:[{key:'period',label:'Length',default:20,min:2,max:500}] },
  { id:'vwap',     name:'Volume Weighted Avg Price',    shortName:'VWAP',    category:'Moving Averages', popular:true,  description:'Avg price weighted by volume. Key intraday benchmark used by institutions.', params:[] },
  { id:'hma',      name:'Hull Moving Average',          shortName:'HMA',     category:'Moving Averages', description:'Alan Hull\'s ultra-smooth MA that reduces lag. Formula: WMA(2*WMA(n/2)−WMA(n), sqrt(n)).', params:[{key:'period',label:'Length',default:14,min:2,max:200}] },
  { id:'dema',     name:'Double EMA',                   shortName:'DEMA',    category:'Moving Averages', description:'Reduces lag of EMA by doubling and subtracting once-smoothed EMA: 2*EMA - EMA(EMA).', params:[{key:'period',label:'Length',default:20,min:2,max:200}] },
  { id:'tema',     name:'Triple EMA',                   shortName:'TEMA',    category:'Moving Averages', description:'Triple-smoothed EMA. Most aggressive lag reduction: 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA)).', params:[{key:'period',label:'Length',default:20,min:2,max:200}] },
  { id:'alma',     name:'Arnaud Legoux MA',             shortName:'ALMA',    category:'Moving Averages', description:'Gaussian distribution MA. Reduces lag and signal noise simultaneously.', params:[{key:'period',label:'Length',default:21,min:5,max:200},{key:'sigma',label:'Sigma',default:6,min:1,max:20}] },

  // ── Oscillators / Momentum ─────────────────────────────────────────
  { id:'rsi',      name:'Relative Strength Index',      shortName:'RSI',     category:'Oscillators', popular:true,  description:'Momentum oscillator 0-100. Overbought >70, oversold <30. Default 14 periods.', params:[{key:'period',label:'Length',default:14,min:2,max:50}] },
  { id:'macd',     name:'MACD',                         shortName:'MACD',    category:'Oscillators', popular:true,  description:'Trend-following momentum. Shows relationship between two EMAs. Classic: 12,26,9.', params:[{key:'fast',label:'Fast',default:12,min:2,max:50},{key:'slow',label:'Slow',default:26,min:5,max:100},{key:'signal',label:'Signal',default:9,min:2,max:20}] },
  { id:'stoch',    name:'Stochastic Oscillator',        shortName:'Stoch',   category:'Oscillators', popular:true,  description:'Compares closing price to price range. %K and %D lines. OB>80, OS<20.', params:[{key:'k',label:'%K',default:14,min:2,max:50},{key:'d',label:'%D',default:3,min:1,max:10},{key:'smooth',label:'Smooth',default:3,min:1,max:10}] },
  { id:'stochrsi', name:'Stochastic RSI',               shortName:'StochRSI',category:'Oscillators', popular:true,  description:'Applies Stochastic formula to RSI. More sensitive than standard RSI.', params:[{key:'rsiPeriod',label:'RSI Length',default:14,min:5,max:50},{key:'stochPeriod',label:'Stoch Length',default:14,min:5,max:50}] },
  { id:'cci',      name:'Commodity Channel Index',      shortName:'CCI',     category:'Oscillators', description:'Measures deviation from average price. >100 overbought, <-100 oversold.', params:[{key:'period',label:'Length',default:20,min:5,max:100}] },
  { id:'roc',      name:'Rate of Change',               shortName:'ROC',     category:'Oscillators', description:'Percentage change between current price and price N periods ago. Momentum indicator.', params:[{key:'period',label:'Length',default:12,min:2,max:200}] },
  { id:'willr',    name:"Williams %R",                  shortName:'%R',      category:'Oscillators', description:'Inverse of Stochastic. Range -100 to 0. OB: -20 to 0, OS: -100 to -80.', params:[{key:'period',label:'Length',default:14,min:2,max:50}] },
  { id:'mfi',      name:'Money Flow Index',             shortName:'MFI',     category:'Oscillators', description:'Volume-weighted RSI. Shows buying/selling pressure. OB>80, OS<20.', params:[{key:'period',label:'Length',default:14,min:5,max:50}] },
  { id:'aroon',    name:'Aroon',                        shortName:'Aroon',   category:'Oscillators', description:'Identifies trend changes. Aroon Up/Down measure time since highest/lowest close.', params:[{key:'period',label:'Length',default:25,min:5,max:100}] },
  { id:'ultimate', name:'Ultimate Oscillator',          shortName:'UO',      category:'Oscillators', description:'Larry Williams\' oscillator using 3 different time periods to reduce false signals.', params:[{key:'p1',label:'Short',default:7,min:2,max:20},{key:'p2',label:'Mid',default:14,min:5,max:30},{key:'p3',label:'Long',default:28,min:10,max:100}] },

  // ── Volatility ─────────────────────────────────────────────────────
  { id:'bbands',   name:'Bollinger Bands',              shortName:'BB',      category:'Volatility', popular:true,  description:'SMA ± N standard deviations. Squeeze = low volatility, expansion = high vol.', params:[{key:'period',label:'Length',default:20,min:5,max:100},{key:'mult',label:'Mult',default:2,min:0.5,max:5}] },
  { id:'atr',      name:'Average True Range',           shortName:'ATR',     category:'Volatility', popular:true,  description:'Average of true ranges. Measures volatility, not direction. Used for stop sizing.', params:[{key:'period',label:'Length',default:14,min:2,max:50}] },
  { id:'keltner',  name:'Keltner Channel',              shortName:'KC',      category:'Volatility', description:'EMA ± N×ATR. When BB is inside KC = Squeeze. Breakout predicts big move.', params:[{key:'period',label:'EMA',default:20,min:5,max:100},{key:'mult',label:'Mult',default:2,min:0.5,max:5}] },
  { id:'donchian', name:'Donchian Channel',             shortName:'DC',      category:'Volatility', description:'Highest high / lowest low over N periods. Turtle Traders strategy foundation.', params:[{key:'period',label:'Length',default:20,min:5,max:200}] },
  { id:'stddev',   name:'Standard Deviation',           shortName:'StdDev',  category:'Volatility', description:'Statistical measure of price dispersion. High = volatile, low = consolidating.', params:[{key:'period',label:'Length',default:20,min:5,max:100}] },
  { id:'chaikin',  name:'Chaikin Volatility',           shortName:'ChVol',   category:'Volatility', description:'Measures spread between high and low prices. Rising = increasing volatility.', params:[{key:'period',label:'Length',default:10,min:5,max:50}] },

  // ── Volume ─────────────────────────────────────────────────────────
  { id:'obv',      name:'On Balance Volume',            shortName:'OBV',     category:'Volume', popular:true,  description:'Running total of volume. Rising OBV = accumulation, falling = distribution.', params:[] },
  { id:'volosc',   name:'Volume Oscillator',            shortName:'VO',      category:'Volume', description:'Difference between fast and slow volume EMAs as a percentage.', params:[{key:'fast',label:'Fast',default:5,min:2,max:20},{key:'slow',label:'Slow',default:10,min:5,max:50}] },
  { id:'cmf',      name:'Chaikin Money Flow',           shortName:'CMF',     category:'Volume', description:'Measures buying and selling pressure using volume and price range. +0.25 = strong buy.', params:[{key:'period',label:'Length',default:20,min:5,max:50}] },
  { id:'vpt',      name:'Volume Price Trend',           shortName:'VPT',     category:'Volume', description:'Combines price change percentage with volume. Similar to OBV but uses % change.', params:[] },
  { id:'force',    name:'Force Index',                  shortName:'FI',      category:'Volume', description:'Alexander Elder\'s indicator. Combines price change, direction, and volume.', params:[{key:'period',label:'Length',default:13,min:2,max:50}] },
  { id:'eom',      name:'Ease of Movement',             shortName:'EOM',     category:'Volume', description:'Relates price change to volume. High positive = prices rising easily with low volume.', params:[{key:'period',label:'Length',default:14,min:2,max:50}] },

  // ── Trend ──────────────────────────────────────────────────────────
  { id:'adx',      name:'Average Directional Index',    shortName:'ADX',     category:'Trend', popular:true,  description:'Measures trend strength (not direction). >25 = strong trend, <20 = no trend.', params:[{key:'period',label:'Length',default:14,min:5,max:50}] },
  { id:'supertrend',name:'Supertrend',                  shortName:'ST',      category:'Trend', popular:true,  description:'ATR-based trend indicator with buy/sell signals. Green = uptrend, red = downtrend.', params:[{key:'period',label:'ATR Period',default:10,min:5,max:50},{key:'mult',label:'Multiplier',default:3,min:1,max:6}] },
  { id:'ichimoku', name:'Ichimoku Cloud',               shortName:'Ichi',    category:'Trend', popular:true,  description:'Complete trend system: Tenkan, Kijun, Senkou A/B, Chikou. Japanese origin.', params:[] },
  { id:'psar',     name:'Parabolic SAR',                shortName:'PSAR',    category:'Trend', description:'Dots above = downtrend, below = uptrend. Trails price with acceleration factor.', params:[{key:'step',label:'Step',default:0.02,min:0.01,max:0.1},{key:'max',label:'Max',default:0.2,min:0.1,max:0.5}] },
  { id:'dmi',      name:'Directional Movement Index',   shortName:'DMI',     category:'Trend', description:'+DI above -DI = bullish. Crossovers with ADX filter signal direction shifts.', params:[{key:'period',label:'Length',default:14,min:5,max:50}] },

  // ── ICT / Smart Money ──────────────────────────────────────────────
  { id:'fvg',      name:'Fair Value Gap',               shortName:'FVG',     category:'ICT / Smart Money', popular:true,  description:'3-candle imbalance where price jumps. Acts as magnet for future price. Bullish/bearish.', params:[] },
  { id:'ob',       name:'Order Block',                  shortName:'OB',      category:'ICT / Smart Money', popular:true,  description:'Last opposing candle before a strong move. Institutional accumulation/distribution zones.', params:[] },
  { id:'sweep',    name:'Liquidity Sweep',              shortName:'Sweep',   category:'ICT / Smart Money', popular:true,  description:'Price takes out swing high/low stops before reversing. Inducement + reversal signal.', params:[{key:'lookback',label:'Lookback',default:20,min:5,max:100}] },
  { id:'bos',      name:'Break of Structure',           shortName:'BOS',     category:'ICT / Smart Money', description:'Price breaks previous swing high (bullish BOS) or low (bearish BOS). Trend continuation.', params:[] },
  { id:'choch',    name:'Change of Character',          shortName:'CHoCH',   category:'ICT / Smart Money', description:'First opposite BOS after a trend — signals potential trend reversal beginning.', params:[] },
  { id:'ifvg',     name:'Inverse Fair Value Gap',       shortName:'IFVG',    category:'ICT / Smart Money', description:'FVG that gets inverted (price trades through it). Becomes opposing zone. Xenia Bot 4 strategy.', params:[] },
];

const CATEGORIES = ['Popular', 'Moving Averages', 'Oscillators', 'Volatility', 'Volume', 'Trend', 'ICT / Smart Money'];

interface Props {
  selected: string[];
  onToggle: (id: string, params?: Record<string,number>) => void;
  onClose: () => void;
}

export function ChartIndicatorsMenu({ selected, onToggle, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [cat,    setCat]    = useState('Popular');
  const [hovered, setHovered] = useState<string|null>(null);

  const filtered = useMemo(() => {
    const base = cat === 'Popular' ? ALL_INDICATORS.filter(i => i.popular) : ALL_INDICATORS.filter(i => i.category === cat);
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return ALL_INDICATORS.filter(i => i.name.toLowerCase().includes(q) || i.shortName.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  }, [cat, search]);

  const hov = ALL_INDICATORS.find(i => i.id === hovered);

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="bg-[#0B0E14] border border-white/[0.1] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden" style={{height:'min(580px,88vh)',display:'flex',flexDirection:'column'}}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex-1 flex items-center gap-2 bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2 focus-within:border-[#2BFFF1]/40">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              autoFocus value={search} onChange={e=>{setSearch(e.target.value);if(e.target.value)setCat('');}}
              placeholder="Search indicators…"
              className="flex-1 bg-transparent text-sm text-[#F4F6FA] outline-none placeholder-[#2D3748]"
            />
            {search&&<button onClick={()=>setSearch('')} className="text-[#4B5563] hover:text-[#A7B0B7] text-xs">✕</button>}
          </div>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#A7B0B7] p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Category sidebar */}
          {!search&&(
            <div className="w-44 border-r border-white/[0.06] overflow-y-auto flex-shrink-0">
              {CATEGORIES.map(c=>(
                <button key={c} onClick={()=>setCat(c)}
                  className={`w-full text-left px-3 py-2.5 text-xs font-semibold transition-all ${cat===c?'bg-[#2BFFF1]/10 text-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7] hover:bg-white/[0.02]'}`}>
                  {c}
                  {c==='Popular'&&<span className="ml-1 text-[8px] text-[#F59E0B]">★</span>}
                </button>
              ))}
            </div>
          )}

          {/* Indicator list */}
          <div className="flex-1 overflow-y-auto min-w-0">
            {filtered.length===0?(
              <div className="flex items-center justify-center h-full text-sm text-[#4B5563]">No indicators found</div>
            ):filtered.map(ind=>(
              <div key={ind.id}
                onMouseEnter={()=>setHovered(ind.id)}
                onMouseLeave={()=>setHovered(null)}
                className={`flex items-center justify-between px-4 py-3 border-b border-white/[0.04] last:border-0 cursor-pointer transition-all ${hovered===ind.id?'bg-white/[0.03]':''}`}
                onClick={()=>{ onToggle(ind.id, ind.params.reduce((a,p)=>({...a,[p.key]:p.default}),{})); }}>
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[#F4F6FA]">{ind.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.05] text-[#6B7280] font-mono">{ind.shortName}</span>
                    {ind.popular&&<span className="text-[8px] text-[#F59E0B]">★</span>}
                  </div>
                  <p className="text-[10px] text-[#4B5563] mt-0.5 truncate">{ind.description}</p>
                </div>
                <div className={`w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black transition-all ${selected.includes(ind.id)?'bg-[#2BFFF1]/20 text-[#2BFFF1] border border-[#2BFFF1]/40':'bg-white/[0.05] text-[#374151] border border-white/[0.08] hover:border-[#2BFFF1]/30 hover:text-[#2BFFF1]'}`}>
                  {selected.includes(ind.id)?'✓':'+'}
                </div>
              </div>
            ))}
          </div>

          {/* Detail pane — desktop only */}
          {hov&&!search&&(
            <div className="hidden lg:flex w-56 border-l border-white/[0.06] flex-col p-4 flex-shrink-0 space-y-3">
              <div>
                <p className="text-sm font-black text-[#F4F6FA]">{hov.shortName}</p>
                <p className="text-[10px] text-[#4B5563] mt-0.5">{hov.name}</p>
              </div>
              <p className="text-[10px] text-[#A7B0B7] leading-relaxed">{hov.description}</p>
              {hov.params.length>0&&(
                <div className="space-y-1.5">
                  <p className="text-[9px] text-[#374151] font-semibold uppercase tracking-wide">Parameters</p>
                  {hov.params.map(p=>(
                    <div key={p.key} className="flex justify-between text-[10px]">
                      <span className="text-[#4B5563]">{p.label}</span>
                      <span className="text-[#F4F6FA] font-mono">{p.default}</span>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={()=>onToggle(hov.id, hov.params.reduce((a,p)=>({...a,[p.key]:p.default}),{}))}
                className={`w-full py-2 rounded-xl text-xs font-bold transition-all border ${selected.includes(hov.id)?'border-red-500/25 text-red-400 hover:bg-red-500/10':'border-[#2BFFF1]/25 text-[#2BFFF1] bg-[#2BFFF1]/10 hover:bg-[#2BFFF1]/20'}`}>
                {selected.includes(hov.id)?'Remove':'Add to Chart'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/[0.06] flex-shrink-0 flex items-center justify-between">
          <span className="text-[10px] text-[#4B5563]">{selected.length} indicator{selected.length!==1?'s':''} active</span>
          <button onClick={onClose} className="px-4 py-1.5 rounded-xl text-xs font-bold bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">Done</button>
        </div>
      </div>
    </div>
  );
}
