import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTradingStore } from '../store';
import { PointsBadge } from '../components/PointsLeaderboard';

type Page = 'trade' | 'markets' | 'p2p' | 'earn' | 'discover' | 'home';

interface MenuItem { id:string; icon:string; label:string; badge?:string; page?:Page; action?:()=>void; fav?:boolean; }
interface Props { onNavigate:(p:Page)=>void; onShowWallet:()=>void; onShowAuth:()=>void; }

const ALL_MENU_ITEMS: MenuItem[] = [
  { id:'deposit',    icon:'💳', label:'Deposit',      page:'earn' },
  { id:'withdraw',   icon:'📤', label:'Withdraw',     page:'p2p' },
  { id:'p2p',        icon:'🔄', label:'P2P',          page:'p2p' },
  { id:'trade',      icon:'📊', label:'Trade',        page:'trade' },
  { id:'markets',    icon:'🔍', label:'Markets',      page:'markets' },
  { id:'earn',       icon:'💎', label:'Earn',         page:'earn' },
  { id:'staking',    icon:'🏦', label:'Staking',      page:'earn' },
  { id:'referral',   icon:'👥', label:'Referrals',    page:'earn' },
  { id:'leaderboard',icon:'🏆', label:'Leaderboard',  page:'trade' },
  { id:'discover',   icon:'🌐', label:'Discover',     page:'discover' },
  { id:'events',     icon:'🎯', label:'Events',       page:'discover' },
  { id:'news',       icon:'📰', label:'News',         page:'discover' },
  { id:'rewards',    icon:'🎁', label:'Rewards',      page:'earn' },
  { id:'coupons',    icon:'🏷️', label:'Coupons',      page:'earn' },
  { id:'bots',       icon:'🤖', label:'Bots',         page:'trade' },
];

const DEFAULT_FAVS = ['deposit','trade','markets','p2p','leaderboard','earn'];

