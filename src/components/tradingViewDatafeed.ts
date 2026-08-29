// ── Xenia — TradingView Advanced Charts datafeed ──────────────────────────
//
// Implements TradingView's Datafeed API against Xenia's existing sources, so the
// Advanced Charts library can render our markets the moment access is approved.
// Build this before the approval lands — it is the long pole, and it does not
// depend on having the library in hand.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT YOU NEED BEFORE THIS RUNS
//
//   1. Apply for Advanced Charts. Approval grants a GitHub invitation to a
//      private repo. There is no npm package and no public download.
//   2. Licence conditions that affect the product, not just the code:
//        • TradingView attribution must stay visible
//        • the implementation must be public — NOT behind a paywall
//        • the library is not redistributable, and no part of it may go in a
//          public repository. Check your .gitignore before the first commit.
//      If Xenia ever gates features behind a subscription, re-read the terms.
//   3. Trade-from-chart is Trading Platform, a separate PAID product. Advanced
//      Charts renders and analyses; it does not place orders.
//
// This file is ours and carries none of those restrictions.
// ─────────────────────────────────────────────────────────────────────────────

import { Candle } from '../engine/types';
import { fetchHistory, INTERVAL_MS, Source } from '../engine/market';

// TradingView's types ship with the library, which we do not have yet. These
// mirror the documented shapes so this compiles standalone; when the library is
// installed, delete them and import from 'charting_library' instead.
export interface TVSymbolInfo {
  ticker: string;
  name: string;
  description: string;
  type: string;
  session: string;
  timezone: string;
  exchange: string;
  listed_exchange: string;
  format: 'price';
  minmov: number;
  pricescale: number;
  has_intraday: boolean;
  has_daily: boolean;
  has_weekly_and_monthly: boolean;
  supported_resolutions: string[];
  volume_precision: number;
  data_status: 'streaming' | 'endofday' | 'pulsed' | 'delayed_streaming';
}

export interface TVBar { time: number; open: number; high: number; low: number; close: number; volume?: number }
export interface TVPeriodParams { from: number; to: number; countBack: number; firstDataRequest: boolean }

/**
 * Crypto trades continuously, so the session is 24x7 and the timezone is UTC.
 * Getting this wrong makes the library insert phantom gaps where it thinks the
 * market was closed, and those gaps shift every bar after them.
 */
const SESSION = '24x7';
const TIMEZONE = 'Etc/UTC';

/** TradingView resolution -> our interval. '60' is minutes; 'D' is a day. */
const RESOLUTION_MAP: Record<string, string> = {
  '1': '1m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1h', '120': '2h', '240': '4h', '720': '12h',
  '1D': '1d', 'D': '1d',
};

export const SUPPORTED_RESOLUTIONS = Object.keys(RESOLUTION_MAP);

/**
 * pricescale is 10^(decimal places). A memecoin at $0.0000031 needs 1e10 or the
 * chart rounds every candle to a flat line — the most common integration bug and
 * one that looks like a data problem rather than a config one.
 */
function priceScaleFor(lastPrice: number): number {
  if (lastPrice >= 1000) return 100;
  if (lastPrice >= 1) return 10_000;
  if (lastPrice >= 0.01) return 1_000_000;
  if (lastPrice >= 0.0001) return 100_000_000;
  return 10_000_000_000;
}

export interface XeniaSymbol {
  ticker: string;          // 'BTCUSDT' or a Solana mint
  displayName: string;
  source: Source;
  lastPrice: number;
  isPerp: boolean;
}

export interface DatafeedDeps {
  listSymbols(): Promise<XeniaSymbol[]>;
  resolveTicker(ticker: string): Promise<XeniaSymbol | null>;
  /** Optional live feed. Without it, bars still update on the polling fallback. */
  subscribeLive?(o: {
    symbol: XeniaSymbol; interval: string; onBar: (bar: Candle) => void;
  }): () => void;
  onLog?: (m: string) => void;
}

