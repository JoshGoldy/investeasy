# Launch Checklist

## Product

- Confirm the GitHub Pages deployment is serving the latest `main`
- Hard refresh the live app and spot-check:
  - `News`
  - `Markets`
  - `FinBot`
  - `Portfolio`
  - `Saved`
  - `Learn`
  - `Calendar`
  - `Settings`

## Supabase

- Confirm `supabase-config.js` points to the correct project URL and publishable key
- Confirm Email auth is enabled
- Confirm Site URL and redirect URLs are correct
- Confirm RLS is enabled on:
  - `profiles`
  - `portfolio`
  - `watchlist`
  - `price_alerts`
  - `saved_reports`
  - `user_progress`
  - `user_settings`
- Confirm Edge Functions are deployed:
  - `finbot`
  - `market-data`
- Confirm function secrets exist:
  - `ANTHROPIC_API_KEY`
  - `ANTHROPIC_MODEL`

## Auth

- Sign up with a brand new email
- Complete OTP verification
- Confirm profile row is created
- Confirm username saves correctly
- Sign out and sign back in
- Confirm `Remember me` restores the session on refresh

## Core User Flows

- Add a watchlist item
- Remove a watchlist item
- Add a portfolio holding
- Remove a portfolio holding
- Save a FinBot report
- Delete a saved report
- Create a price alert
- Update settings and refresh to confirm persistence

## FinBot

- Run one standard analysis mode
- Run one longer mode like `Portfolio Builder` or `Risk`
- Open FinBot quick chat
- Send one starter question
- Send one typed question
- Confirm credits decrement correctly

## Market Data

- Open a featured market
- Confirm the detail chart loads
- Confirm the top-right price matches the live chart
- Switch between timeframes
- Confirm news article previews load
- Confirm the calendar renders

## Smoke Test

Run:

```bash
npm run test:smoke
```

Use this before major pushes and before launch day.

## Final Pre-Launch Sanity

- Check browser console for runtime errors
- Check Supabase function logs for unexpected failures
- Check that no test/demo content is visible
- Check that credits, plan labels, and account UI match the signed-in user
