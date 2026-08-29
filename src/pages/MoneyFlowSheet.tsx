import { useState } from 'react';
import {
  Button, Label, Panel, Sheet, Stat, fmtUsd, num, surface, t,
} from '../ui';

// ── Xenia — Money flows ────────────────────────────────────────────────────
//
// Deposit, withdraw, transfer. The screens where a mistake is permanent, so the
// design rules differ from everywhere else in the app:
//
//   1. NO IRREVERSIBLE ACTION IN ONE TAP. Withdrawal is a two-step confirm that
//      restates the destination. Not friction for its own sake — an address
//      typo on Solana is unrecoverable, and the confirm is the only moment the
//      user will ever re-read it.
//   2. THE NETWORK IS STATED, NOT ASSUMED. Sending SPL USDC to an Ethereum
//      address is the single most common way people lose funds in a
//      multi-chain app. It is named on every screen here.
//   3. NO PROGRESS BARS FOR THINGS WE CANNOT SEE. A deposit is detected when it
//      confirms on chain. Showing a fake three-step tracker implies Xenia is
//      watching something it is not.
//   4. MOCK AND LIVE ARE NEVER THE SAME COMPONENT. Mock funds are a number in a
//      database. Presenting a "deposit" flow for them that resembles the real
//      one trains a habit that costs money later.

export type FlowKind = 'deposit' | 'withdraw' | 'transfer' | null;

export interface MoneyFlowProps {
  kind: FlowKind;
  onClose: () => void;
  mode: 'mock' | 'live';
  /** The user's own deposit address. Non-custodial: this is their wallet. */
  depositAddress?: string;
  availableUsd: number;
  /** Native SOL balance — needed for fees even when trading USDC. */
  solBalance?: number;
  onWithdraw?: (to: string, amountUsd: number) => Promise<void> | void;
  onTransfer?: (direction: 'toTrading' | 'toWallet', amountUsd: number) => Promise<void> | void;
  onResetMock?: () => void;
}

const MIN_SOL_FOR_FEES = 0.01;

/** Base58, 32-44 chars, no 0/O/I/l. Catches typos, not wrong-owner mistakes. */
function looksLikeSolAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

