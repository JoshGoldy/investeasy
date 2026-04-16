## Supabase Edge Functions

This app now expects:

- `finbot` for AI analysis requests
- `market-data` for quotes, charts, news/article fetches, and calendar data on static hosting
- `paystack-billing` for authenticated plan checkout and verification
- `paystack-webhook` for Paystack subscription webhooks

### Required secrets

Set these in your Supabase project before deploying:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (optional, defaults to `claude-sonnet-4-5`)
- `OPS_ALLOWED_EMAILS` (comma-separated admin emails for the `ops-status` function)
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_CALLBACK_URL` (recommended redirect back into the app after checkout)
- `PAYSTACK_PLAN_BASIC_MONTHLY`
- `PAYSTACK_PLAN_PRO_MONTHLY`
- `PAYSTACK_PLAN_ENTERPRISE_MONTHLY`

### Deploy

From the project root:

```bash
supabase db push
supabase functions deploy finbot
supabase functions deploy market-data
supabase functions deploy ops-status
supabase functions deploy paystack-billing
supabase functions deploy paystack-webhook
```

If you are linking the project locally first:

```bash
supabase link --project-ref myldggtkyfdtymaxzspa
supabase db push
supabase functions deploy finbot
supabase functions deploy market-data
supabase functions deploy ops-status
supabase functions deploy paystack-billing
supabase functions deploy paystack-webhook
```

### Local secret setup example

```bash
supabase secrets set ANTHROPIC_API_KEY=your_key_here
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-5
supabase secrets set OPS_ALLOWED_EMAILS=you@example.com
supabase secrets set PAYSTACK_SECRET_KEY=your_paystack_secret_here
supabase secrets set PAYSTACK_CALLBACK_URL=https://yourusername.github.io/investeasy/settings.html
supabase secrets set PAYSTACK_PLAN_BASIC_MONTHLY=plan_code_basic
supabase secrets set PAYSTACK_PLAN_PRO_MONTHLY=plan_code_pro
supabase secrets set PAYSTACK_PLAN_ENTERPRISE_MONTHLY=plan_code_enterprise
```

After deployment, the frontend calls the function through `supabase.functions.invoke('finbot')`.
Market data calls go through `supabase.functions.invoke('market-data')`.
Enterprise admin diagnostics go through `supabase.functions.invoke('ops-status')`.
Billing checkout goes through `supabase.functions.invoke('paystack-billing')`.
Paystack webhooks terminate at `supabase.functions.invoke('paystack-webhook')` via the public webhook URL.

### Billing migration

Apply the billing schema before deploying the Paystack functions:

- [202604160001_paystack_billing.sql](C:/Users/joshu/Desktop/investeasy/supabase/migrations/202604160001_paystack_billing.sql)

This migration adds:

- `billing_plans`
- `billing_customers`
- `billing_subscriptions`
- `billing_events`
- profile billing fields and the new `basic` tier

### Default plan assumptions

The current seeded defaults are:

- `basic`: `R99` / month, `15` credits
- `pro`: `R199` / month, `50` credits
- `enterprise`: `R499` / month, `200` credits

### Abuse protection

This repo now includes Supabase migrations for shared function throttling and event logs:

- [202604150001_function_rate_limits.sql](C:/Users/joshu/Desktop/investeasy/supabase/migrations/202604150001_function_rate_limits.sql)
- [202604150002_function_event_logs.sql](C:/Users/joshu/Desktop/investeasy/supabase/migrations/202604150002_function_event_logs.sql)
- [202604150003_ops_retention.sql](C:/Users/joshu/Desktop/investeasy/supabase/migrations/202604150003_ops_retention.sql)
- [202604170001_market_cache.sql](C:/Users/joshu/Desktop/investeasy/supabase/migrations/202604170001_market_cache.sql)

Apply it before deploying or redeploying the functions:

```bash
supabase db push
```

Current protections:

- `finbot`: authenticated user-based limits by request type
- `market-data`: IP-based limits by action
- `article` extraction: restricted to supported finance/news domains
- structured server-side event logs for throttles, upstream errors, and request failures

### Shared cache

`market-data` now uses a shared Supabase-backed cache table for hot public responses:

- `quotes`: 1 minute TTL
- `chart` `1D`: 1 minute TTL
- `chart` `1W+`: 5 minute TTL
- `news`: 5 minute TTL
- `calendar`: 15 minute TTL

This is meant to absorb repeated requests for market pulse, top movers, quote lookups, and the main news feed without adding Redis or another paid cache layer yet, while keeping detail quotes and `1D` charts noticeably fresher.

### Server-side logs

Function events are written to:

- `public.function_event_logs`
- `public.function_rate_limits`

That gives you a simple place to inspect:

- rate-limited requests
- upstream API failures
- invalid payload attempts
- FinBot credit/auth problems

### Retention cleanup

To keep the ops tables from growing forever, this repo now includes:

- `public.cleanup_ops_tables(rate_limit_hours, event_log_days)`

Example manual cleanup:

```sql
select * from public.cleanup_ops_tables(48, 14);
```

Recommended defaults:

- rate-limit rows: keep `48` hours
- function event logs: keep `14` days

### Token budgets by mode

The function now uses different `max_tokens` caps per mode so shorter analyses stay cheaper:

- `news`: 1800
- `screener`: 2200
- `technical`: 2200
- `earnings`: 2400
- `dcf`: 3200
- `risk`: 3600
- `builder`: 4200

### JWT verification

This repo sets `verify_jwt = false` for both `finbot` and `market-data` in [supabase/config.toml](C:/Users/joshu/Desktop/investeasy/supabase/config.toml).
`finbot` still authenticates the caller internally using the Supabase access token from the request header, while `market-data` is intentionally public so prices/news can load on static hosting.
