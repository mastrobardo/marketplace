# Spec — W0-T06 CI on pull requests

|               |                                                      |
| ------------- | ---------------------------------------------------- |
| **Task**      | `W0-T06` `[A]`                                       |
| **Slice**     | S0 Platform                                          |
| **Owner**     | `agent-devops`                                       |
| **Reviewers** | `agent-qa`, `agent-contracts`                        |
| **Issue**     | https://github.com/mastrobardo/marketplace/issues/38 |
| **Status**    | draft                                                |

---

## 1. Purpose

Nothing is enforced. Five PRs have merged to `main` on the strength of an agent running
`pnpm verify` on its own laptop and reporting the result in a run record. That is not a gate, it is
a claim — and the agent writing the claim is the agent being checked.

This repo is built almost entirely by agents working in parallel in separate sessions. The failure
mode is specific: an agent finishes, self-reports green, and the *next* agent inherits a broken
`main` and spends its session debugging someone else's slice. `TODO.md` R8 and
`memory/repo/gotchas.md` MEM-2026-09-09-12 already record that branches interact badly; without CI
the only detector of a bad interaction is a human reading a diff.

So the point is not "we have a build badge". It is that **the claim becomes a fact**: every gate an
agent asserts locally is re-run by something the agent does not control, on every PR, before a
human spends attention on the change. It is also the precondition for `W0-T13` — branch protection
has nothing to require until named checks exist.

## 2. User stories

- **As a reviewer**, I want types, lint, format, tests and builds already checked when I open a PR,
  so that review is judgement rather than typo-hunting.
- **As an agent**, I want the same gate in CI as on my laptop, so that "green locally" and "green in
  CI" cannot diverge and become two separate things to satisfy.
- **As an agent**, I want the database tests actually run somewhere, so that the eight criteria
  `W0-T05` marked live are not permanently skipped.
- **As `agent-devops` (in `W0-T13`)**, I want stable check names to require in branch protection.
- **As anyone waiting on a PR**, I want the answer in under ten minutes, so that CI shapes how the
  work is done rather than being routed around.
- **As the repo owner**, I want a superseded run cancelled when I push again, so that two commits do
  not queue behind each other on a free-tier runner.

## 3. State machine

The stateful thing is a **PR's check status**.

| from | event | to | guard | side effect |
| --- | --- | --- | --- | --- |
| *none* | PR opened / synchronised | `queued` | any base branch | a run starts; any in-flight run for the same PR is cancelled |
| `queued` | runner picks it up | `running` | — | setup, install, restore cache |
| `running` | every job succeeds | `success` | — | checks reported green; merge unblocked (once `W0-T13` lands) |
| `running` | any job fails | `failure` | — | the failing job's log is the answer; merge blocked |
| `running` | new commit pushed | `cancelled` → `queued` | `cancel-in-progress` | the superseded run stops immediately |
| `success` | merge to `main` | `queued` | — | the same workflow runs again on `main` |

There is no `skipped` state for a gate. A gate that cannot run is a failure, not a pass — the whole
point is that a green check means the same thing every time.

## 4. API surface

No code surface. The public surface is the set of **check names**, because `W0-T13` and `OPS-03`
will name them in branch protection and a rename silently unblocks merges.

| Check | What it runs | Why it is separate |
| --- | --- | --- |
| `build` | `pnpm build` | the slowest job; starting it in parallel is what keeps the wall clock under budget |
| `typecheck` | `pnpm typecheck` | distinct failure class from lint; a reviewer should not read a lint log to find a type error |
| `lint` | `pnpm lint` + `pnpm format:check` | both are "the code is not shaped right" |
| `unit` | `pnpm test` | the workspace suite, no daemons |
| `database` | `pnpm stack:up`, migrations, then every `STACK_LIVE=1` suite | the only job needing Docker |
| `workflows` | `actionlint` over `.github/workflows/**` | CI that cannot lint itself is CI nobody can change safely |

`ci` is **not** a check name. A single aggregate job hides which gate failed and makes the required
check list a lie by omission.

## 5. Permissions matrix

Not user roles — **token** permissions, which is where a CI misconfiguration becomes a supply-chain
problem.

| Actor | `contents` | `pull-requests` | secrets | notes |
| --- | --- | --- | --- | --- |
| every job in this workflow | `read` | none | none | read-only is the default and this task never needs more |
| a fork's PR | `read` | none | none | GitHub gives a forked PR a read-only token; nothing here assumes otherwise |
| `agent-devops` | writes `.github/**` | — | — | charter |
| any other agent | must not edit `.github/**` | — | — | charter — a gate is not weakened by the slice it fails |

Denies that become tests: the workflow declares an explicit top-level `permissions` block, no job
requests `write`, and no job references `secrets.*`.

## 6. Error cases

