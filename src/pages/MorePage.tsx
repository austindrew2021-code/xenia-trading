import { useState } from 'react';
import { Button, Label, Panel, Sheet, Stat, fmtUsd, num, surface, t } from '../ui';

// ── Xenia — More ───────────────────────────────────────────────────────────
//
// The drawer everything else lives in. Grouped by what a user is trying to do,
// not by which subsystem owns the setting — nobody opens a menu looking for
// "engine configuration".
//
// THE MODE SWITCH IS THE POINT OF THIS SCREEN.
//   Going from mock to live is the single highest-consequence action in the
//   app, so it is the only one with a typed confirmation. That is not friction
//   theatre: it is the last checkpoint before an unattended key starts spending
//   real money, and a user who cannot be bothered to type six letters is not
//   ready for the thing on the other side.
//
//   Going back to mock is one tap. Making it easy to stop risking money and
//   deliberate to start is the whole asymmetry, and any design that treats the
//   two directions the same has misunderstood which one causes losses.

export interface GateCheck {
  label: string;
  passed: boolean;
  blocking: boolean;
  detail: string;
}

export interface MorePageProps {
  displayName: string;
  email?: string;
  mode: 'mock' | 'live';
  walletAddress?: string;
  walletBackedUp?: boolean;
  mockBalanceUsd: number;
  liveBalanceUsd: number;
  /** From preflight(). Empty array means the gate has not been run. */
  gate: GateCheck[];
  onModeChange: (m: 'mock' | 'live') => void;
  onNavigate: (to: 'wallet' | 'lab' | 'research' | 'referrals' | 'security' | 'leaderboard') => void;
  onSignOut: () => void;
}

const LINKS: { key: Parameters<MorePageProps['onNavigate']>[0]; label: string; sub: string }[] = [
  { key: 'wallet', label: 'Wallet', sub: 'Keys, recovery phrase, backup' },
  { key: 'lab', label: 'Bot lab', sub: 'Build and deploy strategies' },
  { key: 'research', label: 'Research', sub: 'Backtests and walk-forward results' },
  { key: 'leaderboard', label: 'Leaderboard', sub: 'Ranked by verified results' },
  { key: 'referrals', label: 'Referrals', sub: 'Invite links and rewards' },
  { key: 'security', label: 'Security', sub: 'Sessions, auto-lock, spend caps' },
];

