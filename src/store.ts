import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  Position, BotConfigs, Side,
  DEFAULT_BOT1, DEFAULT_BOT2, DEFAULT_BOT3
} from './types';

function uid() { return Math.random().toString(36).slice(2, 10); }

function calcLiqPrice(entry: number, side: Side, leverage: number): number {
  // Liquidation when 90% of margin is lost
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
  startingCapital: number;
  positions: Position[];
  botConfigs: BotConfigs;
  logs: string[];

  // Actions
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
  updateBotConfig: (bot: 'bot1' | 'bot2' | 'bot3', patch: object) => void;
  addLog: (msg: string) => void;
  clearClosed: () => void;
}

export const useTradingStore = create<TradingState>()(
  persist(
    (set, get) => ({
      capital: 1000,
      startingCapital: 1000,
      positions: [],
      botConfigs: {
        bot1: DEFAULT_BOT1,
        bot2: DEFAULT_BOT2,
        bot3: DEFAULT_BOT3,
      },
      logs: [],

      setCapital: (c) => set({ capital: c, startingCapital: c }),
      resetCapital: () => {
        const sc = get().startingCapital;
        set({ capital: sc, positions: [], logs: [] });
      },

      openPosition: (asset, side, entryPrice, size, leverage, openedBy, tp, sl) => {
        const { capital } = get();
        if (capital < size) return null;
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
        };
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
          const { pnl, pnlPct } = calcPnl(pos, closePrice);
          return {
            capital: s.capital + pos.size + pnl,
            positions: s.positions.map(p => p.id === id
              ? { ...p, closePrice, closedAt: Date.now(), status: 'closed' as const, pnl, pnlPct }
              : p
            ),
          };
        });
      },

      liquidatePosition: (id, closePrice) => {
        set(s => {
          const pos = s.positions.find(p => p.id === id && p.status === 'open');
          if (!pos) return s;
          return {
            positions: s.positions.map(p => p.id === id
              ? { ...p, closePrice, closedAt: Date.now(), status: 'liquidated' as const, pnl: -pos.size, pnlPct: -100 }
              : p
            ),
          };
        });
      },

      partialClosePosition: (id, closePrice, fraction) => {
        set(s => {
          const pos = s.positions.find(p => p.id === id && p.status === 'open');
          if (!pos) return s;
          const partialSize = pos.size * fraction;
          const { pnl } = calcPnl({ ...pos, size: partialSize }, closePrice);
          return {
            capital: s.capital + partialSize + pnl,
            positions: s.positions.map(p => p.id === id
              ? { ...p, size: p.size * (1 - fraction), notional: p.notional * (1 - fraction) }
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
        set(s => ({ positions: s.positions.filter(p => p.status === 'open') }));
      },
    }),
    { name: 'xenia-trading-v1' }
  )
);
