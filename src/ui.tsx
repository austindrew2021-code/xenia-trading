import { useEffect, useRef, useState, type ReactNode } from 'react';

// ── Xenia — Design system ──────────────────────────────────────────────────
//
// One vocabulary for every screen. The reason this file exists is not tidiness:
// it is that a trading app is judged on consistency more than on any individual
// screen. When a panel border is 6% white here and 8% white there, or a label is
// 9px on one page and 10px on the next, the product reads as assembled rather
// than designed — and users extend that judgement to whether the numbers can be
// trusted. Import from here; do not hand-write hex or spacing in a page.
//
// ── THE SYSTEM ─────────────────────────────────────────────────────────────
//
// COLOUR — six values, and a rule about two of them
//   ink        #080B10   page ground
//   panel      #0D1117   raised surface
//   hairline   #FFFFFF at 6%   every border in the app
//   text       #E5E9EF   primary
//   muted      #6B7280 / #4B5563   secondary / labels
//   accent     #2BFFF1   interactive and selected state ONLY
//   up/down    #10B981 / #EF4444
//
//   The rule: green and red are reserved for direction and nothing else. Not for
//   success toasts, not for confirm buttons, not for a healthy status dot. The
//   instant a green appears that does not mean "price up", the eye stops reading
//   colour as direction and every P&L figure on the screen slows down. Amber
//   #F59E0B carries warnings so it never has to borrow red.
//
// TYPE — two roles, and the one that matters
//   Numbers are mono with tabular figures. Always. This is the single largest
//   difference between a terminal and a generic app: decimals align down a
//   column, and a price ticking 0.19 → 0.21 does not reflow the row. Labels and
//   prose are the sans stack. Never mix — a price in the sans face looks broken
//   next to one that is not.
//
//   Scale, in px, and it is deliberately short: 9 (label) 10 (meta) 11 (body)
//   12 (row) 15 (heading) 26 (hero price). Anything not on this list is a
//   mistake waiting to spread.
//
// SPACING — 8px rhythm, 2/4/6/8/12 for the inside of things
//   Density is the product. Padding of 16-24 is what makes an app show six rows
//   where a terminal shows fourteen.
//
// MOTION — 120ms on colour, nothing on layout
//   Traders re-read the same number many times a second. Animated layout makes
//   that harder, and animated numbers make it impossible. Transitions are for
//   press states and sheets, never for values. `prefers-reduced-motion` is
//   respected in index.css.

// ── tokens ─────────────────────────────────────────────────────────────────

export const c = {
  ink: '#080B10',
  panel: '#0D1117',
  panelRaised: '#11161D',
  hairline: 'rgba(255,255,255,0.06)',
  text: '#E5E9EF',
  muted: '#6B7280',
  faint: '#4B5563',
  ghost: '#374151',
  accent: '#2BFFF1',
  up: '#10B981',
  down: '#EF4444',
  warn: '#F59E0B',
} as const;

/** Mono + tabular. Every number in the app gets this class. */
export const num = 'font-mono tabular-nums tracking-tight';

export const t = {
  label: 'text-[9px] uppercase tracking-[0.14em] font-semibold text-[#4B5563]',
  meta: 'text-[10px] text-[#6B7280]',
  body: 'text-[11px] text-[#E5E9EF]',
  row: 'text-[12px] font-semibold text-[#E5E9EF]',
  heading: 'text-[15px] font-black tracking-tight text-[#E5E9EF]',
  hero: 'text-[26px] font-bold leading-none',
} as const;

export const surface = {
  panel: 'bg-[#0D1117] border border-white/[0.06] rounded-lg',
  inset: 'bg-[#080B10] border border-white/[0.06] rounded-lg',
  divider: 'h-px bg-white/[0.06]',
} as const;

export const tone = (v: number) => (v >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]');

// ── formatters ─────────────────────────────────────────────────────────────
//
// Centralised because a price formatted two ways in one app is a bug users can
// see. Memecoins need more significant figures as they get cheaper, not fewer.

export function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return v.toFixed(4);
  if (a >= 0.01) return v.toFixed(5);
  if (a >= 0.0001) return v.toFixed(7);
  return v.toPrecision(4);
}

