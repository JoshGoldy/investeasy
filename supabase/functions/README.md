## Supabase Edge Functions

This app now expects a `finbot` Edge Function for AI analysis requests.

### Required secrets

Set these in your Supabase project before deploying:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (optional, defaults to `claude-3-5-sonnet-latest`)

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
supabase secrets set ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```

After deployment, the frontend calls the function through `supabase.functions.invoke('finbot')`.
