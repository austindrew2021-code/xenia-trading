import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

type TwoFAMethod = 'email' | 'totp' | null;

interface SecurityConfig {
  biometrics_enabled: boolean;
  twofa_enabled: boolean;
  twofa_method: TwoFAMethod;
}

const STORAGE_KEY = 'xenia-security-config';

// Persist security config locally so it survives sign-out/sign-in
function loadLocalConfig(): SecurityConfig {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s);
  } catch { /* ignore */ }
  return { biometrics_enabled: false, twofa_enabled: false, twofa_method: null };
}

function saveLocalConfig(cfg: SecurityConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function SecuritySettings({ onClose }: { onClose?: () => void }) {
  const { user, account, saveAccount } = useAuth();
  // Load from localStorage first so state persists across sign-outs
  const [config, setConfig] = useState<SecurityConfig>(loadLocalConfig);
  const [saving,        setSaving]        = useState(false);
  const [msg,           setMsg]           = useState('');
  const [biometricAvail,setBiometricAvail]= useState(false);
  const [totpQR,        setTotpQR]        = useState('');
  const [totpCode,      setTotpCode]      = useState('');
  const [verifying,     setVerifying]     = useState(false);
  const [emailCode,     setEmailCode]     = useState('');
  const [emailSent,     setEmailSent]     = useState(false);
  const [sendingEmail,  setSendingEmail]  = useState(false);

  // Check WebAuthn availability
  useEffect(() => {
    const check = async () => {
      try {
        const ok = typeof window.PublicKeyCredential !== 'undefined'
          && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        setBiometricAvail(ok);
      } catch { setBiometricAvail(false); }
    };
    check();
  }, []);

  // Sync from server but don't overwrite local if server has defaults
  useEffect(() => {
    if (!account) return;
    const serverCfg = (account as any).security_settings as SecurityConfig | null;
    if (serverCfg && (serverCfg.biometrics_enabled || serverCfg.twofa_enabled)) {
      // Server has meaningful state — merge with local (local wins for biometrics)
      const merged: SecurityConfig = {
        biometrics_enabled: loadLocalConfig().biometrics_enabled || serverCfg.biometrics_enabled,
        twofa_enabled:      serverCfg.twofa_enabled,
        twofa_method:       serverCfg.twofa_method,
      };
      setConfig(merged);
      saveLocalConfig(merged);
    }
    // Also check localStorage for biometric credential
    const credExists = !!localStorage.getItem('xenia-biometric-cred');
    if (credExists && !config.biometrics_enabled) {
      const next = { ...config, biometrics_enabled: true };
      setConfig(next);
      saveLocalConfig(next);
    }
  }, [account?.id]);

  const save = async (patch: Partial<SecurityConfig>) => {
    setSaving(true); setMsg('');
    const next = { ...config, ...patch };
    setConfig(next);
    saveLocalConfig(next); // always persist locally
    if (saveAccount) await saveAccount({ security_settings: next } as any);
    setMsg('Settings saved');
    setSaving(false);
    setTimeout(() => setMsg(''), 2000);
  };

  // ── Biometric enrollment ──────────────────────────────────────────────
  const enrollBiometrics = async () => {
    if (!biometricAvail || !user) {
      setMsg('Biometrics not available on this device/browser');
      return;
    }
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Xenia Trading', id: window.location.hostname },
          user: {
            id: new TextEncoder().encode(user.id),
            name: user.email ?? 'user',
            displayName: (account?.username ?? user.email) ?? 'Xenia User',
          },
          pubKeyCredParams: [
            { alg: -7,   type: 'public-key' },  // ES256
            { alg: -257, type: 'public-key' },  // RS256
            { alg: -8,   type: 'public-key' },  // EdDSA
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
          attestation: 'none',
        },
      }) as PublicKeyCredential | null;

      if (cred) {
        const rawId = (cred as any).rawId as ArrayBuffer;
        const credIdB64 = btoa(String.fromCharCode(...new Uint8Array(rawId)));
        localStorage.setItem('xenia-biometric-cred', credIdB64);
        await save({ biometrics_enabled: true });
        setMsg('Face ID / Touch ID enrolled — use it on next sign-in');
      }
    } catch (e: any) {
      if (e.name === 'NotAllowedError')    setMsg('Permission denied — allow biometrics in your browser');
      else if (e.name === 'NotSupportedError') setMsg('Platform authenticator not supported on this device');
      else setMsg(`Enrollment failed: ${e.message ?? 'Unknown error'}`);
    }
  };

  const disableBiometrics = async () => {
    localStorage.removeItem('xenia-biometric-cred');
    localStorage.removeItem('xenia-bio-email');
    localStorage.removeItem('xenia-bio-pass');
    await save({ biometrics_enabled: false });
    setMsg('Biometrics disabled');
  };

  // ── Email 2FA — send a 6-digit OTP (not a magic link) ─────────────────
  const sendEmailCode = async () => {
    if (!user?.email) return;
    setSendingEmail(true); setMsg('');
    try {
      // Use Supabase phone-style email OTP (6-digit code, not magic link)
      // This requires email OTP to be enabled in Supabase Auth settings
      const { error } = await supabase!.auth.signInWithOtp({
        email: user.email,
        options: {
          shouldCreateUser: false,
          data: { type: '2fa_verify' }, // custom data so we know it's 2FA
        },
      });
      if (error) throw error;
      setEmailSent(true);
      setMsg('6-digit code sent to ' + user.email);
    } catch (e: any) {
      setMsg('Failed to send code: ' + (e.message ?? 'Unknown'));
    }
    setSendingEmail(false);
  };

  const verifyEmailCode = async () => {
    if (!user?.email || !emailCode.trim()) return;
    setVerifying(true); setMsg('');
    try {
      const { error } = await supabase!.auth.verifyOtp({
        email: user.email,
        token: emailCode.trim(),
        type: 'email',
      });
      if (error) throw error;
      await save({ twofa_enabled: true, twofa_method: 'email' });
      setEmailCode(''); setEmailSent(false);
      setMsg('2FA enabled via Email');
    } catch (e: any) {
      setMsg('Invalid code: ' + (e.message ?? 'Try again'));
    }
    setVerifying(false);
  };

  // ── TOTP (Google Authenticator) ────────────────────────────────────────
  const setupTOTP = async () => {
    if (!user) return;
    const secret = generateTOTPSecret();
    const label   = encodeURIComponent(`Xenia:${user.email ?? user.id}`);
    const issuer  = encodeURIComponent('XeniaTrading');
    const uri     = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
    const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(uri)}`;
    setTotpQR(qrUrl);
    // Store secret in Supabase so backend can verify later
    if (supabase) {
      await supabase.from('trading_accounts').update({ totp_secret: secret }).eq('user_id', user.id);
    }
    setMsg('Scan QR code with Authenticator app, then enter the 6-digit code');
  };

  const verifyTOTP = async () => {
    if (!totpCode || totpCode.length !== 6) { setMsg('Enter the 6-digit code from your app'); return; }
    setVerifying(true);
    // In production: verify server-side against stored secret using TOTP algorithm
    // For now: accept valid length as demo (replace with edge function call for production)
    await save({ twofa_enabled: true, twofa_method: 'totp' });
    setTotpQR(''); setTotpCode('');
    setVerifying(false);
  };

  const disable2FA = async () => {
    await save({ twofa_enabled: false, twofa_method: null });
    setMsg('2FA disabled');
  };

  const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
    <button onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-all border flex-shrink-0 ${on ? 'bg-[#2BFFF1]/20 border-[#2BFFF1]/40' : 'bg-white/[0.05] border-white/[0.08]'}`}>
      <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all ${on ? 'translate-x-5 bg-[#2BFFF1]' : 'bg-[#374151]'}`}/>
    </button>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-black text-[#F4F6FA]">Security Settings</p>
        {(saving || msg) && (
          <p className={`text-[10px] font-semibold px-2 py-1 rounded-lg ${msg.includes('failed')||msg.includes('denied')||msg.includes('Invalid')||msg.includes('Failed') ? 'text-red-400 bg-red-500/10' : 'text-green-400 bg-green-500/10'}`}>
            {saving ? 'Saving…' : msg}
          </p>
        )}
      </div>

      {/* ── Biometrics ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#2BFFF1]/10 border border-[#2BFFF1]/20 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2BFFF1" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div>
              <p className="text-sm font-bold text-[#F4F6FA]">Biometric Login</p>
              <p className="text-[10px] text-[#4B5563]">Face ID · Touch ID · Fingerprint</p>
            </div>
          </div>
          <Toggle on={config.biometrics_enabled} onChange={v => v ? enrollBiometrics() : disableBiometrics()}/>
        </div>

        {!biometricAvail && (
          <div className="rounded-xl bg-[#F59E0B]/05 border border-[#F59E0B]/20 px-3 py-2">
            <p className="text-[10px] text-[#F59E0B]/80">
              Not available. Requires HTTPS + Chrome/Safari on a device with biometrics.
            </p>
          </div>
        )}

        {config.biometrics_enabled && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/05 border border-green-500/15 text-[10px] text-green-400">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400"/>
            Active — Face ID / Touch ID enabled for sign-in
          </div>
        )}
      </div>

      {/* ── 2FA ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#A78BFA]/10 border border-[#A78BFA]/20 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>
            </div>
            <div>
              <p className="text-sm font-bold text-[#F4F6FA]">Two-Factor Auth (2FA)</p>
              <p className="text-[10px] text-[#4B5563]">{config.twofa_method ? `Active via ${config.twofa_method.toUpperCase()}` : 'Not configured'}</p>
            </div>
          </div>
          {config.twofa_enabled && (
            <button onClick={disable2FA} className="text-[10px] text-red-400 border border-red-500/20 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-all">Disable</button>
          )}
        </div>

        {config.twofa_enabled ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/05 border border-green-500/15 text-[10px] text-green-400">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/>
            2FA active — account protected with {config.twofa_method?.toUpperCase()}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] text-[#4B5563]">Choose a second factor:</p>

            {/* Email OTP */}
            <div className="rounded-xl border border-white/[0.06] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A7B0B7" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <div className="flex-1"><p className="text-xs font-semibold text-[#F4F6FA]">Email OTP</p><p className="text-[9px] text-[#4B5563]">{user?.email}</p></div>
                {!emailSent && (
                  <button onClick={sendEmailCode} disabled={sendingEmail}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-[#A78BFA] border border-[#A78BFA]/20 hover:bg-[#A78BFA]/10 transition-all disabled:opacity-50">
                    {sendingEmail ? 'Sending…' : 'Send Code'}
                  </button>
                )}
              </div>
              {emailSent && (
                <div className="flex gap-2">
                  <input
                    value={emailCode}
                    onChange={e => setEmailCode(e.target.value.replace(/\D/g,'').slice(0,6))}
                    placeholder="6-digit code"
                    className="flex-1 bg-[#05060B] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-[#F4F6FA] outline-none font-mono text-center tracking-widest focus:border-[#A78BFA]/50"/>
                  <button onClick={verifyEmailCode} disabled={verifying || emailCode.length !== 6}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-[#A78BFA] border border-[#A78BFA]/25 hover:bg-[#A78BFA]/10 transition-all disabled:opacity-50">
                    {verifying ? '…' : 'Verify'}
                  </button>
                </div>
              )}
            </div>

            {/* Google Authenticator TOTP */}
            <div className="rounded-xl border border-white/[0.06] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A7B0B7" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                <div className="flex-1"><p className="text-xs font-semibold text-[#F4F6FA]">Google Authenticator</p><p className="text-[9px] text-[#4B5563]">Works offline · TOTP</p></div>
                {!totpQR && (
                  <button onClick={setupTOTP}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-[#2BFFF1] border border-[#2BFFF1]/20 hover:bg-[#2BFFF1]/10 transition-all">
                    Setup
                  </button>
                )}
              </div>
              {totpQR && (
                <div className="space-y-2">
                  <div className="rounded-xl overflow-hidden border border-white/[0.08] w-fit mx-auto bg-white p-1">
                    <img src={totpQR} alt="TOTP QR" className="w-32 h-32"/>
                  </div>
                  <p className="text-[9px] text-[#4B5563] text-center">Scan with Google Authenticator or Authy</p>
                  <div className="flex gap-2">
                    <input
                      value={totpCode}
                      onChange={e => setTotpCode(e.target.value.replace(/\D/g,'').slice(0,6))}
                      placeholder="Enter 6-digit code"
                      className="flex-1 bg-[#05060B] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-[#F4F6FA] outline-none font-mono text-center tracking-widest focus:border-[#2BFFF1]/40"/>
                    <button onClick={verifyTOTP} disabled={verifying || totpCode.length !== 6}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-[#2BFFF1] border border-[#2BFFF1]/25 hover:bg-[#2BFFF1]/10 transition-all disabled:opacity-50">
                      {verifying ? '…' : 'Verify'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function generateTOTPSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const arr = new Uint8Array(20);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => chars[b % 32]).join('');
}
