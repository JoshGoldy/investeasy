create table if not exists public.function_rate_limits (
  scope text not null,
  subject text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope, subject, window_start)
);

create index if not exists idx_function_rate_limits_updated_at
  on public.function_rate_limits (updated_at);

create or replace function public.consume_rate_limit(
  p_scope text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_seconds integer := greatest(coalesce(p_window_seconds, 60), 10);
  v_limit integer := greatest(coalesce(p_limit, 1), 1);
  v_scope text := left(coalesce(nullif(trim(p_scope), ''), 'unknown'), 80);
  v_subject text := left(coalesce(nullif(trim(p_subject), ''), 'anonymous'), 160);
  v_window_start timestamptz;
  v_count integer;
begin
  v_window_start := to_timestamp(floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds);

  insert into public.function_rate_limits (scope, subject, window_start, count, updated_at)
  values (v_scope, v_subject, v_window_start, 1, v_now)
  on conflict (scope, subject, window_start)
  do update
    set count = public.function_rate_limits.count + 1,
        updated_at = excluded.updated_at
  returning public.function_rate_limits.count into v_count;

  allowed := v_count <= v_limit;
  remaining := greatest(v_limit - v_count, 0);
  reset_at := v_window_start + make_interval(secs => v_window_seconds);
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
