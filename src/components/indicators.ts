// ── Xenia Indicators Library ──────────────────────────────────────────────
// All indicators available for custom bot construction
// Each returns a signal value or array of values

export interface Candle { time:number; open:number; high:number; low:number; close:number; volume:number; }

// ── Moving Averages ────────────────────────────────────────────────────────
export function sma(prices: number[], period: number): number[] {
  return prices.map((_,i) => i < period-1 ? NaN : prices.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period);
}

export function ema(prices: number[], period: number): number[] {
  const k = 2/(period+1); const out: number[] = [];
  prices.forEach((p,i) => {
    if(i===0) out.push(p);
    else out.push(p*k + out[i-1]*(1-k));
  });
  return out;
}

export function wma(prices: number[], period: number): number[] {
  return prices.map((_,i) => {
    if(i < period-1) return NaN;
    let num=0, den=0;
    for(let j=0;j<period;j++){num+=(period-j)*prices[i-j];den+=period-j;}
    return num/den;
  });
}

export function vwap(candles: Candle[]): number[] {
  let cumVol=0, cumTP=0;
  return candles.map(c=>{const tp=(c.high+c.low+c.close)/3;cumTP+=tp*c.volume;cumVol+=c.volume;return cumVol>0?cumTP/cumVol:NaN;});
}

// ── Momentum ──────────────────────────────────────────────────────────────
export function rsi(prices: number[], period=14): number[] {
  const gains: number[]=[], losses: number[]=[];
  for(let i=1;i<prices.length;i++){const d=prices[i]-prices[i-1];gains.push(Math.max(0,d));losses.push(Math.max(0,-d));}
  const out: number[] = [NaN];
  for(let i=0;i<gains.length;i++){
    if(i<period-1){out.push(NaN);continue;}
    const g=gains.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period;
    const l=losses.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period;
    out.push(l===0?100:100-(100/(1+g/l)));
  }
  return out;
}

export function macd(prices: number[], fast=12, slow=26, signal=9): {macd:number[];signal:number[];hist:number[]} {
  const eFast=ema(prices,fast), eSlow=ema(prices,slow);
  const macdLine=eFast.map((v,i)=>v-eSlow[i]);
  const signalLine=ema(macdLine.filter(v=>!isNaN(v)),signal);
  const hist=macdLine.map((v,i)=>v-signalLine[i]||NaN);
  return{macd:macdLine,signal:signalLine,hist};
}

export function stochastic(candles: Candle[], k=14, d=3): {k:number[];d:number[]} {
  const kArr = candles.map((_,i)=>{
    if(i<k-1) return NaN;
    const slice=candles.slice(i-k+1,i+1);
    const lo=Math.min(...slice.map(c=>c.low)), hi=Math.max(...slice.map(c=>c.high));
    return hi===lo?50:((candles[i].close-lo)/(hi-lo))*100;
  });
  const dArr=sma(kArr.map(v=>isNaN(v)?0:v),d);
  return{k:kArr,d:dArr};
}

export function cci(candles: Candle[], period=20): number[] {
  return candles.map((_,i)=>{
    if(i<period-1) return NaN;
    const slice=candles.slice(i-period+1,i+1);
    const tps=slice.map(c=>(c.high+c.low+c.close)/3);
    const mean=tps.reduce((a,b)=>a+b,0)/period;
    const md=tps.reduce((a,b)=>a+Math.abs(b-mean),0)/period;
    return md===0?0:(tps[tps.length-1]-mean)/(0.015*md);
  });
}

export function williamsR(candles: Candle[], period=14): number[] {
  return candles.map((_,i)=>{
    if(i<period-1) return NaN;
    const slice=candles.slice(i-period+1,i+1);
    const hi=Math.max(...slice.map(c=>c.high)), lo=Math.min(...slice.map(c=>c.low));
    return hi===lo?-50:((hi-candles[i].close)/(hi-lo))*-100;
  });
}

