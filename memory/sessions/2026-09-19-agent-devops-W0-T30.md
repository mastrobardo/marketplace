---
task:    W0-T30
agent:   agent-devops
session: 2026-09-19T09:18Z
status:  closed
---

# Session — W0-T30

## Goal

Make `pnpm db:seed` able to reach preview and staging, so `W3-T11` has a deployed taxonomy to edit
and the storefront stops rendering an empty category grid there.

Scope grew once during the session, on the operator's answer: staging also needs **test users QA can
sign in as**, which turned out to be a credential problem rather than a pipeline one.

## Current state

Landed and green. `pnpm verify` 10/10; `STACK_LIVE=1` api suite 357/357; root suite 286 passed.

- `selectSeeders` + `--only` in `apps/api/prisma/seed/{run,types}.ts` and `prisma/seed.ts`
- `auth.demo-users` no longer `localOnly`; password from `SEED_DEMO_PASSWORD`, refuses non-local
  without it
- seed steps in `deploy-preview.yml` and `deploy-staging.yml`; `release-production.yml` untouched
- `PREVIEW_SEED_DEMO_PASSWORD` / `STAGING_SEED_DEMO_PASSWORD` through guard, `.env.example`, README
- `pnpm db:reset` typo fixed (root `package.json`)
- `TODO.md` §5.3 gained the seed-data Definition-of-Done line

## Log

- 09:18 read the ticket. Confirmed both halves of the bug in code before planning: `assertSafeTarget`
  filters the *registry* (`run.ts:38`), and neither deploy workflow calls `db:seed`.
- 09:20 **found the real blocker, which the ticket does not mention**: `auth.demo-users` is
  `localOnly` because its password is a committed literal (`auth-demo-users.ts:16`), not because its
  rows are fake. "Staging gets test users" is a credential problem. Raised before writing anything.
- 09:21 operator answered the fixtures-vs-dump question with a question of their own. Answered in
  spec §1.2 and promoted to `MEM-2026-09-19-2` — the durable part is *a production edge case comes
  back as a regression seeder*, not as a dump.
- 09:22 red phase: 15/16 failing. AC2 passed, deliberately — it asserts the *unfiltered* gate still
  refuses, so a green AC2 before and after is what proves the filter narrowed rather than loosened.
- 09:24 **dead end avoided**: considered a second seeder (`auth.e2e-users`) so the published-password
  one could keep `localOnly`. Rejected — two seeders writing the same two accounts, and the flag
  would still be answering the wrong question. One seeder, environment-sourced password.
- 09:25 two pre-existing guard tests failed: both derive "required" from `EnvSchema` as *no
  `.default(`*, and `SEED_DEMO_PASSWORD` is the repo's first `.optional()` variable. Satisfying them
  would have meant committing a password, or putting a credential on the Fly app with no consumer.
  Corrected both heuristics; flagged as deviation 1 and as the thing to review hardest.
- 09:26 `AC28` forced `PREVIEW_SEED_DEMO_PASSWORD` into the *teardown* workflow, which seeds nothing
  — it shares `REQUIRED.preview`. Withholding it would have made teardown skip and leak the
  resources it destroys. Passed through with a comment; precedent was `PREVIEW_BETTER_AUTH_SECRET`.
- 09:27 **the plan was wrong about the intervention ledger.** §5.6 is for a human *correcting* the
  agent; creating a `[H]` secret is not that. Recorded in README / `.env.example` / spec §6 instead.
- 09:28 live-verified the CLI end to end on a scratch database, because the unit suite cannot see
  `pnpm`'s argument forwarding. Both `--only x` and `-- --only x` work from the root.

## Blocked / escalations

```
BLOCKED — needs human
Target:   preview, staging
Need:     2 secrets that no agent may create
Where:    Settings → Environments → <environment> → Add secret

  - PREVIEW_SEED_DEMO_PASSWORD
  - STAGING_SEED_DEMO_PASSWORD

Meanwhile: the deploy guard reports each environment unconfigured and SKIPS its deploy.
Nothing is created and nothing is changed. Set both BEFORE merging, or the pipeline goes
dark on merge rather than at the first failed seed.
```

Value: anything ≥ 12 characters, different per environment. They unlock
`client@marketplace.local` and `provider@marketplace.local`. Spec §6 is the same checklist.

## Handoff

**Next action:** open the PR, and set the two secrets above before it merges.

Then `W3-T11` — its blocker is gone. Start by settling the three questions `TODO.md` names at its
ticket line (which slice owns it, whether `requiresLicence` is editable and by whom, whether a slug
may change after creation), and confirm `MEM-2026-09-18-13` with the operator as that entry asks.

**Do not redo:**
- The fixtures-vs-dump analysis. It is `MEM-2026-09-19-2` and spec §1.2. `W0-T20` still owns the
  sanitised path; it is additive, not a replacement.
- The `localOnly` question. `MEM-2026-09-19-3` — no registered seeder carries the flag and that is
  correct; it is reserved for data unsafe *as data*.
- The two edited guard tests. The `.optional()` gap was real; deviation 1 in the run record carries
  the argument.
- Verifying `pnpm` argument forwarding. Proven live, both forms. `MEM-2026-09-19-4`.
