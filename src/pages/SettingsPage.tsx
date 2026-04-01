import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { SecuritySettings } from '../components/SecuritySettings';
import { TouchGrassSettings } from '../components/TouchGrassMode';
import { supabase } from '../lib/supabase';
import { useTradingStore } from '../store';

type SettingsTab = 'account' | 'security' | 'trading' | 'wallet' | 'notifications';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';

const Icon = {
  account:       () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  security:      () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  trading:       () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  wallet:        () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  notifications: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
};

interface Props { onNavigate?: (page: any, sub?: any) => void; }

export function SettingsPage({ onNavigate }: Props) {
  const { user, account, saveAccount, refreshBalance, signOut, liveSOL, liveSOLUSD } = useAuth();
  const { setCapital } = useTradingStore();
  const [tab, setTab]               = useState<SettingsTab>('account');
  const [username, setUsername]     = useState(account?.username ?? '');
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState('');
  const [walletAddr, setWalletAddr] = useState('');
  const [walletLoading, setWalletLoading] = useState(false);
  const [copied, setCopied]         = useState(false);
  const [confirmLiveSwitch, setConfirmLiveSwitch] = useState(false);
  const [toggleSaving, setToggleSaving] = useState(false);

  const PASS_KEY = 'xenia-passphrase-saved';
  const [showPassphrase, setShowPassphrase] = useState(() => !localStorage.getItem(PASS_KEY));
  const [passphraseCopied, setPassphraseCopied] = useState(false);
  const passphrase = (() => {
    if (!user) return '';
    const words = ['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india','juliet','kilo','lima','mike','november','oscar','papa','quebec','romeo','sierra','tango','uniform','victor','whiskey','xray','yankee','zulu','solar','lunar','orbit','nova','pulse','nexus','flux','storm','ridge','amber','comet','drift','ember','frost'];
    const seed = user.id.replace(/-/g, '');
    return Array.from({ length: 12 }, (_, i) => words[parseInt(seed.slice(i * 2, i * 2 + 2) || '0', 16) % words.length]).join(' ');
  })();
  const confirmPassphrase = () => { localStorage.setItem(PASS_KEY, '1'); setShowPassphrase(false); };

  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('xenia-notif-prefs') ?? 'null') ?? { liquidated: true, tpsl: true, trade: true, bot: false, sound: false, price: false, news: true, confirmLev: true, pnlUsd: true }; } catch { return { liquidated: true, tpsl: true, trade: true, bot: false, sound: false, price: false, news: true, confirmLev: true, pnlUsd: true }; }
  });
  const setNotif = (key: string, val: boolean) => { const next = { ...notifPrefs, [key]: val }; setNotifPrefs(next); localStorage.setItem('xenia-notif-prefs', JSON.stringify(next)); };
  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  // Refresh balances on mount
  useEffect(() => { refreshBalance(); }, [refreshBalance]);

  const saveProfile = async () => { setSaving(true); await saveAccount({ username: username.trim() } as any); showMsg('Profile saved'); setSaving(false); };

  // ── Live/Mock Toggle — writes to DB, refreshes balance, syncs store ───
  const handleModeToggle = async (v: boolean) => {
    if (v && !account?.use_real) {
      setConfirmLiveSwitch(true);
      return;
    }
    // Switching to MOCK
    setToggleSaving(true);
    try {
      if (supabase && user) {
        await supabase.from('trading_accounts').update({ use_real: false }).eq('user_id', user.id);
      }
      await saveAccount({ use_real: false } as any);
      await refreshBalance();
      // Sync store capital to mock balance
      const mockBal = account?.mock_balance ?? 0;
      setCapital(mockBal);
      showMsg('Switched to MOCK mode');
    } catch (e: any) { showMsg('Error: ' + (e?.message ?? 'unknown')); }
    setToggleSaving(false);
  };

  const confirmGoLive = async () => {
    setConfirmLiveSwitch(false);
    setToggleSaving(true);
    try {
      if (supabase && user) {
        await supabase.from('trading_accounts').update({ use_real: true }).eq('user_id', user.id);
      }
      await saveAccount({ use_real: true } as any);
      await refreshBalance();
      // Sync store capital to live balance
      const liveBal = liveSOLUSD > 0 ? liveSOLUSD : (account?.real_balance ?? 0);
      setCapital(liveBal);
      showMsg('🔴 LIVE mode enabled — real funds active');
    } catch (e: any) { showMsg('Error: ' + (e?.message ?? 'unknown')); }
    setToggleSaving(false);
  };

  const loadWallet = async () => {
    if (!user) return;
    setWalletLoading(true);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-deposit-wallets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({}),
      });
      const d = await r.json();
      setWalletAddr(d.sol ?? account?.platform_wallet_address ?? account?.deposit_wallets?.sol ?? 'Error');
    } catch { setWalletAddr('Error'); }
    setWalletLoading(false);
  };

  const TABS: { id: SettingsTab; label: string; icon: keyof typeof Icon }[] = [
    { id: 'account', label: 'Account', icon: 'account' },
    { id: 'security', label: 'Security', icon: 'security' },
    { id: 'trading', label: 'Trading', icon: 'trading' },
    { id: 'wallet', label: 'Wallet', icon: 'wallet' },
    { id: 'notifications', label: 'Notifications', icon: 'notifications' },
  ];

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0">
      <span className="text-sm text-[#A7B0B7]">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
  const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
    <button onClick={() => onChange(!on)} className={`relative w-10 h-5 rounded-full transition-all border ${on ? 'bg-[#2BFFF1]/20 border-[#2BFFF1]/40' : 'bg-white/[0.05] border-white/[0.08]'}`}>
      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-all ${on ? 'translate-x-5 bg-[#2BFFF1]' : 'bg-[#374151]'}`}/>
    </button>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-8">

      {/* ── Live-mode confirmation ─────────────────────────────────── */}
      {confirmLiveSwitch && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#F59E0B]/40 bg-[#0D1117] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <h3 className="text-sm font-black text-[#F59E0B]">Enable Live Trading</h3>
            </div>
            <div className="space-y-2 text-xs text-[#A7B0B7]">
              <p>Switching to <strong className="text-[#F4F6FA]">LIVE mode</strong>:</p>
              <div className="pl-3 space-y-1 text-[#6B7280]">
                <p>· Trades use <strong className="text-red-400">real funds</strong></p>
                <p>· Withdrawals send real SOL on-chain</p>
                <p>· Losses are permanent and irreversible</p>
              </div>
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
                <p className="text-red-400 font-semibold text-[10px]">Crypto trading can result in total loss of funds.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmLiveSwitch(false)} className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs font-bold text-[#A7B0B7] hover:text-[#F4F6FA]">Cancel</button>
              <button onClick={confirmGoLive} disabled={toggleSaving} className="flex-1 py-2.5 rounded-xl border border-red-500/40 bg-red-500/15 text-xs font-black text-red-400 hover:bg-red-500/25 disabled:opacity-50">
                {toggleSaving ? 'Switching…' : 'I Understand — Go Live'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Passphrase popup ───────────────────────────────────────── */}
      {showPassphrase && user && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#F59E0B]/30 bg-[#0B0E14] p-6 shadow-2xl space-y-4">
            <h2 className="text-sm font-black text-[#F4F6FA]">Save Your Recovery Passphrase</h2>
            <p className="text-[11px] text-[#6B7280]">Write down these 12 words. This is the <strong className="text-[#F59E0B]">only time</strong> they will be shown.</p>
            <div className="grid grid-cols-3 gap-1.5">
              {passphrase.split(' ').map((w, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-[#05060B] border border-white/[0.06] rounded-lg px-2 py-1.5">
                  <span className="text-[9px] text-[#374151] w-4">{i + 1}.</span>
                  <span className="text-xs font-bold text-[#F4F6FA]">{w}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { navigator.clipboard.writeText(passphrase); setPassphraseCopied(true); setTimeout(() => setPassphraseCopied(false), 2000); }} className="flex-1 py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#A7B0B7]">{passphraseCopied ? '✓ Copied' : 'Copy'}</button>
              <button onClick={confirmPassphrase} className="flex-1 py-2 rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/30 text-xs font-bold text-[#F59E0B]">I've Saved It</button>
            </div>
          </div>
        </div>
      )}

      {msg && <div className="mb-4 px-4 py-2.5 rounded-xl bg-[#2BFFF1]/10 border border-[#2BFFF1]/20 text-xs font-semibold text-[#2BFFF1]">{msg}</div>}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-black text-[#F4F6FA]">Settings</h1>
          <p className="text-xs text-[#4B5563] mt-0.5">{user?.email ?? 'Not signed in'}</p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${tab === t.id ? 'bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25' : 'border border-white/[0.07] text-[#4B5563] hover:text-[#A7B0B7]'}`}>
            <span className="opacity-60" style={{ color: tab === t.id ? '#2BFFF1' : '#4B5563' }}>{Icon[t.icon]()}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Account ──────────────────────────────────────────────── */}
      {tab === 'account' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-4">
            <h2 className="text-sm font-bold text-[#F4F6FA]">Profile</h2>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-[#4B5563] mb-1 block font-semibold uppercase tracking-wide">Username</label>
                <input value={username} onChange={e => setUsername(e.target.value)} className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40"/>
              </div>
              <div>
                <label className="text-[10px] text-[#4B5563] mb-1 block font-semibold uppercase tracking-wide">Email</label>
                <input value={user?.email ?? ''} disabled className="w-full bg-[#05060B] border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm text-[#4B5563] cursor-not-allowed"/>
              </div>
              <button onClick={saveProfile} disabled={saving} className="px-5 py-2.5 rounded-xl bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 text-sm font-bold hover:bg-[#2BFFF1]/25 disabled:opacity-50">{saving ? 'Saving…' : 'Save Profile'}</button>
            </div>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
            <h2 className="text-sm font-bold text-[#F4F6FA] mb-3">Overview</h2>
            <div className="space-y-0">
              <Row label="Live Balance"><span className="text-sm font-mono font-bold text-[#F4F6FA]">${liveSOLUSD > 0 ? liveSOLUSD.toFixed(2) : (account?.real_balance ?? 0).toFixed(2)}</span></Row>
              <Row label="Mock Balance"><span className="text-sm font-mono font-bold text-[#F4F6FA]">${(account?.mock_balance ?? 0).toFixed(2)}</span></Row>
              <Row label="Mode"><span className={`text-sm font-bold ${account?.use_real ? 'text-[#2BFFF1]' : 'text-[#6B7280]'}`}>{account?.use_real ? '🔴 LIVE' : '📌 Mock'}</span></Row>
              <Row label="Member Since"><span className="text-xs text-[#6B7280]">{user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span></Row>
            </div>
          </div>
          <div className="rounded-2xl border border-red-500/20 bg-red-500/05 p-5">
            <h2 className="text-sm font-bold text-red-400 mb-1">Danger Zone</h2>
            <p className="text-xs text-[#4B5563] mb-3">Signing out clears your local session.</p>
            <button onClick={() => signOut()} className="px-5 py-2.5 rounded-xl text-sm font-bold text-red-400 border border-red-500/25 hover:bg-red-500/10">Sign Out</button>
          </div>
        </div>
      )}

      {/* ── Security ─────────────────────────────────────────────── */}
      {tab === 'security' && <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden"><SecuritySettings/></div>}

      {/* ── Trading ──────────────────────────────────────────────── */}
      {tab === 'trading' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
            <h2 className="text-sm font-bold text-[#F4F6FA] mb-3">Trading Mode</h2>
            <div className="space-y-0">
              <Row label="Default Mode">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-xl border ${account?.use_real ? 'text-[#2BFFF1] border-[#2BFFF1]/30 bg-[#2BFFF1]/10' : 'text-[#6B7280] border-white/[0.08]'}`}>
                    {toggleSaving ? '…' : account?.use_real ? 'LIVE' : 'MOCK'}
                  </span>
                  <Toggle on={account?.use_real ?? false} onChange={handleModeToggle}/>
                </div>
              </Row>

              {account?.use_real && liveSOLUSD === 0 && (
                <div className="rounded-xl bg-[#F59E0B]/08 border border-[#F59E0B]/20 px-3 py-2 mt-1">
                  <p className="text-[10px] text-[#F59E0B]">Live mode active but balance is $0. Deposit funds first.</p>
                </div>
              )}
              {account?.use_real && liveSOLUSD > 0 && (
                <div className="rounded-xl bg-green-500/08 border border-green-500/20 px-3 py-2 mt-1">
                  <p className="text-[10px] text-green-400">🔴 Live · {liveSOL.toFixed(4)} SOL = ${liveSOLUSD.toFixed(2)}</p>
                </div>
              )}

              <Row label="Confirm high leverage"><Toggle on={notifPrefs.confirmLev ?? true} onChange={v => setNotif('confirmLev', v)}/></Row>
              <Row label="Show P&L in USD"><Toggle on={notifPrefs.pnlUsd ?? true} onChange={v => setNotif('pnlUsd', v)}/></Row>
              <Row label="Sound alerts"><Toggle on={notifPrefs.sound ?? false} onChange={v => setNotif('sound', v)}/></Row>
            </div>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
            <h2 className="text-sm font-bold text-[#F4F6FA] mb-1">Touch Grass Mode</h2>
            <p className="text-xs text-[#4B5563] mb-3">Auto-intervention on losing streaks.</p>
            <TouchGrassSettings/>
          </div>
        </div>
      )}

      {/* ── Wallet ───────────────────────────────────────────────── */}
      {tab === 'wallet' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-[#F4F6FA]">Platform Wallet</h2>
                <p className="text-xs text-[#4B5563]">Solana deposit address</p>
              </div>
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Auto-created</span>
            </div>
            {!walletAddr ? (
              <button onClick={loadWallet} disabled={walletLoading} className="w-full py-2.5 rounded-xl border border-[#2BFFF1]/25 text-[#2BFFF1] text-sm font-bold hover:bg-[#2BFFF1]/10 disabled:opacity-50">
                {walletLoading ? <span className="flex items-center justify-center gap-2"><div className="w-3 h-3 border border-[#2BFFF1]/30 border-t-[#2BFFF1] rounded-full animate-spin"/>Loading…</span> : 'View Wallet Address'}
              </button>
            ) : (
              <div className="space-y-2">
                <div className="bg-[#05060B] border border-white/[0.06] rounded-xl p-3"><p className="font-mono text-xs text-[#2BFFF1] break-all">{walletAddr}</p></div>
                <button onClick={() => { navigator.clipboard.writeText(walletAddr); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="w-full py-2 rounded-xl border border-white/[0.08] text-xs font-bold text-[#A7B0B7] hover:text-[#F4F6FA]">{copied ? '✓ Copied' : 'Copy Address'}</button>
                <p className="text-[9px] text-[#374151]">Send SOL to fund your account. Deposits auto-detected.</p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-[#F4F6FA]">Balances</h2>
              <button onClick={refreshBalance} className="text-[10px] text-[#4B5563] hover:text-[#2BFFF1] flex items-center gap-1">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Refresh
              </button>
            </div>
            <div className="space-y-0">
              {[
                ['On-chain SOL', liveSOL > 0 ? `${liveSOL.toFixed(4)} SOL ($${liveSOLUSD.toFixed(2)})` : '$0.00'],
                ['Funding / Leverage', `$${(liveSOLUSD > 0 ? liveSOLUSD : (account?.real_balance ?? 0)).toFixed(2)}`],
                ['Spot (Live)', `$${(account?.spot_live_balance ?? 0).toFixed(2)}`],
                ['Bots (Live)', `$${(account?.bot_balance ?? 0).toFixed(2)}`],
                ['Mock Trading', `$${(account?.mock_balance ?? 0).toFixed(2)}`],
                ['Bots (Mock)', `$${(account?.bot_mock_balance ?? 0).toFixed(2)}`],
                ['Mode', account?.use_real ? '🔴 Live' : '📌 Mock'],
              ].map(([l, v]) => (
                <Row key={l} label={l as string}><span className="text-sm font-mono font-bold text-[#F4F6FA]">{v}</span></Row>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Notifications ─────────────────────────────────────────── */}
      {tab === 'notifications' && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <h2 className="text-sm font-bold text-[#F4F6FA] mb-3">Notifications</h2>
          <div className="space-y-0">
            <Row label="Position liquidated"><Toggle on={notifPrefs.liquidated ?? true} onChange={v => setNotif('liquidated', v)}/></Row>
            <Row label="TP/SL triggered"><Toggle on={notifPrefs.tpsl ?? true} onChange={v => setNotif('tpsl', v)}/></Row>
            <Row label="Trade executed"><Toggle on={notifPrefs.trade ?? true} onChange={v => setNotif('trade', v)}/></Row>
            <Row label="Bot signal"><Toggle on={notifPrefs.bot ?? false} onChange={v => setNotif('bot', v)}/></Row>
            <Row label="Price alert"><Toggle on={notifPrefs.price ?? false} onChange={v => setNotif('price', v)}/></Row>
            <Row label="News"><Toggle on={notifPrefs.news ?? true} onChange={v => setNotif('news', v)}/></Row>
          </div>
        </div>
      )}
    </div>
  );
}
