-- ========== TELEGRAM SETTINGS ==========
create table if not exists public.telegram_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_chat_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.telegram_settings enable row level security;
create policy "Users manage own telegram settings" on public.telegram_settings
  for all using (auth.uid() = user_id);

-- ========== TRADING PRESETS ==========
create table if not exists public.trading_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  tp_distance_pct numeric not null default 1.0,
  exit_strategy text not null default 'fixed_tp' check (exit_strategy in ('fixed_tp', 'trailing_stop', 'contrary_signal')),
  trailing_stop_pct numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, symbol)
);
alter table public.trading_presets enable row level security;
create policy "Users manage own trading presets" on public.trading_presets
  for all using (auth.uid() = user_id);

-- ========== TRADING STATES (Stateful Trigger Process) ==========
create table if not exists public.trading_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  state text not null default 'IDLE' check (state in ('IDLE', 'BIAS_ESTABLISHED', 'SETUP_ESTABLISHED', 'MANAGING_POSITION')),
  bias_direction text check (bias_direction in ('LONG', 'SHORT', 'NONE')),
  bias_timestamp timestamptz,
  setup_timestamp timestamptz,
  entry_timestamp timestamptz,
  position_taken_over boolean not null default false,
  entry_price numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, symbol)
);
alter table public.trading_states enable row level security;
create policy "Users manage own trading states" on public.trading_states
  for all using (auth.uid() = user_id);