export function HomePage({ onNavigate, onShowWallet, onShowAuth }: Props) {
  const { user, account } = useAuth();
  const { positions, capital } = useTradingStore();
  const [showAll, setShowAll]           = useState(false);
  const [favItems, setFavItems]         = useState<string[]>(DEFAULT_FAVS);
  const [editingFavs, setEditingFavs]   = useState(false);

  const openPnl  = positions.filter(p=>p.status==='open').reduce((s,p)=>s+p.pnl,0);
  const dispCap  = account ? (account.use_real ? account.real_balance : account.mock_balance) : capital;
  const pts      = account?.monthly_points ? Object.values(account.monthly_points).reduce((s:number,m:any)=>s+(m.points||0),0) : 0;

  const toggleFav = (id: string) => {
    setFavItems(prev => prev.includes(id) ? prev.filter(f=>f!==id) : [...prev, id]);
  };

  const visibleMenu = showAll ? ALL_MENU_ITEMS : ALL_MENU_ITEMS.filter(m => favItems.includes(m.id));

  return (
    <div className="overflow-y-auto h-full pb-24 md:pb-4">
      {/* ── Hero balance card ──────────────────────────────────── */}
      <div className="mx-4 mt-4 rounded-2xl overflow-hidden relative"
        style={{ background:'linear-gradient(135deg,#0d1a1a 0%,#0a0f1a 50%,#0d0a1a 100%)', border:'1px solid rgba(43,255,241,0.15)' }}>
        <div className="absolute inset-0 opacity-20"
          style={{ background:'radial-gradient(ellipse at 0% 0%,rgba(43,255,241,0.3),transparent 60%),radial-gradient(ellipse at 100% 100%,rgba(167,139,250,0.3),transparent 60%)' }} />
        <div className="relative p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[11px] text-[#4B5563] uppercase tracking-widest mb-1">
                {user ? `${account?.use_real ? 'Real' : 'Mock'} Balance` : 'Demo Balance'}
              </p>
              <p className="text-3xl font-black text-[#F4F6FA]">${dispCap.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
              <p className={`text-sm mt-1 font-semibold ${openPnl>=0?'text-green-400':'text-red-400'}`}>
                {openPnl>=0?'+':''}${openPnl.toFixed(2)} open P&L
              </p>
            </div>
            <div className="text-right">
              {user ? (
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs text-[#A7B0B7] font-semibold">{account?.username}</span>
                  <PointsBadge />
                </div>
              ) : (
                <button onClick={onShowAuth}
                  className="px-4 py-2 rounded-xl bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 text-sm font-bold hover:bg-[#2BFFF1]/25 transition-all">
                  Sign In
                </button>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2">
            {[
              { label:'Deposit', icon:'📥', action: user ? onShowWallet : onShowAuth },
              { label:'Withdraw', icon:'📤', action: () => onNavigate('p2p') },
              { label:'Trade', icon:'📊', action: () => onNavigate('trade') },
              { label:'Earn', icon:'💎', action: () => onNavigate('earn') },
            ].map(b => (
              <button key={b.label} onClick={b.action}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.08] transition-all border border-white/[0.06]">
                <span className="text-lg">{b.icon}</span>
                <span className="text-[10px] font-semibold text-[#A7B0B7]">{b.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Stats row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 mx-4 mt-3">
        {[
          { label:'Open Positions', value:positions.filter(p=>p.status==='open').length.toString() },
          { label:'Monthly Points',  value:pts.toLocaleString() },
          { label:'Closed Trades',  value:positions.filter(p=>p.status!=='open').length.toString() },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center">
            <p className="text-base font-bold text-[#F4F6FA]">{s.value}</p>
            <p className="text-[10px] text-[#4B5563]">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Quick Access Menu ─────────────────────────────────── */}
      <div className="mx-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Quick Access</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditingFavs(!editingFavs)}
              className={`text-[10px] font-semibold transition-colors ${editingFavs?'text-[#2BFFF1]':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
              {editingFavs ? '✓ Done' : '✏️ Edit'}
            </button>
            <button onClick={() => setShowAll(!showAll)}
              className="text-[10px] font-semibold text-[#4B5563] hover:text-[#A7B0B7] transition-colors">
              {showAll ? 'Less ↑' : 'All →'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {visibleMenu.map(item => (
            <button key={item.id}
              onClick={() => editingFavs ? toggleFav(item.id) : (item.action ? item.action() : item.page && onNavigate(item.page!))}
              className={`relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all ${
                editingFavs
                  ? favItems.includes(item.id)
                    ? 'border-[#2BFFF1]/40 bg-[#2BFFF1]/08'
                    : 'border-white/[0.07] bg-white/[0.02] opacity-50'
                  : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]'
              }`}>
              {editingFavs && favItems.includes(item.id) && (
                <div className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full bg-[#2BFFF1] flex items-center justify-center text-[7px] text-[#05060B] font-black">✓</div>
              )}
              <span className="text-xl">{item.icon}</span>
              <span className="text-[10px] font-semibold text-[#A7B0B7] text-center leading-tight">{item.label}</span>
              {item.badge && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold">{item.badge}</span>}
            </button>
          ))}
        </div>

        {editingFavs && (
          <p className="text-[10px] text-[#4B5563] text-center mt-2">Tap items to add/remove from favourites</p>
        )}
      </div>

      {/* ── Market preview ───────────────────────────────────── */}
      <div className="mx-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">Markets</p>
          <button onClick={() => onNavigate('markets')} className="text-[10px] text-[#2BFFF1] hover:underline">View all →</button>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
          {[
            { symbol:'SOL', change:'+4.21%', price:'$145.20', up:true },
            { symbol:'BONK', change:'-2.14%', price:'$0.0000187', up:false },
            { symbol:'WIF', change:'+8.33%', price:'$1.84', up:true },
            { symbol:'POPCAT', change:'+1.02%', price:'$0.742', up:true },
          ].map((t,i) => (
            <button key={t.symbol} onClick={() => onNavigate('markets')}
              className={`w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.025] transition-all text-left ${i>0?'border-t border-white/[0.04]':''}`}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#2BFFF1]/10 flex items-center justify-center text-xs font-black text-[#2BFFF1]">{t.symbol[0]}</div>
                <span className="text-sm font-semibold text-[#F4F6FA]">{t.symbol}</span>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-[#F4F6FA]">{t.price}</p>
                <p className={`text-xs ${t.up?'text-green-400':'text-red-400'}`}>{t.change}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Announcements preview ─────────────────────────────── */}
      <div className="mx-4 mt-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[#A7B0B7] uppercase tracking-widest">📢 Announcements</p>
          <button onClick={() => onNavigate('discover')} className="text-[10px] text-[#2BFFF1] hover:underline">View all →</button>
        </div>
        <div className="rounded-2xl border border-[#2BFFF1]/15 bg-[#2BFFF1]/04 p-4">
          <div className="flex items-start gap-3">
            <span className="text-xl flex-shrink-0">🚀</span>
            <div>
              <p className="text-sm font-bold text-[#F4F6FA] mb-1">Xenia Trading Beta is Live!</p>
              <p className="text-xs text-[#A7B0B7] leading-relaxed">Welcome to the Xenia mock trading platform. Trade with confidence, earn points, and climb the leaderboard. Real leverage trading launches with the full platform.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
