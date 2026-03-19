import { useState, useEffect, useRef } from 'react';
import { useAuth } from './auth/AuthContext';
import { useTradingStore } from './store';
import { usePriceData, TOP_ASSETS, searchPumpTokens, SearchAsset, AssetId } from './hooks/usePriceData';
import { useBotEngine } from './hooks/useBotEngine';
import { BotPanel } from './components/BotPanel';
import { PositionsTable } from './components/PositionsTable';
import { PriceChart } from './components/PriceChart';
import { AuthModal } from './components/AuthModal';
import { WalletDepositModal } from './components/WalletDepositModal';
import { PointsBadge, PointsLeaderboard } from './components/PointsLeaderboard';
import { P2PPage } from './pages/P2PPage';
import { EarnPage } from './pages/EarnPage';
import { calcRSI, calcStochastic, calcATR } from './bots/indicators';
import { Side } from './types';

type Page = 'trade' | 'p2p' | 'earn' | 'markets';

// ── Asset Selector ─────────────────────────────────────────────────────────
function AssetSelector({ current, onChange }: {
  current: string;
  onChange: (id: string, address?: string) => void;
}) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<SearchAsset[]>([]);
  const [searching, setSrch]  = useState(false);
  const ref = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    clearTimeout(ref.current);
    ref.current = setTimeout(async () => {
      setSrch(true);
      setResults(await searchPumpTokens(query));
      setSrch(false);
    }, 400);
  }, [query]);

  const cur = TOP_ASSETS.find(a => a.id === current);

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:border-white/20 transition-all">
        <span className="text-sm font-bold text-[#F4F6FA]">{cur?.label ?? current}</span>
        <svg className="w-3 h-3 text-[#4B5563]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1.5 w-72 bg-[#0B0E14] border border-white/[0.1] rounded-2xl shadow-2xl z-50 overflow-hidden">
            <div className="p-3 border-b border-white/[0.06]">
              <input autoFocus placeholder="Search Pump.fun / Solana tokens…" value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
            </div>
            <div className="max-h-72 overflow-y-auto">
              {!query && (
                <>
                  <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-widest px-3 pt-2.5 pb-1">Top 10 Tokens</p>
                  {TOP_ASSETS.map(a => (
                    <button key={a.id} onClick={() => { onChange(a.id); setOpen(false); setQuery(''); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.04] transition-all text-left ${a.id === current ? 'bg-[#2BFFF1]/05' : ''}`}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black bg-white/[0.05] text-[#F4F6FA]">
                        {a.id[0].toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-[#F4F6FA]">{a.label}</p>
                        {a.isPump && <p className="text-[9px] text-[#F59E0B]">Pump.fun</p>}
                      </div>
                      {a.id === current && <div className="w-1.5 h-1.5 rounded-full bg-[#2BFFF1]" />}
                    </button>
                  ))}
                </>
              )}
              {query && searching && (
                <div className="flex items-center justify-center py-6 gap-2 text-[#4B5563] text-xs">
                  <div className="w-4 h-4 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />
                  Searching Pump.fun…
                </div>
              )}
              {query && !searching && results.length > 0 && (
                <>
                  <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-widest px-3 pt-2.5 pb-1">Search Results</p>
                  {results.map(r => (
                    <button key={r.id} onClick={() => { onChange(r.id, r.address); setOpen(false); setQuery(''); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.04] transition-all text-left">
                      <div className="w-7 h-7 rounded-lg bg-[#F59E0B]/10 flex items-center justify-center text-[#F59E0B] text-xs font-black">P</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#F4F6FA] truncate">{r.symbol}</p>
                        <p className="text-[9px] text-[#4B5563] truncate">{r.address?.slice(0,12)}…</p>
                      </div>
                      {r.priceUsd && r.priceUsd > 0 && (
                        <span className="text-[10px] text-[#A7B0B7]">${r.priceUsd.toFixed(6)}</span>
                      )}
                    </button>
                  ))}
                </>
              )}
              {query && !searching && results.length === 0 && (
                <p className="text-center text-xs text-[#4B5563] py-6">No results found</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Trade form ─────────────────────────────────────────────────────────────
function TradeForm({ livePrice, asset }: { livePrice: number; asset: string }) {
  const { capital, openPosition, addLog } = useTradingStore();
  const { account, saveAccount, recordTrade } = useAuth();
  const [side, setSide]   = useState<Side>('LONG');
  const [size, setSize]   = useState('50');
  const [lev, setLev]     = useState('10');
  const [tp, setTp]       = useState('');
  const [sl, setSl]       = useState('');

  const sizeN = parseFloat(size) || 0;
  const levN  = parseInt(lev) || 1;
  const notional = sizeN * levN;
  const effectiveCap = account ? (account.use_real ? account.real_balance : account.mock_balance) : capital;
  const liqPct = (1 / levN) * 0.9;

  const submit = async () => {
    if (sizeN <= 0 || sizeN > effectiveCap) return;
    const pos = openPosition(asset, side, livePrice, sizeN, levN, 'manual',
      tp ? parseFloat(tp) : undefined, sl ? parseFloat(sl) : undefined);
    if (pos) {
      addLog(`📌 Manual ${side} ${asset} $${sizeN} ×${levN} @ $${livePrice.toFixed(4)}`);
      if (account) {
        const field = account.use_real ? 'real_balance' : 'mock_balance';
        const bal   = account.use_real ? account.real_balance : account.mock_balance;
        saveAccount({ [field]: Math.max(0, bal - sizeN) } as any);
        recordTrade(notional, 0, false);
      }
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Place Trade</p>
        {account && (
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${account.use_real ? 'text-[#2BFFF1] border-[#2BFFF1]/30 bg-[#2BFFF1]/10' : 'text-[#6B7280] border-white/[0.08]'}`}>
            {account.use_real ? 'LIVE' : 'MOCK'}
          </span>
        )}
      </div>

      <div className="flex rounded-xl overflow-hidden border border-white/[0.07] mb-3">
        {(['LONG','SHORT'] as Side[]).map(s => (
          <button key={s} onClick={() => setSide(s)}
            className={`flex-1 py-2.5 text-xs font-bold transition-all ${side === s ? s === 'LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            {s === 'LONG' ? '▲ LONG' : '▼ SHORT'}
          </button>
        ))}
      </div>

      <div className="space-y-2 mb-3">
        {[
          ['Size ($)', size, setSize],
          ['Leverage', lev, setLev],
          ['TP Price', tp, setTp],
          ['SL Price', sl, setSl],
        ].map(([label, val, setter]: any) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-[10px] text-[#6B7280] w-16 flex-shrink-0">{label}</span>
            <input type="number" value={val}
              placeholder={label.includes('TP') || label.includes('SL') ? 'Optional' : ''}
              onChange={e => setter(e.target.value)}
              className="flex-1 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-[#0B0E14] px-3 py-2.5 mb-3 space-y-1.5">
        {[
          ['Notional', `$${notional.toFixed(0)}`],
          [`Liq ~${(liqPct*100).toFixed(1)}% away`, `$${side === 'LONG' ? (livePrice*(1-liqPct)).toFixed(4) : (livePrice*(1+liqPct)).toFixed(4)}`],
          ['Available', `$${effectiveCap.toFixed(2)}`, sizeN > effectiveCap ? '#F87171' : '#4ADE80'],
        ].map(([k,v,c]:any) => (
          <div key={k} className="flex justify-between text-[10px]">
            <span className="text-[#4B5563]">{k}</span>
            <span style={{ color: c || '#A7B0B7' }}>{v}</span>
          </div>
        ))}
      </div>

      <button onClick={submit} disabled={sizeN <= 0 || sizeN > effectiveCap}
        className={`w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${side === 'LONG' ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'}`}>
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
  const rsiColor   = rsi > 70 ? '#F87171' : rsi < 30 ? '#4ADE80' : '#A7B0B7';
  const stochColor = k  > 80 ? '#F87171' : k  < 20 ? '#4ADE80' : '#A7B0B7';
  const bullish = prices.length > 5 && prices[prices.length-1] > prices[prices.length-5];
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-3">Indicators</p>
      <div className="space-y-3">
        {[['RSI (14)', rsi, rsiColor], ['Stoch K', k, stochColor]].map(([l,v,c]:any) => (
          <div key={l}>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-[#6B7280]">{l}</span>
              <span className="text-[10px] font-bold" style={{ color: c }}>{Number(v).toFixed(1)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full transition-all" style={{ width:`${Math.min(v,100)}%`, background: c }} />
            </div>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="flex justify-between"><span className="text-[#6B7280]">Stoch D</span><span className="text-[#A7B0B7]">{d.toFixed(1)}</span></div>
          <div className="flex justify-between"><span className="text-[#6B7280]">ATR</span><span className="text-[#A7B0B7]">{atr.toFixed(3)}%</span></div>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-[#6B7280]">Trend</span>
          <span className="font-bold" style={{ color: bullish ? '#4ADE80' : '#F87171' }}>
            {bullish ? '▲ Bullish' : '▼ Bearish'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Stats Bar ──────────────────────────────────────────────────────────────
function StatsBar() {
  const { capital, positions, startingCapital } = useTradingStore();
  const { account } = useAuth();
  const closed    = positions.filter(p => p.status !== 'open');
  const wins      = closed.filter(p => p.pnl > 0).length;
  const totalPnl  = closed.reduce((s,p) => s + p.pnl, 0);
  const openPnl   = positions.filter(p => p.status === 'open').reduce((s,p) => s + p.pnl, 0);
  const winRate   = closed.length > 0 ? wins/closed.length*100 : 0;
  const dispCap   = account ? (account.use_real ? account.real_balance : account.mock_balance) : capital;
  const capChg    = ((dispCap - startingCapital) / startingCapital) * 100;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {[
        { label:'Capital', value:`$${dispCap.toFixed(2)}`, sub:`${capChg>=0?'+':''}${capChg.toFixed(1)}%`, color:capChg>=0?'#4ADE80':'#F87171' },
        { label:'Realized P&L', value:`${totalPnl>=0?'+':''}$${totalPnl.toFixed(2)}`, color:totalPnl>=0?'#4ADE80':'#F87171' },
        { label:'Unrealized', value:`${openPnl>=0?'+':''}$${openPnl.toFixed(2)}`, color:openPnl>=0?'#4ADE80':'#F87171' },
        { label:'Win Rate', value:`${winRate.toFixed(0)}%`, sub:`${wins}/${closed.length}`, color:'#A7B0B7' },
      ].map(s => (
        <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] text-[#4B5563] mb-0.5">{s.label}</p>
          <p className="text-sm font-bold" style={{ color: s.color }}>{s.value}</p>
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
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 h-full flex flex-col">
      <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest mb-3 flex-shrink-0">Bot Activity</p>
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {logs.length === 0
          ? <p className="text-[11px] text-[#4B5563]">No activity yet — enable a bot to start</p>
          : logs.map((l,i) => <p key={i} className="text-[10px] text-[#6B7280] font-mono leading-relaxed">{l}</p>)}
      </div>
    </div>
  );
}

// ── Mobile Bottom Nav ──────────────────────────────────────────────────────
function MobileNav({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const items: { id: Page; label: string; icon: string }[] = [
    { id:'trade',   label:'Trade',   icon:'📊' },
    { id:'markets', label:'Markets', icon:'🔍' },
    { id:'p2p',     label:'P2P',     icon:'🔄' },
    { id:'earn',    label:'Earn',    icon:'💎' },
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0B0E14]/95 backdrop-blur-sm border-t border-white/[0.06] flex md:hidden">
      {items.map(item => (
        <button key={item.id} onClick={() => setPage(item.id)}
          className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all ${page === item.id ? 'text-[#2BFFF1]' : 'text-[#4B5563]'}`}>
          <span className="text-lg leading-none">{item.icon}</span>
          <span className="text-[10px] font-semibold">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Mobile Markets Search Panel ─────────────────────────────────────────────
function MarketsPanel({ onChange }: { onChange: (id: string, address?: string) => void }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<SearchAsset[]>([]);
  const [searching, setSrch]  = useState(false);
  const ref = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    clearTimeout(ref.current);
    ref.current = setTimeout(async () => {
      setSrch(true);
      setResults(await searchPumpTokens(query));
      setSrch(false);
    }, 400);
  }, [query]);

  return (
    <div className="p-4 pb-24 overflow-y-auto h-full">
      <p className="text-base font-bold text-[#F4F6FA] mb-4">Markets</p>
      <input placeholder="Search Pump.fun / Solana tokens…" value={query}
        onChange={e => setQuery(e.target.value)}
        className="w-full bg-[#0B0E14] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 mb-4" />

      <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-widest mb-2">Top 10 Tokens</p>
      <div className="space-y-1.5 mb-5">
        {TOP_ASSETS.map(a => (
          <button key={a.id} onClick={() => onChange(a.id)}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] transition-all text-left">
            <div className="w-9 h-9 rounded-xl bg-white/[0.05] flex items-center justify-center font-black text-[#F4F6FA]">
              {a.id[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#F4F6FA]">{a.label}</p>
              {a.isPump && <p className="text-[9px] text-[#F59E0B]">Pump.fun</p>}
            </div>
            <span className="text-[#2BFFF1] text-xs">Trade →</span>
          </button>
        ))}
      </div>

      {results.length > 0 && (
        <>
          <p className="text-[10px] text-[#4B5563] font-semibold uppercase tracking-widest mb-2">Search Results</p>
          <div className="space-y-1.5">
            {results.map(r => (
              <button key={r.id} onClick={() => onChange(r.id, r.address)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] transition-all text-left">
                <div className="w-9 h-9 rounded-xl bg-[#F59E0B]/10 flex items-center justify-center text-[#F59E0B] font-black">P</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#F4F6FA] truncate">{r.symbol}</p>
                  <p className="text-[9px] text-[#4B5563] truncate">{r.address}</p>
                </div>
                {r.priceUsd && r.priceUsd > 0 && <span className="text-[10px] text-[#A7B0B7]">${r.priceUsd.toFixed(6)}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {searching && (
        <div className="flex items-center justify-center py-8 gap-2 text-[#4B5563] text-xs">
          <div className="w-4 h-4 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />
          Searching…
        </div>
      )}
    </div>
  );
}

// ── Mobile Trade View ──────────────────────────────────────────────────────
function MobileTradeView({
  assetId, livePrice, change24h, candles, prices, positions, assetLabel,
  onChangeAsset, interval, setInterval,
}: any) {
  const [tab, setTab] = useState<'chart'|'trade'|'bots'|'board'>('chart');
  const store = useTradingStore();

  return (
    <div className="flex flex-col h-full pb-16">
      {/* Asset + interval bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-shrink-0 overflow-x-auto">
        <AssetSelector current={assetId} onChange={onChangeAsset} />
        <span className={`text-base font-bold ml-1 ${change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          ${livePrice > 0 ? livePrice.toFixed(livePrice < 1 ? 6 : 4) : '—'}
        </span>
        <span className={`text-xs ${change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
        </span>
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          {['5m','15m','1h','4h'].map(i => (
            <button key={i} onClick={() => setInterval(i)}
              className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${interval === i ? 'bg-white/[0.08] text-[#F4F6FA]' : 'text-[#4B5563]'}`}>
              {i}
            </button>
          ))}
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex border-b border-white/[0.06] flex-shrink-0">
        {([['chart','Chart'],['trade','Trade'],['bots','Bots'],['board','Board']] as const).map(([t,l]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-all ${tab === t ? 'text-[#2BFFF1] border-b-2 border-[#2BFFF1]' : 'text-[#4B5563]'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'chart' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0 p-2">
              <PriceChart candles={candles} livePrice={livePrice} positions={positions} />
            </div>
            <div className="p-3 border-t border-white/[0.06] flex-shrink-0">
              <StatsBar />
            </div>
            <div className="flex-1 overflow-y-auto p-3 min-h-0">
              <PositionsTable livePrice={livePrice} />
            </div>
          </div>
        )}
        {tab === 'trade' && (
          <div className="overflow-y-auto h-full p-3 space-y-3">
            <TradeForm livePrice={livePrice} asset={assetLabel} />
            <IndicatorsPanel prices={prices} />
          </div>
        )}
        {tab === 'bots' && (
          <div className="overflow-y-auto h-full p-3 space-y-3">
            <BotPanel />
            <ActivityLog />
          </div>
        )}
        {tab === 'board' && (
          <div className="overflow-y-auto h-full p-3">
            <PointsLeaderboard />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [assetId,   setAssetId]   = useState<AssetId>('sol');
  const [customAddr, setCustomAddr] = useState<string | undefined>();
  const [interval,  setInterval_] = useState('15m');
  const [page,      setPage]      = useState<Page>('trade');
  const [rightTab,  setRightTab]  = useState<'trade'|'leaderboard'>('trade');
  const [showAuth,  setShowAuth]  = useState(false);
  const [showWallet,setShowWallet]= useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [startCap,  setStartCap]  = useState('1000');
  const [flash,     setFlash]     = useState(false);

  const { candles, livePrice, loading, change24h, prices, asset } = usePriceData(assetId, interval, customAddr);
  const { capital, setCapital, resetCapital, positions } = useTradingStore();
  const { user, account, signOut, loading: authLoading } = useAuth();

  useBotEngine({ prices, livePrice, asset: asset.label });

  useEffect(() => { setFlash(true); setTimeout(() => setFlash(false), 300); }, [livePrice]);
  useEffect(() => { if (account) setCapital(account.use_real ? account.real_balance : account.mock_balance); }, [account, setCapital]);

  const handleChangeAsset = (id: string, address?: string) => {
    setAssetId(id);
    setCustomAddr(address);
    setPage('trade');
  };

  if (authLoading) return (
    <div className="min-h-screen bg-[#05060B] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />
    </div>
  );

  // ── Shared header ─────────────────────────────────────────────────────────
  const Header = () => (
    <div className="border-b border-white/[0.06] bg-[#05060B]/90 backdrop-blur-sm sticky top-0 z-50">
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Logo */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <img src="/logo.png" alt="Xenia" className="w-8 h-8 rounded-lg object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
          <div className="hidden sm:block">
            <span className="font-bold text-[#F4F6FA] text-sm">Xenia</span>
            <span className="text-[#2BFFF1] font-bold text-sm"> Trading</span>
          </div>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#2BFFF1]/10 border border-[#2BFFF1]/25 text-[#2BFFF1] font-semibold uppercase tracking-wide hidden sm:inline">MOCK</span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 ml-2">
          {([['trade','Trade'],['p2p','P2P'],['earn','Earn']] as [Page,string][]).map(([p,l]) => (
            <button key={p} onClick={() => setPage(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${page === p ? 'bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
              {l}
            </button>
          ))}
        </nav>

        {/* Live price — desktop only */}
        {page === 'trade' && (
          <div className="hidden md:flex items-center gap-2 ml-2">
            <span className={`text-base font-bold transition-colors ${flash ? 'text-[#2BFFF1]' : 'text-[#F4F6FA]'}`}>
              ${livePrice > 0 ? livePrice.toFixed(livePrice < 1 ? 6 : 2) : '—'}
            </span>
            <span className={`text-xs font-semibold ${change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <PointsBadge />
          {user ? (
            <>
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
                <span className="text-xs text-[#A7B0B7]">{account?.username ?? user.email?.split('@')[0]}</span>
                <span className="text-[10px] text-[#2BFFF1] font-bold">${(account?.use_real ? account.real_balance : account?.mock_balance ?? capital).toFixed(0)}</span>
              </div>
              <button onClick={() => setShowWallet(true)}
                className="text-xs px-3 py-1.5 rounded-xl border border-[#2BFFF1]/25 text-[#2BFFF1] hover:bg-[#2BFFF1]/10 transition-all">
                Wallet
              </button>
              <button onClick={() => signOut()}
                className="hidden sm:block text-xs px-3 py-1.5 rounded-xl border border-white/[0.07] text-[#6B7280] hover:text-[#A7B0B7] transition-all">
                Out
              </button>
            </>
          ) : (
            <>
              {!user && (
                <button onClick={() => setShowSetup(!showSetup)}
                  className="hidden sm:block text-xs px-3 py-1.5 rounded-xl border border-white/[0.07] text-[#A7B0B7] hover:border-white/20 transition-all">
                  ${capital.toFixed(0)}
                </button>
              )}
              <button onClick={() => setShowAuth(true)}
                className="text-xs px-3 py-1.5 rounded-xl border border-[#2BFFF1]/25 bg-[#2BFFF1]/10 text-[#2BFFF1] hover:bg-[#2BFFF1]/20 font-semibold transition-all">
                Sign In
              </button>
            </>
          )}
          <button onClick={resetCapital}
            className="hidden sm:block text-xs px-2 py-1.5 rounded-xl border border-red-500/20 text-red-400/70 hover:bg-red-500/10 transition-all">
            ↺
          </button>
        </div>
      </div>

      {showSetup && !user && (
        <div className="border-t border-white/[0.06] px-4 py-3 flex items-center gap-3">
          <span className="text-xs text-[#A7B0B7]">Starting capital</span>
          <input type="number" value={startCap} onChange={e => setStartCap(e.target.value)}
            className="w-28 bg-[#0B0E14] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-[#F4F6FA] outline-none" />
          <button onClick={() => { setCapital(parseFloat(startCap)||1000); setShowSetup(false); }}
            className="text-xs px-3 py-1.5 rounded-lg bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 transition-all">
            Set
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen bg-[#05060B] flex flex-col overflow-hidden" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif' }}>
      <Header />

      {/* ── Mobile layout ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden md:hidden">
        {page === 'trade' && (
          <MobileTradeView
            assetId={assetId} livePrice={livePrice} change24h={change24h}
            candles={candles} prices={prices} positions={positions}
            assetLabel={asset.label} onChangeAsset={handleChangeAsset}
            interval={interval} setInterval={setInterval_}
          />
        )}
        {page === 'markets' && (
          <MarketsPanel onChange={(id, addr) => { handleChangeAsset(id, addr); setPage('trade'); }} />
        )}
        {page === 'p2p' && <div className="overflow-y-auto h-full pb-16"><P2PPage /></div>}
        {page === 'earn' && <div className="overflow-y-auto h-full pb-16"><EarnPage /></div>}
      </div>

      {/* ── Desktop layout ─────────────────────────────────────────────── */}
      <div className="hidden md:flex flex-1 overflow-hidden flex-col">
        {(page === 'p2p') && <div className="flex-1 overflow-y-auto"><P2PPage /></div>}
        {(page === 'earn') && <div className="flex-1 overflow-y-auto"><EarnPage /></div>}
        {(page === 'trade') && (
          <div className="flex flex-col flex-1 overflow-hidden px-4 pt-3 pb-3 gap-3">
            {/* Top bar */}
            <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
              <AssetSelector current={assetId} onChange={handleChangeAsset} />
              <div className="flex items-center gap-1">
                {['5m','15m','1h','4h'].map(i => (
                  <button key={i} onClick={() => setInterval_(i)}
                    className={`px-2 py-1 rounded text-[10px] font-semibold transition-all ${interval === i ? 'bg-white/[0.08] text-[#F4F6FA]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                    {i}
                  </button>
                ))}
              </div>
              <div className="flex-1"><StatsBar /></div>
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-[260px_1fr_280px] gap-3 flex-1 min-h-0">
              {/* Left: Bots */}
              <div className="overflow-y-auto"><BotPanel /></div>

              {/* Centre: Chart + Positions */}
              <div className="flex flex-col gap-3 min-w-0 overflow-hidden">
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 flex-shrink-0" style={{ height:'55%' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[#A7B0B7]">{asset.label} — {interval}</span>
                    {loading && <div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin" />}
                  </div>
                  <div style={{ height: 'calc(100% - 28px)' }}>
                    <PriceChart candles={candles} livePrice={livePrice} positions={positions} />
                  </div>
                </div>
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 flex-1 overflow-hidden">
                  <PositionsTable livePrice={livePrice} />
                </div>
              </div>

              {/* Right: Trade / Leaderboard */}
              <div className="flex flex-col gap-3 overflow-hidden">
                <div className="flex rounded-xl border border-white/[0.07] overflow-hidden flex-shrink-0">
                  {([['trade','Trade'],['leaderboard','Rankings']] as const).map(([t,l]) => (
                    <button key={t} onClick={() => setRightTab(t)}
                      className={`flex-1 py-2 text-xs font-semibold transition-all ${rightTab === t ? 'bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                      {l}
                    </button>
                  ))}
                </div>
                {rightTab === 'trade' ? (
                  <>
                    <TradeForm livePrice={livePrice} asset={asset.label} />
                    <IndicatorsPanel prices={prices} />
                    <div className="flex-1 overflow-hidden min-h-0"><ActivityLog /></div>
                  </>
                ) : (
                  <div className="flex-1 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <PointsLeaderboard />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile bottom nav */}
      <MobileNav page={page} setPage={setPage} />

      {/* Modals */}
      {showAuth    && <AuthModal onClose={() => setShowAuth(false)} />}
      {showWallet  && <WalletDepositModal onClose={() => setShowWallet(false)} />}
    </div>
  );
}
