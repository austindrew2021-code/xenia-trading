import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTradingStore } from '../store';
import { PointsBadge } from '../components/PointsLeaderboard';

type Page = 'trade' | 'markets' | 'p2p' | 'earn' | 'discover' | 'home';
type SubNav = { tab?: string; rightTab?: string; discoverTab?: string; earnTab?: string };

interface MenuItem {
  id: string;
  label: string;
  page?: Page;
  subNav?: SubNav;
  action?: () => void;
  icon: React.ReactNode;
}

// ── Neon SVG icons matching Xenia's cyan aesthetic ────────────────────────
const Icons: Record<string, React.ReactNode> = {
  deposit: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  withdraw: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  p2p: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
    </svg>
  ),
  trade: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  markets: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  earn: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  staking: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
    </svg>
  ),
  referral: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  leaderboard: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6l4-4 4 4"/><path d="M12 2v10.3"/><path d="M3 15h18"/><path d="M5 15v5"/><path d="M10 15v3"/><path d="M14 15v3"/><path d="M19 15v5"/>
    </svg>
  ),
  discover: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
    </svg>
  ),
  events: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  news: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8z"/>
    </svg>
  ),
  rewards: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>
    </svg>
  ),
  coupons: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
  ),
  bots: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/>
    </svg>
  ),
};

const ALL_MENU_ITEMS: MenuItem[] = [
  { id:'deposit',    label:'Deposit',     icon:Icons.deposit,    page:'trade', subNav:{} },
  { id:'withdraw',   label:'Withdraw',    icon:Icons.withdraw,   page:'p2p' },
  { id:'p2p',        label:'P2P',         icon:Icons.p2p,        page:'p2p' },
  { id:'trade',      label:'Trade',       icon:Icons.trade,      page:'trade' },
  { id:'markets',    label:'Markets',     icon:Icons.markets,    page:'markets' },
  { id:'earn',       label:'Earn',        icon:Icons.earn,       page:'earn' },
  { id:'staking',    label:'Staking',     icon:Icons.staking,    page:'earn', subNav:{earnTab:'staking'} },
  { id:'referral',   label:'Referrals',   icon:Icons.referral,   page:'earn', subNav:{earnTab:'referrals'} },
  { id:'leaderboard',label:'Leaderboard', icon:Icons.leaderboard,page:'trade', subNav:{rightTab:'board'} },
  { id:'discover',   label:'Discover',    icon:Icons.discover,   page:'discover' },
  { id:'events',     label:'Events',      icon:Icons.events,     page:'discover', subNav:{discoverTab:'events'} },
  { id:'news',       label:'News',        icon:Icons.news,       page:'discover', subNav:{discoverTab:'news'} },
  { id:'rewards',    label:'Rewards',     icon:Icons.rewards,    page:'earn', subNav:{earnTab:'bonuses'} },
  { id:'coupons',    label:'Coupons',     icon:Icons.coupons,    page:'earn', subNav:{earnTab:'coupons'} },
  { id:'bots',       label:'Bots',        icon:Icons.bots,       page:'trade', subNav:{rightTab:'bots'} },
];

const DEFAULT_FAVS = ['deposit','trade','markets','p2p','leaderboard','earn'];

interface Props {
  onNavigate: (p: Page, subNav?: SubNav) => void;
  onShowWallet: () => void;
  onShowAuth: () => void;
}

