# W0-T29 — One `gates` job, and the check names `OPS-03` will use

- **Slice**: S0 Platform (`agent-devops`)
- **Decides**: how many jobs a pull request costs, and which check names branch protection will
  require. Nothing about what the gates *assert* changes, with one exception (§3.4).
- **Unblocks**: `OPS-03` / `W0-T13` — the names have to be chosen before they are typed into
  repository settings, not inherited from whatever shape `ci.yml` happens to have that day.

---

## 1. Purpose

Across the 273 CI runs between 2026-09-09 and 2026-09-17 this repo billed **1,993 minutes for
1,328 minutes of compute**. GitHub rounds every job up to a whole minute, so 11 jobs per run turn
~14 minutes of work into ~20 on the invoice.

Four of those jobs — `spec-present`, `intervention-logged`, `author-identity`, `agents-drift` — are
the same `scripts/gates/run.ts` with a different argument. Each spends ~30s on `checkout` +
`setup-node` + `pnpm install --frozen-lockfile` to run ~2s of gate, and each then bills a full
minute. Merged, they would have saved **345 minutes — 17% of every minute this repo has ever
billed** — and, more to the point now that the repo is public and minutes are free, they take three
runner slots away from the jobs a pull request is actually waiting on.

### 1.1 The tension, and how the operator resolved it

`ci.yml` splits one job per failure class deliberately: a red pull request should name *which* gate
failed without anyone opening a log. The job names are also the contract `W0-T13` requires in
branch protection, and GitHub matches required checks **by name** — so merging four jobs collapses
four required check names into one.

**Operator's steer, 2026-09-17** (in the `W3-T07` thread): *`spec-present` is the one that matters;
`author-identity` is not very useful; the gates take time.* That resolves the tension in favour of
collapsing, with two conditions this spec carries:

1. **A failure stays legible.** What four job names did, one job now does with a GitHub error
   annotation per failing gate and a table in the run summary (§3.2, §3.3). A red `gates` check
   names its gate on the Checks tab, without a log.
2. **The names are chosen, not inherited.** `OPS-03` has not run, so nothing is load-bearing yet.
   §4 is the list it should use.

## 2. What does not change

- Every gate's assertion, and every pure function in `scripts/gates/`, except §3.4.
- **No `if:` on the job.** A conditional job reports "skipped", and GitHub counts a skipped
  required check as satisfied. A gate that can vanish is not a gate (`W0-T12` AC8).
- **No `continue-on-error` anywhere in `ci.yml`.**
- The gates still refuse rather than pass when they cannot see their inputs (`GATE_NO_BASE`,
  exit 2).
- `perf` stays a reporter and must never be a required check.

## 3. Design

### 3.1 One job, one runner invocation

```yaml
gates:
  name: gates
  steps:
    - uses: actions/checkout@v5
      with: { fetch-depth: 0 }   # the diff and the walk both need the base
    - …setup-node + pnpm install…
    - run: pnpm gates            # = tsx scripts/gates/run.ts --all
```

`run.ts` gains an `--all` mode that evaluates **every** gate and only then decides the exit code.
Running them as four workflow *steps* would stop at the first failure — or need `if: always()` on
each, which is the same list of four in a different file. One invocation, one round trip, every
failure named.

`pnpm gates` is a root script, so the command CI runs is the command an agent runs locally. That is
already the rule for `typecheck`, `lint`, `unit` and `build`; these four gates were the exception.

### 3.2 A failing gate annotates the check

Each failure prints a GitHub workflow command:

```
::error title=gate: spec-present::SPEC_MISSING: branch "…" carries task ID … but changes no spec.…
```

Annotations appear on the pull request's Checks tab and next to the failing job, which is where the
four job names used to put the same information. Newlines are `%0A`-encoded, as the workflow-command
format requires, so the remedy survives intact.

### 3.3 Every verdict lands in the run summary

`$GITHUB_STEP_SUMMARY` gets a row per gate, and the full message of each failure underneath:

| gate | verdict |
| --- | --- |
| `spec-present` | ✅ `W0-T29: spec and run record both changed on this branch.` |
| `intervention-logged` | ⏭️ `no intervention:* label — nothing claimed, nothing to log.` |
| `author-identity` | ✅ `3 commit(s), every author and committer is mastrobardo@gmail.com` |
| `agents-drift` | ❌ `AGENTS_DRIFT: .claude/agents/agent-devops.md is out of date…` |

The summary is appended, never truncated, so it cannot delete another step's contribution to the
same file — the same rule `perf` follows.

### 3.4 `author-identity`: kept, and no longer wrong about GitHub's own commits

