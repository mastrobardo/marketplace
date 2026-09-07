# ADR-007: Feature flags

## Status
Accepted — 2026-09-07

## Context
Every feature ships behind a flag so that thirteen agents working in parallel never block each
other on unfinished work, and so incomplete slices can merge to `main` instead of living on
long-lived branches. We need per-environment control (a flag on in staging, off in production) and
it should be free.

## Decision

**Flagsmith free cloud tier**, accessed through the **OpenFeature** SDK.

Flagsmith's free plan gives unlimited flags, **unlimited environments**, unlimited segments, and API
access at 50k requests/month with one team member — the only free option whose environment model
matches ours directly (one project, one environment per env, each with its own SDK key).

**OpenFeature wraps it.** The application never imports the Flagsmith SDK directly. This keeps the
provider swappable (PostHog, Unleash, or a self-hosted Flagsmith if we outgrow the free tier) and
lets tests inject a static provider with no network calls.

### Rules

1. **Typed registry in code.** Every flag is declared in one file with its key, owner, creation
   date, default (**always OFF**), and a **removal task ID**. An undeclared flag key fails typecheck.
2. **Server-side evaluation with local caching.** The API evaluates flags and passes the resolved
   set in the bootstrap payload. The client never calls Flagsmith per request — this respects the
   50k/month cap and eliminates UI flicker.
3. **Environment mapping**: `preview` (all previews share one Flagsmith environment), `staging`,
   `production`. A PR's preview forces its own flag ON; every other flag stays at its default.
4. **Tests use the static provider.** Never the network. The e2e matrix runs the branch's flag on;
   the nightly suite runs the production flag set.
5. **Kill switch.** Any flag can be turned off in production without a deploy. This is the point of
   the whole exercise — rollout is a flag change, not a release.
6. **Lifecycle is enforced, not hoped for.** A flag at 100% rollout for more than 4 weeks becomes a
   cleanup task via its removal task ID. Dead flag branches are how flag-driven development rots
   after six months.

## Alternatives considered
- **PostHog free** (1M events/mo): more generous on volume and bundles analytics, but environments
  are modelled as separate projects, which fragments the flag list. Strong candidate later for
  analytics; not the flag store.
- **Unleash self-hosted**: no vendor limits, but another container to run, patch and secure.
- **GrowthBook**: warehouse-native experimentation; more than we need at MVP.

## Consequences
- 50k requests/month is comfortable **only** with server-side evaluation and caching. If we ever
  evaluate per client request, we blow through it — the architecture rule above is load-bearing.
- One team member on the free tier: flag changes go through the account owner or the API token in
  CI. Acceptable while the team is one human plus agents.
- Flags are runtime configuration reaching production behaviour. Changing one is an operational
  action: log it, and treat a production flag flip like a deploy in the runbooks.
