create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.billing_plans (
  tier text primary key,
  label text not null,
  price_zar numeric(12,2) not null,
  monthly_credits integer not null,
  active boolean not null default true,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plans_tier_check check (tier in ('basic', 'pro', 'enterprise'))
);

insert into public.billing_plans (tier, label, price_zar, monthly_credits, description, sort_order)
values
  ('basic', 'Basic', 99.00, 15, 'Starter AI access with monthly credits.', 1),
  ('pro', 'Pro', 199.00, 50, 'Full FinBot access with a larger monthly credit pool.', 2),
  ('enterprise', 'Enterprise', 499.00, 200, 'Highest monthly credit pool and premium support.', 3)
on conflict (tier) do update
set
  label = excluded.label,
  price_zar = excluded.price_zar,
  monthly_credits = excluded.monthly_credits,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  provider text not null default 'paystack',
  provider_customer_code text,
  email text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_billing_customers_provider_code
  on public.billing_customers(provider, provider_customer_code)
  where provider_customer_code is not null;

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'paystack',
  provider_subscription_code text,
  provider_plan_code text,
  provider_customer_code text,
  tier text not null,
  status text not null default 'pending',
  amount_zar numeric(12,2),
  currency text not null default 'ZAR',
  next_payment_at timestamptz,
  cancel_at_period_end boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_subscriptions_tier_check check (tier in ('basic', 'pro', 'enterprise')),
  constraint billing_subscriptions_status_check check (status in ('pending', 'active', 'past_due', 'non_renewing', 'cancelled', 'failed'))
);

create unique index if not exists idx_billing_subscriptions_provider_code
  on public.billing_subscriptions(provider, provider_subscription_code)
  where provider_subscription_code is not null;

create index if not exists idx_billing_subscriptions_user_id
  on public.billing_subscriptions(user_id, created_at desc);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paystack',
  provider_event_type text not null,
  provider_event_key text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  processed boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_events_created_at on public.billing_events(created_at desc);
create index if not exists idx_billing_events_user_id on public.billing_events(user_id, created_at desc);

alter table public.profiles
  add column if not exists billing_status text not null default 'inactive',
  add column if not exists current_period_end timestamptz,
  add column if not exists billing_provider text,
  add column if not exists billing_customer_code text,
  add column if not exists billing_subscription_code text;

alter table public.profiles drop constraint if exists profiles_tier_check;

alter table public.profiles
  add constraint profiles_tier_check
  check (tier in ('free', 'basic', 'pro', 'enterprise'));

alter table public.profiles drop constraint if exists profiles_billing_status_check;

alter table public.profiles
  add constraint profiles_billing_status_check
  check (billing_status in ('inactive', 'pending', 'active', 'past_due', 'non_renewing', 'cancelled', 'failed'));

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_billing_plans_updated_at'
  ) then
    create trigger trg_billing_plans_updated_at
    before update on public.billing_plans
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_billing_customers_updated_at'
  ) then
    create trigger trg_billing_customers_updated_at
    before update on public.billing_customers
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_billing_subscriptions_updated_at'
  ) then
    create trigger trg_billing_subscriptions_updated_at
    before update on public.billing_subscriptions
    for each row
    execute function public.set_updated_at();
  end if;
end $$;