export function HomePage({ onNavigate, onShowWallet, onShowAuth }: Props) {
  const { user, account } = useAuth();
  const { positions, capital } = useTradingStore();
  const [showAll,       setShowAll]       = useState(false);
  const [favItems,      setFavItems]      = useState<string[]>(DEFAULT_FAVS);
  const [editingFavs,   setEditingFavs]   = useState(false);
  const [ticker,        setTicker]        = useState<{symbol:string;change:number;price:string}[]>([]);
  const tickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch top Solana token prices for ticker
    const load = async () => {
      try {
        const addrs = [
          'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
          'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
          '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
          'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREkzUo8THF',  // MEW
          'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',  // BOME
          'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  // JUP
        ].join(',');
        const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addrs}`);
        if (!r.ok) return;
        const d = await r.json();
        const seen = new Set<string>();
        const items: {symbol:string;change:number;price:string}[] = [];
        for (const p of (d.pairs || [])) {
          const sym = p.baseToken?.symbol?.toUpperCase();
          if (!sym || seen.has(sym)) continue;
          seen.add(sym);
          const pr = parseFloat(p.priceUsd||'0');
          const prStr = pr >= 1 ? `$${pr.toFixed(4)}` : pr >= 0.001 ? `$${pr.toFixed(6)}` : `$${pr.toFixed(9)}`;
          items.push({ symbol:sym, change:parseFloat(p.priceChange?.h24||'0'), price:prStr });
        }
        if (items.length > 0) setTicker(items);
      } catch {}
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  const openPnl = positions.filter(p=>p.status==='open').reduce((s,p)=>s+p.pnl,0);
  const dispCap = account ? (account.use_real ? account.real_balance : account.mock_balance) : capital;
  const pts     = account?.monthly_points ? Object.values(account.monthly_points as Record<string,any>).reduce((s:number,m:any)=>s+(m.points||0),0) : 0;

  const toggleFav = (id: string) => setFavItems(prev => prev.includes(id) ? prev.filter(f=>f!==id) : [...prev,id]);
  const visibleMenu = showAll ? ALL_MENU_ITEMS : ALL_MENU_ITEMS.filter(m => favItems.includes(m.id));

  const handleMenuClick = (item: MenuItem) => {
    if (editingFavs) { toggleFav(item.id); return; }
    if (item.action) { item.action(); return; }
    if (item.id === 'deposit') { onShowWallet(); return; }
    if (item.page) onNavigate(item.page, item.subNav);
  };

  return (
    <div className="overflow-y-auto h-full pb-24 md:pb-4">

      {/* ── Cyberpunk header ───────────────────────────────── */}
      <div className="relative overflow-hidden flex flex-col items-center pt-6 pb-3 px-4"
        style={{background:'linear-gradient(180deg,#030608 0%,transparent 100%)'}}>
        {/* Neon grid lines */}
        <div className="absolute inset-0 pointer-events-none opacity-15" style={{
          backgroundImage:'linear-gradient(rgba(43,255,241,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(43,255,241,0.15) 1px,transparent 1px)',
          backgroundSize:'40px 40px',
        }}/>
        {/* Glow orbs */}
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full opacity-20 pointer-events-none" style={{background:'radial-gradient(ellipse,#2BFFF1,transparent 70%)'}}/>
        
        {/* XENIA text */}
        <div className="relative z-10 text-center mb-1">
          <h1 className="font-black tracking-[0.3em] text-4xl sm:text-5xl uppercase select-none"
            style={{
              color:'transparent',
              backgroundImage:'linear-gradient(180deg,#ffffff 0%,#2BFFF1 50%,#00a8ff 100%)',
              WebkitBackgroundClip:'text',
              backgroundClip:'text',
              textShadow:'0 0 40px rgba(43,255,241,0.4)',
              filter:'drop-shadow(0 0 12px rgba(43,255,241,0.6))',
            }}>
            XENIA
          </h1>
          <p className="text-[10px] tracking-[0.5em] text-[#2BFFF1]/50 uppercase font-semibold mt-0.5">
            TRADING PLATFORM
          </p>
        </div>

        {/* Ticker bar */}
        <div className="relative z-10 w-full mt-3 overflow-hidden h-7 rounded-lg border border-[#2BFFF1]/10 bg-black/30">
          <div ref={tickerRef} className="flex items-center h-full gap-6 px-4 whitespace-nowrap"
            style={{animation: ticker.length > 0 ? 'ticker-scroll 30s linear infinite' : 'none'}}>
            {[...ticker, ...ticker].map((t, i) => (
              <span key={i} className="flex items-center gap-1.5 text-[11px] font-semibold flex-shrink-0">
                <span className="text-[#A7B0B7]">{t.symbol}</span>
                <span className="text-[#6B7280]">{t.price}</span>
                <span className={`font-bold ${t.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {t.change >= 0 ? '▲' : '▼'} {Math.abs(t.change).toFixed(2)}%
                </span>
              </span>
            ))}
            {ticker.length === 0 && (
              <span className="text-[11px] text-[#374151] font-mono">Loading market data…</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Balance hero card ──────────────────────────────── */}
      <div className="mx-4 mt-4 rounded-2xl overflow-hidden relative"
        style={{ background:'linear-gradient(135deg,#0d1a1a 0%,#0a0f1a 50%,#0d0a1a 100%)', border:'1px solid rgba(43,255,241,0.15)' }}>
        <div className="absolute inset-0 opacity-20" style={{ background:'radial-gradient(ellipse at 0% 0%,rgba(43,255,241,0.3),transparent 60%),radial-gradient(ellipse at 100% 100%,rgba(167,139,250,0.3),transparent 60%)' }} />
        <div className="relative p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[11px] text-[#4B5563] uppercase tracking-widest mb-1">
                {user ? `${account?.use_real ? 'Live' : 'Mock'} Balance` : 'Demo Balance'}
              </p>
              <p className="text-3xl font-black text-[#F4F6FA]">${dispCap.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
              <p className={`text-sm mt-1 font-semibold ${openPnl>=0?'text-green-400':'text-red-400'}`}>
                {openPnl>=0?'+':''}${openPnl.toFixed(2)} open P&L
              </p>
            </div>
            <div className="text-right">
              {user ? (
                <div className="flex flex-col items-end gap-2">
                  <span className="text-xs text-[#A7B0B7] font-semibold">{account?.username}</span>
                  <PointsBadge/>
                </div>
              ) : (
                <button onClick={onShowAuth}
                  className="px-4 py-2 rounded-xl bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 text-sm font-bold hover:bg-[#2BFFF1]/25 transition-all">
                  Sign In
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {[
              { label:'Deposit', icon:Icons.deposit, action: user ? onShowWallet : onShowAuth },
              { label:'Withdraw',icon:Icons.withdraw,action: ()=>onNavigate('p2p') },
              { label:'Trade',   icon:Icons.trade,   action: ()=>onNavigate('trade') },
              { label:'Earn',    icon:Icons.earn,    action: ()=>onNavigate('earn') },
            ].map(b => (
              <button key={b.label} onClick={b.action}
                className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.08] transition-all border border-white/[0.06]">
                {b.icon}
                <span className="text-[10px] font-semibold text-[#A7B0B7]">{b.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 mx-4 mt-3">
        {[
          { label:'Open Positions', value:positions.filter(p=>p.status==='open').length.toString() },
          { label:'Monthly Points',  value:pts.toLocaleString() },
          { label:'Closed Trades',  value:positions.filter(p=>p.status!=='open').length.toString() },
        ].map(s=>(
          <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center">
            <p className="text-base font-bold text-[#F4F6FA]">{s.value}</p>
            <p className="text-[10px] text-[#4B5563]">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Quick Access Menu ──────────────────────────────── */}
      <div className="mx-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Quick Access</p>
          <div className="flex items-center gap-3">
            <button onClick={()=>setEditingFavs(!editingFavs)}
              className={`text-[10px] font-semibold transition-colors ${editingFavs?'text-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
              {editingFavs?'✓ Done':'✏️ Edit'}
            </button>
            <button onClick={()=>setShowAll(!showAll)}
              className="text-[10px] font-semibold text-[#4B5563] hover:text-[#A7B0B7] transition-colors">
              {showAll?'Show less ↑':'All →'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {visibleMenu.map(item => (
            <button key={item.id} onClick={()=>handleMenuClick(item)}
              className={`relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all ${
                editingFavs
                  ? favItems.includes(item.id)
                    ? 'border-[#2BFFF1]/40 bg-[#2BFFF1]/08'
                    : 'border-white/[0.07] bg-white/[0.02] opacity-40'
                  : 'border-white/[0.07] bg-white/[0.02] hover:border-[#2BFFF1]/30 hover:bg-[#2BFFF1]/05'
              }`}>
              {editingFavs && favItems.includes(item.id) && (
                <div className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full bg-[#2BFFF1] flex items-center justify-center text-[7px] text-[#05060B] font-black">✓</div>
              )}
              <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center">
                {item.icon}
              </div>
              <span className="text-[10px] font-semibold text-[#A7B0B7] text-center leading-tight">{item.label}</span>
            </button>
          ))}
        </div>
        {editingFavs && <p className="text-[10px] text-[#4B5563] text-center mt-2">Tap to add/remove from favourites</p>}
      </div>

      {/* ── Market preview ─────────────────────────────────── */}
      <div className="mx-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Markets</p>
          <button onClick={()=>onNavigate('markets')} className="text-[10px] text-[#2BFFF1] hover:underline">View all →</button>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
          {[
            {symbol:'SOL',   name:'Solana',        img:'https://assets.coingecko.com/coins/images/4128/small/solana.png',    change:'+4.21%', price:'$145.20',    up:true},
            {symbol:'BONK',  name:'Bonk',           img:'https://assets.coingecko.com/coins/images/28600/small/bonk.jpg',    change:'-2.14%', price:'$0.0000187', up:false},
            {symbol:'WIF',   name:'dogwifhat',      img:'https://assets.coingecko.com/coins/images/33566/small/wif.png',     change:'+8.33%', price:'$1.84',      up:true},
            {symbol:'POPCAT',name:'Popcat',         img:'https://assets.coingecko.com/coins/images/39580/small/popcat.png',  change:'+1.02%', price:'$0.742',     up:true},
          ].map((t,i)=>(
            <button key={t.symbol} onClick={()=>onNavigate('markets')}
              className={`w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.025] transition-all text-left ${i>0?'border-t border-white/[0.04]':''}`}>
              <div className="flex items-center gap-2.5">
                <img src={t.img} alt={t.symbol} className="w-8 h-8 rounded-full object-cover"
                  onError={e=>{(e.target as HTMLImageElement).style.display='none';}}/>
                <div>
                  <p className="text-sm font-semibold text-[#F4F6FA]">{t.symbol}</p>
                  <p className="text-[9px] text-[#374151]">{t.name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-[#F4F6FA]">{t.price}</p>
                <p className={`text-xs ${t.up?'text-green-400':'text-red-400'}`}>{t.change}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Announcement ───────────────────────────────────── */}
      <div className="mx-4 mt-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">📢 Announcements</p>
          <button onClick={()=>onNavigate('discover',{discoverTab:'announcements'})} className="text-[10px] text-[#2BFFF1] hover:underline">View all →</button>
        </div>
        <div className="rounded-2xl border border-[#2BFFF1]/15 bg-[#2BFFF1]/04 p-4 flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">🚀</span>
          <div>
            <p className="text-sm font-bold text-[#F4F6FA] mb-1">Xenia Trading Beta is Live!</p>
            <p className="text-xs text-[#A7B0B7] leading-relaxed">Welcome to the Xenia mock trading platform. Trade, earn points, climb the leaderboard. Real leverage trading launches with the full platform.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
