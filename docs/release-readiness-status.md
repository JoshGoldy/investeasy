# Release Readiness Status

Last updated: 2026-04-16

## Current Automated Gate

- Public smoke suite: `6/6` passing
- Authenticated shell suite: `3/3` passing
- Authenticated CRUD suite: `3/3` passing
- Authenticated FinBot save/delete suite: `1/1` passing

## Covered By Automation

- app boot and core tab shells
- guest FinBot entry
- markets shell and detail open
- news shell
- settings guest/auth state
- password login
- authenticated portfolio shell
- authenticated settings shell
- authenticated FinBot shell
- watchlist add/remove persistence
- portfolio add/remove persistence
- settings persistence
- one real FinBot analysis run
- save report to Saved Reports
- delete saved report cleanly

## Still Primarily Manual

- new-user OTP signup flow
- remember-me session persistence across real browser restarts
- price alerts creation and lifecycle
- saved report edit/share/download controls
- FinBot long-form modes beyond the automated single-run coverage
- real-device mobile polish across iPhone and Android
- live market sanity for edge cases like JSE
- ops/admin diagnostics review in Settings

## Current Launch Risks

- JSE charts are intentionally deprioritized for launch and should be treated as non-blocking only if they are hidden, labeled, or excluded from launch promises
- live-data providers can still drift even when shell flows are green, so a quick live sanity pass remains important
- FinBot automated coverage uses real credits, so repeated RC runs should use an account with headroom

## Suggested Ship Bar

Ship when all of the following are true:

- `npm run test:rc` passes
- no manual release blockers remain from [release-candidate-qa.md](C:/Users/joshu/Desktop/investeasy/docs/release-candidate-qa.md)
- Supabase function logs look normal
- one final mobile pass feels stable

## Recommended Next Human Pass

1. New-user OTP signup
2. Remember-me login persistence
3. Price alerts create/delete
4. Saved report edit/share/download
5. One real mobile pass on iPhone and Android
