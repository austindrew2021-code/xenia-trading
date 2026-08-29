// ── Xenia Wallet — Session ─────────────────────────────────────────────────
//
// Holds the unlocked key in memory and nowhere else, for as short a time as the
// user's chosen mode allows.
//
// THE TENSION, STATED PLAINLY
//   Non-custodial means only the user can sign. Autonomous means something signs
//   without asking. Those pull against each other, and every design that claims
//   to satisfy both is choosing a point on the line rather than escaping it.
//
//   Xenia's point on that line:
//     'manual'  — key unlocks per action, locks immediately after. Every trade
//                 is a deliberate act. The bot cannot run.
//     'session' — key stays unlocked for a bounded window with an idle timeout
//                 and a hard cap on how much it may spend before re-authorising.
//                 This is what lets the runner trade unattended.
//   There is no third mode where the bot trades for a month and the key is safe.
//   Do not add one.

import { Keypair } from '@solana/web3.js';
import { unlockVault, Vault, wipe } from './keystore';

export type SessionMode = 'manual' | 'session';

export interface SessionPolicy {
  mode: SessionMode;
  /** Lock after this long with no runner activity. */
  idleTimeoutMs: number;
  /** Lock this long after unlocking, no matter what. */
  maxSessionMs: number;
  /** Re-authorise once this much USDC notional has been traded this session. */
  spendCapUsd: number;
}

export const DEFAULT_POLICY: SessionPolicy = {
  mode: 'session',
  idleTimeoutMs: 6 * 3600_000,   // 6h — one 4h bar plus slack
  maxSessionMs: 24 * 3600_000,
  spendCapUsd: 250,
};

type Listener = (s: { unlocked: boolean; address: string | null; reason?: string }) => void;

export class WalletSession {
  private kp: Keypair | null = null;
  private unlockedAt = 0;
  private lastActivity = 0;
  private spentUsd = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();

  constructor(public policy: SessionPolicy = DEFAULT_POLICY) {}

  get address(): string | null { return this.kp?.publicKey.toBase58() ?? null; }
  get isUnlocked(): boolean { return this.kp !== null; }
  get spentThisSession(): number { return this.spentUsd; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason?: string) {
    for (const fn of this.listeners) {
      fn({ unlocked: this.isUnlocked, address: this.address, reason });
    }
  }

  async unlock(vault: Vault, password: string): Promise<void> {
    if (!vault.backupConfirmed) {
      throw new Error('Confirm your recovery phrase before using this wallet.');
    }
    this.kp = await unlockVault(vault, password);
    this.unlockedAt = Date.now();
    this.lastActivity = Date.now();
    this.spentUsd = 0;
    this.startWatchdog();
    this.emit('unlocked');
  }

  lock(reason = 'locked') {
    if (this.kp) wipe(this.kp.secretKey);
    this.kp = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit(reason);
  }

  private startWatchdog() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      const now = Date.now();
      if (now - this.unlockedAt > this.policy.maxSessionMs) return this.lock('session expired');
      if (now - this.lastActivity > this.policy.idleTimeoutMs) return this.lock('idle timeout');
    }, 30_000);
  }

  /**
   * Every signing path goes through here. It is the single place that can hand
   * out the key, so it is the single place that enforces the policy.
   */
  useKey<T>(fn: (kp: Keypair) => T): T {
    if (!this.kp) throw new Error('Wallet is locked.');
    if (this.policy.mode === 'manual') {
      const kp = this.kp;
      const out = fn(kp);
      this.lock('manual mode — locked after signing');
      return out;
    }
    this.lastActivity = Date.now();
    return fn(this.kp);
  }

  /** Call after each fill. Trips the cap rather than silently trading past it. */
  recordSpend(notionalUsd: number) {
    this.spentUsd += Math.abs(notionalUsd);
    if (this.spentUsd >= this.policy.spendCapUsd) {
      this.lock(`spend cap reached ($${this.spentUsd.toFixed(2)}) — re-authorise to continue`);
    }
  }

  /** Wire this to the page so closing the tab does not leave a key resident. */
  attachToPage() {
    const onHide = () => { if (document.visibilityState === 'hidden') this.lastActivity = Date.now(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', () => this.lock('page closed'));
  }
}

export const walletSession = new WalletSession();
