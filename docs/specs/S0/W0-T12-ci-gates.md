# Spec — W0-T12 the four CI gates the repo already promises

|               |                                                                          |
| ------------- | ------------------------------------------------------------------------ |
| **Task**      | `W0-T12` `[A]` — with `W0-T15` and `W0-T21`                              |
| **Slice**     | S0 Platform                                                              |
| **Owner**     | `agent-devops`                                                           |
| **Reviewers** | `agent-qa`                                                               |
| **Issues**    | [#44](https://github.com/mastrobardo/marketplace/issues/44) `spec-present` + `intervention-logged` · [#47](https://github.com/mastrobardo/marketplace/issues/47) `agents-drift` · [#53](https://github.com/mastrobardo/marketplace/issues/53) `author-identity` |
| **Status**    | in progress                                                              |

---

## 1. Purpose

Four gates are described in this repository as **enforced**:

| Gate | Where it is claimed |
|---|---|
| `spec-present` | `AGENTS.md` L55, `TODO.md` L219 and §5.5, `memory/repo/conventions.md` L10 |
| `intervention-logged` | `TODO.md` §5.5 and §5.6, `agents/policies/review-and-merge.md` L24 |
| `agents-drift` | `TODO.md` §5.5, `agents/roles/agent-devops.md` L43 |
| `author-identity` | `docs/board/IDENTITY.md`, "Enforcement" |

None of them exists. `.github/workflows/ci.yml` runs `typecheck`, `lint`, `unit`, `build`,
`database` and `workflows` — six jobs, no gates. Every agent has been asked to police itself, and
CI has reported success either way.

This is worse than having no gate. A documented gate is a gate reviewers *rely* on: the reason
nobody checks whether a branch carries its spec is that CI is believed to have checked. The gap is
invisible precisely where it matters.

### Why one task and not three

`W0-T12`, `W0-T15` and `W0-T21` are separate board items, but all four gates land in one workflow
file and share one test file and one CLI. Three branches would collide on `ci.yml` three times —
which is `W0-T23` (#153), the task that exists *because* this repo already loses time to exactly
that. One branch, three issues closed.

## 2. Scope

**In:** the four gates, the `docs/interventions/` ledger they point at, the PR template, and the
documentation edits that make the claims true.

**Out:** the remaining `TODO.md` §5.5 gates — `prisma migrate diff`, `contract`, `e2e smoke`,
`secret scan`, `dependency audit`. Each needs machinery this repo does not have yet (a frozen
OpenAPI contract, a Playwright suite). Naming them here is deliberate: they are still claimed and
still absent, and the next person should not have to rediscover that.

**Out:** branch protection making these gates *required* — that is `W0-T13` (#45), and it is a
GitHub settings change, not a repository change.

## 3. Design

### 3.1 A gate is a pure function

Each gate splits in two: a pure decision function under `scripts/gates/` and one impure CLI
(`run.ts`) that gathers facts from git and the environment. This follows `scripts/deploy/`
(`config.ts` decides, `check.ts` executes), and it is what lets the interesting half be tested
without a pull request, a network, or a second repository.

### 3.2 `spec-present`

A branch whose name starts with a task ID must **change** both `docs/specs/<slice>/<ID>-<slug>.md`
and `<ID>-<slug>.run.md`.

- **Changed, not merely present.** A branch that inherits a spec written by an earlier task has
  documented nothing about itself.
- **Prefix-anchored.** `revert-W0-T12-ci-gates` contains a task ID but is not that task, and
  demanding it re-add the spec it is reverting is backwards.
- **The slice directory is not pinned**, so `W1` needs no change to this gate.
- **A branch with no task ID skips.** `main`, a spike and a typo fix are legitimate. The gate
  reports "skipped", never "passed" — see §3.5.
- Spec present but run record absent is its own failure code (`SPEC_UNPAIRED`), because it is the
  common case: the run record carries the failing-test paste and is written last.

### 3.3 `intervention-logged`

If the PR carries any `intervention:*` label, the branch must add a file matching
`docs/interventions/YYYY-MM-DD-<TASK-ID>-<n>.md`.

`_TEMPLATE.md` and `ROLLUP.md` are explicitly not entries — neither records anything that happened.
The date-and-number pattern is matched in full rather than by substring, so a `W0-T1` branch cannot
satisfy the gate with `W0-T12`'s entry.

Labels arrive as **JSON** through `env:`, not interpolated into a `run:` string: GitHub labels may
contain commas, spaces and shell metacharacters.

### 3.4 `author-identity`

Every commit in the range must have author **and** committer equal to `mastrobardo@gmail.com`.

Both trailers, because `git commit --author=…` sets only the author and leaves the committer as
whoever ran the command — and on this machine `gh` and the default SSH key both authenticate as the
work account (`IDENTITY.md`, "Known trap"). The `.githooks/pre-commit` hook checks the same thing,
but it is opt-in via `core.hooksPath` and `--no-verify` skips it. This gate is the one that cannot
be bypassed.

Every offending commit is reported, not the first: discovering the next one only after another CI
round is how a five-commit branch costs an afternoon.

### 3.5 The failure mode that matters most

A gate that cannot see its inputs must **refuse**, not pass.

`actions/checkout` defaults to `fetch-depth: 1`. With a shallow clone there is no base commit,
`git diff` aborts, and the obvious implementation — catch the error, return "no changed files" —
passes every branch while reporting green. `spec-present` and `author-identity` therefore assert the
base ref is present and exit **2** with the `fetch-depth: 0` fix in the message. Exit 2 is distinct
from a gate failure (1) so the two are never confused in a log.

## 4. Acceptance criteria

| | |
|---|---|
| AC1 | A branch name parses into a task ID and slug; `W0-T12`, `OPS-04` and `BD-07` shapes; `null` for no ID; not matched mid-branch |
| AC2 | `spec-present` passes both-changed, fails neither (`SPEC_MISSING`) and either-alone (`SPEC_UNPAIRED`), ignores another task's spec, accepts any slice dir, skips a non-task branch, and names the files it wanted |
| AC3 | `intervention-logged` skips with no label, fails a labelled PR with no entry, passes with one, rejects another task's entry, lists every label, and rejects `_TEMPLATE.md`/`ROLLUP.md` |
| AC4 | `author-identity` passes a clean range, fails a work author, fails a work committer, names sha and email, reports every offender, passes an empty range, and is case-insensitive |
| AC5 | The ledger template matches `TODO.md` §5.6 and the PR template asks whether a human changed anything |
| AC6 | `ci.yml` runs all four by name; `agents-drift` invokes the generator with `--check`; the history-reading gates use `fetch-depth: 0` |
| AC7 | A gate whose base ref is absent exits 2 naming `fetch-depth: 0`; an unknown gate name exits 2 |

## 5. Risks

- **The gates become required and block everything.** Mitigated by scope: making them required is
  `W0-T13`. Until then they are advisory-by-default and visible on every PR.
- **`author-identity` and merge commits.** A branch updated by GitHub's "Update branch" button gets
  a merge commit whose committer is `noreply@github.com`. `run.ts` passes `--no-merges`, so the
  gate walks only authored commits. Rebase remains the house style.
- **`spec-present` is satisfiable by touching a whitespace character** in the spec. Accepted: this
  gate enforces that the file exists and was considered, not that it is good. Spec quality is a
  review axis (`TODO.md` §5.4), and no CI check substitutes for it.