/**
 * Narrower variant for list columns, where a 70px cell cannot hold seven
 * decimals. Same rules as fmtPrice, one significant figure fewer at each step.
 * It exists here rather than in a page so the two never drift apart.
 */
export function fmtPriceCompact(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return v.toFixed(3);
  if (a >= 0.01) return v.toFixed(4);
  if (a >= 0.0001) return v.toFixed(6);
  return v.toPrecision(3);
}

/** Magnitude without the dollar sign, for columns headed "Vol" or "Liq". */
export function fmtUsdBare(v?: number): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

export function fmtUsd(v: number | undefined, compact = true): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (compact) {
    if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  }
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const fmtPct = (v: number, dp = 2) =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%` : '—';

export function fmtAge(ms?: number): string {
  if (!ms) return '—';
  const mins = (Date.now() - ms) / 60000;
  if (mins < 1) return 'now';
  if (mins < 60) return `${Math.floor(mins)}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  const d = Math.floor(mins / 1440);
  return d < 365 ? `${d}d` : `${Math.floor(d / 365)}y`;
}

// ── primitives ─────────────────────────────────────────────────────────────

export function Panel({ children, className = '', pad = true }: {
  children: ReactNode; className?: string; pad?: boolean;
}) {
  return <div className={`${surface.panel} ${pad ? 'p-2.5' : ''} ${className}`}>{children}</div>;
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`${t.label} ${className}`}>{children}</span>;
}

/** Label above value. The atom the whole app is built from. */
export function Stat({ label, value, tone: tn, mono = true, className = '' }: {
  label: string; value: string;
  tone?: 'up' | 'down' | 'accent' | 'warn'; mono?: boolean; className?: string;
}) {
  const color = tn === 'up' ? 'text-[#10B981]'
    : tn === 'down' ? 'text-[#EF4444]'
    : tn === 'accent' ? 'text-[#2BFFF1]'
    : tn === 'warn' ? 'text-[#F59E0B]' : 'text-[#E5E9EF]';
  return (
    <div className={`flex flex-col gap-[1px] min-w-0 ${className}`}>
      <Label>{label}</Label>
      <span className={`${mono ? num : ''} text-[11px] font-semibold ${color} truncate`}>{value}</span>
    </div>
  );
}

type BtnVariant = 'primary' | 'ghost' | 'buy' | 'sell' | 'danger';

const BTN: Record<BtnVariant, string> = {
  primary: 'bg-[#2BFFF1]/12 border-[#2BFFF1]/30 text-[#2BFFF1] active:bg-[#2BFFF1]/20',
  ghost: 'bg-white/[0.04] border-white/[0.08] text-[#E5E9EF] active:bg-white/[0.09]',
  buy: 'bg-[#10B981]/15 border-[#10B981]/40 text-[#10B981] active:bg-[#10B981]/25',
  sell: 'bg-[#EF4444]/15 border-[#EF4444]/40 text-[#EF4444] active:bg-[#EF4444]/25',
  // Destructive, not directional. Amber so it never competes with a short.
  danger: 'bg-[#F59E0B]/12 border-[#F59E0B]/35 text-[#F59E0B] active:bg-[#F59E0B]/20',
};