export function createXeniaDatafeed(deps: DatafeedDeps) {
  const log = deps.onLog ?? (() => {});
  const subs = new Map<string, () => void>();
  /** Last bar per subscription, so a tick can extend it rather than duplicate it. */
  const lastBar = new Map<string, Candle>();

  return {
    onReady(callback: (config: unknown) => void) {
      // The library requires this to be ASYNCHRONOUS. Calling back synchronously
      // is documented as unsupported and produces intermittent init failures
      // that look like a data bug.
      setTimeout(() => callback({
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
        exchanges: [
          { value: '', name: 'All', desc: 'All markets' },
          { value: 'Jupiter', name: 'Jupiter', desc: 'Solana spot' },
          { value: 'Velocity', name: 'Velocity', desc: 'Perpetuals' },
        ],
        symbols_types: [
          { name: 'All', value: '' },
          { name: 'Spot', value: 'crypto' },
          { name: 'Perpetual', value: 'futures' },
        ],
      }), 0);
    },

    async searchSymbols(
      userInput: string, exchange: string, symbolType: string,
      onResult: (items: unknown[]) => void,
    ) {
      const all = await deps.listSymbols();
      const q = userInput.toLowerCase();
      onResult(all
        .filter(s =>
          (!q || s.ticker.toLowerCase().includes(q) || s.displayName.toLowerCase().includes(q))
          && (!exchange || (s.isPerp ? 'Velocity' : 'Jupiter') === exchange)
          && (!symbolType || (s.isPerp ? 'futures' : 'crypto') === symbolType))
        .slice(0, 30)
        .map(s => ({
          symbol: s.ticker,
          full_name: s.displayName,
          description: s.displayName,
          exchange: s.isPerp ? 'Velocity' : 'Jupiter',
          ticker: s.ticker,
          type: s.isPerp ? 'futures' : 'crypto',
        })));
    },

    async resolveSymbol(
      ticker: string,
      onResolve: (info: TVSymbolInfo) => void,
      onError: (reason: string) => void,
    ) {
      const s = await deps.resolveTicker(ticker);
      if (!s) return onError(`Unknown symbol: ${ticker}`);
      const scale = priceScaleFor(s.lastPrice);
      onResolve({
        ticker: s.ticker,
        name: s.displayName,
        description: s.displayName,
        type: s.isPerp ? 'futures' : 'crypto',
        session: SESSION,
        timezone: TIMEZONE,
        exchange: s.isPerp ? 'Velocity' : 'Jupiter',
        listed_exchange: s.isPerp ? 'Velocity' : 'Jupiter',
        format: 'price',
        minmov: 1,
        pricescale: scale,
        has_intraday: true,
        has_daily: true,
        has_weekly_and_monthly: false,
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        volume_precision: 2,
        data_status: 'streaming',
      });
    },

    async getBars(
      symbolInfo: TVSymbolInfo,
      resolution: string,
      periodParams: TVPeriodParams,
      onResult: (bars: TVBar[], meta: { noData: boolean }) => void,
      onError: (reason: string) => void,
    ) {
      try {
        const interval = RESOLUTION_MAP[resolution] ?? '4h';
        const s = await deps.resolveTicker(symbolInfo.ticker);
        if (!s) return onError(`Unknown symbol: ${symbolInfo.ticker}`);

        const ms = INTERVAL_MS[interval] ?? 14_400_000;
        // countBack is what the library actually wants; from/to is a hint. Ask
        // for a margin so a partial page does not read as the end of history.
        const want = Math.max(periodParams.countBack + 50,
          Math.ceil((periodParams.to - periodParams.from) * 1000 / ms) + 50);

        const hist = await fetchHistory({
          symbol: s.ticker, interval, bars: Math.min(want, 5000), source: s.source,
        });

        const bars: TVBar[] = hist.candles
          .filter(c => c.time >= periodParams.from * 1000 && c.time <= periodParams.to * 1000)
          .map(c => ({
            time: c.time,          // MILLISECONDS. Seconds here silently renders 1970.
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
          }));

        // noData must be true when a range genuinely has none, or the library
        // pages backwards forever hunting for bars that do not exist.
        onResult(bars, { noData: bars.length === 0 });
      } catch (e) {
        onError((e as Error).message);
      }
    },

    subscribeBars(
      symbolInfo: TVSymbolInfo,
      resolution: string,
      onTick: (bar: TVBar) => void,
      subscriberUID: string,
      _onResetCacheNeededCallback: () => void,
    ) {
      const interval = RESOLUTION_MAP[resolution] ?? '4h';
      const ms = INTERVAL_MS[interval] ?? 14_400_000;

      void (async () => {
        const s = await deps.resolveTicker(symbolInfo.ticker);
        if (!s) return;

        // A tick either EXTENDS the forming bar or opens a new one. Emitting a
        // fresh bar on every tick makes the chart grow a candle per update.
        const push = (c: Candle) => {
          const prev = lastBar.get(subscriberUID);
          const bucket = Math.floor(c.time / ms) * ms;
          if (prev && Math.floor(prev.time / ms) * ms === bucket) {
            const merged: Candle = {
              time: prev.time,
              open: prev.open,
              high: Math.max(prev.high, c.high),
              low: Math.min(prev.low, c.low),
              close: c.close,
              volume: (prev.volume ?? 0) + (c.volume ?? 0),
            };
            lastBar.set(subscriberUID, merged);
            onTick({ ...merged });
          } else {
            const fresh: Candle = { ...c, time: bucket };
            lastBar.set(subscriberUID, fresh);
            onTick({ ...fresh });
          }
        };

        if (deps.subscribeLive) {
          subs.set(subscriberUID, deps.subscribeLive({ symbol: s, interval, onBar: push }));
          return;
        }

        // Polling fallback. Deliberately slow — the strategy engine only acts on
        // closed bars, so this exists to keep the display honest, not to feed a
        // decision. Hammering a paid RPC for a smoother candle is a bad trade.
        const poll = setInterval(async () => {
          try {
            const h = await fetchHistory({ symbol: s.ticker, interval, bars: 2, source: s.source });
            const latest = h.candles[h.candles.length - 1];
            if (latest) push(latest);
          } catch { /* transient; next tick retries */ }
        }, Math.min(Math.max(ms / 60, 10_000), 60_000));

        subs.set(subscriberUID, () => clearInterval(poll));
      })();
    },

    unsubscribeBars(subscriberUID: string) {
      subs.get(subscriberUID)?.();
      subs.delete(subscriberUID);
      lastBar.delete(subscriberUID);
      log(`unsubscribed ${subscriberUID}`);
    },

    getServerTime(callback: (unixSeconds: number) => void) {
      callback(Math.floor(Date.now() / 1000));
    },
  };
}

