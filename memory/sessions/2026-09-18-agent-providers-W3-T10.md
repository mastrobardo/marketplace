---
task:    W3-T10
agent:   agent-providers
session: 2026-09-18
status:  closed
---

# Session — W3-T10

## Goal

A demo provider seeder, and then the retirement of `apps/web/mocks/search.ts`,
`apps/web/mocks/provider.ts` and their two MSW handlers. `W3-T05` and `W3-T07` made both endpoints
real; nothing seeds a provider, so deleting the handlers today points `pnpm dev` at a correct
endpoint over an empty table.

## Current state

- Branch `W3-T10-demo-provider-seeder`, cut from `origin/main` at `627cb40` (after `W0-T29` merged
  as #260).
- `auth-demo-users` is the only seeder. The pipeline (`prisma/seed/run.ts`) runs each seeder once
  per database, inside a transaction with its own ledger row, and `assertSafeTarget` guards only
  seeders marked `localOnly`.
- `apps/web/mocks/catalogue.ts` already *is* the demo world: 4 categories, 5 providers around
  Madrid (one in Alcalá 41 km out, one quote-only, one unrated). It stays — `app-harness.tsx`
  builds component-test data from it and `W3-T01` owns the categories handler.
- Only `apps/web/tests/mocks.test.ts` imports `handlers`; no component test does.

## Log

- Boot: `AGENTS.md`, policies, charter, `LONG_TERM.md`, `slices/agent-providers.md`, `sessions/`
  (no open file for this ID), `TODO.md` §6 `W3-T10`, `W3-T05`/`W3-T07` specs and live suites.
- Four decisions put to the operator before any code, all four answered with the recommendation:
  - **A — not `localOnly`.** The rows are invented: no credentials, no personal data, so `W0-T20`'s
    reason for the flag does not apply. A preview database *can* therefore be seeded and demo a
    working storefront. Wiring a deploy to run it is not this ticket — nothing seeds on deploy today.
  - **B — `requiresLicence: false` on every seeded category, with a `BD-07` note.** A demo seeder
    must not be where a legal boundary gets decided by default. The licence badge stays exercised
    by the component tests, which read `buildCatalogue` rather than the database.
  - **C — AC14–AC16 port to the API's live suite**, not to a second web-side fixture test. They are
    `W12-T08`'s criteria *about the contract*; the real endpoint is now the thing that should be
    answering them.
  - **D — cut from `main` after #260 merged**, so `TODO.md` has no conflict.

## Open questions

None. The one that came up mid-task — `mocks/search.ts` has a second caller the ticket also says to
keep — went to the operator and was answered (see Handoff).

## Handoff

**`W3-T10` is complete.** Seeder, both suites, the handler deletions, the re-homed criteria, spec,
run record, `TODO.md` and memory are on `W3-T10-demo-provider-seeder`.

Gates: typecheck 10/10 · lint clean · format:check clean · `apps/api` **230** under `STACK_LIVE=1`
(14 files, 207 before this task) · web 230 · contracts 210 · ui 255 · testing 33 · root 283 ·
build 6/6. And `pnpm db:seed` against the local stack: *ran 1 (providers.demo-world), skipped 1*.

**Running the live suites locally needs `DATABASE_URL` exported**, and the local port is **5433**:
`STACK_LIVE=1 DATABASE_URL="postgres://marketplace:marketplace_local@127.0.0.1:5433/marketplace" \
  pnpm --filter @marketplace/api exec vitest run`

**Next action: `W3-T02`** — the provider profile write path, and the ticket that stops new
`base_address_id` nulls arriving. `W3-T10` is the argument for it: every seeded provider has a base
address because the endpoints are unusable without one. The migration that makes the column
`NOT NULL` stays `agent-contracts`' edit (`W3-T07` §5 Q1).

**Do not redo:**
- Deleting `mocks/search.ts` and `mocks/provider.ts`. Their handlers are gone; the modules are the
  component-test stub's engine (`tests/app-harness.tsx`), and `W12-T11` split them out so the stub
  and the handler could not disagree. Operator's call, 2026-09-18. When `W3-T01` removes the
  categories handler, move the whole directory to `tests/fixtures/` in one step.
- The eight re-homed criteria. Spec §3.1 maps `W12-T08`'s AC14–AC16 and `W12-T12`'s AC10–AC13 onto
  the API suites; only AC14 and AC11 needed writing, and both are in `seed-live.test.ts`.
- The real Alcalá coordinates. The catalogue's 41 km offset is due north, in the sierra; `W3-T06`
  will draw these points on a map.
- `requiresLicence: false` on the seeded categories. It is a deferral to `BD-07`, named in the file,
  and the storefront's badge stays exercised by `buildCatalogue()`.

**Carry forward:** `packages/testing`'s `ProviderProfileInput` still has no `ratingAvg`, so this
seeder writes through Prisma like both live suites before it — the third ticket to route around it
(`agent-qa`).

**Skills used**: `test-driven-development` (the red phase in the run record §1 — a missing module
and a handler count of 3), `api-and-interface-design` (§3.3, where the deleted handlers' criteria
had to land), `security-and-hardening` (§2.3 of the spec: what makes seed data safe outside a
laptop — no credential, no personal data, its own users).
