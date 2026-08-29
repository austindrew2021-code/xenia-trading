// ── Xenia — Trading mode ──────────────────────────────────────────────────
//
// One place that knows whether the app is in MOCK or LIVE. Today that answer
// lives in at least three places and they disagree.
//
// ═══════════════════════════════════════════════════════════════════════════
// BUGS THIS FIXES
//
// 1. TWO TOGGLES, ONE GUARDED.
//    SettingsPage shows a warning modal before enabling live ("trades use real
//    funds, losses are permanent"). The header LiveMockToggle in App.tsx flips
//    the same flag with a single tap and no warning at all. Same state, two
//    entry points, one of them unguarded.
//
// 2. STALE CLOSURE ON BALANCE.
//        await saveAccount({ use_real: newMode });
//        await refreshBalance();
//        setCapital(newMode ? account.real_balance : account.mock_balance);
//    `account` is captured from the render closure. refreshBalance() updates the
//    store but the component has not re-rendered, so this reads the PRE-refresh
//    balance. The user switches to live and sees the wrong number.
//
// 3. COPYTRADEPAGE HAS ITS OWN MODE.
//        const [isMock, setIsMock] = useState(true)  // local, disconnected
//    The header can say LIVE while copy trading says Mock. A user can believe
//    they are practising and be spending real money, or the reverse.
//
// 4. BOTS DO NOT CARRY THEIR MODE.
//    A bot deployed in mock keeps running when the global flag flips to live.
//    Nothing about the bot records which mode it was created for, so switching
//    the toggle silently converts every running paper bot into a live one.
//    This is the most dangerous of the four.
// ═══════════════════════════════════════════════════════════════════════════

export type TradingMode = 'mock' | 'live';

export interface ModeState {
  mode: TradingMode;
  mockBalance: number;
  liveBalance: number;
  /** Bots keep the mode they were deployed in. See boundMode(). */
  liveEnabledAt: number | null;
}

export interface ModeTransitionCheck {
  allowed: boolean;
  requiresConfirmation: boolean;
  blockers: string[];
  warnings: string[];
}

export interface LivePreconditions {
  liveBalance: number;
  walletConnected: boolean;
  walletBackupConfirmed: boolean;
  /** Bots currently running. Switching mode must not silently re-target them. */
  activeBotCount: number;
  /** From preflight.ts, if the research gate has been run. */
  researchGatePassed?: boolean;
}

/**
 * Every path into live mode goes through this — header toggle, settings toggle,
 * deep link, anything. One function means one set of rules.
 */
export function checkTransition(
  from: TradingMode, to: TradingMode, pre: LivePreconditions,
): ModeTransitionCheck {
  if (from === to) {
    return { allowed: true, requiresConfirmation: false, blockers: [], warnings: [] };
  }

  // Going back to mock is always safe and never needs a confirmation dialog.
  // Making it easy to retreat is the point.
  if (to === 'mock') {
    const warnings: string[] = [];
    if (pre.activeBotCount > 0) {
      warnings.push(
        `${pre.activeBotCount} running ${pre.activeBotCount === 1 ? 'bot' : 'bots'} will keep `
        + `trading in the mode they were deployed in. Pause them here if you want them stopped.`);
    }
    return { allowed: true, requiresConfirmation: false, blockers: [], warnings };
  }

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!pre.walletConnected) blockers.push('No wallet connected.');
  if (!pre.walletBackupConfirmed) {
    blockers.push('Recovery phrase not confirmed. Do not fund a wallet you cannot restore.');
  }
  if (pre.liveBalance <= 0) {
    blockers.push('Live balance is $0. Deposit before switching, or the first trade just fails.');
  }
  if (pre.researchGatePassed === false) {
    warnings.push('The research gate has not passed. Any strategy you run is untested.');
  }
  if (pre.activeBotCount > 0) {
    warnings.push(
      `${pre.activeBotCount} ${pre.activeBotCount === 1 ? 'bot is' : 'bots are'} running. `
      + `They stay on the mode they were deployed in and will NOT switch to live — `
      + `redeploy them if that is what you want.`);
  }

  return {
    allowed: blockers.length === 0,
    requiresConfirmation: true,     // live ALWAYS confirms, from every entry point
    blockers,
    warnings,
  };
}

