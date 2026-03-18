-- ============================================================
-- Xenia Trading — Optimized Schema
-- One row per user. All state stored as JSONB on that row.
-- Dramatically reduces writes vs inserting rows per trade.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── Single user account row — everything lives here ──────────────────────
-- positions      JSONB array of open + recent closed positions
-- stats          JSONB object: totalPnl, winCount, lossCount, tradeCount
-- points         JSONB object keyed by month '2026-03': { points, volume }
-- deposits       JSONB array of deposit records
create table if not exists trading_accounts (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade unique,
  username        text unique,
  mock_balance    numeric not null default 1000.0,
  real_balance    numeric not null default 0.0,
  use_real        boolean not null default false,
  sol_address     text,
  evm_address     text,
  positions       jsonb not null default '[]'::jsonb,
  stats           jsonb not null default '{"totalPnl":0,"winCount":0,"lossCount":0,"tradeCount":0}'::jsonb,
  monthly_points  jsonb not null default '{}'::jsonb,
  deposits        jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table trading_accounts enable row level security;

create policy "Users own their account"
  on trading_accounts for select using (auth.uid() = user_id);
create policy "Users can insert their account"
  on trading_accounts for insert with check (auth.uid() = user_id);
create policy "Users can update their account"
  on trading_accounts for update using (auth.uid() = user_id);

-- ── Public leaderboard view — read only, no PII ───────────────────────────
-- Exposes just username + monthly_points for the leaderboard.
-- No positions or balance data exposed.
create or replace view public_leaderboard as
  select
    user_id,
    username,
    monthly_points
  from trading_accounts
  where username is not null;

-- Allow anyone to read the leaderboard view
grant select on public_leaderboard to anon, authenticated;

-- ── Auto-update timestamp ─────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trading_accounts_updated
  before update on trading_accounts
  for each row execute function update_updated_at();

-- ── Level tier reference (informational) ─────────────────────────────────
-- Level thresholds by monthly points
-- L1  Recruit     0
-- L2  Trader      100
-- L3  Degen       1,000
-- L4  Scalper     5,000
-- L5  Hunter      10,000
-- L6  Apex        25,000
-- L7  Predator    50,000
-- L8  Legend      100,000
-- L9  Elite       250,000
-- L10 Xenia Pro   1,000,000