export function Button({
  children, onClick, variant = 'ghost', disabled, size = 'md', className = '', type = 'button',
}: {
  children: ReactNode; onClick?: () => void; variant?: BtnVariant;
  disabled?: boolean; size?: 'sm' | 'md' | 'lg'; className?: string;
  type?: 'button' | 'submit';
}) {
  const pad = size === 'sm' ? 'py-1 px-2 text-[10px]'
    : size === 'lg' ? 'py-3 text-[12px]' : 'py-2 text-[11px]';
  return (
    <button
      type={type} onClick={onClick} disabled={disabled}
      className={`w-full rounded-lg border font-black uppercase tracking-[0.1em]
                  transition-colors duration-[120ms] disabled:opacity-25
                  focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#2BFFF1]
                  ${pad} ${BTN[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: {
  value: T; options: { key: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex border-y border-white/[0.06]">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em]
                      border-b-2 transition-colors duration-[120ms] ${
            value === o.key ? 'border-[#2BFFF1] text-[#2BFFF1]' : 'border-transparent text-[#4B5563]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange }: {
  value: T; options: { key: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto no-scrollbar">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`${num} px-2.5 py-1 rounded text-[10px] font-bold whitespace-nowrap border
                      transition-colors duration-[120ms] ${
            value === o.key
              ? 'bg-[#2BFFF1]/12 border-[#2BFFF1]/25 text-[#2BFFF1]'
              : 'bg-transparent border-white/[0.07] text-[#4B5563]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Empty states are directions, not apologies. Every one names what is absent and
 * gives the single action that fills it. A blank panel that says "No data" is a
 * dead end; the user has to guess what to do next, and often the answer is close
 * the app.
 */
export function Empty({ message, actionLabel, onAction }: {
  message: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div className="py-12 px-8 text-center">
      <p className="text-[11px] text-[#9CA3AF] leading-relaxed">{message}</p>
      {actionLabel && onAction && (
        <button onClick={onAction} className="mt-2 text-[11px] font-bold text-[#2BFFF1]">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** Shaped like the content it replaces, so nothing jumps when data lands. */
export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse motion-reduce:animate-none">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.035]">
          <div className="w-11 h-3 rounded bg-white/[0.05]" />
          <div className="flex-1 h-3 rounded bg-white/[0.05]" />
          <div className="w-[70px] h-3 rounded bg-white/[0.04]" />
          <div className="w-[56px] h-3 rounded bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}

/**
 * Bottom sheet. Deposit, confirm, wallet unlock — anything that interrupts.
 * Sheets rather than centred modals because a thumb reaches the bottom of a 6.8"
 * screen and does not reach the middle.
 */
export function Sheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className="relative bg-[#0D1117] border-t border-white/[0.08] rounded-t-2xl
                   pb-[max(12px,env(safe-area-inset-bottom))] max-h-[85dvh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-[#0D1117] px-3 pt-2.5 pb-2 flex items-center justify-between
                        border-b border-white/[0.06]">
          <span className={t.heading}>{title}</span>
          <button onClick={onClose} aria-label="Close"
            className="text-[#4B5563] text-[18px] leading-none px-1">×</button>
        </div>
        <div className="px-3 pt-2.5">{children}</div>
      </div>
    </div>
  );
}

/**
 * Toast. Deliberately not green on success — see the colour rule at the top.
 * Confirmation reads as accent; problems read as amber.
 */
export function Toast({ message, kind = 'info', onDone, ms = 3200 }: {
  message: string; kind?: 'info' | 'warn'; onDone: () => void; ms?: number;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const id = setTimeout(() => done.current(), ms);
    return () => clearTimeout(id);
  }, [message, ms]);
  return (
    <div role="status" aria-live="polite"
      className="fixed left-3 right-3 bottom-[calc(60px+env(safe-area-inset-bottom))] z-50">
      <div className={`rounded-lg border px-3 py-2 backdrop-blur-sm ${
        kind === 'warn'
          ? 'bg-[#F59E0B]/12 border-[#F59E0B]/30 text-[#F59E0B]'
          : 'bg-[#2BFFF1]/10 border-[#2BFFF1]/25 text-[#2BFFF1]'}`}>
        <p className="text-[11px] font-semibold leading-snug">{message}</p>
      </div>
    </div>
  );
}

/**
 * A price that flashes its direction on change and then settles. The flash is on
 * background, never on the digits — moving or recolouring the number itself is
 * what makes a ticking price hard to read.
 */
export function LivePrice({ value, className = '' }: { value: number; className?: string }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (value === prev.current) return;
    setFlash(value > prev.current ? 'up' : 'down');
    prev.current = value;
    const id = setTimeout(() => setFlash(null), 260);
    return () => clearTimeout(id);
  }, [value]);

  return (
    <span className={`${num} rounded px-0.5 transition-colors duration-[120ms] ${
      flash === 'up' ? 'bg-[#10B981]/20' : flash === 'down' ? 'bg-[#EF4444]/20' : ''} ${className}`}>
      {fmtPrice(value)}
    </span>
  );
}
