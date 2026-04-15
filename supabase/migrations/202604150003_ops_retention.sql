create or replace function public.cleanup_ops_tables(
  p_rate_limit_retention_hours integer default 48,
  p_event_log_retention_days integer default 14
)
returns table (
  deleted_rate_limit_rows bigint,
  deleted_event_log_rows bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate_hours integer := greatest(coalesce(p_rate_limit_retention_hours, 48), 1);
  v_log_days integer := greatest(coalesce(p_event_log_retention_days, 14), 1);
begin
  with deleted as (
    delete from public.function_rate_limits
    where updated_at < now() - make_interval(hours => v_rate_hours)
    returning 1
  )
  select count(*) into deleted_rate_limit_rows from deleted;

  with deleted as (
    delete from public.function_event_logs
    where created_at < now() - make_interval(days => v_log_days)
    returning 1
  )
  select count(*) into deleted_event_log_rows from deleted;

  return next;
end;
$$;

revoke all on function public.cleanup_ops_tables(integer, integer) from public;
grant execute on function public.cleanup_ops_tables(integer, integer) to service_role;
