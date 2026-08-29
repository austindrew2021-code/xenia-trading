import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

// ── Xenia — Market list ────────────────────────────────────────────────────
//
// DESIGN NOTES
//
//   This is the screen that decides whether Xenia feels like a terminal. A
//   trader scanning for something to trade is doing one thing: comparing rows.
//   Everything here serves that comparison.
//
//   1. ROWS, NOT CARDS. Cards impose padding and borders that push the row
//      count down to five or six. This fits fourteen on a phone. A scanner that
//      shows six things is a list of suggestions; one that shows fourteen is a
//      market.
//   2. COLUMNS ALIGN BECAUSE THE NUMBERS ARE TABULAR. Right-aligned mono
//      figures mean the eye can run down a column and compare magnitudes
//      without reading. This is most of why terminals feel fast.
//   3. SORT IS THE PRIMARY VERB. Tapping a column header is how you ask a
//      question of a market. It gets a real affordance and remembers direction.
//   4. THE SPARKLINE IS THE ROW'S THESIS. 24h shape in 44 pixels tells you
//      whether a +12% is a steady climb or a spike already sold. A percentage
//      alone cannot distinguish those, and the difference decides the trade.
//
//   RISK FLAGS, AND WHY THEY ARE NOT DECORATION
//   On pump.fun the difference between a tradeable token and an exit-liquidity
//   trap is usually visible in the metadata before the chart: thin liquidity
//   relative to volume, an unrenounced mint authority, a dev holding a large
//   share of supply, an age measured in minutes. Competing scanners bury these
//   behind a detail view. Surfacing them in the row costs one line of type and
//   is the most valuable thing on the screen — a user who avoids one rug is
//   better served than one who catches one runner.
//
//   Flags describe facts, never verdicts. "Mint live" is checkable and true;
//   "safe" is a promise nobody can make, and putting it on a row would make
//   Xenia responsible for an outcome it cannot control.

export type SortKey = 'symbol' | 'price' | 'change' | 'volume' | 'liquidity' | 'age' | 'mcap';
export type SortDir = 'asc' | 'desc';
export type MarketFilter = 'all' | 'new' | 'gainers' | 'losers' | 'volume' | 'watchlist';

export interface MarketRow {
  id: string;
  symbol: string;
  name: string;
  mint?: string;
  price: number;
  change24hPct: number;
  volume24hUsd: number;
  liquidityUsd?: number;
  marketCapUsd?: number;
  /** Unix ms of pair creation. Drives the age column and the "new" filter. */
  createdAt?: number;
  /** ~24 evenly spaced closes, oldest first. Optional; the row degrades fine. */
  spark?: number[];
  /** Fraction of supply held by the deployer, 0-1. */
  devHoldingPct?: number;
  /** True when mint authority has not been revoked — supply can still grow. */
  mintAuthorityLive?: boolean;
  /** True when LP tokens are burned or locked. */
  lpLocked?: boolean;
  isWatchlisted?: boolean;
}

export interface MarketListProps {
  markets: MarketRow[];
  loading?: boolean;
  onSelect: (m: MarketRow) => void;
  onToggleWatchlist?: (m: MarketRow) => void;
  /** Shown in the header so a stale feed is visible rather than assumed live. */
  lastUpdated?: number;
}

const num = 'font-mono tabular-nums tracking-tight';
const eyebrow = 'text-[9px] uppercase tracking-[0.14em] text-[#4B5563] font-semibold';

function px(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return v.toFixed(3);
  if (a >= 0.01) return v.toFixed(4);
  if (a >= 0.0001) return v.toFixed(6);
  return v.toPrecision(3);
}

function usd(v?: number): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

