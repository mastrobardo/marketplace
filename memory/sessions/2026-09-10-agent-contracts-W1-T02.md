---
task: W1-T02
agent: agent-contracts
session: 2026-09-10T10:35Z
status: closed
---

# Session — W1-T02

## Goal

Land the list conventions in `packages/contracts` — how every list endpoint is paged, sorted and
filtered — plus a ticket the operator asked for in the same instruction, about naming environments
after the task rather than the pull request.

## What the operator asked for, and what that turned into

Two things, deliberately kept apart:

1. **`W1-T02`**, the next task in the agreed serial W1 order, `#165` having merged.
2. **A new ticket** — environments, previews and every other per-branch unit of work should be
   named from the task (`w1t02`), not the PR (`pr-123`). Filed as `W0-T25` / issue #166, linked
   under the W0 epic, `agent-devops`, with the line in `TODO.md` §6. The work is not this task's
   and not this slice's; only the board entry is in this branch.

The naming ticket carries one thing the request did not mention and a reader needs: a PR number is
unique by construction and a task ID is not, so two open PRs on one task resolve to one Fly app and
one database branch. The ticket recommends reuse plus a teardown guard, and says why the
alternative (a collision suffix) gives up the property the change is being made for.

## Log

- **10:35** — Fetched. `origin/main` at `e6d1e56` (the `W1-T06` merge). Branch
  `W1-T02-list-conventions` cut from it.
- **10:38** — `W0-T25` filed (#166) and linked to epic #138. Noted in passing: #153 and #156, the
  two other hand-filed tickets, have **no parent epic** — the seeded ones all do. Not fixed here;
  it is a two-call `addSubIssue` for whoever wants the board tree consistent.
- **10:42** — Spec written. Eight decisions: A–D were in the plan the operator approved, E–H
  (unsigned cursor, appended tiebreaker, reject-not-clamp, provider-neutral predicate) derived
  while writing and flagged in §10 for objection before merge.
- **10:44** — Suite written first, 60 tests. Red at import.
- **10:45** — Probed three zod 4 APIs for a dynamic issue message before writing the module. The
  `.refine(pred, fn)` form is silently ignored. → `MEM-2026-09-10-06`.
- **10:50** — Module written. Two failures, both mine: a test asserting a code path that does not
  exist, and a fixture that failed to compile for the wrong reason.
- **10:52** — Added codec coverage the spec did not ask for (Unicode, surrogate pairs, all three
  base64 group lengths). The codec is hand-rolled and that was the thinnest coverage in the change.
- **10:54** — Full `pnpm verify` green: 224 tests, 10 files, both builds.
- **10:55** — Re-ran the suite against a stub surface per `MEM-2026-09-10-03`, after the fact and
  recorded as such: 54 of 60 red, and the six vacuous passes named in the run record §2.

## What went into memory

- `MEM-2026-09-10-06` (repo) — zod 4's `.refine(pred, fn)` accepts a function and ignores it.
- `MEM-2026-09-10-07` (slice) — paging goes through `pagination.ts`; don't re-derive the predicate.
- `MEM-2026-09-10-08` (slice) — the fixture projects' `types: []` is what keeps `src` free of
  `Buffer`/`btoa`/`TextEncoder`, and is why the cursor codec is hand-rolled.

## Open for the reviewer

- Decisions E–H in spec §2, and the two called out in §10: the unsigned cursor, and whether the
  back office gets an offset shape of its own later.
- `MAX_SORT_FIELDS = 3` and `PAGE_LIMIT_MAX = 100` are frozen into the seam before `W3-T05` has
  measured a geo query.