The gate has fired exactly once in this repo's history, on `03e8651` — the squash-merge commit
**GitHub** wrote when #256 was merged through the web UI (`MEM-2026-09-17-16`). Its remedy
(`git commit --amend --reset-author`) cannot be applied to a commit the platform authored on a
branch that is already merged, so the gate was telling the truth about a fact and the wrong thing
about what to do.

The fix is the smallest one that is also *right*: **a commit whose committer is `noreply@github.com`
was committed by GitHub, not by a person, so its committer trailer is not evidence about identity.
Its author still is, and is still judged.** Every path that produces such a commit — squash merge,
"Update branch", a web-UI edit — leaves the author untouched, which is the trailer this repo's rule
is actually about (`docs/board/IDENTITY.md`).

Why the gate survives at all, given the steer: `ADR-008` (§*Rules that follow from
AGENT-CREDENTIALS.md*) and `IDENTITY.md` both name it as the enforcement that cannot be bypassed —
push *authentication* is the `OPS-19` GitHub App, commit *authorship* is the personal identity, and
that split only holds while something checks. After this change it costs one `git log` in a job that
already has full history: no runner slot, no billed minute, no check name. The steer's cost argument
is answered by the collapse; its precision argument is answered above. See §6 Q1 — retiring it is a
one-line change if the operator still wants it gone.

### 3.5 `agents-drift` runs on `main` too; the other three still skip

The three pull-request gates have nothing to compare on a push to `main` and say so — an honest
answer rather than an absent one (`W0-T12` AC8). `agents-drift` needs no pull-request context, so it
is the one gate that still evaluates there. The runner asks
`scripts/generate-claude-agents.ts --check` rather than re-implementing the comparison: the
generator stays the single source of truth for what a generated charter looks like.

### 3.6 What stays a separate job, and why

`workflows` (actionlint) installs nothing and runs a container action; folding it in would save a
billed minute and mix *"this YAML is malformed"* with *"this branch has no spec"*. It keeps its own
name. `typecheck`, `lint`, `unit`, `build` and `database` are untouched — each is minutes of real
work, not a setup tax.

## 4. The check names for `OPS-03`

Seven required checks, and one job that must **never** be added:

| Required | |
|---|---|
| `typecheck` `lint` `unit` `build` | the four that do real work |
| `database` | the only job that needs Docker |
| `workflows` | actionlint |
| `gates` | `spec-present` · `intervention-logged` · `author-identity` · `agents-drift` |

| Never required | |
|---|---|
| `perf` | Lighthouse reports into the recap; performance is not a merge gate in the MVP phase |

Renaming a job here silently removes a required check and reports nothing. Rename one, update
branch protection in the same change.

## 5. Acceptance criteria

- **AC1** — `ci.yml` declares exactly eight jobs: the seven of §4 plus `perf`. None of
  `spec-present`, `intervention-logged`, `author-identity`, `agents-drift` is a job name any more.
- **AC2** — the `gates` job checks out full history (`fetch-depth: 0`) and runs one command, the
  same `pnpm gates` script an agent runs locally.
- **AC3** — `run.ts --all` evaluates every gate even when an earlier one fails, so one CI round
  trip names every failure.
- **AC4** — every gate's verdict is written to `$GITHUB_STEP_SUMMARY` as a table row, and each
  failure's full message is reproduced below the table.
- **AC5** — each failing gate emits a `::error title=gate: <name>::` annotation, so a red check
  names its gate without a log.
- **AC6** — the runner exits 1 when any gate fails, 0 when all pass or skip, and 2 when it cannot
  see its inputs.
- **AC7** — a single gate can still be run by name: `tsx scripts/gates/run.ts spec-present`.
- **AC8** — on a push to `main` the three pull-request gates report "not a pull request" and
  `agents-drift` still evaluates.
- **AC9** — `author-identity` does not fail a commit whose committer is `noreply@github.com`, and
  still fails one whose **author** is not the personal address.
- **AC10** — no `continue-on-error` in `ci.yml`, and no `if:` on any job.
- **AC11** — `README.md`, `agents/policies/review-and-merge.md` and `docs/board/IDENTITY.md` name
  the checks that exist, not the four that no longer do.

## 6. For the operator

- **Q1 — retire `author-identity` after all?** Kept, for the reasons in §3.4. Retiring it means
  deleting one entry from `GATES` in `scripts/gates/run.ts`, the module, its tests, and the
  sentences in `ADR-008` and `IDENTITY.md` that promise it. Say the word.
- **Q2 — `OPS-03` should use §4 verbatim.** It has not run yet, which is the only reason this
  ticket could choose the names rather than preserve them.
