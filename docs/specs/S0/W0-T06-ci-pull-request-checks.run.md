# Run record — W0-T06 CI on pull requests

|                  |                                                                |
| ---------------- | -------------------------------------------------------------- |
| **Agent**        | `agent-devops`                                                  |
| **Model**        | `claude-opus-5`                                                 |
| **Charter rev**  | 1                                                               |
| **Skills used**  | `ci-cd-and-automation`, `test-driven-development`, `spec-driven-development`, `security-and-hardening` |
| **Started**      | 2026-09-09T09:40Z                                               |
| **Finished**     | 2026-09-09T10:05Z                                               |
| **Branch**       | `W0-T06-ci-pull-request-checks` (from `W0-T05-database-toolchain` @ 7fbc702) |
| **Issue**        | https://github.com/mastrobardo/marketplace/issues/38            |
| **Spec**         | [`W0-T06-ci-pull-request-checks.md`](W0-T06-ci-pull-request-checks.md) |
| **Session file** | `memory/sessions/2026-09-09-agent-devops-W0-T06.md`             |

---

## Prompts

### 1. Task assignment (operator, verbatim)

> continue till w07, everything is autoapproved. However, consider the GA actions might need an
> extra ticket, cause they will not run in auto for w07 PR

### 2. Plan (agent, presented before any file was written)

> 1. Branch, spec, session memory.
> 2. Red: `tests/ci-workflow.test.ts` statically parses `.github/workflows/**` — every gate
>    present, node version matches `.nvmrc`, `concurrency` + `cancel-in-progress`, per-job
>    `timeout-minutes`, no `continue-on-error` on a gate.
> 3. Green: `ci.yml` on `pull_request` + `push: main`; split jobs for the <10 min budget; pnpm
>    store cache; a `db` job with a PostGIS service container running the T05 migrations and live
>    tests.
> 4. Scope guard: `spec-present`/`intervention-logged` are `W0-T12`, `agents-drift` is `W0-T15`,
>    `author-identity` is `W0-T21` — referenced as out-of-scope, not built here.
> 5. Document the exact required-check names for branch protection (`OPS-03`/`W0-T13`).

Followed, with one designed-in change to step 3 — see *Deviations* 1.

### 3. Corrections

No corrective re-prompt. One harness-level block, recorded under *Interventions*.

---

## Red phase

`tests/ci-workflow.test.ts` written against the nineteen acceptance criteria before
`.github/workflows/` existed:

```
 × AC1 … declares exactly the two triggers
 × AC1 … targets main from both
 × AC2 … groups per workflow and ref
 × AC2 … cancels in progress
 × AC3 … makes cancel-in-progress conditional on not being main
 × AC4 … declares one job per check name and no aggregate job
 × AC5 … build / typecheck / lint / unit run their local scripts        (4 failures)
 × AC6 … applies the migrations and opts into STACK_LIVE
 × AC7 … brings up the project compose stack
 × AC8 … never sets continue-on-error
 × AC8 … puts no condition on a gate job
 × AC9 … runs actionlint over every workflow file
 × AC10 … reads the node version from .nvmrc rather than restating it
 × AC11 … satisfies packageManager
 × AC12 … installs with --frozen-lockfile everywhere
 × AC13 … never uses a moving ref
 × AC14 … sets a timeout of at most 15 minutes on every job
 × AC15 … keeps the longest needs-chain to two jobs
 × AC16 … caches the pnpm store, keyed by the lockfile
 × AC17 … declares permissions at the top level
 × AC17 … grants contents: read and nothing else
 × AC17 … never escalates in a job
 × AC18 … references no secrets context
 × AC19 … lists every gate in the README
 × … parses every workflow file
 Test Files  1 failed (1)
      Tests  28 failed (28)
```

## Green phase

```
.github/workflows/ci.yml     six jobs, no aggregate, read-only token
README.md                    the CI section, naming the six required checks for W0-T13
tests/ci-workflow.test.ts    28 assertions over the workflow
```

```
$ pnpm vitest run tests/ci-workflow.test.ts
 Test Files  1 passed (1)
      Tests  28 passed (28)

$ pnpm verify
 typecheck  4 successful   lint  4 successful   format  clean
 test       api 44 passed | 8 skipped · web 15 passed · root 77 passed | 6 skipped
 build      3 successful
```