/** Copy for the confirmation dialog. Same words wherever it is shown. */
export const LIVE_CONFIRMATION = {
  title: 'Switch to live trading',
  points: [
    'Trades execute with real funds from your wallet.',
    'Losses are permanent and cannot be reversed by us.',
    'Withdrawals send real assets on-chain.',
    'Bots already running stay in the mode they were deployed in.',
  ],
  ack: 'I understand these trades use real money.',
  confirmLabel: 'Enable live trading',
  cancelLabel: 'Stay in mock',
};

// ═══════════════════════════════════════════════════════════════════════════
// PER-BOT MODE BINDING — bug 4
// ═══════════════════════════════════════════════════════════════════════════

export interface BotModeBinding {
  botId: string;
  /** The mode this bot was DEPLOYED in. Never derived from the global flag. */
  deployedMode: TradingMode;
  deployedAt: number;
}

/**
 * A bot's mode is a property of the bot, not of the app.
 *
 * The alternative — reading the global flag at execution time — means flipping a
 * header toggle silently converts every paper bot into a live one. A user who
 * has been testing a bot for a week, taps the toggle to check their live
 * balance, and walks away, comes back to real trades they never authorised.
 *
 * So: the bot stores its mode at deploy time and keeps it. Changing a bot's mode
 * requires redeploying it, which is a deliberate act with its own confirmation.
 */
export function boundMode(bot: { deployedMode?: TradingMode }): TradingMode {
  // Absent binding means the bot predates this fix. Treat it as mock — the
  // conservative reading — and prompt for redeploy rather than guessing live.
  return bot.deployedMode ?? 'mock';
}

export function needsRedeployPrompt(bot: { deployedMode?: TradingMode }): boolean {
  return bot.deployedMode === undefined;
}

/**
 * Are any running bots in a different mode than the app is displaying?
 * Surface this — a user looking at a LIVE header while three mock bots run is
 * not being lied to, but they are being confused.
 */
export function modeMismatches(
  appMode: TradingMode, bots: { botId: string; name: string; deployedMode?: TradingMode }[],
): { botId: string; name: string; botMode: TradingMode }[] {
  return bots
    .map(b => ({ botId: b.botId, name: b.name, botMode: boundMode(b) }))
    .filter(b => b.botMode !== appMode);
}

// ═══════════════════════════════════════════════════════════════════════════
// THE STORE
// ═══════════════════════════════════════════════════════════════════════════

type Listener = (s: ModeState) => void;

/**
 * Deliberately not React state. Bots, the runner and the sweeper all need to
 * read the mode outside a component tree, and a second copy of this in a hook is
 * how the CopyTradePage divergence happened in the first place.
 */
export class TradingModeStore {
  private state: ModeState = {
    mode: 'mock', mockBalance: 0, liveBalance: 0, liveEnabledAt: null,
  };
  private listeners = new Set<Listener>();

  get(): Readonly<ModeState> { return this.state; }
  get mode(): TradingMode { return this.state.mode; }
  get isLive(): boolean { return this.state.mode === 'live'; }

  /** The balance for the CURRENT mode. Never read the other one by accident. */
  get balance(): number {
    return this.state.mode === 'live' ? this.state.liveBalance : this.state.mockBalance;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() { for (const fn of this.listeners) fn(this.state); }

  /**
   * Balances are set from fresh data, not from a closure. Call this AFTER the
   * refresh resolves and pass the values it returned — that is bug 2.
   */
  setBalances(o: { mock: number; live: number }) {
    this.state = { ...this.state, mockBalance: o.mock, liveBalance: o.live };
    this.emit();
  }

  /**
   * The only way the mode changes. Returns the check so the caller can render
   * the dialog; it does NOT apply the change until confirm() is called.
   */
  requestTransition(to: TradingMode, pre: LivePreconditions): ModeTransitionCheck {
    return checkTransition(this.state.mode, to, pre);
  }

  /**
   * Apply. `persist` writes use_real to the DB and returns the FRESH balances,
   * so the store never reads a stale closure value.
   */
  async commit(
    to: TradingMode,
    pre: LivePreconditions,
    persist: (useReal: boolean) => Promise<{ mock: number; live: number }>,
  ): Promise<{ ok: boolean; error?: string }> {
    const check = checkTransition(this.state.mode, to, pre);
    if (!check.allowed) return { ok: false, error: check.blockers.join(' ') };

    const fresh = await persist(to === 'live');
    this.state = {
      mode: to,
      mockBalance: fresh.mock,
      liveBalance: fresh.live,
      liveEnabledAt: to === 'live' ? Date.now() : null,
    };
    this.emit();
    return { ok: true };
  }
}

export const tradingMode = new TradingModeStore();
