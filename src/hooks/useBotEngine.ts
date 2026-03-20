import { useEffect, useRef } from 'react';
import { useTradingStore } from '../store';
import { bot1Signal, bot1PositionSize } from '../bots/botOne';
import { bot2Signal, bot2KellySize, bot2ShouldExit, bot2ShouldPartialExit } from '../bots/botTwo';
import { bot3Signal, bot3PositionSize, bot3CheckTP } from '../bots/botThree';

const BOT_INTERVAL = 15_000;

interface Props { prices: number[]; livePrice: number; asset: string; }

export function useBotEngine({ prices, livePrice, asset }: Props) {
  const peakPrices = useRef<Record<string, number>>({});
  const partialFlags = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (prices.length < 30) return;

    const run = () => {
      const {
        botConfigs, capital, positions,
        openPosition, closePosition, liquidatePosition,
        partialClosePosition, updatePositionPnl, addLog,
      } = useTradingStore.getState();

      // ── Manage all open positions ───────────────────────────────────────
      for (const pos of positions.filter(p => p.status === 'open')) {
        updatePositionPnl(pos.id, livePrice);

        // Track peak
        if (!peakPrices.current[pos.id]) peakPrices.current[pos.id] = pos.entryPrice;
        if (pos.side === 'LONG' && livePrice > peakPrices.current[pos.id]) peakPrices.current[pos.id] = livePrice;
        else if (pos.side === 'SHORT' && livePrice < peakPrices.current[pos.id]) peakPrices.current[pos.id] = livePrice;

        // Liquidation
        const liq = pos.side === 'LONG' ? livePrice <= pos.liquidationPrice : livePrice >= pos.liquidationPrice;
        if (liq) {
          liquidatePosition(pos.id, livePrice);
          addLog(`💥 LIQ ${pos.asset} ${pos.side} @ $${livePrice.toFixed(4)}`);
          delete peakPrices.current[pos.id]; partialFlags.current.delete(pos.id); continue;
        }

        // Manual TP/SL
        if (pos.takeProfitPrice) {
          const hit = pos.side === 'LONG' ? livePrice >= pos.takeProfitPrice : livePrice <= pos.takeProfitPrice;
          if (hit) { closePosition(pos.id, livePrice); addLog(`✅ TP ${pos.asset} ${pos.side} @ $${livePrice.toFixed(4)}`); delete peakPrices.current[pos.id]; continue; }
        }
        if (pos.stopLossPrice) {
          const hit = pos.side === 'LONG' ? livePrice <= pos.stopLossPrice : livePrice >= pos.stopLossPrice;
          if (hit) { closePosition(pos.id, livePrice); addLog(`🛑 SL ${pos.asset} ${pos.side} @ $${livePrice.toFixed(4)}`); delete peakPrices.current[pos.id]; continue; }
        }

        // Bot 2 position management
        if (pos.openedBy === 'bot2' && botConfigs.bot2.enabled) {
          if (bot2ShouldPartialExit(pos.entryPrice, livePrice, pos.side, botConfigs.bot2, partialFlags.current.has(pos.id))) {
            partialClosePosition(pos.id, livePrice, 0.5);
            partialFlags.current.add(pos.id);
            addLog(`📤 Partial bot2 ${pos.asset} 50% @ $${livePrice.toFixed(4)}`);
          }
          const _lb = botConfigs.bot2.lookback ?? 80;
const { exit, reason } = bot2ShouldExit(pos.entryPrice, livePrice, peakPrices.current[pos.id] || pos.entryPrice, pos.side, prices.slice(-_lb), botConfigs.bot2);
          if (exit) { closePosition(pos.id, livePrice); addLog(`🔚 Bot2 exit ${pos.asset} — ${reason}`); delete peakPrices.current[pos.id]; partialFlags.current.delete(pos.id); continue; }
        }

        // Bot 3 multi-tier TP management
        if (pos.openedBy === 'bot3' && botConfigs.bot3.enabled) {
          const { action, fraction, reason } = bot3CheckTP(
            pos.entryPrice, livePrice, pos.side,
            peakPrices.current[pos.id] || pos.entryPrice,
            pos.openedAt, partialFlags.current.has(pos.id),
            botConfigs.bot3
          );
          if (action === 'full') {
            closePosition(pos.id, livePrice);
            addLog(`🔚 Bot3 ${reason} ${pos.asset} @ $${livePrice.toFixed(4)}`);
            delete peakPrices.current[pos.id]; partialFlags.current.delete(pos.id);
          } else if (action === 'partial') {
            partialClosePosition(pos.id, livePrice, fraction);
            partialFlags.current.add(pos.id);
            addLog(`📤 Bot3 ${reason} ${pos.asset} ${(fraction*100).toFixed(0)}% @ $${livePrice.toFixed(4)}`);
          }
        }
      }

      // ── Bot 1 ───────────────────────────────────────────────────────────
      if (botConfigs.bot1.enabled) {
        const lb1 = botConfigs.bot1.lookback ?? 50;
        const sig = bot1Signal(prices.slice(-lb1), asset, botConfigs.bot1);
        if (sig) {
          const size = bot1PositionSize(sig.confidence, botConfigs.bot1);
          if (capital >= size) {
            const pos = openPosition(asset, sig.side, livePrice, size, botConfigs.bot1.leverage, 'bot1');
            if (pos) addLog(`🤖 Bot1 ${sig.side} ${asset} $${size.toFixed(0)} ×${botConfigs.bot1.leverage} | ${sig.description}`);
          }
        }
      }

      // ── Bot 2 ───────────────────────────────────────────────────────────
      if (botConfigs.bot2.enabled) {
        const lb2 = botConfigs.bot2.lookback ?? 80;
        const sig = bot2Signal(prices.slice(-lb2), asset, botConfigs.bot2);
        if (sig) {
          const size = bot2KellySize(livePrice, botConfigs.bot2, capital);
          if (capital >= size) {
            const pos = openPosition(asset, sig.side, livePrice, size, botConfigs.bot2.leverage, 'bot2');
            if (pos) addLog(`🤖 Bot2 ${sig.side} ${asset} $${size.toFixed(0)} ×${botConfigs.bot2.leverage} | ${sig.description}`);
          }
        }
      }

      // ── Bot 3 ───────────────────────────────────────────────────────────
      if (botConfigs.bot3.enabled) {
        const lb3 = botConfigs.bot3.lookback ?? 100;
        const sig = bot3Signal(prices.slice(-lb3), asset, botConfigs.bot3);
        if (sig) {
          const size = bot3PositionSize(sig.confidence, capital, botConfigs.bot3);
          if (capital >= size) {
            const pos = openPosition(asset, sig.side, livePrice, size, botConfigs.bot3.leverage, 'bot3');
            if (pos) addLog(`🤖 Bot3 ${sig.side} ${asset} $${size.toFixed(0)} ×${botConfigs.bot3.leverage} | ${sig.description}`);
          }
        }
      }
    };

    const iv = setInterval(run, BOT_INTERVAL);
    return () => clearInterval(iv);
  }, [prices, livePrice, asset]);
}
