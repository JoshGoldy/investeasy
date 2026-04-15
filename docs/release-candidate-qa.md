# Release Candidate QA

Use this pass when you feel “close enough to launch” and want to validate the app end-to-end like a real user would.

## Test Environment

- Live GitHub Pages build is serving the latest `main`
- Supabase project is the intended production project
- Edge Functions are deployed:
  - `finbot`
  - `market-data`
  - `ops-status`
- Browser cache has been hard refreshed before testing

## Test Accounts

Prepare these before the pass:

- `New user`
  - no prior account
- `Free user`
  - regular non-admin account
- `Paid user`
  - `pro` or `enterprise`
- `Ops/admin user`
  - email included in `OPS_ALLOWED_EMAILS`

## Release Blockers

Treat any of these as launch blockers:

- login/signup fails or gets stuck
- user data leaks across accounts
- FinBot charges wrong credits
- saved reports fail to save/load/delete
- portfolio/watchlist/settings fail to persist
- Markets detail screen shows broken prices or unusable charts for core symbols
- repeated console/runtime errors during normal usage

## Auth Pass

### New User Signup

1. Open the live app logged out
2. Sign up with a new email
3. Complete OTP verification
4. Confirm a profile is created and the app signs in

Expected:

- no stuck modal
- username persists
- plan shows the expected starter plan
- no console errors

### Login Variants

1. Sign out
2. Log in with email code
3. Sign out
4. Log in with password
5. Toggle password visibility once

Expected:

- both methods work
- password eye toggle behaves correctly
- no duplicate sessions or broken redirects

### Session Persistence

1. Log in with `Remember me` enabled
2. Refresh
3. Close/reopen browser tab
4. Confirm session persists
5. Sign out
6. Confirm protected actions now require auth

## Portfolio Pass

1. Add a new holding
2. Edit the holding
3. Remove a holding
4. Re-add at least one holding
5. Confirm summary cards update
6. Confirm portfolio screen works on desktop and phone width

Expected:

- values and counts update immediately
- no duplicate holdings unless intentionally allowed
- summary cards and lists remain visually stable

## Watchlist + Alerts Pass

1. Add a market to watchlist
2. Confirm the star updates visually
3. Remove it
4. Create a price alert
5. Confirm it appears in the right place

Expected:

- watchlist star and stored state stay in sync
- alerts save without UI drift or stale state

## Saved Reports Pass

1. Run a FinBot analysis
2. Save the report
3. Open it from Saved Reports
4. Edit details
5. Share/copy
6. Delete it

Expected:

- metadata updates persist
- buttons align cleanly on mobile
- deleting removes the report without a stale card remaining

## FinBot Pass

### Analysis Modes

Run at least one of each:

- `Stock Screener`
- `DCF Valuation`
- `Risk Assessment`
- `Portfolio Builder`

Expected:

- each mode completes
- long reports are not visibly truncated
- credits decrement by the expected amount
- saved report flow works afterward

### Quick Chat

1. Open FinBot quick chat
2. Tap a starter prompt
3. Send a typed prompt
4. Confirm 1 credit per chat message

Expected:

- category buttons render correctly on mobile
- chat composer stays usable on narrow screens
- responses are readable and don’t overflow

## Markets Pass

Test at least:

- `SPX`
- `AAPL`
- `BTC`
- one JSE symbol

For each:

1. Open detail view
2. Check top-right price/change
3. Switch all timeframes
4. Confirm the chart is sane

Expected:

- no absurd spikes for supported live markets
- header numbers match the visible chart behavior
- compare/watchlist/portfolio buttons work

## News + Calendar Pass

### News

1. Load News
2. Refresh
3. Change category filters
4. Change time filters
5. Search
6. Open article preview / FinBot analyze

Expected:

- header controls align correctly
- articles load with no broken cards
- live badge and updated time behave sensibly

### Calendar

1. Open Calendar
2. Check each view type you support
3. Confirm no layout breakage on mobile

## Settings + Admin Pass

### Standard User

1. Update currency
2. Update risk / horizon / preferred sectors
3. Toggle notifications
4. Refresh and confirm persistence

### Ops/Admin User

1. Open Settings
2. Confirm `System Status`
3. Confirm `Server Health`
4. Trigger one safe failure if practical
5. Confirm diagnostics/event health updates

## Mobile Pass

Run on at least one real phone:

- open sidebar
- close sidebar
- tap FinBot bubble
- open account dropdown
- use Saved Reports
- use FinBot
- use Markets detail
- use Settings

Expected:

- header is not overcrowded
- sidebar is clean and scrollable
- FinBot bubble does not cover core actions
- page does not zoom awkwardly on input focus

## Console + Logs Pass

### Browser

- check console for uncaught errors
- check failed network calls during common flows

### Supabase

- inspect function logs for:
  - auth problems
  - rate-limit spikes
  - market-data failures
  - FinBot upstream failures

## Smoke Suite

Run:

```bash
npm run test:smoke
```

If a smoke test fails, fix that before launch.

## Authenticated Smoke Suite

You can also run a lightweight logged-in pass with a real test account:

```bash
TEST_USER_EMAIL="you@example.com" TEST_USER_PASSWORD="your-password" npm run test:smoke:auth
```

On Windows PowerShell:

```powershell
$env:TEST_USER_EMAIL="you@example.com"
$env:TEST_USER_PASSWORD="your-password"
npm run test:smoke:auth
```

This covers:

- password login
- authenticated portfolio shell
- authenticated settings shell
- authenticated FinBot shell

Note:

- the authenticated smoke suite expects a user that already has a valid Supabase password set
- OTP-only accounts will fail this test until a password is created for that account

## Ship Decision

Only ship when:

- no release blockers remain
- smoke suite passes
- manual QA pass is complete
- Supabase logs look normal
- mobile and desktop both feel stable