export default function MoneyFlowSheet(props: MoneyFlowProps) {
  const {
    kind, onClose, mode, depositAddress, availableUsd, solBalance,
    onWithdraw, onTransfer, onResetMock,
  } = props;

  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [direction, setDirection] = useState<'toTrading' | 'toWallet'>('toTrading');

  const value = Number(amount) || 0;

  const reset = () => {
    setAmount(''); setTo(''); setConfirming(false); setError(null); setCopied(false);
  };

  const close = () => { reset(); onClose(); };

  const copy = async () => {
    if (!depositAddress) return;
    try {
      await navigator.clipboard.writeText(depositAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Select the address and copy it by hand.');
    }
  };

  const title = kind === 'deposit' ? 'Deposit'
    : kind === 'withdraw' ? 'Withdraw'
    : kind === 'transfer' ? 'Transfer' : '';

  // ── mock ─────────────────────────────────────────────────────────────────
  if (mode === 'mock' && kind) {
    return (
      <Sheet open onClose={close} title={`${title} — mock mode`}>
        <div className="space-y-2.5 pb-3">
          <Panel>
            <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
              You are in mock mode. This balance is a number Xenia keeps for you — there is no
              wallet behind it, nothing to deposit into and nothing to withdraw.
            </p>
            <div className={`${surface.divider} my-2`} />
            <Stat label="Mock balance" value={fmtUsd(availableUsd, false)} />
          </Panel>
          <p className="text-[10px] text-[#6B7280] leading-relaxed">
            Switch to live mode to use a real wallet. Live trades spend real funds and cannot
            be reversed.
          </p>
          {onResetMock && (
            <Button variant="ghost" onClick={() => { onResetMock(); close(); }}>
              Reset mock balance
            </Button>
          )}
        </div>
      </Sheet>
    );
  }

  // ── deposit ──────────────────────────────────────────────────────────────
  if (kind === 'deposit') {
    return (
      <Sheet open onClose={close} title="Deposit">
        <div className="space-y-2.5 pb-3">
          <Panel>
            <Label>Your Solana address</Label>
            <p className={`${num} text-[11px] break-all leading-relaxed mt-1 select-all`}>
              {depositAddress ?? 'No wallet yet.'}
            </p>
            {depositAddress && (
              <div className="mt-2">
                <Button variant="primary" size="sm" onClick={copy}>
                  {copied ? 'Copied' : 'Copy address'}
                </Button>
              </div>
            )}
          </Panel>

          <Panel>
            <Label>Send only these</Label>
            <ul className="text-[10px] text-[#9CA3AF] leading-relaxed mt-1 space-y-0.5 list-disc pl-3.5">
              <li>USDC on <span className="text-[#E5E9EF] font-semibold">Solana</span> — the SPL token, not Ethereum or Base</li>
              <li>SOL on <span className="text-[#E5E9EF] font-semibold">Solana</span>, for transaction fees</li>
            </ul>
            <p className="text-[10px] text-[#F59E0B] leading-relaxed mt-2">
              Anything sent on another network is lost. Nobody can retrieve it — not Xenia,
              not the network, not the exchange you sent it from.
            </p>
          </Panel>

          <p className="text-[10px] text-[#6B7280] leading-relaxed">
            Your balance updates once the transfer confirms on chain, usually under a minute.
            This is your own wallet — Xenia never holds the funds and cannot move them.
          </p>
        </div>
      </Sheet>
    );
  }

  // ── withdraw ─────────────────────────────────────────────────────────────
  if (kind === 'withdraw') {
    const addressOk = looksLikeSolAddress(to);
    const lowSol = solBalance !== undefined && solBalance < MIN_SOL_FOR_FEES;
    const canSend = value > 0 && value <= availableUsd && addressOk && !busy && !lowSol;

    const send = async () => {
      if (!canSend || !onWithdraw) return;
      setBusy(true); setError(null);
      try {
        await onWithdraw(to.trim(), value);
        close();
      } catch (e) {
        setError((e as Error).message);
        setConfirming(false);
      } finally { setBusy(false); }
    };

    return (
      <Sheet open onClose={close} title="Withdraw">
        <div className="space-y-2.5 pb-3">
          {!confirming ? (
            <>
              <Panel>
                <div className="flex items-baseline justify-between mb-1">
                  <Label>Amount</Label>
                  <button onClick={() => setAmount(availableUsd.toFixed(2))}
                    className={`${num} text-[10px] text-[#2BFFF1]`}>
                    {fmtUsd(availableUsd, false)} available
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`${num} text-[#4B5563] text-[16px]`}>$</span>
                  <input
                    value={amount} inputMode="decimal" placeholder="0.00"
                    onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    className={`${num} flex-1 bg-transparent text-[20px] font-bold outline-none
                                placeholder:text-[#1F2937]`}
                  />
                </div>
              </Panel>

              <Panel>
                <Label>Solana address</Label>
                <input
                  value={to} autoComplete="off" spellCheck={false}
                  onChange={e => setTo(e.target.value)}
                  placeholder="Paste the destination address"
                  className={`${num} w-full bg-transparent text-[11px] outline-none mt-1
                              placeholder:font-sans placeholder:text-[#374151] placeholder:tracking-normal`}
                />
                {to && !addressOk && (
                  <p className="text-[10px] text-[#F59E0B] mt-1 leading-snug">
                    That is not a valid Solana address. Check it character by character —
                    a wrong address sends the funds to someone else permanently.
                  </p>
                )}
              </Panel>

              {lowSol && (
                <p className="text-[10px] text-[#F59E0B] leading-snug">
                  You have {solBalance?.toFixed(4)} SOL. A transfer needs a little SOL for the
                  network fee even when you are sending USDC. Deposit around 0.01 SOL first.
                </p>
              )}
              {value > availableUsd && (
                <p className="text-[10px] text-[#EF4444] leading-snug">
                  {fmtUsd(value, false)} is more than the {fmtUsd(availableUsd, false)} you have free.
                </p>
              )}

              <Button variant="primary" disabled={!canSend} onClick={() => setConfirming(true)}>
                Review withdrawal
              </Button>
            </>
          ) : (
            <>
              <Panel>
                <Label>Sending</Label>
                <p className={`${num} text-[22px] font-bold mt-0.5`}>{fmtUsd(value, false)}</p>
                <div className={`${surface.divider} my-2`} />
                <Label>To this address on Solana</Label>
                <p className={`${num} text-[11px] break-all leading-relaxed mt-1`}>{to.trim()}</p>
              </Panel>

              <p className="text-[10px] text-[#F59E0B] leading-relaxed">
                Read the address again before confirming. Once this is signed it cannot be
                cancelled, reversed or refunded by anyone.
              </p>

              {error && (
                <p className="text-[10px] text-[#EF4444] leading-snug">{error}</p>
              )}

              <Button variant="danger" disabled={busy} onClick={send}>
                {busy ? 'Sending' : `Send ${fmtUsd(value, false)}`}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Go back and edit
              </Button>
            </>
          )}
        </div>
      </Sheet>
    );
  }

  // ── transfer ─────────────────────────────────────────────────────────────
  if (kind === 'transfer') {
    const canMove = value > 0 && value <= availableUsd && !busy;
    const move = async () => {
      if (!canMove || !onTransfer) return;
      setBusy(true); setError(null);
      try { await onTransfer(direction, value); close(); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    };

    return (
      <Sheet open onClose={close} title="Transfer">
        <div className="space-y-2.5 pb-3">
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ['toTrading', 'To trading'],
              ['toWallet', 'To wallet'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setDirection(k)}
                className={`py-2 rounded-lg border text-[11px] font-bold transition-colors duration-[120ms] ${
                  direction === k
                    ? 'bg-[#2BFFF1]/12 border-[#2BFFF1]/30 text-[#2BFFF1]'
                    : 'bg-transparent border-white/[0.07] text-[#4B5563]'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <Panel>
            <div className="flex items-baseline justify-between mb-1">
              <Label>Amount</Label>
              <button onClick={() => setAmount(availableUsd.toFixed(2))}
                className={`${num} text-[10px] text-[#2BFFF1]`}>
                {fmtUsd(availableUsd, false)} available
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`${num} text-[#4B5563] text-[16px]`}>$</span>
              <input
                value={amount} inputMode="decimal" placeholder="0.00"
                onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                className={`${num} flex-1 bg-transparent text-[20px] font-bold outline-none
                            placeholder:text-[#1F2937]`}
              />
            </div>
          </Panel>

          <p className="text-[10px] text-[#6B7280] leading-relaxed">
            {direction === 'toTrading'
              ? 'Moves funds into the balance the bot can trade against. Only send what you can lose entirely — an unattended signing key is a hot wallet.'
              : 'Moves funds out of reach of the trading engine. Open positions are unaffected.'}
          </p>

          {error && <p className="text-[10px] text-[#EF4444] leading-snug">{error}</p>}

          <Button variant="primary" disabled={!canMove} onClick={move}>
            {busy ? 'Moving' : `Transfer ${value > 0 ? fmtUsd(value, false) : ''}`}
          </Button>
        </div>
      </Sheet>
    );
  }

  return null;
}

/** The four-up action row that opens these flows. */
export function ActionRow({ onAction, mode }: {
  onAction: (k: Exclude<FlowKind, null> | 'trade') => void;
  mode: 'mock' | 'live';
}) {
  const items: { key: Exclude<FlowKind, null> | 'trade'; label: string }[] = [
    { key: 'deposit', label: 'Deposit' },
    { key: 'withdraw', label: 'Withdraw' },
    { key: 'transfer', label: 'Transfer' },
    { key: 'trade', label: 'Trade' },
  ];
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {items.map(i => (
        <button
          key={i.key}
          onClick={() => onAction(i.key)}
          className={`py-2 rounded-lg border border-white/[0.07] bg-white/[0.03]
                      text-[10px] font-bold active:bg-white/[0.07]
                      transition-colors duration-[120ms] ${
            i.key === 'trade' ? 'text-[#2BFFF1] border-[#2BFFF1]/25 bg-[#2BFFF1]/8' : 'text-[#9CA3AF]'}`}
        >
          {i.label}
        </button>
      ))}
      {mode === 'mock' && (
        <span className={`${t.label} col-span-4 pt-0.5`}>
          Mock mode — deposits and withdrawals are disabled
        </span>
      )}
    </div>
  );
}