/**
 * Widget options matching Xenia's palette, so the library does not arrive in
 * TradingView's default light theme.
 *
 * `custom_css_url` is where the rest of the theming goes — the library renders
 * in an iframe, so app-level Tailwind does not reach inside it. That surprises
 * people.
 */
export const XENIA_WIDGET_OVERRIDES = {
  theme: 'dark' as const,
  overrides: {
    'paneProperties.background': '#080B10',
    'paneProperties.backgroundType': 'solid',
    'paneProperties.vertGridProperties.color': 'rgba(255,255,255,0.03)',
    'paneProperties.horzGridProperties.color': 'rgba(255,255,255,0.03)',
    'scalesProperties.textColor': '#4B5563',
    'scalesProperties.lineColor': 'rgba(255,255,255,0.06)',
    'mainSeriesProperties.candleStyle.upColor': '#26D9A3',
    'mainSeriesProperties.candleStyle.downColor': '#FF5C6C',
    'mainSeriesProperties.candleStyle.borderUpColor': '#26D9A3',
    'mainSeriesProperties.candleStyle.borderDownColor': '#FF5C6C',
    'mainSeriesProperties.candleStyle.wickUpColor': '#26D9A3',
    'mainSeriesProperties.candleStyle.wickDownColor': '#FF5C6C',
  },
  loading_screen: { backgroundColor: '#080B10', foregroundColor: '#2BFFF1' },
  disabled_features: [
    'use_localstorage_for_settings',   // persist layouts server-side instead
    'header_symbol_search',            // our own search knows our markets
  ],
  enabled_features: [
    'hide_left_toolbar_by_default',
    'side_toolbar_in_fullscreen_mode',
  ],
};

/**
 * Position lines on Advanced Charts.
 *
 * The library has its own createPositionLine / createOrderLine API — richer than
 * lightweight-charts' price lines, since they are draggable and can carry a
 * quantity and a close button.
 *
 * The rule from XeniaChart still holds and matters more here, because a
 * draggable liquidation line looks authoritative: pass the liquidation price the
 * VENUE reports. Never compute it locally. On routed leverage it is their number,
 * and ours would be an estimate drawn as a fact.
 */
export function applyPositionLines(
  chartWidget: any,
  position: { entry: number; stop?: number; target?: number; liquidation?: number; size: number; side: 1 | -1 },
) {
  const chart = chartWidget.activeChart();
  const lines: any[] = [];

  lines.push(chart.createPositionLine()
    .setPrice(position.entry)
    .setText(`${position.side > 0 ? 'LONG' : 'SHORT'} ${position.size}`)
    .setLineColor('#2BFFF1').setBodyBorderColor('#2BFFF1').setBodyTextColor('#2BFFF1'));

  if (position.target) {
    lines.push(chart.createOrderLine().setPrice(position.target)
      .setText('TARGET').setLineStyle(2).setLineColor('#26D9A3').setBodyTextColor('#26D9A3'));
  }
  if (position.stop) {
    lines.push(chart.createOrderLine().setPrice(position.stop)
      .setText('STOP').setLineStyle(2).setLineColor('#FFB84D').setBodyTextColor('#FFB84D'));
  }
  if (position.liquidation) {
    lines.push(chart.createOrderLine().setPrice(position.liquidation)
      .setText('LIQUIDATION').setLineWidth(2)
      .setLineColor('#FF3B4E').setBodyBorderColor('#FF3B4E').setBodyTextColor('#FF3B4E'));
  }
  return () => lines.forEach(l => l.remove());
}