## Verified beyond the static suite

A workflow that only ever gets parsed by its own tests is a workflow nobody has run. Three of the
six jobs were executed by hand as CI will run them:

```
$ docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:1.7.7 -color
(no output — the workflow is valid)

$ DATABASE_URL=… pnpm db:migrate:deploy
All migrations have been successfully applied.

$ STACK_LIVE=1 pnpm vitest run tests/local-stack.test.ts
      Tests  15 passed (15)
$ STACK_LIVE=1 pnpm --filter @marketplace/api exec vitest run tests/db.test.ts
      Tests  29 passed (29)
```

That last pair is the payoff of the `database` job: twenty of those forty-four assertions are the
`STACK_LIVE` criteria `W0-T02` and `W0-T05` could not run in the default gate. Until now they were
skipped everywhere, and the suite measured less than it claimed.

## Deviations from the plan

1. **The `database` job runs `pnpm stack:up`, not a PostGIS service container.** The plan said
   service container; that would have been a second Postgres definition to keep in step with
   `docker-compose.yml`, *and* the live tests reach Postgres through `docker compose exec`, so they
   would have needed a CI-only variant — the exact split this spec argues against in §1. Bringing
   up the repo's own stack means one definition, one code path, and the compose file is exercised
   on every PR rather than drifting until someone's `pnpm stack:up` fails. AC7 was rewritten to
   assert this and to assert that the job declares **no** `services:`.

2. **`.nvmrc` is read by the action, not restated in the workflow.** AC10 originally said the
   pinned version must *equal* `.nvmrc`. `node-version-file: .nvmrc` removes the second copy that
   could drift, which satisfies the criterion's intent more strongly than the criterion's letter.

3. **Three test-mechanism bugs, found by the tests failing against a correct workflow.** All three
   are recorded because each would have recurred:
   - AC6 read only `run:` and `with:`, never `env:` — where `STACK_LIVE` actually lives.
   - AC11 collected `undefined` from the `pnpm/action-setup` steps that deliberately pin nothing
     (omitting `version` makes the action read `packageManager`, which is the stronger guarantee).
   - AC13 required an `@` in every `uses:`, which rejects `docker://rhysd/actionlint:1.7.7` — the
     documented form for a container action, and pinned by its tag. MEM-2026-09-09-19.

4. **`pnpm stack:logs` removed from the failure step.** It is `docker compose logs --follow`; in an
   `if: failure()` step it never returns, so the job would run to its fifteen-minute timeout to
   print logs it already had. Replaced with `docker compose logs --no-color --tail=200`.
   MEM-2026-09-09-18. Caught by reading the script, not by a test — the static suite cannot tell a
   blocking command from a returning one.

## Notes for the reviewer

- **This PR tests itself.** A `pull_request` workflow added by a branch in this repository runs on
  that branch's own PR, so the six checks appear here. That is *not* true of `W0-T07`'s deploy
  workflows, for a different reason — see that PR.
- **`ci` is deliberately not a check name.** Six names, no aggregate. §4 and MEM-2026-09-09-17
  explain why, and `W0-T13` depends on it.
- **No secrets, `contents: read`.** Nothing here needs more, and a workflow that reads a secret
  cannot safely run on a fork's pull request. Two criteria enforce it.
- **Gates deliberately left out**: `spec-present`/`intervention-logged` (`W0-T12`), `agents-drift`
  (`W0-T15`), `author-identity` (`W0-T21`), secret scan and dependency audit (ticketed; they need a
  policy decision on which severities block, which this task should not invent). Spec §9.

## Interventions

| Type | What | Ledger |
|---|---|---|
| `AUTOAPPROVE` | Operator pre-authorised the session, including merging the agent's own PRs. | `W0-T05` run record |
| `TOOL_BLOCKED` | `gh pr merge` was refused by the harness, so `W0-T05` could not be merged before this task started. Rather than stop, the branches were **stacked**: this branch is cut from `W0-T05-database-toolchain` and its PR is based on it. Same sequential ordering the plan called for, no re-merges; the operator merges the stack bottom-up. | this row |

No `MANUAL_FIX`: no gate was skipped, weakened or disabled.
