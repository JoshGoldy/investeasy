# FinScope

FinScope is a static frontend investing app powered by Supabase Auth, Supabase Edge Functions, and browser-side portfolio/watchlist state.

## Current Stack

- Frontend: plain HTML, CSS, and JavaScript
- Auth + database: Supabase
- AI analysis: Supabase Edge Function `finbot`
- Market data: Supabase Edge Function `market-data`
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
```

### 5. Deploy the Edge Functions

```bash
npx supabase@latest db push
npx supabase@latest functions deploy finbot
npx supabase@latest functions deploy market-data
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

## License

Proprietary. All rights reserved.