// ── Volatility ────────────────────────────────────────────────────────────
export function bollingerBands(prices: number[], period=20, mult=2): {upper:number[];mid:number[];lower:number[];width:number[]} {
  const mid=sma(prices,period);
  const upper=mid.map((m,i)=>{if(isNaN(m)) return NaN;const sl=prices.slice(i-period+1,i+1);const sd=Math.sqrt(sl.reduce((a,b)=>a+(b-m)**2,0)/period);return m+mult*sd;});
  const lower=mid.map((m,i)=>{if(isNaN(m)) return NaN;const sl=prices.slice(i-period+1,i+1);const sd=Math.sqrt(sl.reduce((a,b)=>a+(b-m)**2,0)/period);return m-mult*sd;});
  const width=upper.map((u,i)=>isNaN(u)?NaN:(u-lower[i])/mid[i]);
  return{upper,mid,lower,width};
}

export function atr(candles: Candle[], period=14): number[] {
  const tr=candles.map((c,i)=>i===0?c.high-c.low:Math.max(c.high-c.low,Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)));
  return sma(tr,period);
}

export function keltnerChannels(candles: Candle[], period=20, mult=2): {upper:number[];mid:number[];lower:number[]} {
  const closes=candles.map(c=>c.close);
  const mid=ema(closes,period);
  const atrV=atr(candles,period);
  return{upper:mid.map((m,i)=>m+mult*atrV[i]),mid,lower:mid.map((m,i)=>m-mult*atrV[i])};
}

export function donchianChannel(candles: Candle[], period=20): {upper:number[];lower:number[];mid:number[]} {
  const upper=candles.map((_,i)=>i<period-1?NaN:Math.max(...candles.slice(i-period+1,i+1).map(c=>c.high)));
  const lower=candles.map((_,i)=>i<period-1?NaN:Math.min(...candles.slice(i-period+1,i+1).map(c=>c.low)));
  return{upper,lower,mid:upper.map((u,i)=>(u+lower[i])/2)};
}

// ── Volume ────────────────────────────────────────────────────────────────
export function obv(candles: Candle[]): number[] {
  let v=0;
  return candles.map((c,i)=>{if(i===0)return v;v+=c.close>candles[i-1].close?c.volume:c.close<candles[i-1].close?-c.volume:0;return v;});
}

export function voluemOscillator(candles: Candle[], fast=5, slow=10): number[] {
  const vols=candles.map(c=>c.volume);
  const ef=ema(vols,fast), es=ema(vols,slow);
  return ef.map((v,i)=>es[i]===0?0:((v-es[i])/es[i])*100);
}

export function moneyFlowIndex(candles: Candle[], period=14): number[] {
  const tp=candles.map(c=>(c.high+c.low+c.close)/3);
  const mf=tp.map((t,i)=>t*candles[i].volume);
  return candles.map((_,i)=>{
    if(i<period) return NaN;
    let posFlow=0,negFlow=0;
    for(let j=i-period+1;j<=i;j++){if(tp[j]>tp[j-1])posFlow+=mf[j];else negFlow+=mf[j];}
    return negFlow===0?100:100-(100/(1+posFlow/negFlow));
  });
}

// ── Trend ─────────────────────────────────────────────────────────────────
export function supertrend(candles: Candle[], period=10, mult=3): {value:number[];trend:number[]} {
  const atrV=atr(candles,period);
  const hl2=candles.map(c=>(c.high+c.low)/2);
  const up=hl2.map((h,i)=>h+mult*atrV[i]);
  const dn=hl2.map((h,i)=>h-mult*atrV[i]);
  const trend:number[]=[1],value:number[]=[dn[0]];
  for(let i=1;i<candles.length;i++){
    const nUp=up[i]<(up[i-1]||up[i])||candles[i-1].close<(up[i-1]||up[i])?up[i]:up[i-1]||up[i];
    const nDn=dn[i]>(dn[i-1]||dn[i])||candles[i-1].close>(dn[i-1]||dn[i])?dn[i]:dn[i-1]||dn[i];
    const t=trend[i-1]===1?candles[i].close<nUp?-1:1:candles[i].close>nDn?1:-1;
    trend.push(t);value.push(t===1?nDn:nUp);
  }
  return{value,trend};
}

