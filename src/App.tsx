import { useState, useEffect } from 'react';
import { useTradingStore } from './store';
import { usePriceData, ASSETS, AssetId } from './hooks/usePriceData';
import { useBotEngine } from './hooks/useBotEngine';
import { BotPanel } from './components/BotPanel';
import { PositionsTable } from './components/PositionsTable';
import { PriceChart } from './components/PriceChart';
import { calcRSI, calcStochastic, calcATR } from './bots/indicators';
import { Side } from './types';

// ── Manual trade form ──────────────────────────────────────────────────────
function TradeForm({ livePrice, asset }: { livePrice: number; asset: string }) {
  const { capital, openPosition, addLog } = useTradingStore();
  const [side, setSide] = useState<Side>('LONG');
  const [size, setSize] = useState('50');
  const [lev, setLev] = useState('10');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');

  const sizeN = parseFloat(size) || 0;
  const levN  = parseInt(lev) || 1;
  const notional = sizeN * levN;
  const liqDist = (1 / levN) * 0.9 * 100;

  const submit = () => {
    if (sizeN <= 0 || sizeN > capital) return;
    const pos = openPosition(
      asset, side, livePrice, sizeN, levN, 'manual',
      tp ? parseFloat(tp) : undefined,
      sl ? parseFloat(sl) : undefined,
    );
    if (pos) addLog(`📌 Manual ${side} ${asset} $${sizeN} ×${levN} @ $${livePrice.toFixed(4)}`);
  };

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-3">Place Trade</p>

      <div className="flex rounded-xl overflow-hidden border border-white/[0.07] mb-3">
        {(['LONG','SHORT'] as Side[]).map(s => (
          <button key={s} onClick={() => setSide(s)}
            className={`flex-1 py-2.5 text-xs font-bold transition-all ${side === s
              ? s === 'LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
              : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {s === 'LONG' ? '▲ LONG' : '▼ SHORT'}
          </button>
        ))}
      </div>

      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#6B7280] w-14">Size ($)</span>
          <input type="number" value={size} min={1} onChange={e => setSize(e.target.value)}
            className="flex-1 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#6B7280] w-14">Leverage</span>
          <input type="number" value={lev} min={1} max={100} onChange={e => setLev(e.target.value)}
            className="flex-1 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#6B7280] w-14">TP ($)</span>
          <input type="number" placeholder="Optional" value={tp} onChange={e => setTp(e.target.value)}
            className="flex-1 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#6B7280] w-14">SL ($)</span>
          <input type="number" placeholder="Optional" value={sl} onChange={e => setSl(e.target.value)}
            className="flex-1 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
        </div>
      </div>

      <div className="rounded-xl bg-[#0B0E14] px-3 py-2.5 mb-3 space-y-1">
        <div className="flex justify-between text-[10px]">
          <span className="text-[#4B5563]">Notional</span>
          <span className="text-[#A7B0B7]">${notional.toFixed(0)}</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-[#4B5563]">Liq. ~{liqDist.toFixed(1)}% away</span>
          <span className="text-[#A7B0B7]">
            ${side === 'LONG' ? (livePrice * (1 - liqDist/100)).toFixed(4) : (livePrice * (1 + liqDist/100)).toFixed(4)}
          </span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-[#4B5563]">Available</span>
          <span style={{ color: sizeN > capital ? '#F87171' : '#4ADE80' }}>${capital.toFixed(2)}</span>
        </div>
      </div>

      <button onClick={submit} disabled={sizeN <= 0 || sizeN > capital}
        className={`w-full py-3 rounded-xl text-sm font-bold transition-all ${side === 'LONG'
          ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30'
          : 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'}
          disabled:opacity-40 disabled:cursor-not-allowed`}>
        {side === 'LONG' ? '▲ Open Long' : '▼ Open Short'}
      </button>
    </div>
  );
}

// ── Indicators panel ───────────────────────────────────────────────────────
function IndicatorsPanel({ prices }: { prices: number[] }) {
  const rsi = calcRSI(prices);
  const { k, d } = calcStochastic(prices);
  const atr = calcATR(prices) * 100;

  const rsiColor = rsi > 70 ? '#F87171' : rsi < 30 ? '#4ADE80' : '#A7B0B7';
  const stochColor = k > 80 ? '#F87171' : k < 20 ? '#4ADE80' : '#A7B0B7';

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-3">Indicators</p>
      <div className="space-y-3">
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-[#6B7280]">RSI (14)</span>
            <span className="text-[10px] font-bold" style={{ color: rsiColor }}>{rsi.toFixed(1)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full transition-all" style={{ width: `${rsi}%`, background: rsiColor }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-[#6B7280]">Stoch K/D</span>
            <span className="text-[10px] font-bold" style={{ color: stochColor }}>{k.toFixed(1)} / {d.toFixed(1)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full transition-all" style={{ width: `${k}%`, background: stochColor }} />
          </div>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-[#6B7280]">ATR (5)</span>
          <span className="text-[10px] text-[#A7B0B7]">{atr.toFixed(3)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-[#6B7280]">Trend</span>
          <span className="text-[10px] font-bold" style={{ color: prices.length > 5 && prices[prices.length-1] > prices[prices.length-5] ? '#4ADE80' : '#F87171' }}>
            {prices.length > 5 && prices[prices.length-1] > prices[prices.length-5] ? '▲ Bullish' : '▼ Bearish'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Stats bar ──────────────────────────────────────────────────────────────
function StatsBar() {
  const { capital, startingCapital, positions } = useTradingStore();
  const closed  = positions.filter(p => p.status !== 'open');
  const wins    = closed.filter(p => p.pnl > 0).length;
  const totalPnl = closed.reduce((s, p) => s + p.pnl, 0);
  const openPnl  = positions.filter(p => p.status === 'open').reduce((s, p) => s + p.pnl, 0);
  const winRate  = closed.length > 0 ? (wins / closed.length * 100) : 0;
  const capChange = ((capital - startingCapital) / startingCapital * 100);

  const stats = [
    { label: 'Capital', value: `$${capital.toFixed(2)}`, sub: `${capChange >= 0 ? '+' : ''}${capChange.toFixed(1)}%`, color: capChange >= 0 ? '#4ADE80' : '#F87171' },
    { label: 'Realized P&L', value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? '#4ADE80' : '#F87171' },
    { label: 'Open P&L', value: `${openPnl >= 0 ? '+' : ''}$${openPnl.toFixed(2)}`, color: openPnl >= 0 ? '#4ADE80' : '#F87171' },
    { label: 'Win Rate', value: `${winRate.toFixed(0)}%`, sub: `${wins}/${closed.length}`, color: '#A7B0B7' },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {stats.map(s => (
        <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] text-[#4B5563] mb-0.5">{s.label}</p>
          <p className="text-sm font-bold" style={{ color: s.color }}>{s.value}</p>
          {s.sub && <p className="text-[10px] text-[#6B7280]">{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Activity log ───────────────────────────────────────────────────────────
function ActivityLog() {
  const { logs } = useTradingStore();
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 h-full flex flex-col">
      <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-3 flex-shrink-0">Bot Activity</p>
      <div className="flex-1 overflow-y-auto space-y-1">
        {logs.length === 0 ? (
          <p className="text-[11px] text-[#4B5563]">No activity yet — enable a bot to start</p>
        ) : logs.map((l, i) => (
          <p key={i} className="text-[10px] text-[#6B7280] leading-relaxed font-mono">{l}</p>
        ))}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [assetId, setAssetId] = useState<AssetId>('sol');
  const [interval, setInterval_] = useState('15m');
  const { candles, livePrice, loading, change24h, prices, asset } = usePriceData(assetId, interval);
  const { capital, setCapital, resetCapital, positions } = useTradingStore();
  const [startCap, setStartCap] = useState('1000');
  const [showSetup, setShowSetup] = useState(false);

  useBotEngine({ prices, livePrice, asset: asset.label });

  // Price flash
  const [flash, setFlash] = useState(false);
  const prevPrice = positions.length; // trick to trigger
  useEffect(() => { setFlash(true); setTimeout(() => setFlash(false), 300); }, [livePrice]);

  return (
    <div className="min-h-screen bg-[#05060B]" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif' }}>

      {/* ── Header ── */}
      <div className="border-b border-white/[0.06] bg-[#05060B]/90 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-lg"
              style={{ background: 'linear-gradient(135deg,#2BFFF1,#00c4ff)', color: '#05060B' }}>X</div>
            <div>
              <span className="font-bold text-[#F4F6FA] text-sm">Xenia</span>
              <span className="text-[#2BFFF1] font-bold text-sm"> Trading</span>
            </div>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#2BFFF1]/10 border border-[#2BFFF1]/25 text-[#2BFFF1] font-semibold uppercase tracking-wide">MOCK</span>
          </div>

          {/* Asset selector */}
          <div className="flex items-center gap-1 ml-2">
            {ASSETS.map(a => (
              <button key={a.id} onClick={() => setAssetId(a.id as AssetId)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${assetId === a.id ? 'bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                {a.id.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Interval */}
          <div className="flex items-center gap-1">
            {['5m','15m','1h','4h'].map(i => (
              <button key={i} onClick={() => setInterval_(i)}
                className={`px-2 py-1 rounded text-[10px] font-semibold transition-all ${interval === i ? 'bg-white/[0.08] text-[#F4F6FA]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                {i}
              </button>
            ))}
          </div>

          {/* Live price */}
          <div className="ml-2">
            <span className={`text-lg font-bold transition-colors ${flash ? 'text-[#2BFFF1]' : 'text-[#F4F6FA]'}`}>
              ${livePrice > 0 ? livePrice.toFixed(livePrice < 1 ? 6 : 2) : '—'}
            </span>
            <span className={`ml-2 text-xs font-semibold ${change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setShowSetup(!showSetup)}
              className="text-xs px-3 py-1.5 rounded-lg border border-white/[0.08] text-[#A7B0B7] hover:border-white/20 transition-all">
              Capital: ${capital.toFixed(0)}
            </button>
            <button onClick={resetCapital}
              className="text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all">
              Reset
            </button>
          </div>
        </div>

        {showSetup && (
          <div className="border-t border-white/[0.06] px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-[#A7B0B7]">Starting capital</span>
            <input type="number" value={startCap} onChange={e => setStartCap(e.target.value)}
              className="w-32 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-[#F4F6FA] outline-none" />
            <button onClick={() => { setCapital(parseFloat(startCap)||1000); setShowSetup(false); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">
              Set & Reset
            </button>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="max-w-[1600px] mx-auto px-4 py-4">

        {/* Stats bar */}
        <div className="mb-4"><StatsBar /></div>

        <div className="grid grid-cols-[280px_1fr_280px] gap-4 h-[calc(100vh-200px)]">

          {/* Left — Bots */}
          <div className="flex flex-col gap-4 overflow-hidden">
            <BotPanel />
          </div>

          {/* Centre — Chart + Positions */}
          <div className="flex flex-col gap-4 min-w-0 overflow-hidden">
            {/* Chart */}
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 flex-shrink-0" style={{ height: '42%' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#A7B0B7]">{asset.label} — {interval}</span>
                {loading && <div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />}
              </div>
              <div style={{ height: 'calc(100% - 28px)' }}>
                <PriceChart candles={candles} livePrice={livePrice} positions={positions} />
              </div>
            </div>

            {/* Positions */}
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 flex-1 overflow-hidden">
              <PositionsTable livePrice={livePrice} />
            </div>
          </div>

          {/* Right — Trade form + indicators + log */}
          <div className="flex flex-col gap-4 overflow-hidden">
            <TradeForm livePrice={livePrice} asset={asset.label} />
            <IndicatorsPanel prices={prices} />
            <div className="flex-1 overflow-hidden">
              <ActivityLog />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