/** Compact age. Minutes matter most here — a 4m pair is a different animal. */
function age(createdAt?: number): string {
  if (!createdAt) return '—';
  const mins = (Date.now() - createdAt) / 60000;
  if (mins < 1) return 'now';
  if (mins < 60) return `${Math.floor(mins)}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  const d = Math.floor(mins / 1440);
  return d < 365 ? `${d}d` : `${Math.floor(d / 365)}y`;
}

// ── sparkline ──────────────────────────────────────────────────────────────

function Spark({ points, up }: { points?: number[]; up: boolean }) {
  const d = useMemo(() => {
    if (!points || points.length < 2) return null;
    const vals = points.filter(Number.isFinite);
    if (vals.length < 2) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const w = 44, h = 16;
    return vals
      .map((v, i) => {
        const x = (i / (vals.length - 1)) * w;
        const y = h - ((v - min) / span) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [points]);

  if (!d) return <div className="w-11 h-4" />;
  return (
    <svg width={44} height={16} className="shrink-0" aria-hidden="true">
      <path d={d} fill="none" strokeWidth={1.25}
        stroke={up ? '#10B981' : '#EF4444'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── risk flags ─────────────────────────────────────────────────────────────

function flagsFor(m: MarketRow): { label: string; tone: 'warn' | 'bad' }[] {
  const out: { label: string; tone: 'warn' | 'bad' }[] = [];
  if (m.mintAuthorityLive) out.push({ label: 'Mint live', tone: 'bad' });
  if (m.lpLocked === false) out.push({ label: 'LP unlocked', tone: 'bad' });
  if (m.devHoldingPct !== undefined && m.devHoldingPct > 0.15) {
    out.push({ label: `Dev ${(m.devHoldingPct * 100).toFixed(0)}%`, tone: 'warn' });
  }
  // Volume far above the pool it trades against means the printed volume is
  // mostly the same dollars cycling, and your own fill will move the price.
  if (m.liquidityUsd && m.liquidityUsd > 0 && m.volume24hUsd / m.liquidityUsd > 20) {
    out.push({ label: 'Thin pool', tone: 'warn' });
  }
  return out;
}

// ── screen ─────────────────────────────────────────────────────────────────

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'symbol', label: 'Market', className: 'flex-1 text-left' },
  { key: 'price', label: 'Price', className: 'w-[70px] text-right' },
  { key: 'change', label: '24h', className: 'w-[56px] text-right' },
  { key: 'volume', label: 'Vol', className: 'w-[48px] text-right' },
];

const FILTERS: { key: MarketFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'gainers', label: 'Gainers' },
  { key: 'losers', label: 'Losers' },
  { key: 'volume', label: 'Volume' },
  { key: 'watchlist', label: 'Watchlist' },
];

const PAGE = 40;

export default function MarketListPage(props: MarketListProps) {
  const { markets, loading, onSelect, onToggleWatchlist, lastUpdated } = props;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MarketFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  // Typing stays responsive on a long list because filtering runs against the
  // deferred value while the input updates immediately.
  const deferredQuery = useDeferredValue(query);

  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let out = markets;

    if (q) {
      out = out.filter(m =>
        m.symbol.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.mint?.toLowerCase().startsWith(q));
    }

    switch (filter) {
      case 'new':
        out = out.filter(m => m.createdAt && Date.now() - m.createdAt < 24 * 3600_000);
        break;
      case 'gainers': out = out.filter(m => m.change24hPct > 0); break;
      case 'losers': out = out.filter(m => m.change24hPct < 0); break;
      case 'volume': out = out.filter(m => m.volume24hUsd > 0); break;
      case 'watchlist': out = out.filter(m => m.isWatchlisted); break;
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (m: MarketRow): number | string => {
      switch (sortKey) {
        case 'symbol': return m.symbol.toLowerCase();
        case 'price': return m.price;
        case 'change': return m.change24hPct;
        case 'volume': return m.volume24hUsd;
        case 'liquidity': return m.liquidityUsd ?? -1;
        case 'mcap': return m.marketCapUsd ?? -1;
        case 'age': return m.createdAt ?? 0;
      }
    };

    return [...out].sort((a, b) => {
      const x = val(a), y = val(b);
      if (typeof x === 'string' || typeof y === 'string') {
        return String(x).localeCompare(String(y)) * dir;
      }
      return (x - y) * dir;
    });
  }, [markets, deferredQuery, filter, sortKey, sortDir]);

  // Reset the window whenever the result set changes, or a filter narrows to
  // twelve rows and the list still claims to be showing forty.
  useEffect(() => { setShown(PAGE); }, [deferredQuery, filter, sortKey, sortDir]);

  // Grow the window as the sentinel scrolls into view. Rendering 800 rows at
  // once is what makes a list feel heavy on a phone.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) setShown(s => Math.min(s + PAGE, rows.length));
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Names read naturally A-Z; every number is more interesting largest first.
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  const stale = lastUpdated ? Date.now() - lastUpdated > 60_000 : false;

  return (
    <div className="flex flex-col h-[100dvh] bg-[#080B10] text-[#E5E9EF] overflow-hidden">

      {/* ── search ── */}
      <div className="px-3 pt-2 pb-1.5">
        <div className="flex items-center gap-2 bg-[#0D1117] border border-white/[0.06]
                        rounded-lg px-2.5 py-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0"
            stroke="#4B5563" strokeWidth="2.5" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search symbol, name or mint"
            className={`${num} flex-1 bg-transparent text-[12px] outline-none
                        placeholder:font-sans placeholder:text-[#374151] placeholder:tracking-normal`}
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-[#4B5563] text-[14px] leading-none px-1">
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── filters ── */}
      <div className="flex gap-1 px-3 pb-1.5 overflow-x-auto no-scrollbar">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 rounded text-[10px] font-bold whitespace-nowrap border transition-colors ${
              filter === f.key
                ? 'bg-[#2BFFF1]/12 border-[#2BFFF1]/25 text-[#2BFFF1]'
                : 'bg-transparent border-white/[0.07] text-[#4B5563]'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── column headers ── */}
      <div className="flex items-center gap-2 px-3 py-1 border-y border-white/[0.06] bg-[#0A0D12]">
        <div className="w-11 shrink-0" />
        {COLUMNS.map(c => (
          <button
            key={c.key}
            onClick={() => toggleSort(c.key)}
            className={`${c.className} ${eyebrow} flex items-center gap-0.5 ${
              sortKey === c.key ? 'text-[#2BFFF1]' : ''
            } ${c.className.includes('text-right') ? 'justify-end' : ''}`}
          >
            {c.label}
            <span className="text-[7px] leading-none">
              {sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '\u00A0'}
            </span>
          </button>
        ))}
      </div>

      {/* ── rows ── */}
      <div className="flex-1 overflow-y-auto">
        {loading && rows.length === 0 ? (
          <div className="py-16 text-center">
            <span className={eyebrow}>Loading markets</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 px-8 text-center">
            <p className="text-[11px] text-[#9CA3AF]">
              {query
                ? `Nothing matches "${query}".`
                : filter === 'watchlist'
                  ? 'Your watchlist is empty. Tap the star on any row to add it.'
                  : 'No markets match this filter right now.'}
            </p>
            {(query || filter !== 'all') && (
              <button
                onClick={() => { setQuery(''); setFilter('all'); }}
                className="mt-1.5 text-[11px] font-bold text-[#2BFFF1]"
              >
                Show all markets
              </button>
            )}
          </div>
        ) : (
          <>
            {rows.slice(0, shown).map(m => {
              const up = m.change24hPct >= 0;
              const flags = flagsFor(m);
              return (
                <button
                  key={m.id}
                  onClick={() => onSelect(m)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.035]
                             active:bg-white/[0.04] text-left"
                >
                  <Spark points={m.spark} up={up} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-bold truncate">{m.symbol}</span>
                      {m.createdAt && Date.now() - m.createdAt < 3600_000 && (
                        <span className={`${eyebrow} text-[#2BFFF1]`}>{age(m.createdAt)}</span>
                      )}
                    </div>
                    {flags.length > 0 ? (
                      <div className="flex items-center gap-1 mt-[1px]">
                        {flags.slice(0, 2).map(f => (
                          <span key={f.label}
                            className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded ${
                              f.tone === 'bad'
                                ? 'text-[#EF4444] bg-[#EF4444]/10'
                                : 'text-[#F59E0B] bg-[#F59E0B]/10'}`}>
                            {f.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[9px] text-[#374151] truncate block">{m.name}</span>
                    )}
                  </div>

                  <span className={`${num} w-[70px] text-right text-[11px] font-semibold`}>
                    {px(m.price)}
                  </span>
                  <span className={`${num} w-[56px] text-right text-[11px] font-bold ${
                    up ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                    {up ? '+' : ''}{m.change24hPct.toFixed(1)}%
                  </span>
                  <span className={`${num} w-[48px] text-right text-[10px] text-[#6B7280]`}>
                    {usd(m.volume24hUsd)}
                  </span>

                  {onToggleWatchlist && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); onToggleWatchlist(m); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault(); e.stopPropagation(); onToggleWatchlist(m);
                        }
                      }}
                      aria-label={m.isWatchlisted ? `Remove ${m.symbol} from watchlist` : `Add ${m.symbol} to watchlist`}
                      className={`shrink-0 text-[13px] leading-none px-0.5 ${
                        m.isWatchlisted ? 'text-[#F59E0B]' : 'text-[#1F2937]'}`}
                    >
                      ★
                    </span>
                  )}
                </button>
              );
            })}
            <div ref={sentinel} className="h-8" />
            {shown < rows.length && (
              <p className={`${eyebrow} text-center pb-3`}>
                {shown} of {rows.length}
              </p>
            )}
          </>
        )}
      </div>

      {/* ── feed status: a stale list must say so ── */}
      {lastUpdated && (
        <div className="px-3 py-1 border-t border-white/[0.06] flex items-center gap-1.5">
          <span className={`w-1 h-1 rounded-full ${stale ? 'bg-[#F59E0B]' : 'bg-[#10B981]'}`} />
          <span className={eyebrow}>
            {stale
              ? `Prices last updated ${age(lastUpdated)} ago`
              : `${rows.length} markets · live`}
          </span>
        </div>
      )}
    </div>
  );
}
