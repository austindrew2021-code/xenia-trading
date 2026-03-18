import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

interface Props { onClose: () => void; }

export function AuthModal({ onClose }: Props) {
  const { signIn, signUp } = useAuth();
  const [tab, setTab]   = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [pass, setPass]   = useState('');
  const [user, setUser]   = useState('');
  const [err, setErr]     = useState('');
  const [busy, setBusy]   = useState(false);
  const [done, setDone]   = useState(false);

  const submit = async () => {
    setErr(''); setBusy(true);
    if (tab === 'in') {
      const e = await signIn(email, pass);
      if (e) setErr(e); else onClose();
    } else {
      if (!user.trim()) { setErr('Username required'); setBusy(false); return; }
      const e = await signUp(email, pass, user.trim());
      if (e) setErr(e); else setDone(true);
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0B0E14] border border-white/[0.08] rounded-2xl w-[min(92vw,400px)] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-sm"
              style={{ background: 'linear-gradient(135deg,#2BFFF1,#00c4ff)', color: '#05060B' }}>X</div>
            <span className="font-bold text-[#F4F6FA]">Xenia Trading</span>
          </div>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#F4F6FA] text-xl transition-colors">×</button>
        </div>

        {done ? (
          <div className="px-6 py-10 text-center">
            <div className="text-4xl mb-4">🎉</div>
            <p className="text-[#F4F6FA] font-bold mb-1">Account created!</p>
            <p className="text-sm text-[#A7B0B7] mb-6">Check your email to confirm, then sign in.</p>
            <button onClick={() => setTab('in')}
              className="px-6 py-2.5 rounded-xl bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 text-sm font-semibold hover:bg-[#2BFFF1]/25 transition-all">
              Go to Sign In
            </button>
          </div>
        ) : (
          <div className="p-6">
            {/* Tabs */}
            <div className="flex rounded-xl border border-white/[0.07] overflow-hidden mb-5">
              {([['in','Sign In'],['up','Sign Up']] as const).map(([t,l]) => (
                <button key={t} onClick={() => { setTab(t); setErr(''); }}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tab === t ? 'bg-[#2BFFF1]/15 text-[#2BFFF1]' : 'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
                  {l}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {tab === 'up' && (
                <div>
                  <label className="text-[11px] text-[#6B7280] mb-1 block">Username</label>
                  <input placeholder="Your trading username" value={user} onChange={e => setUser(e.target.value)}
                    className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 transition-colors" />
                </div>
              )}
              <div>
                <label className="text-[11px] text-[#6B7280] mb-1 block">Email</label>
                <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 transition-colors" />
              </div>
              <div>
                <label className="text-[11px] text-[#6B7280] mb-1 block">Password</label>
                <input type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  className="w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/40 transition-colors" />
              </div>
            </div>

            {err && (
              <div className="mt-3 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25">
                <p className="text-red-400 text-xs">{err}</p>
              </div>
            )}

            <button onClick={submit} disabled={busy || !email || !pass}
              className="w-full mt-4 py-3 rounded-xl font-bold text-sm transition-all bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25 disabled:opacity-40 disabled:cursor-not-allowed">
              {busy ? '…' : tab === 'in' ? 'Sign In' : 'Create Account'}
            </button>

            {tab === 'in' && (
              <p className="text-center text-[11px] text-[#4B5563] mt-3">
                No account? <button onClick={() => setTab('up')} className="text-[#2BFFF1] hover:underline">Sign up free</button>
              </p>
            )}

            <p className="text-center text-[10px] text-[#374151] mt-4">
              Mock trading only. No real funds at risk unless you deposit.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