export function adx(candles: Candle[], period=14): {adx:number[];pdi:number[];mdi:number[]} {
  const atrV=atr(candles,period);
  const pDM=candles.map((c,i)=>{if(i===0)return 0;const up=c.high-candles[i-1].high;const dn=candles[i-1].low-c.low;return up>dn&&up>0?up:0;});
  const mDM=candles.map((c,i)=>{if(i===0)return 0;const up=c.high-candles[i-1].high;const dn=candles[i-1].low-c.low;return dn>up&&dn>0?dn:0;});
  const pDI=ema(pDM,period).map((v,i)=>atrV[i]>0?(v/atrV[i])*100:0);
  const mDI=ema(mDM,period).map((v,i)=>atrV[i]>0?(v/atrV[i])*100:0);
  const dx=pDI.map((p,i)=>{const s=p+mDI[i];return s>0?Math.abs(p-mDI[i])/s*100:0;});
  return{adx:ema(dx,period),pdi:pDI,mdi:mDI};
}

export function ichimoku(candles: Candle[]): {tenkan:number[];kijun:number[];spanA:number[];spanB:number[];chikou:number[]} {
  const hl=(arr:Candle[],p:number)=>arr.map((_,i)=>i<p-1?NaN:((Math.max(...arr.slice(i-p+1,i+1).map(c=>c.high))+Math.min(...arr.slice(i-p+1,i+1).map(c=>c.low)))/2));
  const tenkan=hl(candles,9),kijun=hl(candles,26),spanA=tenkan.map((t,i)=>(t+kijun[i])/2);
  const spanB=hl(candles,52),chikou=candles.map(c=>c.close);
  return{tenkan,kijun,spanA,spanB,chikou};
}

// ── Candle Patterns ───────────────────────────────────────────────────────
export interface PatternResult { name:string; direction:'bullish'|'bearish'|'neutral'; strength:number; index:number; }

export function detectPatterns(candles: Candle[]): PatternResult[] {
  const results: PatternResult[] = [];
  const n = candles.length;
  if(n<5) return results;

  const last=candles[n-1],prev=candles[n-2],prev2=candles[n-3];
  const body=(c:Candle)=>Math.abs(c.close-c.open);
  const bullish=(c:Candle)=>c.close>c.open;
  const range=(c:Candle)=>c.high-c.low;
  const upperWick=(c:Candle)=>c.high-Math.max(c.open,c.close);
  const lowerWick=(c:Candle)=>Math.min(c.open,c.close)-c.low;

  // Doji
  if(body(last)/range(last)<0.1) results.push({name:'Doji',direction:'neutral',strength:0.5,index:n-1});
  // Hammer
  if(!bullish(last)&&lowerWick(last)>body(last)*2&&upperWick(last)<body(last)*0.3) results.push({name:'Hammer',direction:'bullish',strength:0.7,index:n-1});
  // Shooting Star
  if(bullish(last)&&upperWick(last)>body(last)*2&&lowerWick(last)<body(last)*0.3) results.push({name:'Shooting Star',direction:'bearish',strength:0.7,index:n-1});
  // Engulfing
  if(bullish(last)&&!bullish(prev)&&last.open<prev.close&&last.close>prev.open) results.push({name:'Bullish Engulfing',direction:'bullish',strength:0.85,index:n-1});
  if(!bullish(last)&&bullish(prev)&&last.open>prev.close&&last.close<prev.open) results.push({name:'Bearish Engulfing',direction:'bearish',strength:0.85,index:n-1});
  // Morning Star
  if(bullish(last)&&body(prev)<body(prev2)*0.3&&!bullish(prev2)&&body(last)>body(prev2)*0.5) results.push({name:'Morning Star',direction:'bullish',strength:0.8,index:n-1});
  // Evening Star
  if(!bullish(last)&&body(prev)<body(prev2)*0.3&&bullish(prev2)&&body(last)>body(prev2)*0.5) results.push({name:'Evening Star',direction:'bearish',strength:0.8,index:n-1});
  // Pinbar
  if(lowerWick(last)>range(last)*0.6&&body(last)<range(last)*0.25) results.push({name:'Bullish Pinbar',direction:'bullish',strength:0.75,index:n-1});
  if(upperWick(last)>range(last)*0.6&&body(last)<range(last)*0.25) results.push({name:'Bearish Pinbar',direction:'bearish',strength:0.75,index:n-1});
  // Inside Bar
  if(last.high<prev.high&&last.low>prev.low) results.push({name:'Inside Bar',direction:'neutral',strength:0.5,index:n-1});
  // Three White Soldiers
  if(bullish(last)&&bullish(prev)&&bullish(prev2)&&last.close>prev.close&&prev.close>prev2.close) results.push({name:'Three White Soldiers',direction:'bullish',strength:0.9,index:n-1});
  // Three Black Crows
  if(!bullish(last)&&!bullish(prev)&&!bullish(prev2)&&last.close<prev.close&&prev.close<prev2.close) results.push({name:'Three Black Crows',direction:'bearish',strength:0.9,index:n-1});
  // Tweezer Tops/Bottoms
  if(Math.abs(last.high-prev.high)/prev.high<0.002) results.push({name:'Tweezer Tops',direction:'bearish',strength:0.65,index:n-1});
  if(Math.abs(last.low-prev.low)/prev.low<0.002) results.push({name:'Tweezer Bottoms',direction:'bullish',strength:0.65,index:n-1});

  return results;
}

