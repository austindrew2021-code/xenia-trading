import type { ReactNode } from 'react';
import { num, t } from './ui';

// ── Xenia — App shell ──────────────────────────────────────────────────────
//
// The frame every screen sits inside. Two things it exists to enforce:
//
//   1. NAVIGATION IS ALWAYS REACHABLE AND ALWAYS THE SAME. Five destinations,
//      no more. A sixth tab means the information architecture is wrong, not
//      that the bar needs to be smaller — at six the labels truncate and the
//      touch targets fall under 44px.
//
//   2. LIVE MODE IS IMPOSSIBLE TO MISS. When real funds are at risk there is a
//      persistent band across the top. Not a badge, not a coloured dot — a band,
//      because the entire failure mode this guards against is a user believing
//      they are in mock. It is the one piece of chrome allowed to be loud.
//
// The nav labels name destinations, not features: a trader looks for "Markets",
// not "Discover". Vocabulary consistency is how someone learns their way around
// an app, so whatever a thing is called here it is called everywhere.

export type Tab = 'home' | 'markets' | 'trade' | 'positions' | 'more';

export interface AppShellProps {
  tab: Tab;
  onTabChange: (t: Tab) => void;
  mode: 'mock' | 'live';
  /** Count badge on Positions. Omit or 0 to hide. */
  openPositions?: number;
  children: ReactNode;
}

const ICONS: Record<Tab, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V21H3z" />,
  markets: <><path d="M3 20h18" /><path d="M6 16v-5" /><path d="M11 16V6" /><path d="M16 16v-8" /></>,
  trade: <><path d="M4 17 10 11l4 4 6-8" /><path d="M20 3v4h-4" /></>,
  positions: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
};

const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'markets', label: 'Markets' },
  { key: 'trade', label: 'Trade' },
  { key: 'positions', label: 'Positions' },
  { key: 'more', label: 'More' },
];

export default function AppShell({
  tab, onTabChange, mode, openPositions = 0, children,
}: AppShellProps) {
  return (
    <div className="flex flex-col h-[100dvh] bg-[#080B10] text-[#E5E9EF] overflow-hidden">

      {mode === 'live' && (
        <div className="shrink-0 bg-[#EF4444]/12 border-b border-[#EF4444]/30
                        px-3 py-1 flex items-center gap-1.5
                        pt-[max(4px,env(safe-area-inset-top))]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
          <span className={`${t.label} text-[#EF4444]`}>
            Live — trades spend real funds
          </span>
        </div>
      )}

      <main className="flex-1 min-h-0 overflow-hidden">{children}</main>

      <nav
        aria-label="Main"
        className="shrink-0 flex border-t border-white/[0.06] bg-[#0A0D12]
                   pb-[env(safe-area-inset-bottom)]"
      >
        {TABS.map(item => {
          const on = tab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onTabChange(item.key)}
              aria-current={on ? 'page' : undefined}
              className="flex-1 flex flex-col items-center gap-0.5 pt-1.5 pb-1
                         min-h-[48px] transition-colors duration-[120ms]
                         focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#2BFFF1]"
            >
              <span className="relative">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke={on ? '#2BFFF1' : '#4B5563'} strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {ICONS[item.key]}
                </svg>
                {item.key === 'positions' && openPositions > 0 && (
                  <span className={`${num} absolute -top-1 -right-2 min-w-[13px] h-[13px] px-[3px]
                                    rounded-full bg-[#2BFFF1] text-[#080B10]
                                    text-[8px] font-black leading-[13px] text-center`}>
                    {openPositions > 9 ? '9+' : openPositions}
                  </span>
                )}
              </span>
              <span className={`text-[9px] font-bold tracking-tight ${
                on ? 'text-[#2BFFF1]' : 'text-[#4B5563]'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
