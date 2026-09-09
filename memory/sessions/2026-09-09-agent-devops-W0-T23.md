---
task:    W0-T23
agent:   agent-devops
session: 2026-09-09T19:50Z
status:  closed
---

# Session — W0-T23

## Goal
Stop parallel agents colliding on shared files (#153): namespaced i18n, one-record-per-file memory,
a scripted lockfile resolution, and a generated README Layout table.

## Current state
Landed. Four commits, 300 tests green, typecheck/lint/format clean.

## Log
- Picked W0-T23 over W0-T10 as next: it is the one that gets more expensive daily, since the i18n
  split has to land before any slice adds keys.
- Chose a guard test for the i18n barrel and a generator for `LONG_TERM.md`. Different treatment on
  purpose — cost of the generator against cost of the collision, not consistency.
- `satisfies Translations` on the composed barrel would NOT catch an excess key: excess-property
  checking does not apply through a spread. Moved the check per-namespace onto a direct literal.
- Migration surfaced four records with no `status` and two ids each naming two facts. Grepped for
  citations before renumbering — W0-T07 already cites the slice `-23`, so the newer W0-T12 gotchas
  moved to `-27`/`-28`.
- Did not touch `ci.yml`: the drift checks are vitest tests and the `unit` job already runs them.
- Dead end avoided: an append-merge driver on README.md. The issue's own evidence says it produced
  a duplicate stale row. Drivers only where the file is recomputed, never stitched.

## Blocked / escalations
None.

## Handoff
See `docs/specs/S0/W0-T23-shared-file-collisions.run.md` §7. Next unblocked `[A]` task is `W0-T10`
(#42) — `CONTRIBUTING-agents.md` does not exist.
