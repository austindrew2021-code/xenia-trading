import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Candle } from '../types';

interface Props {
  candles: Candle[];
  livePrice: number;
  positions: { entryPrice: number; side: string; status: string }[];
}

export function PriceChart({ candles, livePrice, positions }: Props) {
  if (candles.length === 0) return (
    <div className="flex items-center justify-center h-full text-[#4B5563] text-sm">
      Loading chart data…
    </div>
  );

  const data = candles.slice(-60).map(c => ({
    time: new Date(c.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    // recharts bar needs [low, high] for candlestick-style
    range: [c.low, c.high] as [number, number],
    body: [Math.min(c.open, c.close), Math.max(c.open, c.close)] as [number, number],
    bullish: c.close >= c.open,
  }));

  const openPositions = positions.filter(p => p.status === 'open');
  const priceMin = Math.min(...data.map(d => d.low)) * 0.998;
  const priceMax = Math.max(...data.map(d => d.high)) * 1.002;

  const CustomBar = (props: any) => {
    const { x, y, width, height, payload } = props;
    if (!payload) return null;
    const color = payload.bullish ? '#4ADE80' : '#F87171';
    const bodyLow  = Math.min(payload.open, payload.close);
    const bodyHigh = Math.max(payload.open, payload.close);
    const scale = height / (payload.high - payload.low || 1);
    const wickTop    = (payload.high  - bodyHigh) * scale;
    const bodyHeight = (bodyHigh - bodyLow) * scale || 1;
    const wickBot    = (bodyLow - payload.low) * scale;
    const cx = x + width / 2;

    return (
      <g>
        <line x1={cx} y1={y} x2={cx} y2={y + wickTop} stroke={color} strokeWidth={1}/>
        <rect x={x + 1} y={y + wickTop} width={width - 2} height={bodyHeight} fill={color} />
        <line x1={cx} y1={y + wickTop + bodyHeight} x2={cx} y2={y + wickTop + bodyHeight + wickBot} stroke={color} strokeWidth={1}/>
      </g>
    );
  };

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="time" tick={{ fill: '#4B5563', fontSize: 10 }} tickLine={false} interval={9} />
          <YAxis domain={[priceMin, priceMax]} tick={{ fill: '#4B5563', fontSize: 10 }} tickLine={false} width={72}
            tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(4)}`} />
          <Tooltip
            contentStyle={{ background: '#0B0E14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#A7B0B7' }}
            formatter={(v: any, n: string) => {
              if (n === 'range' || n === 'body') return null;
              return [`$${Number(v).toFixed(4)}`, n];
            }}
          />
          {/* Live price line */}
          {livePrice > 0 && (
            <ReferenceLine y={livePrice} stroke="#2BFFF1" strokeDasharray="4 2" strokeWidth={1.5}
              label={{ value: `$${livePrice.toFixed(4)}`, position: 'insideTopRight', fill: '#2BFFF1', fontSize: 10 }} />
          )}
          {/* Open position entry lines */}
          {openPositions.map((p, i) => (
            <ReferenceLine key={i} y={p.entryPrice}
              stroke={p.side === 'LONG' ? '#4ADE80' : '#F87171'}
              strokeDasharray="3 3" strokeWidth={1}
              label={{ value: `${p.side} $${p.entryPrice.toFixed(4)}`, position: 'insideTopLeft', fill: p.side === 'LONG' ? '#4ADE80' : '#F87171', fontSize: 9 }}
            />
          ))}
          <Bar dataKey="range" shape={<CustomBar />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
