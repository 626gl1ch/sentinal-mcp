-- ========== USERS & PROFILES ==========
-- Supabase Auth handles auth.users; this extends it.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Trigger to automatically create a profile for new auth.users
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ========== CONNECTOR CATALOG (public, admin-managed) ==========
create table public.connectors (
  id text primary key,              -- e.g. 'mt5', 'bybit', 'tradingview', 'fred', 'ohlcv'
  name text not null,
  description text,
  requires_credentials boolean not null default true,
  supports_execution_mode boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.connectors enable row level security;
create policy "Anyone can read active connectors" on public.connectors
  for select using (is_active = true);

-- ========== SUBSCRIPTIONS (mirrors Stripe) ==========
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text unique,
  tier text not null check (tier in ('free','trader','pro','team')),
  status text not null check (status in ('active','past_due','canceled','trialing')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy "Users read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

-- ========== USER CONNECTOR ENABLEMENT ==========
create table public.user_connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_id text not null references public.connectors(id),
  mode text not null default 'read_only' check (mode in ('read_only','execution')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, connector_id)
);
alter table public.user_connectors enable row level security;
create policy "Users manage own connectors" on public.user_connectors
  for all using (auth.uid() = user_id);

-- ========== ENCRYPTED CREDENTIAL VAULT ==========
-- Encryption happens application-side (Worker) using a key from Cloudflare
-- secrets, NEVER in the client. Postgres column stores ciphertext only.
create table public.credential_vault (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_id text not null references public.connectors(id),
  label text,                          -- e.g. "Exness Live" / "Bybit Main"
  encrypted_payload text not null,     -- AES-GCM ciphertext, base64
  encryption_key_version int not null default 1,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, connector_id, label)
);
alter table public.credential_vault enable row level security;
create policy "Users manage own credentials" on public.credential_vault
  for all using (auth.uid() = user_id);

-- ========== API KEYS (for MCP endpoint auth) ==========
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key_hash text not null unique,     -- store a hash, never the raw key
  key_prefix text not null,          -- first 8 chars, shown in UI for identification
  label text,
  revoked boolean not null default false,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.api_keys enable row level security;
create policy "Users manage own API keys" on public.api_keys
  for all using (auth.uid() = user_id);

-- ========== USAGE / RATE LIMITING LOG ==========
create table public.usage_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_id text not null,
  endpoint text not null,
  status_code int,
  created_at timestamptz not null default now()
);
alter table public.usage_logs enable row level security;
create policy "Users read own usage" on public.usage_logs
  for select using (auth.uid() = user_id);
create index idx_usage_logs_user_time on public.usage_logs(user_id, created_at desc);

-- ========== AUDIT LOG (security-sensitive actions) ==========
create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,             -- e.g. 'credential_created', 'execution_mode_enabled'
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create policy "Users read own audit trail" on public.audit_log
  for select using (auth.uid() = user_id);

-- ========== SEED CONNECTORS ==========
insert into public.connectors (id, name, description, requires_credentials, supports_execution_mode, is_active)
values
  ('mt5', 'MetaTrader 5', 'Connects to a MetaTrader 5 terminal over HTTP/ZeroMQ bridge', true, true, true),
  ('bybit', 'Bybit REST & WS', 'Connects to Bybit REST and WebSockets API', true, true, true),
  ('tradingview', 'TradingView Webhooks', 'Receives webhooks from TradingView alerts', true, false, true),
  ('fred', 'FRED Data', 'Fetch macroeconomic data from Federal Reserve Economic Data', true, false, true),
  ('ohlcv', 'OHLCV Normalizer', 'Aggregates and normalizes OHLCV candles from multiple feeds', false, false, true)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  requires_credentials = excluded.requires_credentials,
  supports_execution_mode = excluded.supports_execution_mode,
  is_active = excluded.is_active;
