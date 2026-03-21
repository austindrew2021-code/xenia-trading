import { SecuritySettings } from '../components/SecuritySettings';
import { useState } from 'react';

type EarnTab = 'staking' | 'mining' | 'bonuses' | 'coupons' | 'referrals' | 'security';

const STAKING_POOLS = [
  { name:'XEN Flex',   apy:12.5,  lock:'No lock',    min:'100 XEN',  badge:'',        color:'#2BFFF1' },
  { name:'XEN 30d',    apy:22.0,  lock:'30 days',    min:'500 XEN',  badge:'Popular', color:'#A78BFA' },
  { name:'XEN 90d',    apy:38.5,  lock:'90 days',    min:'1,000 XEN',badge:'Best APY',color:'#F59E0B' },
  { name:'SOL Pool',   apy:8.2,   lock:'7 days',     min:'1 SOL',    badge:'',        color:'#9945FF' },
  { name:'USDC Earn',  apy:6.5,   lock:'No lock',    min:'$50',      badge:'Stable',  color:'#4ADE80' },
];

const BONUSES = [
  { title:'First Trade Bonus',    desc:'Complete your first trade and earn 500 XEN',              reward:'500 XEN',    done:false },
  { title:'Volume Milestone $1K', desc:'Trade $1,000 notional volume in a single month',          reward:'1,000 XEN',  done:false },
  { title:'Referral Bonus',       desc:'Invite a friend who completes their first trade',         reward:'250 XEN',    done:false },
  { title:'Top 10 Leaderboard',   desc:'Finish in the top 10 of the monthly volume rankings',    reward:'5,000 XEN',  done:false },
  { title:'Account Verified',     desc:'Complete profile and connect a wallet',                   reward:'100 XEN',    done:false },
];

const COUPONS = [
  { code:'LAUNCH25',  desc:'25% fee discount — first month',     expiry:'Launch offer', type:'Fee Discount' },
  { code:'XENIA10',   desc:'$10 in mock balance for new accounts',expiry:'Ongoing',     type:'Balance Boost' },
  { code:'DEGEN50',   desc:'50% off all trading fees for 7 days', expiry:'Limited',     type:'Fee Discount' },
];

