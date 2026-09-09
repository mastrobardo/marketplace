---
task:    W0-T06
agent:   agent-devops
session: 2026-09-09T09:40Z
status:  closed
---

# Session — W0-T06

## Goal
GitHub Actions on every PR: the six named gates from the spec, under ten minutes, with the database
tests `W0-T05` left behind `STACK_LIVE=1` actually running somewhere.

## Current state
**Done.** 28 static assertions green; actionlint clean; the `database` job's command sequence run
by hand (migrations + both live suites, 44 assertions that were skipped everywhere until now).

## Log
- 09:40 **stacked branches, not parallel ones.** The plan was T05 → merge → T06 → merge → T07. The
  harness blocked `gh pr merge`, so T06 branches off T05 and T07 will branch off T06, each PR based
  on the previous. Same ordering, no re-merges; the operator merges the stack in order.
- 09:45 six separate check names rather than one aggregate `ci` job: W0-T13 requires them by name
  in branch protection, and an aggregate hides which gate failed.
- 09:50 CI must run the *same* pnpm scripts an agent runs locally. A CI-only variant command is how
  "green locally" and "green in CI" become two different things to satisfy.

- 09:58 dropped the PostGIS **service container** for `pnpm stack:up`. The live tests reach Postgres
  through `docker compose exec`, so a service container would have needed a CI-only variant of the
  suite — the exact local/CI split the spec argues against.
- 10:00 `pnpm stack:logs` follows; in an `if: failure()` step it hangs to the job timeout.
  MEM-2026-09-09-18.
- 10:02 three test-mechanism bugs (env not read, undefined pnpm version, `docker://` has no `@`).
  All three failed against a *correct* workflow. MEM-2026-09-09-19.

## Blocked / escalations
None. `gh pr merge` is blocked by the harness — recorded as `TOOL_BLOCKED`, not an escalation:
it changes how the branches are shaped, not whether the work can be done.

## Handoff
`W0-T06` is complete. Next is `W0-T07` (CD), branched from **this** branch, not from `main`.

What `W0-T07` inherits:
- The six check names are fixed and documented. Deploy workflows are new **files**, never new jobs
  in `ci.yml` — adding a job there would add an unrequired check and confuse `W0-T13`.
- `contents: read` and no secrets is a property of `ci.yml` only. `W0-T07` needs secrets and an
  `environment:`, and every one of them is `[H]`.
- Operator's steer: the deploy workflows will not run on their own PR. That needs its own ticket.
