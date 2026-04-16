create table if not exists public.market_cache (
  cache_key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_market_cache_expires_at
  on public.market_cache (expires_at);
