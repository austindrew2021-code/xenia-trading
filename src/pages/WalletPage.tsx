import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keypair } from '@solana/web3.js';
import {
  backupChallenge, checkBackup, createVault, deleteVault, isValidMnemonic,
  keypairFromMnemonic, listVaults, newMnemonic, saveVault, Vault, wipe,
} from '../wallet/keystore';
import { walletSession } from '../wallet/session';

// Xenia's existing identity: near-black ground, one cyan accent, hairline cards.
// Nothing new is introduced here — a wallet screen that looks unlike the rest of
// the app reads as a phishing page, which is the opposite of what it needs.
const cardCls = 'rounded-2xl border border-white/[0.05] bg-[#0D1117]/60';
const labelCls = 'text-[10px] uppercase tracking-widest text-[#4B5563]';
const btnPrimary = 'w-full py-2.5 rounded-xl bg-[#2BFFF1]/10 border border-[#2BFFF1]/30 '
  + 'text-[#2BFFF1] text-xs font-bold hover:bg-[#2BFFF1]/20 disabled:opacity-30';
const btnGhost = 'w-full py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] '
  + 'text-xs font-bold hover:bg-white/[0.08] disabled:opacity-30';
const inputCls = 'w-full bg-[#0D1117] border border-white/[0.07] rounded-lg px-3 py-2 '
  + 'text-xs text-[#F4F6FA] focus:border-[#2BFFF1]/40 outline-none';

type Step = 'choose' | 'reveal' | 'verify' | 'password' | 'import' | 'ready';