// ── ICT Concepts ──────────────────────────────────────────────────────────
export function detectFVG(candles: Candle[]): {bullish:number[];bearish:number[]} {
  const bullish: number[]=[], bearish: number[]=[];
  for(let i=2;i<candles.length;i++){
    if(candles[i].low>candles[i-2].high) bullish.push(i-1);
    if(candles[i].high<candles[i-2].low) bearish.push(i-1);
  }
  return{bullish,bearish};
}

export function detectOrderBlocks(candles: Candle[]): {bullish:{i:number;top:number;bot:number}[];bearish:{i:number;top:number;bot:number}[]} {
  const bullish: {i:number;top:number;bot:number}[]=[], bearish: {i:number;top:number;bot:number}[]=[];
  for(let i=3;i<candles.length;i++){
    const c=candles[i],p=candles[i-1],pp=candles[i-2];
    const bearMove=c.close<pp.low&&c.close<p.low;
    if(bearMove&&p.close>p.open) bullish.push({i:i-1,top:p.high,bot:p.low});
    const bullMove=c.close>pp.high&&c.close>p.high;
    if(bullMove&&p.close<p.open) bearish.push({i:i-1,top:p.high,bot:p.low});
  }
  return{bullish:bullish.slice(-5),bearish:bearish.slice(-5)};
}

export function detectLiquiditySweeps(candles: Candle[], lookback=20): {bullSweep:number[];bearSweep:number[]} {
  const bullSweep: number[]=[], bearSweep: number[]=[];
  for(let i=lookback;i<candles.length;i++){
    const recent=candles.slice(i-lookback,i);
    const prevHigh=Math.max(...recent.map(c=>c.high));
    const prevLow=Math.min(...recent.map(c=>c.low));
    if(candles[i].high>prevHigh&&candles[i].close<prevHigh) bearSweep.push(i);
    if(candles[i].low<prevLow&&candles[i].close>prevLow) bullSweep.push(i);
  }
  return{bullSweep,bearSweep};
}

// ── Indicator Metadata (for the UI) ───────────────────────────────────────
export interface IndicatorMeta {
  id: string; name: string; category: string;
  params: {key:string;label:string;default:number;min:number;max:number}[];
  description: string;
}

