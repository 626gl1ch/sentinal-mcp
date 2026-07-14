-- ========== HIGH-THROUGHPUT PERFORMANCE INDEXES & SCALABILITY OPTIMIZATIONS ==========

-- 1. Accelerate API key & Subscription tier lookups per gateway request
create index if not exists idx_subscriptions_user_id 
  on public.subscriptions(user_id);

-- 2. Accelerate Credential Vault payload decryption queries
create index if not exists idx_credential_vault_user_connector 
  on public.credential_vault(user_id, connector_id);

-- 3. Accelerate Trading Bot Cron Scheduler state machine monitoring (state != 'IDLE')
create index if not exists idx_trading_states_active 
  on public.trading_states(state) 
  where state != 'IDLE';

-- 4. Accelerate TradingView incoming webhook broadcast dispatch per symbol
create index if not exists idx_trading_presets_symbol 
  on public.trading_presets(symbol);

-- 5. Accelerate user audit log queries for dashboard overview
create index if not exists idx_audit_log_user_time 
  on public.audit_log(user_id, created_at desc);
