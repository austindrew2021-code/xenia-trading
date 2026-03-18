import { useState, useEffect, useRef } from 'react';
import { useTradingStore } from './store';
import { usePriceData, ASSETS, AssetId } from './hooks/usePriceData';
import { useBotEngine } from './hooks/useBotEngine';
import { BotPanel } from './components/BotPanel';
import { PositionsTable } from './components/PositionsTable';
import { PriceChart } from './components/PriceChart';
import { NewsTicker } from './components/NewsTicker';
import { calcRSI, calcStochastic, calcATR } from './bots/indicators';
import { Side } from './types';

// ── Xenia Logo ─────────────────────────────────────────────────────────────
function XeniaLogo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="logo.png"
      alt="Xenia Chain"
      style={{ width: size, height: size, borderRadius: size * 0.25, objectFit: 'cover' }}
      onError={e => {
        // Fallback to text logo if image fails
        const el = e.currentTarget;
        el.style.display = 'none';
        const parent = el.parentElement;
        if (parent && !parent.querySelector('.logo-fallback')) {
          const fb = document.createElement('div');
          fb.className = 'logo-fallback';
          fb.style.cssText = `width:${size}px;height:${size}px;border-radius:${size*0.25}px;background:linear-gradient(135deg,#2BFFF1,#00c4ff);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${size*0.55}px;color:#05060B;`;
          fb.textContent = 'X';
          parent.appendChild(fb);
        }
      }}
    />
  );
}