export const INDICATOR_LIBRARY: IndicatorMeta[] = [
  // Moving Averages
  {id:'sma',name:'SMA',category:'Moving Averages',params:[{key:'period',label:'Period',default:20,min:2,max:200}],description:'Simple Moving Average'},
  {id:'ema',name:'EMA',category:'Moving Averages',params:[{key:'period',label:'Period',default:20,min:2,max:200}],description:'Exponential Moving Average'},
  {id:'wma',name:'WMA',category:'Moving Averages',params:[{key:'period',label:'Period',default:20,min:2,max:200}],description:'Weighted Moving Average'},
  {id:'vwap',name:'VWAP',category:'Moving Averages',params:[],description:'Volume Weighted Average Price'},
  // Momentum
  {id:'rsi',name:'RSI',category:'Momentum',params:[{key:'period',label:'Period',default:14,min:2,max:50}],description:'Relative Strength Index'},
  {id:'macd',name:'MACD',category:'Momentum',params:[{key:'fast',label:'Fast',default:12,min:2,max:50},{key:'slow',label:'Slow',default:26,min:5,max:100},{key:'signal',label:'Signal',default:9,min:2,max:20}],description:'Moving Average Convergence Divergence'},
  {id:'stoch',name:'Stochastic',category:'Momentum',params:[{key:'k',label:'K Period',default:14,min:2,max:50},{key:'d',label:'D Period',default:3,min:1,max:10}],description:'Stochastic Oscillator'},
  {id:'cci',name:'CCI',category:'Momentum',params:[{key:'period',label:'Period',default:20,min:5,max:100}],description:'Commodity Channel Index'},
  {id:'willr',name:"Williams %R",category:'Momentum',params:[{key:'period',label:'Period',default:14,min:2,max:50}],description:"Williams Percent Range"},
  // Volatility
  {id:'bbands',name:'Bollinger Bands',category:'Volatility',params:[{key:'period',label:'Period',default:20,min:5,max:100},{key:'mult',label:'Multiplier',default:2,min:0.5,max:4}],description:'Bollinger Bands'},
  {id:'atr',name:'ATR',category:'Volatility',params:[{key:'period',label:'Period',default:14,min:2,max:50}],description:'Average True Range'},
  {id:'keltner',name:'Keltner Channel',category:'Volatility',params:[{key:'period',label:'Period',default:20,min:5,max:100},{key:'mult',label:'Multiplier',default:2,min:0.5,max:4}],description:'Keltner Channels'},
  {id:'donchian',name:'Donchian',category:'Volatility',params:[{key:'period',label:'Period',default:20,min:5,max:100}],description:'Donchian Channel'},
  // Volume
  {id:'obv',name:'OBV',category:'Volume',params:[],description:'On Balance Volume'},
  {id:'mfi',name:'MFI',category:'Volume',params:[{key:'period',label:'Period',default:14,min:5,max:50}],description:'Money Flow Index'},
  {id:'volosc',name:'Volume Oscillator',category:'Volume',params:[{key:'fast',label:'Fast',default:5,min:2,max:20},{key:'slow',label:'Slow',default:10,min:5,max:50}],description:'Volume Oscillator'},
  // Trend
  {id:'adx',name:'ADX',category:'Trend',params:[{key:'period',label:'Period',default:14,min:5,max:50}],description:'Average Directional Index'},
  {id:'supertrend',name:'Supertrend',category:'Trend',params:[{key:'period',label:'Period',default:10,min:5,max:50},{key:'mult',label:'Multiplier',default:3,min:1,max:6}],description:'Supertrend'},
  {id:'ichimoku',name:'Ichimoku',category:'Trend',params:[],description:'Ichimoku Cloud'},
  // ICT
  {id:'fvg',name:'Fair Value Gap',category:'ICT',params:[],description:'ICT Fair Value Gaps'},
  {id:'ob',name:'Order Block',category:'ICT',params:[],description:'ICT Order Blocks'},
  {id:'sweep',name:'Liquidity Sweep',category:'ICT',params:[{key:'lookback',label:'Lookback',default:20,min:5,max:100}],description:'Liquidity Sweep Detection'},
];

export const CANDLE_PATTERNS = [
  'Doji','Hammer','Shooting Star','Bullish Engulfing','Bearish Engulfing',
  'Morning Star','Evening Star','Bullish Pinbar','Bearish Pinbar','Inside Bar',
  'Three White Soldiers','Three Black Crows','Tweezer Tops','Tweezer Bottoms',
];
