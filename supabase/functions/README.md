## Supabase Edge Functions

This app now expects a `finbot` Edge Function for AI analysis requests.

### Required secrets

Set these in your Supabase project before deploying:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (optional, defaults to `claude-sonnet-4-5`)

### Deploy

From the project root:

```bash
supabase functions deploy finbot
```

If you are linking the project locally first:

```bash
supabase link --project-ref myldggtkyfdtymaxzspa
supabase functions deploy finbot
```

### Local secret setup example

```bash
supabase secrets set ANTHROPIC_API_KEY=your_key_here
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-5
```

After deployment, the frontend calls the function through `supabase.functions.invoke('finbot')`.

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

This repo sets `verify_jwt = false` for `finbot` in [supabase/config.toml](C:/Users/joshu/Desktop/investeasy/supabase/config.toml).
The function still authenticates the caller internally using the Supabase access token from the request header, but disabling gateway JWT verification avoids false `Invalid JWT` failures from the Edge Function gateway.
