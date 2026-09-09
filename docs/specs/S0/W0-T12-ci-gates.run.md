# Run record — W0-T12 the four CI gates

|            |                                                    |
| ---------- | -------------------------------------------------- |
| **Task**   | `W0-T12` (with `W0-T15`, `W0-T21`)                 |
| **Agent**  | `agent-devops`                                     |
| **Date**   | 2026-09-09                                         |
| **Branch** | `W0-T12-ci-gates`                                  |

---

## 1. How this task was chosen

It was not on the plan. The session began on `W0-T20` (sanitisation), and two findings redirected
it:

1. `gh issue list --limit 60` **truncated past #54**, so an early claim that "only two W0 issues
   remain open" was wrong — eleven more were open. The epic's sub-issue list
   (`gh api repos/…/issues/138/sub_issues`) is the authoritative enumeration; a paginated issue list
   filtered by title is not.
2. `W0-T20` turned out to have nothing to operate on: `schema.prisma` contains one model
   (`SeedRun`) and no domain columns at all, so there is no PII in the database to strip. Reported
   before writing code; the operator deferred the task.

While reading for both, the real gap surfaced: **four gates are documented as enforced and none
exists.**

## 2. The red phase

Stubs were written with real signatures *before* the tests, deliberately. `memory/repo/gotchas.md`
records that "a collection error proves only that a file is absent" — a suite that fails to import
has not tested anything. These 25 failures are assertions.

```
total 33 passed 8 failed 25

FAIL: AC1 … splits a workstream branch :: expected null to deeply equal { taskId: 'W0-T12', slug: 'ci-gates' }
FAIL: AC2 … fails when neither is touched :: expected true to be false
FAIL: AC2 … fails when the spec is there but the run record is not :: expected true to be false
FAIL: AC2 … names the files it wanted :: expected 'not implemented' to contain 'W0-T12-ci-gates.md'
FAIL: AC3 … fails when a label claims an intervention and no ledger file was added :: expected true to be false
FAIL: AC3 … does not count the template or the rollup as a ledger entry :: expected true to be false
FAIL: AC4 … fails on a work committer email even when the author is correct :: expected true to be false
FAIL: AC4 … reports every offending commit, not just the first :: expected 'not implemented' to contain 'bad1111'
FAIL: AC5 … docs/interventions/ has a template matching TODO.md §5.6 :: expected false to be true
FAIL: AC6 … has a job named spec-present :: expected [ 'typecheck', 'lint', 'unit', …(3) ] to include 'spec-present'
FAIL: AC6 … the history-reading gates check out full history :: spec-present must not use a shallow clone
  (…25 total)
```

Green after implementation: **35 passed, 0 failed** (AC7 added two after the fact — see §3).

## 3. The defect the unit tests could not have found

After the pure functions were green, the CLI was run against the real repository. It behaved
correctly. Then it was run with a base ref that does not exist:

```
GITHUB_BASE_REF=nonexistent-branch pnpm tsx scripts/gates/run.ts spec-present
```

```
fatal: ambiguous argument 'origin/nonexistent-branch...HEAD': unknown revision or path not in the working tree.
    at genericNodeError (node:internal/errors:983:15)
    …
Node.js v22.22.0
```

A Node stack trace naming neither the cause nor the fix. It fails closed, so it is not *dangerous*
— but it is the failure `W0-T24`'s run record already complained about once: a failure that does
not name the thing a human must change.

**The dangerous version is the obvious repair.** Wrapping the `git diff` in a `try/catch` that
returns "no changed files" makes the message disappear *and* makes every branch pass. That is a
gate reporting green because it cannot see. `actions/checkout` defaults to `fetch-depth: 1`, so
this is not hypothetical — it is what these jobs would have done had the depth been left at its
default and the error been swallowed.

Fixed with an explicit `git rev-parse --verify origin/<base>` and **exit 2**, distinct from a gate
failure (1):

```
GATE_NO_BASE: origin/nonexistent-branch is not in this clone, so there is nothing to compare against.
  Give the job a full history:
    - uses: actions/checkout@v5
      with:
        fetch-depth: 0
```

AC7 was added to cover it, driving the CLI end-to-end through `spawnSync`. The pure functions
cannot catch this class: the bug lives entirely in how facts are gathered.

## 4. Decisions worth reviewing

- **One branch, three issues.** `ci.yml` is one file and `W0-T23` (#153) exists because this repo
  already loses time to branches colliding on shared files. Splitting would have guaranteed three
  conflicts on the file being edited. Agreed with the operator before starting.
- **`--no-merges` on the identity walk.** A branch updated by GitHub's "Update branch" button
  carries a merge commit committed by `noreply@github.com`, which would fail a gate the author
  never violated. Merges are skipped; authored commits are all checked.
- **Labels as JSON, not a delimited string.** GitHub labels may legally contain commas and spaces.
  The first draft used `join(…, '\n')` inside the YAML expression, which needs a literal newline in
  the workflow source — replaced with `toJSON`.
- **Skipped ≠ passed.** Every gate distinguishes them, so CI can say "not applicable" rather than
  claiming it verified something it never looked at.
- **`spec-present` is satisfiable by a whitespace edit.** Accepted, and written into the spec's
  risks rather than left implicit. It enforces that the file exists and was considered; quality is
  a review axis, not a CI check.

## 5. Method note

The vitest JSON report at `.vitest/json/output.json` was **stale on re-read** — a second run
returned byte-identical output including assertions that had just been fixed. Two files that
should have passed were reported failing. Always write the report to a fresh path
(`--outputFile=…`) before trusting a comparison between runs; a report file that is not
regenerated is indistinguishable from a run that changed nothing.

## 6. Self-assessment

- **Weakest part:** `intervention-logged` is only as good as the labels. Nothing forces a human who
  hand-edits a branch to apply one — the gate catches the honest case, and the PR template's
  mandatory question is the only pressure on the dishonest one. A stronger version would compare
  commit authorship against the PR author, which `author-identity` makes unnecessary here only
  because this repo has exactly one human.
- **Look hardest at:** the `if: github.event_name == 'pull_request'` on three jobs. It is correct —
  a push to `main` has no base ref and no labels — but it means `main` is not gated by them, and if
  branch protection (`W0-T13`) is ever configured to require these checks on a push event they will
  never report at all.

## 7. Handoff

- `W0-T13` (#45) makes these required in branch protection. They are advisory until it lands.
- `TODO.md` §5.5 still claims five gates that do not exist: `prisma migrate diff`, `contract`,
  `e2e smoke`, `secret scan`, `dependency audit (high+)`. Listed in the spec's §2 so the next
  person does not have to rediscover it.
- The `intervention:*` labels did not exist in the repo and were created as part of this task.