| Code | When | What the operator sees |
| --- | --- | --- |
| gate failure | any of the six checks fails | that job red, the others still reported — the failing gate is identifiable without opening a log |
| `timeout` | a job exceeds its `timeout-minutes` | the job is killed; a hung install cannot burn the free-tier minute budget |
| cache miss | the pnpm store key changes | the run is slower, never wrong — the cache is keyed by lockfile hash |
| service unhealthy | the PostGIS container never becomes ready | `database` fails on its health check rather than on a confusing connection error |
| runner outage | GitHub-side failure | re-run; nothing here retries automatically, because a flaky gate must be **fixed**, not retried |

## 7. Acceptance criteria

**Triggers and lifecycle**

1. **Given** the workflow, **when** its triggers are read, **then** it runs on **every**
   `pull_request` regardless of base branch, and on `push` to `main` only, and on nothing else.
   Restricting the pull-request trigger to `base: main` leaves a stacked PR — one feature branch
   reviewed on top of another — with no checks at all; limiting `push` to `main` stops a branch
   push being checked twice, once by the push and once by its PR.
2. **Given** two pushes to one branch in quick succession, **when** the second starts, **then**
   `concurrency` cancels the first — the group is per-ref and `cancel-in-progress` is true.
3. **Given** the `push` trigger on `main`, **when** a run happens there, **then** it is **not**
   cancelled by concurrency — a `main` build that is cancelled leaves `main` unverified.

**The gates**

4. **Given** the workflow, **when** its jobs are read, **then** exactly the six check names in §4
   exist, each as its own job.
5. **Given** each gate job, **when** its steps are read, **then** it runs the same `pnpm` script an
   agent runs locally — CI must not invent a variant command.
6. **Given** the `database` job, **when** it runs, **then** it applies the migrations and runs the
   `STACK_LIVE=1` suite against a container that has PostGIS.
7. **Given** the `database` job, **when** its steps are read, **then** it brings up the project's
   own `docker-compose.yml` via `pnpm stack:up` rather than a bespoke service container — one
   Postgres definition, one version, one code path, everywhere. It follows that the live suites
   need no CI-specific variant, and that the compose file is itself exercised on every PR.
8. **Given** any job, **when** its steps are read, **then** none carries `continue-on-error`, and
   none is conditioned on anything that could silently skip it.
9. **Given** the `workflows` job, **when** it runs, **then** `actionlint` checks every file in
   `.github/workflows/`.

**Reproducibility**

10. **Given** any job, **when** its Node version is read, **then** it comes from `.nvmrc` — read
    from the file, not restated as a literal that can drift from it.
11. **Given** any job, **when** its pnpm version is read, **then** it satisfies `packageManager` in
    the root `package.json`.
12. **Given** any job, **when** dependencies are installed, **then** it is `--frozen-lockfile`, so a
    lockfile that does not match `package.json` fails rather than being silently updated.
13. **Given** every `uses:` in the workflow, **when** its ref is read, **then** it is pinned to a
    version tag, never a moving branch.

**Budget**

14. **Given** every job, **when** its `timeout-minutes` is read, **then** it is set and ≤ 15.
15. **Given** the workflow, **when** the critical path is computed, **then** no chain of `needs`
    exceeds two jobs — the gates run in parallel, not in a queue.
16. **Given** a repeat run on an unchanged lockfile, **when** install runs, **then** it restores a
    cached pnpm store rather than re-downloading.

**Security**

17. **Given** the workflow, **when** its top level is read, **then** `permissions` is declared and
    grants `contents: read` only.
18. **Given** every job, **when** it is read, **then** it references no `secrets.*` — nothing here
    needs one, and a workflow that reads a secret cannot safely run on a fork's PR.

**Documentation**

19. **Given** `README.md`, **when** the CI section is read, **then** it lists the exact check names
    `W0-T13` must require in branch protection.

All nineteen are statically checkable by parsing the workflow file, and are. The suite deliberately
does not shell out to GitHub: a test that needs a GitHub API call is a test that cannot run offline
or on a fork.

## 8. Data

No database changes. The `database` job creates and destroys its own throwaway databases, exactly
as the `W0-T05` live tests do locally.

## 9. Out of scope

Each of these is somebody's ticket already, and folding them in here would make the required-check
list churn:

- **`spec-present` and `intervention-logged`** — `W0-T12`.
- **`agents-drift`** — `W0-T15`.
- **`author-identity`** — `W0-T21`. `.githooks/pre-commit` covers it locally today.
- **Secret scanning and dependency audit** — named in the `agent-devops` charter, ticketed
  separately; they need policy decisions (which severities block?) this task should not invent.
- **Branch protection itself.** This task produces the check names; requiring them is `W0-T13` and
  needs GitHub settings access (`OPS-03`), which is `[H]`.
- **Deploys.** `W0-T07`.
- **E2E and contract tests.** `W1-T04` and `W7-T01`. The job list grows when the suites exist.
- **A merge queue.** Worth having when the repo has enough traffic to need one; it does not.

## 10. Open questions

None blocking.

One note for `W0-T13`: the six check names in §4 are the contract. Renaming a job silently removes
a required check — GitHub matches by name and reports nothing when a required check simply never
arrives. If a job is renamed, branch protection must be updated in the same change.
