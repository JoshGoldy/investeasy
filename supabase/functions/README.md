## Supabase Edge Functions

This app now expects:

- `finbot` for AI analysis requests
- `market-data` for quotes, charts, news/article fetches, and calendar data on static hosting

### Required secrets

Set these in your Supabase project before deploying:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (optional, defaults to `claude-sonnet-4-5`)

### Deploy

From the project root:

```bash
supabase db push
supabase functions deploy finbot
supabase functions deploy market-data
```

If you are linking the project locally first:

```bash
supabase link --project-ref myldggtkyfdtymaxzspa
supabase db push
supabase functions deploy finbot
supabase functions deploy market-data
```

### Local secret setup example

```bash
supabase secrets set ANTHROPIC_API_KEY=your_key_here
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-5
```

After deployment, the frontend calls the function through `supabase.functions.invoke('finbot')`.
Market data calls go through `supabase.functions.invoke('market-data')`.

### Abuse protection

This repo now includes a Supabase migration for shared function throttling:

- [20260415_function_rate_limits.sql](C:/Users/joshu/Desktop/investeasy/supabase/migrations/20260415_function_rate_limits.sql)

Apply it before deploying or redeploying the functions:

```bash
supabase db push
```

Current protections:

- `finbot`: authenticated user-based limits by request type
- `market-data`: IP-based limits by action
- `article` extraction: restricted to supported finance/news domains

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