// ── Manual Trade Form ──────────────────────────────────────────────────────
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
    const pos = openPosition(asset, side, livePrice, sizeN, levN, 'manual',
      tp ? parseFloat(tp) : undefined, sl ? parseFloat(sl) : undefined);
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
        {[
          { label: 'Size ($)', val: size, set: setSize, type: 'number', ph: '' },
          { label: 'Leverage', val: lev,  set: setLev,  type: 'number', ph: '' },
          { label: 'TP ($)',   val: tp,   set: setTp,   type: 'number', ph: 'Optional' },
          { label: 'SL ($)',   val: sl,   set: setSl,   type: 'number', ph: 'Optional' },
        ].map(f => (
          <div key={f.label} className="flex items-center gap-2">
            <span className="text-[10px] text-[#6B7280] w-14 flex-shrink-0">{f.label}</span>
            <input type={f.type} value={f.val} placeholder={f.ph}
              onChange={e => f.set(e.target.value)}
              className="flex-1 min-w-0 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-[#0B0E14] px-3 py-2.5 mb-3 space-y-1">
        <div className="flex justify-between text-[10px]">
          <span className="text-[#4B5563]">Notional</span>
          <span className="text-[#A7B0B7]">${notional.toFixed(0)}</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-[#4B5563]">Liq ~{liqDist.toFixed(1)}% away</span>
          <span className="text-[#A7B0B7]">
            ${side === 'LONG' ? (livePrice*(1-liqDist/100)).toFixed(4) : (livePrice*(1+liqDist/100)).toFixed(4)}
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

// ── Indicators ─────────────────────────────────────────────────────────────
function IndicatorsPanel({ prices }: { prices: number[] }) {
  const rsi = calcRSI(prices);
  const { k, d } = calcStochastic(prices);
  const atr = calcATR(prices) * 100;
  const rsiColor  = rsi > 70 ? '#F87171' : rsi < 30 ? '#4ADE80' : '#A7B0B7';
  const stochColor = k  > 80 ? '#F87171' : k  < 20 ? '#4ADE80' : '#A7B0B7';
  const bullish = prices.length > 5 && prices[prices.length-1] > prices[prices.length-5];
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
            <div className="h-full rounded-full transition-all" style={{ width:`${rsi}%`, background: rsiColor }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-[#6B7280]">Stoch K/D</span>
            <span className="text-[10px] font-bold" style={{ color: stochColor }}>{k.toFixed(1)} / {d.toFixed(1)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full transition-all" style={{ width:`${k}%`, background: stochColor }} />
          </div>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-[#6B7280]">ATR (5)</span>
          <span className="text-[10px] text-[#A7B0B7]">{atr.toFixed(3)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-[#6B7280]">Trend</span>
          <span className="text-[10px] font-bold" style={{ color: bullish ? '#4ADE80' : '#F87171' }}>
            {bullish ? '▲ Bullish' : '▼ Bearish'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Stats Bar ──────────────────────────────────────────────────────────────
function StatsBar() {
  const { capital, startingCapital, positions } = useTradingStore();
  const closed   = positions.filter(p => p.status !== 'open');
  const wins     = closed.filter(p => p.pnl > 0).length;
  const totalPnl = closed.reduce((s,p) => s+p.pnl, 0);
  const openPnl  = positions.filter(p => p.status==='open').reduce((s,p) => s+p.pnl, 0);
  const winRate  = closed.length > 0 ? wins/closed.length*100 : 0;
  const capChg   = (capital-startingCapital)/startingCapital*100;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
      {[
        { label:'Capital',     val:`$${capital.toFixed(2)}`,               sub:`${capChg>=0?'+':''}${capChg.toFixed(1)}%`, color: capChg>=0?'#4ADE80':'#F87171' },
        { label:'Realized P&L',val:`${totalPnl>=0?'+':''}$${totalPnl.toFixed(2)}`, sub:'',      color: totalPnl>=0?'#4ADE80':'#F87171' },
        { label:'Open P&L',    val:`${openPnl>=0?'+':''}$${openPnl.toFixed(2)}`,   sub:'',      color: openPnl>=0?'#4ADE80':'#F87171' },
        { label:'Win Rate',    val:`${winRate.toFixed(0)}%`,                sub:`${wins}/${closed.length}`, color:'#A7B0B7' },
      ].map(s => (
        <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] text-[#4B5563] mb-0.5">{s.label}</p>
          <p className="text-sm font-bold" style={{ color: s.color }}>{s.val}</p>
          {s.sub && <p className="text-[10px] text-[#6B7280]">{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Activity Log ───────────────────────────────────────────────────────────
function ActivityLog() {
  const { logs } = useTradingStore();
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 flex flex-col h-full">
      <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-3 flex-shrink-0">Bot Activity</p>
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {logs.length === 0
          ? <p className="text-[11px] text-[#4B5563]">No activity — enable a bot to start</p>
          : logs.map((l,i) => <p key={i} className="text-[10px] text-[#6B7280] leading-relaxed font-mono">{l}</p>)
        }
      </div>
    </div>
  );
}

// ── Mobile Tab Bar ─────────────────────────────────────────────────────────
type MobileTab = 'chart' | 'trade' | 'positions' | 'bots';

function MobileTabBar({ active, onChange }: { active: MobileTab; onChange: (t: MobileTab) => void }) {
  const tabs: { id: MobileTab; label: string; icon: string }[] = [
    { id:'chart',     label:'Chart',     icon:'📈' },
    { id:'trade',     label:'Trade',     icon:'⚡' },
    { id:'positions', label:'Positions', icon:'📊' },
    { id:'bots',      label:'Bots',      icon:'🤖' },
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.06] bg-[#05060B]/95 backdrop-blur-sm flex sm:hidden">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-all ${active===t.id ? 'text-[#2BFFF1]' : 'text-[#4B5563]'}`}>
          <span className="text-base">{t.icon}</span>
          <span className="text-[9px] font-semibold">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [assetId, setAssetId]   = useState<AssetId>('sol');
  const [interval_, setInterval_] = useState('15m');
  const [mobileTab, setMobileTab] = useState<MobileTab>('chart');
  const [showSetup, setShowSetup] = useState(false);
  const [startCap, setStartCap]  = useState('1000');

  const { candles, livePrice, loading, change24h, prices, asset } = usePriceData(assetId, interval_);
  const { capital, setCapital, resetCapital } = useTradingStore();
  const { positions } = useTradingStore();

  useBotEngine({ prices, livePrice, asset: asset.label });

  const [flash, setFlash] = useState(false);
  const prevRef = useRef(livePrice);
  useEffect(() => {
    if (prevRef.current !== livePrice) { setFlash(true); setTimeout(() => setFlash(false), 400); prevRef.current = livePrice; }
  }, [livePrice]);

  return (
    <div className="min-h-screen bg-[#05060B] flex flex-col" style={{ fontFamily:'-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif' }}>

      {/* ── News Ticker ── */}
      <NewsTicker />

      {/* ── Header ── */}
      <div className="border-b border-white/[0.06] bg-[#05060B]/90 backdrop-blur-sm sticky top-0 z-40">
        <div className="px-3 sm:px-4 py-2.5 sm:py-3">
          {/* Row 1: Logo + price + capital */}
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2 flex-shrink-0">
              <XeniaLogo size={32} />
              <div className="hidden sm:block">
                <span className="font-bold text-[#F4F6FA] text-sm">Xenia</span>
                <span className="text-[#2BFFF1] font-bold text-sm"> Trading</span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#2BFFF1]/10 border border-[#2BFFF1]/25 text-[#2BFFF1] font-bold uppercase tracking-wide">MOCK</span>
            </div>

            {/* Live price */}
            <div className="flex items-baseline gap-1.5 flex-shrink-0">
              <span className={`font-bold transition-colors ${flash ? 'text-[#2BFFF1]' : 'text-[#F4F6FA]'} text-base sm:text-lg`}>
                ${livePrice > 0 ? (livePrice < 1 ? livePrice.toFixed(6) : livePrice.toFixed(2)) : '—'}
              </span>
              <span className={`text-xs font-semibold ${change24h>=0 ? 'text-green-400' : 'text-red-400'}`}>
                {change24h>=0?'+':''}{change24h.toFixed(2)}%
              </span>
            </div>

            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <button onClick={() => setShowSetup(!showSetup)}
                className="text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 rounded-lg border border-white/[0.08] text-[#A7B0B7] hover:border-white/20 transition-all">
                ${capital.toFixed(0)}
              </button>
              <button onClick={resetCapital}
                className="text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all">
                Reset
              </button>
            </div>
          </div>

          {/* Row 2: Asset + interval selectors */}
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {ASSETS.map(a => (
              <button key={a.id} onClick={() => setAssetId(a.id as AssetId)}
                className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold transition-all ${assetId===a.id ? 'bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                {a.id.toUpperCase()}
              </button>
            ))}
            <div className="w-px h-4 bg-white/[0.08] mx-1" />
            {['5m','15m','1h','4h'].map(i => (
              <button key={i} onClick={() => setInterval_(i)}
                className={`px-1.5 sm:px-2 py-1 rounded text-[10px] font-semibold transition-all ${interval_===i ? 'bg-white/[0.08] text-[#F4F6FA]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                {i}
              </button>
            ))}
          </div>
        </div>

        {showSetup && (
          <div className="border-t border-white/[0.06] px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 flex-wrap">
            <span className="text-xs text-[#A7B0B7]">Starting capital</span>
            <input type="number" value={startCap} onChange={e => setStartCap(e.target.value)}
              className="w-28 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none" />
            <button onClick={() => { setCapital(parseFloat(startCap)||1000); setShowSetup(false); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">
              Set & Reset
            </button>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Stats bar */}
        <div className="px-3 sm:px-4 pt-3 pb-2 flex-shrink-0">
          <StatsBar />
        </div>

        {/* ── DESKTOP layout (sm and up) ── */}
        <div className="hidden sm:grid sm:grid-cols-[260px_1fr_260px] gap-3 px-4 pb-4 flex-1 overflow-hidden" style={{ minHeight: 0 }}>

          {/* Left — Bots */}
          <div className="overflow-y-auto pr-1">
            <BotPanel />
          </div>

          {/* Centre — Chart + Positions */}
          <div className="flex flex-col gap-3 min-w-0 overflow-hidden">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 flex-shrink-0" style={{ height:'42%' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#A7B0B7]">{asset.label} · {interval_}</span>
                {loading && <div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />}
              </div>
              <div style={{ height:'calc(100% - 28px)' }}>
                <PriceChart candles={candles} livePrice={livePrice} positions={positions} />
              </div>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 flex-1 overflow-hidden min-h-0">
              <PositionsTable livePrice={livePrice} />
            </div>
          </div>

          {/* Right — Trade + Indicators + Log */}
          <div className="flex flex-col gap-3 overflow-y-auto pr-1">
            <TradeForm livePrice={livePrice} asset={asset.label} />
            <IndicatorsPanel prices={prices} />
            <div className="flex-1 min-h-0" style={{ minHeight: '160px' }}>
              <ActivityLog />
            </div>
          </div>
        </div>

        {/* ── MOBILE layout ── */}
        <div className="flex sm:hidden flex-1 overflow-hidden pb-14 px-3">

          {mobileTab === 'chart' && (
            <div className="flex flex-col gap-3 w-full overflow-y-auto">
              {/* Chart */}
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3" style={{ height: '260px' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[#A7B0B7]">{asset.label} · {interval_}</span>
                  {loading && <div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />}
                </div>
                <div style={{ height: 'calc(100% - 28px)' }}>
                  <PriceChart candles={candles} livePrice={livePrice} positions={positions} />
                </div>
              </div>
              {/* Indicators inline on chart tab */}
              <IndicatorsPanel prices={prices} />
              {/* Activity log */}
              <div style={{ minHeight: '160px' }}><ActivityLog /></div>
            </div>
          )}

          {mobileTab === 'trade' && (
            <div className="w-full overflow-y-auto">
              <TradeForm livePrice={livePrice} asset={asset.label} />
            </div>
          )}

          {mobileTab === 'positions' && (
            <div className="w-full overflow-y-auto">
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 h-full">
                <PositionsTable livePrice={livePrice} />
              </div>
            </div>
          )}

          {mobileTab === 'bots' && (
            <div className="w-full overflow-y-auto">
              <BotPanel />
            </div>
          )}
        </div>
      </div>

      {/* Mobile tab bar */}
      <MobileTabBar active={mobileTab} onChange={setMobileTab} />
    </div>
  );
}
