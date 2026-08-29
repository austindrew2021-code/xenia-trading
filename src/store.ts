import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  Position, BotConfigs, Side,
  DEFAULT_BOT1, DEFAULT_BOT2, DEFAULT_BOT3, DEFAULT_BOT4
} from './types';

// ── Xenia — Trading store ──────────────────────────────────────────────────
//
// FOUR FIXES IN THIS VERSION. The first is the one that costs money.
//
// 1. POSITIONS NOW CARRY THEIR MODE, AND IT IS BOUND AT OPEN.
//    Before: one `positions` array served both mock and live. `capital` was
//    synced from `use_real ? real_balance : mock_balance`, so flipping the mode
//    swapped the balance underneath a list of positions that did not change.
//    A mock long opened at $1,000 of play money stayed on screen in live mode,
//    counted toward P&L, and could be closed against real funds — crediting a
//    real balance with an imaginary profit.
//
//    This is the same failure as the deposit ratchet: state that reads
//    correctly until the mode changes, then silently mixes two accounts.
//    Mode is now written once at open and never mutated, which is the same rule
//    bots already follow via boundMode(). Every read filters on it.
//
// 2. POSITIONS ARE SCOPED TO THE USER WHO OPENED THEM.
//    `persist` writes to localStorage, which is per-browser, not per-account.
//    Signing out and signing in as somebody else inherited the previous user's
//    open trades. `ownerId` is stamped at open and filtered on read.
//
// 3. STARTING CAPITAL IS TRACKED PER MODE.
//    `setCapital` only ever set `startingCapital` once, on the first call in the
//    lifetime of the persisted store. So after one mode switch the "capital
//    change %" on the stats bar compared a live balance against a mock starting
//    point, and reported nonsense forever. There are now two baselines.
//
// 4. PARTIAL CLOSES RECORD WHAT THEY REALISED.
//    Before, a partial close credited capital and shrank the position but wrote
//    nothing down. The realised profit vanished from history and from every
//    statistic — a user who scaled out of a winner saw a smaller final P&L than
//    they actually made. `realizedPnl` accumulates it and the final close adds
//    it in.
//
// MIGRATION: the persisted key moves to v3 and existing positions are tagged
// `mock`. That is the safe assumption — mislabelling a live position as mock
// hides it from a live balance, while the reverse would show phantom real
// trades. Losing sight of a position is recoverable; inventing one is not.

function uid() { return Math.random().toString(36).slice(2, 10); }

export type TradingMode = 'mock' | 'live';

function calcLiqPrice(entry: number, side: Side, leverage: number): number {
  const margin = 1 / leverage;
  return side === 'LONG'
    ? entry * (1 - margin * 0.9)
    : entry * (1 + margin * 0.9);
}

function calcPnl(pos: Position, currentPrice: number) {
  const notional = pos.size * pos.leverage;
  const rawPnl = pos.side === 'LONG'
    ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * notional
    : ((pos.entryPrice - currentPrice) / pos.entryPrice) * notional;
  return { pnl: rawPnl, pnlPct: (rawPnl / pos.size) * 100 };
}

interface TradingState {
  capital: number;
  /** Baseline per mode, so a mode switch cannot corrupt the other one's %. */
  startingCapitalMock: number;
  startingCapitalLive: number;
  positions: Position[];
  botConfigs: BotConfigs;
  logs: string[];

  /** Current mode and owner. Everything opened is stamped with these. */
  mode: TradingMode;
  ownerId: string | null;

  setMode: (m: TradingMode) => void;
  setOwner: (id: string | null) => void;
  setCapital: (c: number) => void;
  resetCapital: () => void;
  openPosition: (
    asset: string, side: Side, entryPrice: number,
    size: number, leverage: number,
    openedBy: Position['openedBy'],
    tp?: number, sl?: number
  ) => Position | null;
  closePosition: (id: string, closePrice: number) => void;
  liquidatePosition: (id: string, closePrice: number) => void;
  partialClosePosition: (id: string, closePrice: number, fraction: number) => void;
  updatePositionPnl: (id: string, currentPrice: number) => void;
  updateBotConfig: (bot: 'bot1' | 'bot2' | 'bot3' | 'bot4', patch: object) => void;
  addLog: (msg: string) => void;
  clearClosed: () => void;

