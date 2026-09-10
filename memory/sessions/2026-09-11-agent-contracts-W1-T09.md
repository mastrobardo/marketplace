---
task:    W1-T09
agent:   agent-contracts
session: 2026-09-11T00:00:00Z
status:  closed
---

# Session — W1-T09

## Goal
One place to build the core entities for tests, deterministic, so that thirteen agents test
against the same shapes and a failure reproduces. `packages/testing`, which the charter already
lists under `owns:` and `MEM-2026-09-07-06` already promises exists.

## Current state
Branch `W1-T09-test-factories` cut from `origin/main` @ b9792c8. `W1-T07` is on PR #195, unmerged.

## Log
- 00:05 Branched off `origin/main`, not off `W1-T07`. T09 needs only the T05 schema, which is
  merged; branching off an unmerged branch would put T07's commits in T09's review.
  Known cost: both branches touch `memory/slices/agent-contracts.md`, so a rebase is due when
  #195 lands. That is the standing policy ([[marketplace-shared-file-rebase-preference]], #163).
- 00:08 Scope check against the issue. It says "users, providers, jobs and bookings". `job` and
  `booking` **do not exist** — W1-T05 shipped six tables and neither is among them. Factories
  cover what the schema has; the spec says so in §9 rather than inventing tables.
- 00:12 First design: **two entry points**, `@marketplace/testing` pure and
  `@marketplace/testing/db` importing `@prisma/client`, because `apps/web` has a real test suite
  (`tests/shell.test.tsx`, `i18n`, `tokens`) and no Prisma, and one entry point would drag the
  query engine into the browser test bundle.
- 00:20 **Reversed it.** If the persisting factories take a *structural* client interface — the
  `W1-T07` recorder trick — the package needs no `@prisma/client` dependency at all, and the
  browser-bundle argument that justified two entry points disappears with it. One entry point,
  zero runtime dependencies beyond `@marketplace/contracts`.
  The better consequence is in the tests: a recording fake satisfies a structural interface in ten
  lines, so the factory *logic* (parent auto-creation, override merging, uniqueness) is tested in
  the `unit` job that actually runs in CI, instead of behind `STACK_LIVE` where `W1-T07`'s live
  criteria went unproven. Only one criterion is left needing a database: that the structural
  interface really matches Prisma's shape.
- 00:15 The hard criterion is the third one, "tests do not hand-roll their own fixtures", because
  it describes a habit rather than a behaviour. Plan: make it structural instead — a test that
  parses `schema.prisma` for `model X` and fails if any model has no factory. That way the day W2
  adds `Job`, the suite fails until a factory exists, and there is never a reason to inline.

- 00:35 Red, first attempt: 27/27 "failed" — a lie. The file-level `beforeEach(resetFactories)`
  threw, so everything died in the hook. Re-scoped; honest figure 19 failed / 8 passed, eight
  named in the run record's table. Promoted as MEM-2026-09-11-03.
- 00:45 Green: 30/30. Two test fixes, no criterion touched. AC9's scanner had matched the doc
  comment that documents the rule it enforces.
- 00:50 `pnpm test` caught what no criterion here covers: `infra/docker/api.Dockerfile` lists every
  workspace manifest by hand and `tests/cd-workflows.test.ts` fails when a new one is missing. One
  COPY line. Worth noting as the counter-example to ci.yml's list — same pattern, but with a test
  behind it, so it fails closed.
- 00:55 AC14 had never been observed red (the live file only runs against a built package).
  Reconstructed it: moved the implementation aside, restored the stub, rebuilt, captured the red,
  restored. Said so in the run record rather than claiming a red that did not happen.

## Blocked / escalations
ESC-1 (spec §10) — same as W1-T07, second task running. `apps/api/tests/factories-live.test.ts` is
not in `ci.yml`'s hand-maintained list and this agent may not edit that file (L4). Exposure here is
one criterion rather than five, because Decision D pushed the rest into the `unit` job.

## Handoff
Nothing half-done. Full local gate green — all five commands.

**Next action**: open the PR, hand it to a reviewer (L6). Then `W1-T03` + `W1-T04` (OpenAPI
generation and contract conformance), which the operator picked for the third slot.

**Rebase due**: when #195 (W1-T07) merges, this branch conflicts on `memory/slices/agent-contracts.md`
and `pnpm-lock.yaml`, and AC10 will fail until `AuditRecord` gets a builder and a factory. That
failure is the gate working — add the factory, do not allowlist the model.

**Do not redo**: the reconstructed AC14 red. It is captured; re-running it now passes.