export function EarnPage() {
  const [tab, setTab] = useState<EarnTab>('staking');
  const [refCopied, setRefCopied] = useState(false);
  const refLink = 'https://trading.xeniachain.com?ref=XENIA123';

  const tabs: { id: EarnTab; label: string; icon: string }[] = [
    { id:'staking',   label:'Staking',   icon:'💎' },
    { id:'mining',    label:'Mining',    icon:'⛏️' },
    { id:'bonuses',   label:'Bonuses',   icon:'🎁' },
    { id:'coupons',   label:'Coupons',   icon:'🏷️' },
    { id:'referrals', label:'Referrals', icon:'👥' },
    { id:'security',   label:'Security',   icon:'🔐' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-24 md:pb-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#F4F6FA] mb-1">Earn</h1>
        <p className="text-sm text-[#A7B0B7]">Stake, mine, and earn rewards on the Xenia platform.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${tab === t.id ? 'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25' : 'border border-white/[0.07] text-[#4B5563] hover:text-[#A7B0B7] bg-white/[0.02]'}`}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Staking */}
      {tab === 'staking' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[['Total Staked','—'],['Your Stake','—'],['Est. Monthly','—']].map(([l,v]) => (
              <div key={l} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center">
                <p className="text-[10px] text-[#4B5563] mb-1">{l}</p>
                <p className="text-base font-bold text-[#F4F6FA]">{v}</p>
              </div>
            ))}
          </div>
          {STAKING_POOLS.map((p, i) => (
            <div key={i} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 hover:border-white/[0.12] transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm"
                    style={{ background: p.color + '20', color: p.color }}>
                    {p.name[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#F4F6FA]">{p.name}</span>
                      {p.badge && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: p.color+'20', color: p.color, border:`1px solid ${p.color}40` }}>{p.badge}</span>}
                    </div>
                    <p className="text-[11px] text-[#6B7280]">{p.lock} · Min {p.min}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black" style={{ color: p.color }}>{p.apy}%</p>
                  <p className="text-[10px] text-[#4B5563]">APY</p>
                </div>
              </div>
              <button className="w-full mt-3 py-2.5 rounded-xl text-xs font-bold border transition-all"
                style={{ color: p.color, borderColor: p.color+'40', background: p.color+'10' }}>
                Stake — Coming at Launch
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mining */}
      {tab === 'mining' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#F59E0B]/20 bg-[#F59E0B]/05 p-6 text-center">
            <div className="text-5xl mb-3">⛏️</div>
            <h2 className="text-lg font-bold text-[#F4F6FA] mb-2">Liquidity Mining</h2>
            <p className="text-sm text-[#A7B0B7] mb-4 max-w-md mx-auto">Provide liquidity to Xenia pools and earn XEN rewards proportional to your share. Mining rewards launch alongside the trading platform.</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[['Est. APR','Up to 85%'],['Reward Token','XEN'],['Launch','TBA']].map(([l,v]) => (
                <div key={l} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[10px] text-[#4B5563] mb-0.5">{l}</p>
                  <p className="text-sm font-bold text-[#F59E0B]">{v}</p>
                </div>
              ))}
            </div>
            <button className="px-6 py-3 rounded-xl border border-[#F59E0B]/30 text-[#F59E0B] font-bold text-sm bg-[#F59E0B]/10 hover:bg-[#F59E0B]/20 transition-all">
              Get Notified at Launch
            </button>
          </div>
        </div>
      )}

      {/* Bonuses */}
      {tab === 'bonuses' && (
        <div className="space-y-3">
          {BONUSES.map((b, i) => (
            <div key={i} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${b.done ? 'bg-green-500/20' : 'bg-white/[0.04]'}`}>
                {b.done ? '✅' : '🎁'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-[#F4F6FA]">{b.title}</p>
                <p className="text-[11px] text-[#6B7280] mt-0.5">{b.desc}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-[#2BFFF1]">{b.reward}</p>
                <p className="text-[9px] text-[#4B5563]">{b.done ? 'Claimed' : 'Available'}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Coupons */}
      {tab === 'coupons' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 mb-4">
            <div className="flex gap-2">
              <input placeholder="Enter coupon code…" className="flex-1 bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40" />
              <button className="px-4 py-2.5 rounded-xl bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 text-sm font-bold hover:bg-[#2BFFF1]/25 transition-all">Apply</button>
            </div>
          </div>
          {COUPONS.map((c, i) => (
            <div key={i} className="rounded-2xl border border-dashed border-[#2BFFF1]/25 bg-[#2BFFF1]/05 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono font-black text-[#2BFFF1] text-base tracking-widest">{c.code}</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full border border-[#2BFFF1]/25 text-[#2BFFF1]">{c.type}</span>
              </div>
              <p className="text-sm text-[#A7B0B7] mb-1">{c.desc}</p>
              <p className="text-[10px] text-[#4B5563]">Expires: {c.expiry}</p>
            </div>
          ))}
        </div>
      )}

      {/* Referrals */}
      {tab === 'referrals' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[['Referrals','0'],['Earned','0 XEN'],['Pending','0 XEN']].map(([l,v]) => (
              <div key={l} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center">
                <p className="text-[10px] text-[#4B5563] mb-1">{l}</p>
                <p className="text-base font-bold text-[#F4F6FA]">{v}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
            <h3 className="font-bold text-[#F4F6FA] mb-1">Your Referral Link</h3>
            <p className="text-xs text-[#6B7280] mb-4">Earn 250 XEN for every friend who signs up and completes their first trade.</p>
            <div className="flex gap-2">
              <div className="flex-1 bg-[#0B0E14] border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-[#6B7280] font-mono truncate">
                {refLink}
              </div>
              <button onClick={() => { navigator.clipboard.writeText(refLink); setRefCopied(true); setTimeout(() => setRefCopied(false), 1500); }}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${refCopied ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-[#2BFFF1]/15 text-[#2BFFF1] border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25'}`}>
                {refCopied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
            <h3 className="font-bold text-[#F4F6FA] mb-3">How it works</h3>
            <div className="space-y-3">
              {[
                ['1','Share your referral link with friends'],
                ['2','They sign up and complete their first trade'],
                ['3','You both receive 250 XEN bonus instantly'],
                ['4','Earn 10% of their trading fees forever'],
              ].map(([n,t]) => (
                <div key={n} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#2BFFF1]/15 text-[#2BFFF1] flex items-center justify-center text-xs font-bold flex-shrink-0">{n}</div>
                  <p className="text-sm text-[#A7B0B7]">{t}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Security */}
      {tab === 'security' && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
          <SecuritySettings />
        </div>
      )}
    </div>
  );
}