export default function WalletPage() {
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [step, setStep] = useState<Step>('choose');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [pendingKp, setPendingKp] = useState<Keypair | null>(null);
  const [origin, setOrigin] = useState<Vault['origin']>('generated');
  const [importPhrase, setImportPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [challenge, setChallenge] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlockPw, setUnlockPw] = useState('');
  const [active, setActive] = useState<string | null>(walletSession.address);

  const refresh = useCallback(() => { listVaults().then(setVaults); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => walletSession.subscribe(s => setActive(s.address)), []);

  const words = useMemo(() => mnemonic?.split(' ') ?? [], [mnemonic]);

  // ── create ───────────────────────────────────────────────────────────────
  const startCreate = () => {
    setError(null);
    const m = newMnemonic(128);
    setMnemonic(m);
    setPendingKp(keypairFromMnemonic(m));
    setOrigin('generated');
    setRevealed(false);
    setAcknowledged(false);
    setStep('reveal');
  };

  const goVerify = () => {
    if (!mnemonic) return;
    setChallenge(backupChallenge(mnemonic, 3));
    setAnswers({});
    setStep('verify');
  };

  const submitVerify = () => {
    if (!mnemonic) return;
    if (!checkBackup(mnemonic, answers)) {
      setError('Those words do not match. Go back and check what you wrote down.');
      return;
    }
    setError(null);
    setStep('password');
  };

  // ── import ───────────────────────────────────────────────────────────────
  const submitImport = () => {
    setError(null);
    if (!isValidMnemonic(importPhrase)) {
      setError('That is not a valid 12 or 24 word recovery phrase.');
      return;
    }
    try {
      setPendingKp(keypairFromMnemonic(importPhrase));
      setMnemonic(null);          // an imported phrase is never displayed back
      setOrigin('imported');
      setStep('password');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // ── finish ───────────────────────────────────────────────────────────────
  const finish = async () => {
    setError(null);
    if (password.length < 10) return setError('Use at least 10 characters.');
    if (password !== password2) return setError('The two passwords do not match.');
    if (!pendingKp) return setError('Lost the key mid-flow. Start again.');
    try {
      const v = await createVault(
        pendingKp, password, origin === 'generated' ? 'Trading wallet' : 'Imported wallet', origin,
      );
      v.backupConfirmed = origin === 'generated' ? true : true;
      await saveVault(v);
      wipe(pendingKp.secretKey);
      setPendingKp(null);
      setMnemonic(null);
      setImportPhrase('');
      setPassword(''); setPassword2('');
      refresh();
      setStep('ready');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unlock = async (v: Vault) => {
    setError(null);
    try {
      await walletSession.unlock(v, unlockPw);
      setUnlockPw('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const forget = async (v: Vault) => {
    if (!confirm(
      `Remove ${v.address.slice(0, 6)}…${v.address.slice(-4)} from this device?\n\n`
      + `This deletes the encrypted key stored here. Any funds stay on chain, but the `
      + `only way back in is your recovery phrase. If you do not have it written down, `
      + `they are gone permanently.`,
    )) return;
    await deleteVault(v.address);
    if (walletSession.address === v.address) walletSession.lock('wallet removed');
    refresh();
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#080B10] text-[#F4F6FA]">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-lg font-black tracking-tight">Wallet</h1>
        <p className="text-[10px] text-[#4B5563]">
          Your keys, your funds. Xenia never holds, moves, or can recover them.
        </p>
      </div>

      <div className="px-4 pb-6 space-y-3 max-w-lg w-full">
        {error && (
          <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2">
            <p className="text-[11px] text-red-400 leading-snug">{error}</p>
          </div>
        )}

        {/* ── existing wallets ── */}
        {vaults.length > 0 && step === 'choose' && (
          <div className={`${cardCls} p-3 space-y-3`}>
            <p className={labelCls}>On this device</p>
            {vaults.map(v => (
              <div key={v.address} className="rounded-xl bg-[#0D1117] border border-white/[0.05] p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold">{v.label}</p>
                    <p className="text-[10px] text-[#4B5563] font-mono">
                      {v.address.slice(0, 8)}…{v.address.slice(-6)}
                    </p>
                  </div>
                  <span className={`text-[9px] px-2 py-0.5 rounded-lg border ${
                    active === v.address
                      ? 'text-[#2BFFF1] border-[#2BFFF1]/30 bg-[#2BFFF1]/10'
                      : 'text-[#4B5563] border-white/[0.06]'}`}>
                    {active === v.address ? 'Unlocked' : 'Locked'}
                  </span>
                </div>
                {active !== v.address && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="password" value={unlockPw} placeholder="Password"
                      onChange={e => setUnlockPw(e.target.value)}
                      className={inputCls}
                    />
                    <button onClick={() => unlock(v)} className={`${btnPrimary} w-24`}>Unlock</button>
                  </div>
                )}
                <button onClick={() => forget(v)}
                  className="mt-2 text-[10px] text-[#4B5563] hover:text-red-400">
                  Remove from this device
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── choose ── */}
        {step === 'choose' && (
          <div className={`${cardCls} p-3 space-y-2`}>
            <p className={labelCls}>Add a wallet</p>
            <button onClick={startCreate} className={btnPrimary}>Create a new wallet</button>
            <button onClick={() => { setStep('import'); setError(null); }} className={btnGhost}>
              Import an existing recovery phrase
            </button>
            <p className="text-[10px] text-[#6B7280] leading-relaxed pt-1">
              For trading by hand, connecting Phantom or Solflare is safer — the key never
              touches this page. A wallet created here can sign on its own, which is what the
              bot needs, and that is exactly why it should only ever hold money you can lose.
            </p>
          </div>
        )}

        {/* ── reveal: the one-time ceremony ── */}
        {step === 'reveal' && mnemonic && (
          <div className={`${cardCls} p-4 space-y-3`}>
            <p className={labelCls}>Recovery phrase</p>
            <p className="text-[11px] text-[#A7B0B7] leading-relaxed">
              Twelve words. Write them on paper, in order. This screen is the only time they
              exist anywhere — after you leave it, no copy remains on this device, on our
              servers, or with us.
            </p>

            <div className="relative">
              <div className={`grid grid-cols-3 gap-2 ${revealed ? '' : 'blur-sm select-none'}`}>
                {words.map((w, i) => (
                  <div key={i} className="rounded-lg bg-[#0D1117] border border-white/[0.06] px-2 py-1.5">
                    <span className="text-[9px] text-[#374151] mr-1">{i + 1}</span>
                    <span className="text-[11px] font-mono">{w}</span>
                  </div>
                ))}
              </div>
              {!revealed && (
                <button onClick={() => setRevealed(true)}
                  className="absolute inset-0 flex items-center justify-center rounded-xl
                             bg-[#080B10]/60 text-[11px] font-bold text-[#2BFFF1]">
                  Tap to reveal — make sure nobody is watching
                </button>
              )}
            </div>

            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 space-y-1.5">
              <p className="text-[10px] text-amber-400 leading-relaxed">
                Anyone who reads these words owns the funds. Nobody who loses them can get the
                funds back — not you, not us, not an exchange, not a support ticket.
              </p>
              <p className="text-[10px] text-amber-400 leading-relaxed">
                Do not photograph this screen, store it in a password manager you sync, or type
                it into anything that is not a wallet you trust.
              </p>
            </div>

            <label className="flex items-start gap-2 pt-1">
              <input type="checkbox" checked={acknowledged}
                onChange={e => setAcknowledged(e.target.checked)}
                className="accent-[#2BFFF1] mt-0.5" />
              <span className="text-[11px] text-[#A7B0B7] leading-snug">
                I have written the phrase down on paper and understand it cannot be recovered.
              </span>
            </label>

            <button onClick={goVerify} disabled={!revealed || !acknowledged} className={btnPrimary}>
              Continue
            </button>
          </div>
        )}

        {/* ── verify ── */}
        {step === 'verify' && mnemonic && (
          <div className={`${cardCls} p-4 space-y-3`}>
            <p className={labelCls}>Check the backup</p>
            <p className="text-[11px] text-[#A7B0B7]">
              Type these words from what you wrote down, not from memory.
            </p>
            {challenge.map(pos => (
              <label key={pos} className="block">
                <span className="text-[10px] text-[#4B5563]">Word {pos}</span>
                <input
                  value={answers[pos] ?? ''} autoComplete="off" autoCapitalize="none"
                  onChange={e => setAnswers(a => ({ ...a, [pos]: e.target.value }))}
                  className={inputCls}
                />
              </label>
            ))}
            <button onClick={submitVerify} className={btnPrimary}>Verify</button>
            <button onClick={() => setStep('reveal')} className={btnGhost}>
              Show the phrase again
            </button>
          </div>
        )}

        {/* ── import ── */}
        {step === 'import' && (
          <div className={`${cardCls} p-4 space-y-3`}>
            <p className={labelCls}>Import</p>
            <p className="text-[11px] text-[#A7B0B7] leading-relaxed">
              Paste a 12 or 24 word phrase. It is turned into a key here in your browser and
              never leaves this device. Use the path {`m/44'/501'/0'/0'`}, which is what
              Phantom and Solflare use, so you will see the same address.
            </p>
            <textarea
              value={importPhrase} rows={3} autoComplete="off" spellCheck={false}
              onChange={e => setImportPhrase(e.target.value)}
              placeholder="word word word …"
              className={`${inputCls} font-mono resize-none`}
            />
            <button onClick={submitImport} className={btnPrimary}>Continue</button>
            <button onClick={() => { setStep('choose'); setImportPhrase(''); }} className={btnGhost}>
              Cancel
            </button>
          </div>
        )}

        {/* ── password ── */}
        {step === 'password' && (
          <div className={`${cardCls} p-4 space-y-3`}>
            <p className={labelCls}>Password for this device</p>
            <p className="text-[11px] text-[#A7B0B7] leading-relaxed">
              This encrypts the key stored in this browser. It is not a second copy of your
              recovery phrase and it cannot restore the wallet anywhere else — if you clear this
              browser, the phrase is what gets you back in.
            </p>
            <input type="password" value={password} placeholder="Password"
              onChange={e => setPassword(e.target.value)} className={inputCls} />
            <input type="password" value={password2} placeholder="Password again"
              onChange={e => setPassword2(e.target.value)} className={inputCls} />
            <button onClick={finish} className={btnPrimary}>Save wallet</button>
          </div>
        )}

        {/* ── ready ── */}
        {step === 'ready' && (
          <div className={`${cardCls} p-4 space-y-3`}>
            <p className="text-xs font-bold text-[#2BFFF1]">Wallet ready</p>
            <p className="text-[11px] text-[#A7B0B7] leading-relaxed">
              Send USDC to this address to fund it. Send only what you can lose entirely — a
              wallet that signs trades without asking is a hot wallet, and one bad script on
              this page is enough to empty it. Keep the rest in Phantom or on hardware.
            </p>
            <button onClick={() => { setStep('choose'); refresh(); }} className={btnPrimary}>
              Done
            </button>
          </div>
        )}

        {/* ── standing disclosure ── */}
        <div className={`${cardCls} p-3`}>
          <p className={`${labelCls} mb-2`}>What Xenia does and does not do</p>
          <ul className="text-[10px] text-[#6B7280] leading-relaxed space-y-1 list-disc pl-4">
            <li>Trades settle directly between your wallet and the AMM. Xenia is never a party to them.</li>
            <li>We store your public address so the app can show balances. Nothing else about your wallet reaches a server.</li>
            <li>We cannot freeze, reverse, refund, or recover a trade or a wallet.</li>
            <li>Stops are checked when a bar closes, not continuously. Between closes you are unhedged.</li>
            <li>Running trading software for other people can be a regulated activity where you live. That is a question for a lawyer, not for us.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
