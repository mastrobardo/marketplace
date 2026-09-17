---
task:    W3-T07
agent:   agent-providers
session: 2026-09-17
status:  closed
---

# Session — W3-T07

## Goal

`GET /api/providers/:id` — the real provider profile endpoint, against the `ProviderProfileSchema`
seam `W12-T12` froze and `apps/web/mocks/provider.ts` has been standing in for. The projection and
its privacy exclusions, 400-before-404, locale-resolved category names, and the outbound parse.

## Current state

- Contract frozen and complete. This slice may not touch `packages/contracts/**` or `schema.prisma`
  and does not need to.
- `W3-T05` merged into `chore-memory-consolidation`, **not** `main` (PR #256, base
  `chore-memory-consolidation`), and that branch has no open PR. `main` is two commits ahead of it.
  So this branch is cut from `chore-memory-consolidation` with `origin/main` merged in.
- `apps/api` has `/health`, better-auth and `modules/search/` — the split this module copies.
- Only `auth-demo-users` is seeded; live tests build their own world through `packages/testing`.
- First task in this slice: `memory/slices/agent-providers.md` is empty.

## Log

- Boot: read `AGENTS.md`, policies, charter, `LONG_TERM.md`, slice file, `sessions/` (no open file
  for this ID), `TODO.md` §6, `W12-T12`'s spec and `W3-T05`'s spec + session + run record.
- Skills loaded for this task: `test-driven-development` (L1), `api-and-interface-design`,
  `security-and-hardening` (the projection is the security surface), `debugging-and-error-recovery`.
- Four decisions put to the operator before any code, all four answered:
  - **A — a provider with no base address**: `404`, because `ProviderProfileSchema` requires
    `city`/`province`/`point` and `baseAddressId` is nullable. Agreed **with a product correction**
    that changes what the 404 *means* — see below.
  - **B — module directory**: `modules/providers/`, not the charter's `professionals/`. The route,
    the contract, the table and `glossary.md` all say `provider`. Charter glob corrected in this PR.
  - **C — data access**: Prisma's typed client, not raw SQL. `W3-T05`'s one-statement rule exists
    because a radius scan is expensive; this is a point read, and the outbound parse is the gate.
  - **D — the factory gap**: widen `ProviderProfileInput` rather than work around it a third time
    (`MEM-2026-09-17-10`). Cross-slice, so it was the operator's call.
- **The operator's product rule, taken 2026-09-17** — the reason A is transitional: *every provider,
  manitas or pro, must have a base address, and it is the centre of their operating radius, not
  where they live.* A provider may set it to a city centre with a wide radius. On that rule
  `baseAddressId` is `NOT NULL`, the 404 in §2.4 becomes unreachable, and two documents are wrong:
  `schema.prisma:214` and `packages/contracts/src/search.ts` both justify the coarse point with
  *"usually a home address"*. The privacy behaviour is right and does not change; the stated purpose
  is not. Both are `agent-contracts`' edits — raised as §5 Q1/Q2, not made here (L3, L10).
- **After the operator merged `chore-memory-consolidation` (#257, squashed)** this branch was
  rebased onto `main` with `git rebase --onto origin/main c033b1e` — a squash puts the *content* on
  `main` without its commits, so the old ancestors stayed in the PR range and `author-identity`
  failed on `03e8651`, a commit **GitHub** wrote. The rebase was verified content-neutral with
  `git diff --stat bbb2e01 HEAD` (empty) before pushing. `MEM-2026-09-17-16`.
- **CI's `lint` job runs `pnpm format:check` as well as ESLint**, and the root `pnpm lint` script
  does not. Cost one round trip on a wrapped import. `MEM-2026-09-17-17`.
- Merge of `origin/main` conflicted in three files, all foreseen by `MEM-2026-09-09-28`:
  `conventions.md` and `gotchas.md` were genuine additions (both sides kept); `TODO.md`'s NEXT block
  was a **modification** and `MEM-2026-09-09-13` applies — kept HEAD's block, dropped the stale one.

## Blocked / escalations

None. Both proposals in the spec's §5 are for `agent-contracts` and neither blocks this task.

## Handoff

**`W3-T07` is complete.** Endpoint, both suites, the factory widening, spec, run record, memory and
`TODO.md` all on `W3-T07-provider-profile-api`. Gates: typecheck 10/10 · lint clean · api 207/207
(`STACK_LIVE=1`, 12 files — 183 before this task) · contracts 210 · web 239 · testing 33.

**Running the live suites locally needs `DATABASE_URL` exported** — `.env` does not carry one and
`auth.test.ts` builds its config from `process.env`, so a bare `STACK_LIVE=1 vitest run` fails that
file in `beforeAll` with `ConfigError: DATABASE_URL: expected string, received undefined` and then
again in `afterAll` on `app.close()` of an app that was never built. It looks like a broken suite
and is a missing variable. The local port is **5433**, not 5432:
`STACK_LIVE=1 DATABASE_URL="postgres://marketplace:marketplace_local@127.0.0.1:5433/marketplace" \
  pnpm --filter @marketplace/api exec vitest run`

**Next action: `W0-T29`, then `W3-T10`** — reordered by the operator after this task's CI runs.

`W0-T29` stopped being a review and became a decision: **`spec-present` is the gate worth its slot,
`author-identity` is not, and the four gate jobs cost more in feedback latency than they return**
(operator, 2026-09-17). The ticket's own "middle option" — one job, each gate reported in the
summary — is what the steer points at, and `OPS-03` has not run, so the check names can still be
chosen rather than inherited. `author-identity` fired exactly once in this repo's history and was
wrong when it did (`MEM-2026-09-17-16`).

Then `W3-T10`: the demo provider seeder, then retire `mocks/search.ts`, `mocks/provider.ts` and
their two handlers, re-pointing `tests/mocks.test.ts` AC14–AC16 at the contract rather than at the
handler. Both endpoints are now real and both mocks are deliberately still in place; `W3-T10` is the
only thing standing between the storefront and real data.

**Do not redo:**
- The factory widening. `ProviderProfileInput` now has `baseAddressId` and nullable
  `serviceRadiusMetres`/`hourlyRateCents`, with `factories.test.ts` AC17 holding it.
  `search-live.test.ts` still carries `W3-T05`'s older Prisma workaround — simplifying it is safe
  but was out of scope here.
- The 404 for a provider with no base address. It is deliberate and documented (spec §2.4), and the
  thing that removes it is `W3-T02` plus an `agent-contracts` migration, not a change to this
  endpoint.
- The `professionals` → `providers` charter fix, in both `agents/roles/` and `.claude/agents/`.

**Carry forward — two proposals for `agent-contracts`,** both in the spec's §5 and neither blocking:
`baseAddressId` should be `NOT NULL` (§5 Q1), and the "usually a home address" justification in
`schema.prisma:214` and `packages/contracts/src/search.ts` is now the wrong reason for the right
behaviour — the column is an operating centre (§5 Q2). Also still open for `agent-qa`:
`ProviderProfileInput` has no `ratingAvg` and `AddressInput` has no `line2`.
