import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

const SUPABASE_URL = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL || 'https://ofjuiciwmwahdwdagzsj.supabase.co';

interface Props { onClose: () => void; }

// ── Passphrase display shown after signup ─────────────────────────────────
function PassphraseModal({ mnemonic, solAddress, onClose }: { mnemonic: string; solAddress: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const words = mnemonic.split(' ');

  const copy = () => {
    navigator.clipboard.writeText(`Xenia Wallet\nAddress: ${solAddress}\nRecovery Phrase: ${mnemonic}`);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
      <div className="bg-[#0B0E14] border border-[#F59E0B]/30 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#F59E0B]/20 border border-[#F59E0B]/30 flex items-center justify-center text-xl">🔑</div>
          <div>
            <p className="text-sm font-black text-[#F4F6FA]">Save Your Recovery Phrase</p>
            <p className="text-[10px] text-[#F59E0B]/80">This is shown once — never again</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="rounded-xl border border-red-500/25 bg-red-500/05 px-4 py-3">
            <p className="text-xs text-red-400 font-semibold">⚠️ Never share this with anyone. Store it offline. It grants full access to your wallet.</p>
          </div>

          {/* Wallet address */}
          <div className="rounded-xl bg-[#05060B] border border-white/[0.06] px-3 py-2">
            <p className="text-[9px] text-[#4B5563] mb-0.5">Your Xenia Wallet Address (SOL)</p>
            <p className="font-mono text-[10px] text-[#2BFFF1] break-all">{solAddress}</p>
          </div>

          {/* Passphrase grid */}
          <div>
            <p className="text-[10px] text-[#4B5563] mb-2 font-semibold uppercase tracking-wide">12-Word Recovery Phrase</p>
            <div className="grid grid-cols-3 gap-1.5">
              {words.map((w, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-[#05060B] border border-white/[0.06] rounded-lg px-2 py-1.5">
                  <span className="text-[9px] text-[#374151] w-4">{i+1}.</span>
                  <span className="text-xs font-bold text-[#F4F6FA]">{w}</span>
                </div>
              ))}
            </div>
          </div>

          <button onClick={copy} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#2BFFF1]/25 text-[#2BFFF1] text-sm font-semibold hover:bg-[#2BFFF1]/10 transition-all">
            {copied ? '✓ Copied to clipboard' : '📋 Copy phrase + address'}
          </button>

          <div className="flex items-start gap-2.5 p-3 rounded-xl border border-white/[0.06]">
            <input type="checkbox" id="confirm-saved" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#2BFFF1] cursor-pointer"/>
            <label htmlFor="confirm-saved" className="text-xs text-[#A7B0B7] cursor-pointer leading-relaxed">
              I have securely saved my recovery phrase and wallet address. I understand this cannot be recovered if lost.
            </label>
          </div>

          <button onClick={onClose} disabled={!confirmed}
            className="w-full py-3.5 rounded-xl text-sm font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/25">
            ✓ I've saved it — Continue to Platform
          </button>
        </div>
      </div>
    </div>
  );
}

export function AuthModal({ onClose }: Props) {
  const { signIn, signUp } = useAuth();
  const [tab,   setTab]   = useState<'in'|'up'>('in');
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [pass2, setPass2] = useState('');
  const [user,  setUser]  = useState('');
  const [err,   setErr]   = useState('');
  const [busy,  setBusy]  = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [walletData, setWalletData] = useState<{ mnemonic: string; sol: string } | null>(null);

  const tryBiometric = async () => {
    setErr(''); setBusy(true);
    const credId = localStorage.getItem('xenia-biometric-cred');
    if (!credId) { setErr('No biometric enrolled. Sign in with password first, then enable it in Settings.'); setBusy(false); return; }
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: Uint8Array.from(atob(credId), c => c.charCodeAt(0)), type: 'public-key' }],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      if (assertion) {
        // Biometric passed — sign in with stored email/pass from secure storage
        const storedEmail = localStorage.getItem('xenia-bio-email') ?? '';
        const storedPass  = localStorage.getItem('xenia-bio-pass') ?? '';
        if (storedEmail && storedPass) {
          const e = await signIn(storedEmail, storedPass);
          if (e) setErr(e); else onClose();
        } else {
          setErr('Biometric credential found but no stored login. Sign in with password once.');
        }
      }
    } catch (bioErr: any) {
      if (bioErr.name === 'NotAllowedError') setErr('Biometric authentication was cancelled.');
      else setErr('Biometric failed: ' + (bioErr.message ?? 'Unknown error'));
    }
    setBusy(false);
  };

  // After successful password sign-in, store credentials for biometric use
  const storeForBiometric = (e: string, p: string) => {
    localStorage.setItem('xenia-bio-email', e);
    localStorage.setItem('xenia-bio-pass', p);
  };

  const biometricAvailable = typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
  const biometricEnrolled  = typeof window !== 'undefined' && !!localStorage.getItem('xenia-biometric-cred');

  const submit = async () => {
    setErr(''); setBusy(true);
    if (tab === 'in') {
      const e = await signIn(email, pass);
      if (e) setErr(e);
      else {
        storeForBiometric(email, pass); // store for future biometric use
        onClose();
      }
    } else {
      if (!user.trim())       { setErr('Username required'); setBusy(false); return; }
      if (pass.length < 8)    { setErr('Password must be at least 8 characters'); setBusy(false); return; }
      if (pass !== pass2)     { setErr('Passwords do not match'); setBusy(false); return; }

      const e = await signUp(email, pass, user.trim());
      if (e) { setErr(e); setBusy(false); return; }

      // Auto sign in then generate wallet
      const signInErr = await signIn(email, pass);
      if (!signInErr) {
        // Generate deposit wallet and get mnemonic
        try {
          const { supabase } = await import('../lib/supabase');
          const { data: { session } } = await supabase!.auth.getSession();
          if (session?.access_token) {
            const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-deposit-wallets`, {
              method: 'POST',
              headers: { 'Content-Type':'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({}),
            });
            const d = await r.json();
            if (d.mnemonic && d.sol) {
              setWalletData({ mnemonic: d.mnemonic, sol: d.sol });
              setBusy(false);
              return; // Show passphrase modal before closing
            }
          }
        } catch (walletErr) {
          console.warn('Wallet generation failed:', walletErr);
        }
        onClose();
      } else {
        // Sign up succeeded but sign in failed — email confirmation needed
        setErr('');
        setBusy(false);
        setTab('confirm' as any);
        return;
      }
    }
    setBusy(false);
  };

  const inputClass = "w-full bg-[#05060B] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-[#F4F6FA] outline-none focus:border-[#2BFFF1]/50 transition-all placeholder-[#2D3748]";

  // Show passphrase modal after signup
  if (walletData) {
    return <PassphraseModal mnemonic={walletData.mnemonic} solAddress={walletData.sol} onClose={onClose}/>;
  }

  // Email confirmation screen
  if ((tab as any) === 'confirm') {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="bg-[#0B0E14] border border-white/[0.08] rounded-2xl w-full max-w-sm shadow-2xl p-8 text-center">
          <div className="text-4xl mb-4">📧</div>
          <p className="text-[#F4F6FA] font-bold mb-2">Check your email</p>
          <p className="text-sm text-[#A7B0B7] mb-6">We sent a confirmation link to <span className="text-[#2BFFF1]">{email}</span>. Click it to activate your account, then sign in.</p>
          <button onClick={() => setTab('in')} className="px-6 py-2.5 rounded-xl bg-[#2BFFF1]/15 text-[#2BFFF1] border border-[#2BFFF1]/25 text-sm font-semibold hover:bg-[#2BFFF1]/25 transition-all">Go to Sign In</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="bg-[#0B0E14] border border-white/[0.08] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm" style={{ background:'linear-gradient(135deg,#2BFFF1,#00c4ff)', color:'#05060B' }}>X</div>
            <div><p className="font-black text-[#F4F6FA] text-sm">Xenia Trading</p><p className="text-[9px] text-[#374151]">Professional memecoin trading</p></div>
          </div>
          <button onClick={onClose} className="text-[#4B5563] hover:text-[#F4F6FA] text-xl transition-colors leading-none">×</button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-white/[0.06]">
          {(['in','up'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setErr(''); }} className={`flex-1 py-3 text-sm font-bold transition-all ${tab===t?'text-[#2BFFF1] border-b-2 border-[#2BFFF1] -mb-px':'text-[#4B5563] hover:text-[#A7B0B7]'}`}>
              {t==='in'?'Sign In':'Create Account'}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-3">
          {tab==='up' && (
            <div>
              <label className="text-[10px] text-[#4B5563] mb-1 block">Username</label>
              <input value={user} onChange={e=>setUser(e.target.value)} placeholder="Pick a username" className={inputClass}/>
            </div>
          )}

          <div>
            <label className="text-[10px] text-[#4B5563] mb-1 block">Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="your@email.com" className={inputClass}/>
          </div>

          <div>
            <label className="text-[10px] text-[#4B5563] mb-1 block">Password</label>
            <div className="relative">
              <input type={showPass?'text':'password'} value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder={tab==='up'?'Min 8 characters':'Enter password'} className={inputClass + ' pr-10'}/>
              <button type="button" onClick={()=>setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4B5563] hover:text-[#A7B0B7] text-xs">
                {showPass?'Hide':'Show'}
              </button>
            </div>
          </div>

          {tab==='up' && (
            <div>
              <label className="text-[10px] text-[#4B5563] mb-1 block">Confirm Password</label>
              <input type="password" value={pass2} onChange={e=>setPass2(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="Repeat password" className={inputClass}/>
            </div>
          )}

          {err && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5">
              <p className="text-xs text-red-400 font-semibold">❌ {err}</p>
            </div>
          )}

          {tab==='up' && (
            <div className="rounded-xl border border-[#2BFFF1]/15 bg-[#2BFFF1]/05 px-3 py-2.5">
              <p className="text-[10px] text-[#2BFFF1]/70">🔑 A dedicated Solana wallet will be auto-created for your account. You will receive a recovery phrase — save it securely.</p>
            </div>
          )}

          {tab === 'in' && biometricAvailable && biometricEnrolled && (
            <button onClick={tryBiometric} disabled={busy}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all border border-[#2BFFF1]/30 text-[#2BFFF1] hover:bg-[#2BFFF1]/10 flex items-center justify-center gap-2 disabled:opacity-50">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              Sign in with Face ID / Touch ID
            </button>
          )}

          {tab === 'in' && biometricAvailable && biometricEnrolled && (
            <div className="flex items-center gap-2 my-1">
              <div className="flex-1 h-px bg-white/[0.06]"/>
              <span className="text-[10px] text-[#374151]">or</span>
              <div className="flex-1 h-px bg-white/[0.06]"/>
            </div>
          )}

          <button onClick={submit} disabled={busy || !email || !pass}
            className="w-full py-3.5 rounded-xl text-sm font-black transition-all disabled:opacity-40 mt-1"
            style={{ background:'linear-gradient(135deg,#2BFFF1,#00c4ff)', color:'#05060B' }}>
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-[#05060B]/30 border-t-[#05060B] rounded-full animate-spin"/>
                {tab==='in'?'Signing in…':'Creating account…'}
              </span>
            ) : tab==='in' ? 'Sign In' : 'Create Account & Generate Wallet'}
          </button>

          {tab==='in' && (
            <p className="text-[10px] text-[#374151] text-center">Don't have an account? <button onClick={()=>setTab('up')} className="text-[#2BFFF1] hover:underline">Create one</button></p>
          )}
        </div>
      </div>
    </div>
  );
}