export default function MorePage(props: MorePageProps) {
  const {
    displayName, email, mode, walletAddress, walletBackedUp,
    mockBalanceUsd, liveBalanceUsd, gate, onModeChange, onNavigate, onSignOut,
  } = props;

  const [switching, setSwitching] = useState(false);
  const [typed, setTyped] = useState('');

  const blockers = gate.filter(g => g.blocking && !g.passed);
  const canGoLive = gate.length > 0 && blockers.length === 0 && walletBackedUp === true;

  const goLive = () => {
    if (typed.trim().toUpperCase() !== 'GO LIVE') return;
    onModeChange('live');
    setSwitching(false);
    setTyped('');
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto thin-scrollbar">

      {/* ── identity ── */}
      <div className="px-3 pt-3 pb-2.5">
        <p className={t.heading}>{displayName}</p>
        {email && <p className="text-[10px] text-[#4B5563] mt-0.5">{email}</p>}
        {walletAddress && (
          <p className={`${num} text-[10px] text-[#4B5563] mt-0.5`}>
            {walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}
          </p>
        )}
      </div>

      {/* ── mode ── */}
      <div className="px-3 pb-2.5">
        <Label>Trading mode</Label>
        <Panel className="mt-1.5">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Mock balance" value={fmtUsd(mockBalanceUsd, false)}
              tone={mode === 'mock' ? 'accent' : undefined} />
            <Stat label="Live balance" value={fmtUsd(liveBalanceUsd, false)}
              tone={mode === 'live' ? 'down' : undefined} />
          </div>

          <div className={`${surface.divider} my-2.5`} />

          {mode === 'mock' ? (
            <>
              <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
                You are trading with simulated funds against live prices. Nothing you do here
                can lose money.
              </p>
              {gate.length === 0 ? (
                <p className="text-[10px] text-[#6B7280] leading-relaxed mt-2">
                  Run the live-trading checks in Research before switching. Live mode stays
                  closed until they pass.
                </p>
              ) : (
                <div className="mt-2 space-y-1">
                  {gate.filter(g => g.blocking).map(g => (
                    <div key={g.label} className="flex items-start gap-1.5">
                      <span className={`text-[10px] leading-tight ${
                        g.passed ? 'text-[#2BFFF1]' : 'text-[#F59E0B]'}`}>
                        {g.passed ? '✓' : '○'}
                      </span>
                      <span className={`text-[10px] leading-tight ${
                        g.passed ? 'text-[#6B7280]' : 'text-[#9CA3AF]'}`}>
                        {g.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2.5">
                <Button
                  variant={canGoLive ? 'danger' : 'ghost'}
                  disabled={!canGoLive}
                  onClick={() => setSwitching(true)}
                >
                  {canGoLive
                    ? 'Switch to live trading'
                    : `${blockers.length || 'Some'} checks still to pass`}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] text-[#EF4444] leading-relaxed">
                Live. Every trade spends real funds from your own wallet and cannot be
                reversed by anyone, including us.
              </p>
              <div className="mt-2.5">
                <Button variant="primary" onClick={() => onModeChange('mock')}>
                  Back to mock trading
                </Button>
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* ── backup nag: the only thing that outranks the mode switch ── */}
      {walletAddress && walletBackedUp === false && (
        <div className="px-3 pb-2.5">
          <div className="rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-2.5">
            <p className="text-[11px] text-[#F59E0B] leading-relaxed">
              Your recovery phrase is not confirmed. If you clear this browser, the wallet and
              anything in it are gone permanently.
            </p>
            <button onClick={() => onNavigate('wallet')}
              className="text-[11px] font-bold text-[#F59E0B] mt-1.5">
              Confirm it now
            </button>
          </div>
        </div>
      )}

      {/* ── links ── */}
      <div className="px-3 pb-2.5">
        <Panel pad={false}>
          {LINKS.map((l, i) => (
            <button
              key={l.key}
              onClick={() => onNavigate(l.key)}
              className={`w-full flex items-center gap-2 px-2.5 py-2.5 text-left ${
                i > 0 ? 'border-t border-white/[0.05]' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <span className="text-[12px] font-semibold block">{l.label}</span>
                <span className="text-[10px] text-[#4B5563] block">{l.sub}</span>
              </div>
              <span className="text-[#374151] text-[14px] leading-none">›</span>
            </button>
          ))}
        </Panel>
      </div>

      <div className="px-3 pb-4">
        <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
      </div>

      <div className="px-3 pb-6">
        <p className="text-[9px] text-[#374151] leading-relaxed">
          Xenia is non-custodial. Your keys and funds stay in your own wallet, trades settle
          directly between you and the venue, and we cannot freeze, reverse or recover them.
          Trading with leverage can lose more than you deposit.
        </p>
      </div>

      {/* ── the confirmation ── */}
      <Sheet open={switching} onClose={() => { setSwitching(false); setTyped(''); }}
        title="Switch to live trading">
        <div className="space-y-2.5 pb-3">
          <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
            From this point trades spend real funds from your wallet. Stops are checked when a
            bar closes, not continuously — between closes you are unhedged. Nobody can reverse
            a fill, refund a loss, or recover a wallet you lose access to.
          </p>
          <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
            Fund this wallet with money you can lose entirely.
          </p>

          <Panel>
            <Label>Type GO LIVE to confirm</Label>
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off" autoCapitalize="characters" spellCheck={false}
              placeholder="GO LIVE"
              className={`${num} w-full bg-transparent text-[14px] font-bold outline-none mt-1
                          placeholder:text-[#1F2937]`}
            />
          </Panel>

          <Button
            variant="danger"
            disabled={typed.trim().toUpperCase() !== 'GO LIVE'}
            onClick={goLive}
          >
            Start live trading
          </Button>
          <Button variant="ghost" onClick={() => { setSwitching(false); setTyped(''); }}>
            Stay in mock
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
