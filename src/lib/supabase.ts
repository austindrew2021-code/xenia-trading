import { createClient } from '@supabase/supabase-js';

const url  = (import.meta as any).env?.VITE_TRADING_SUPABASE_URL  as string;
const key  = (import.meta as any).env?.VITE_TRADING_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  console.warn('Supabase env vars missing — auth and cloud sync disabled');
}

export const supabase = url && key ? createClient(url, key) : null;

export function currentMonth() {
  return new Date().toISOString().slice(0, 7); // '2026-03'
}

// Points per $1 USD notional volume
export const POINTS_PER_USD = 1;

// Level thresholds (monthly points)
export const LEVEL_TIERS = [
  { level: 1,  label: 'Recruit',   min: 0,       color: '#6B7280' },
  { level: 2,  label: 'Trader',    min: 100,      color: '#A78BFA' },
  { level: 3,  label: 'Degen',     min: 1_000,    color: '#60A5FA' },
  { level: 4,  label: 'Scalper',   min: 5_000,    color: '#34D399' },
  { level: 5,  label: 'Hunter',    min: 10_000,   color: '#2BFFF1' },
  { level: 6,  label: 'Apex',      min: 25_000,   color: '#F59E0B' },
  { level: 7,  label: 'Predator',  min: 50_000,   color: '#F97316' },
  { level: 8,  label: 'Legend',    min: 100_000,  color: '#EF4444' },
  { level: 9,  label: 'Elite',     min: 250_000,  color: '#EC4899' },
  { level: 10, label: 'Xenia Pro', min: 1_000_000,color: '#FFD700' },
] as const;

export function getLevel(points: number) {
  for (let i = LEVEL_TIERS.length - 1; i >= 0; i--) {
    if (points >= LEVEL_TIERS[i].min) return LEVEL_TIERS[i];
  }
  return LEVEL_TIERS[0];
}

export function getNextLevel(points: number) {
  const tier = getLevel(points);
  const next = LEVEL_TIERS.find(t => t.level === tier.level + 1);
  return next ?? null;
}

export function getLevelProgress(points: number) {
  const curr = getLevel(points);
  const next = getNextLevel(points);
  if (!next) return 100;
  return ((points - curr.min) / (next.min - curr.min)) * 100;
}
