# FinScope

FinScope is a static frontend investing app powered by Supabase Auth, Supabase Edge Functions, and browser-side portfolio/watchlist state.

## Current Stack

- Frontend: plain HTML, CSS, and JavaScript
- Auth + database: Supabase
- AI analysis: Supabase Edge Function `finbot`
- Market data: Supabase Edge Function `market-data`
- Billing: Paystack via Supabase Edge Functions `paystack-billing` and `paystack-webhook`
- Hosting target: GitHub Pages

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/investeasy.git
cd investeasy
```

### 2. Add your Supabase client config

Create or update `supabase-config.js`:

```js
window.SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  anonKey: 'YOUR_PUBLISHABLE_KEY',
};
```

This file is loaded directly by the frontend.

### 3. Link the repo to your Supabase project

From the project root:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
```

### 4. Set required Edge Function secrets

```bash
npx supabase@latest secrets set ANTHROPIC_API_KEY="YOUR_ANTHROPIC_KEY"
npx supabase@latest secrets set ANTHROPIC_MODEL="claude-sonnet-4-5"
npx supabase@latest secrets set OPS_ALLOWED_EMAILS="you@example.com"
npx supabase@latest secrets set PAYSTACK_SECRET_KEY="YOUR_PAYSTACK_SECRET_KEY"
npx supabase@latest secrets set PAYSTACK_CALLBACK_URL="https://YOUR_USERNAME.github.io/investeasy/settings.html"
npx supabase@latest secrets set PAYSTACK_PLAN_BASIC_MONTHLY="plan_code_basic"
npx supabase@latest secrets set PAYSTACK_PLAN_PRO_MONTHLY="plan_code_pro"
npx supabase@latest secrets set PAYSTACK_PLAN_ENTERPRISE_MONTHLY="plan_code_enterprise"
```

### 5. Deploy the Edge Functions

```bash
npx supabase@latest db push
npx supabase@latest functions deploy finbot
npx supabase@latest functions deploy market-data
npx supabase@latest functions deploy ops-status
npx supabase@latest functions deploy paystack-billing
npx supabase@latest functions deploy paystack-webhook
```

### 6. Push to GitHub Pages

Push `main`, wait for GitHub Pages to deploy, then hard refresh the site.

## Required Supabase Setup

### Auth

- Enable Email auth
- Configure your GitHub Pages site URL
- Add redirect URLs for:
  - your app root
  - `reset-password.html` if you still use recovery links

### Database

The app expects these Supabase tables:

- `profiles`
- `portfolio`
- `watchlist`
- `price_alerts`
- `saved_reports`
- `user_progress`
- `user_settings`
- `billing_plans`
- `billing_customers`
- `billing_subscriptions`
- `billing_events`

RLS should be enabled so users can only access their own rows.

## Edge Functions

### `finbot`

Handles:

- AI analysis modes
- quick FinBot chat
- credit usage enforcement
- user-based rate limiting

### `market-data`

Handles:

- live quotes
- charts
- news
- article extraction
- calendar events
- IP-based rate limiting and safer article source allowlisting
- server-side event logging for failures and throttles
- retention-friendly ops tables via `cleanup_ops_tables(...)`

### `ops-status`

Handles:

- enterprise admin health snapshots
- recent server-side function events
- plan/credit summary metrics for internal monitoring

### `paystack-billing`

Handles:

- authenticated checkout creation for `basic`, `pro`, and `enterprise`
- Paystack transaction verification after redirect
- profile tier / billing status updates in Supabase

### `paystack-webhook`

Handles:

- Paystack webhook events
- subscription lifecycle updates
- billing event logging and entitlement sync

## Paid Plans

Default monthly plans seeded by the billing migration:

- `basic`: `R99` / month, `15` FinBot credits
- `pro`: `R199` / month, `50` FinBot credits
- `enterprise`: `R499` / month, `200` FinBot credits

These defaults can be changed later in the billing migration seed data and matching frontend plan config.

## Paystack Setup

In your Paystack dashboard:

- create recurring monthly plans for `basic`, `pro`, and `enterprise`
- copy each plan code into the matching Supabase secret
- set the webhook URL to your deployed `paystack-webhook` function

Webhook URL shape:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook
```

## Ops Retention

The repo now includes a cleanup helper for backend ops tables:

```sql
select * from public.cleanup_ops_tables(48, 14);
```

Default guidance:

- keep rate-limit rows for `48` hours
- keep function event logs for `14` days

## Cheap Shared Cache

The repo now includes a simple shared cache for public market/news responses:

- migration: [202604170001_market_cache.sql](C:/Users/joshu/Desktop/investeasy/supabase/migrations/202604170001_market_cache.sql)
- table: `public.market_cache`

Current cache targets:

- `quotes`: `1` minute
- `chart` `1D`: `1` minute
- `chart` `1W+`: `5` minutes
- `news`: `5` minutes
- `calendar`: `15` minutes

This is the balanced first scaling layer because shared requests like market pulse, top movers, and news feed can be served from Supabase, while detail quotes and `1D` charts stay much fresher.

## Legacy Files

Older deployment artifacts are now grouped under:

- `legacy/php-cpanel/`
- `legacy/docker-local/`

These files are kept only for historical reference and are not part of the active GitHub Pages + Supabase production path.

## Testing

Playwright is installed as a dev dependency. Before a wider launch, test:

- sign up / sign in / remember me
- portfolio add/remove
- watchlist add/remove
- price alerts
- saved reports
- FinBot analysis
- FinBot quick chat
- market detail charts and headline values

Quick smoke run:

```bash
npm run test:smoke
```

Pre-launch checklist:

- [docs/launch-checklist.md](C:/Users/joshu/Desktop/investeasy/docs/launch-checklist.md)
- [docs/release-candidate-qa.md](C:/Users/joshu/Desktop/investeasy/docs/release-candidate-qa.md)

## License

Proprietary. All rights reserved.