  /** Positions belonging to the current mode and user. Use these everywhere. */
  visiblePositions: () => Position[];
  openPositions: () => Position[];
  closedPositions: () => Position[];
  startingCapital: () => number;
}

export const useTradingStore = create<TradingState>()(
  persist(
    (set, get) => ({
      capital: 0,
      startingCapitalMock: 0,
      startingCapitalLive: 0,
      positions: [],
      mode: 'mock',
      ownerId: null,
      botConfigs: {
        bot1: DEFAULT_BOT1,
        bot2: DEFAULT_BOT2,
        bot3: DEFAULT_BOT3,
        bot4: DEFAULT_BOT4,
      },
      logs: [],

      setMode: (mode) => set({ mode }),

      // Changing user clears nothing — the positions stay in storage tagged with
      // their owner and simply stop being visible. Deleting them here would lose
      // a user's open trades if they signed in on a shared device by mistake.
      setOwner: (ownerId) => set({ ownerId }),

      setCapital: (c) => set((s) => {
        const key = s.mode === 'live' ? 'startingCapitalLive' : 'startingCapitalMock';
        const current = s[key];
        return {
          capital: c,
          // Seed the baseline the first time this mode is ever funded, and only
          // then. A later balance change is performance, not a new baseline.
          [key]: current === 0 ? c : current,
        } as Partial<TradingState>;
      }),

      resetCapital: () => {
        const s = get();
        const sc = s.mode === 'live' ? s.startingCapitalLive : s.startingCapitalMock;
        set({
          capital: sc,
          // Only this mode's positions and logs. Resetting mock must never
          // delete a live position, which the previous version did.
          positions: s.positions.filter(p => (p as any).mode !== s.mode),
          logs: [],
        });
      },

      openPosition: (asset, side, entryPrice, size, leverage, openedBy, tp, sl) => {
        const { capital, mode, ownerId } = get();
        if (capital < size) return null;
        if (!(entryPrice > 0) || !(size > 0) || !(leverage >= 1)) return null;

        const pos: Position = {
          id: uid(),
          asset, side, entryPrice, size, leverage,
          notional: size * leverage,
          liquidationPrice: calcLiqPrice(entryPrice, side, leverage),
          takeProfitPrice: tp ?? null,
          stopLossPrice: sl ?? null,
          openedAt: Date.now(),
          closedAt: null,
          closePrice: null,
          status: 'open',
          pnl: 0,
          pnlPct: 0,
          openedBy,
          // Bound here, never mutated. See note 1.
          mode,
          ownerId,
          realizedPnl: 0,
        } as Position;

        set(s => ({
          capital: s.capital - size,
          positions: [pos, ...s.positions],
        }));
        return pos;
      },

      closePosition: (id, closePrice) => {
        set(s => {
          const pos = s.positions.find(p => p.id === id && p.status === 'open');
          if (!pos) return s;
          // Refuse to settle a position from the other mode against this
          // balance. Nothing should call it, but the guard is one line and the
          // failure it prevents is crediting real funds with mock profit.
          if ((pos as any).mode !== s.mode) return s;

          const { pnl, pnlPct } = calcPnl(pos, closePrice);
          const banked = (pos as any).realizedPnl ?? 0;
          return {
            capital: s.capital + pos.size + pnl,
            positions: s.positions.map(p => p.id === id
              ? {
                  ...p, closePrice, closedAt: Date.now(), status: 'closed' as const,
                  // Total P&L includes anything already taken off the table.
                  pnl: pnl + banked, pnlPct,
                }
              : p
            ),
          };
        });
      },

      liquidatePosition: (id, closePrice) => {
        set(s => {
          const pos = s.positions.find(p => p.id === id && p.status === 'open');
          if (!pos) return s;
          if ((pos as any).mode !== s.mode) return s;
          const banked = (pos as any).realizedPnl ?? 0;
          return {
            positions: s.positions.map(p => p.id === id
              ? {
                  ...p, closePrice, closedAt: Date.now(), status: 'liquidated' as const,
                  // The remaining margin is gone; anything banked earlier is not.
                  pnl: -pos.size + banked, pnlPct: -100,
                }
              : p
            ),
          };
        });
      },

      partialClosePosition: (id, closePrice, fraction) => {
        set(s => {
          const pos = s.positions.find(p => p.id === id && p.status === 'open');
          if (!pos) return s;
          if ((pos as any).mode !== s.mode) return s;
          if (!(fraction > 0) || fraction >= 1) return s;

          const partialSize = pos.size * fraction;
          const { pnl } = calcPnl({ ...pos, size: partialSize }, closePrice);
          const remaining = pos.size * (1 - fraction);

          return {
            capital: s.capital + partialSize + pnl,
            positions: s.positions.map(p => p.id === id
              ? {
                  ...p,
                  size: remaining,
                  notional: remaining * p.leverage,
                  // Recorded, not discarded. See note 4.
                  realizedPnl: ((p as any).realizedPnl ?? 0) + pnl,
                } as Position
              : p
            ),
          };
        });
      },

      updatePositionPnl: (id, currentPrice) => {
        set(s => ({
          positions: s.positions.map(p => {
            if (p.id !== id || p.status !== 'open') return p;
            const { pnl, pnlPct } = calcPnl(p, currentPrice);
            return { ...p, pnl, pnlPct };
          }),
        }));
      },

      updateBotConfig: (bot, patch) => {
        set(s => ({
          botConfigs: {
            ...s.botConfigs,
            [bot]: { ...s.botConfigs[bot], ...patch },
          },
        }));
      },

      addLog: (msg) => {
        set(s => ({ logs: [`${new Date().toLocaleTimeString()} ${msg}`, ...s.logs].slice(0, 200) }));
      },

      clearClosed: () => {
        // Only this mode's history. Clearing mock trades should not wipe the
        // live record, which is the one that has to be auditable.
        set(s => ({
          positions: s.positions.filter(
            p => p.status === 'open' || (p as any).mode !== s.mode,
          ),
        }));
      },

      // ── selectors ──────────────────────────────────────────────────────
      // Every component should read through these rather than filtering the
      // raw array. One place decides what "mine, in this mode" means.

      visiblePositions: () => {
        const s = get();
        return s.positions.filter(p => {
          const m = (p as any).mode ?? 'mock';
          const o = (p as any).ownerId ?? null;
          if (m !== s.mode) return false;
          // Positions opened before sign-in have a null owner and stay visible;
          // ones stamped with a different user do not.
          return o === null || o === s.ownerId;
        });
      },

      openPositions: () => get().visiblePositions().filter(p => p.status === 'open'),
      closedPositions: () => get().visiblePositions().filter(p => p.status !== 'open'),

      startingCapital: () => {
        const s = get();
        return s.mode === 'live' ? s.startingCapitalLive : s.startingCapitalMock;
      },
    }),
    {
      name: 'xenia-trading-v3',
      version: 3,
      migrate: (persisted: any, version) => {
        if (!persisted) return persisted;
        if (version < 3) {
          // Existing positions predate the mode field. Tag them mock: a live
          // trade hidden from view can be recovered from the DB, while a mock
          // trade shown as live would let imaginary profit settle into a real
          // balance. Prefer the recoverable mistake.
          persisted.positions = (persisted.positions ?? []).map((p: any) => ({
            ...p,
            mode: p.mode ?? 'mock',
            ownerId: p.ownerId ?? null,
            realizedPnl: p.realizedPnl ?? 0,
          }));
          persisted.startingCapitalMock = persisted.startingCapital ?? 0;
          persisted.startingCapitalLive = 0;
          persisted.mode = persisted.mode ?? 'mock';
          persisted.ownerId = persisted.ownerId ?? null;
          delete persisted.startingCapital;
        }
        return persisted;
      },
    }
  )
);
