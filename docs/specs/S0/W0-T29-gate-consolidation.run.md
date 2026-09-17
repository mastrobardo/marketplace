# W0-T29 — run record

- **Branch**: `W0-T29-gate-consolidation`, off `main` at `07ebec5`
- **Spec**: `docs/specs/S0/W0-T29-gate-consolidation.md`
- **Session**: `memory/sessions/2026-09-17-agent-devops-W0-T29.md`
- **Trigger**: the billing stop of 2026-09-17 — 1,993 billed minutes against 1,328 of compute —
  and the operator's steer in the `W3-T07` thread, which turned this ticket from a review into a
  decision.

---

## 1. Red phase

The three suites that hard-code the shape of `ci.yml`, run before any of it was written:

```
 Test Files  3 failed (3)
      Tests  3 failed | 141 passed (144)

 FAIL  tests/ci-gates.test.ts
Error: Cannot find module '../scripts/gates/agents-drift.js'
  imported from tests/ci-gates.test.ts

 FAIL  tests/ci-workflow.test.ts > AC4 — exactly the named jobs exist
AssertionError: expected [ 'agents-drift', …(10) ] to deeply equal [ 'build', 'database', 'gates', …(5) ]

 FAIL  tests/ci-workflow.test.ts > AC19 — the required check names are written down for W0-T13
AssertionError: README does not name the "gates" check

 FAIL  tests/cd-workflows.test.ts > AC26 — a deploy is never a required check
AssertionError: expected [ 'agents-drift', …(10) ] to deeply equal [ 'build', 'database', 'gates', …(5) ]
```

`ci-gates.test.ts` could not even be collected: `agents-drift` had no pure half to test, because
until now it was a line of YAML rather than a gate.

## 2. Green

```
 Test Files  3 passed (3)
      Tests  191 passed (191)
```

The suite grew by 47: the four gates' own decisions were already covered, and what was untested was
everything this ticket touches — that every gate is judged in one invocation, that a failure is
annotated and summarised, and that `agents-drift` is a verdict rather than an exit code.

Full local gate afterwards: `typecheck` 10/10 · `lint` clean · `format:check` clean · `test`
10 turbo tasks + 283 root (277 passed, 6 skipped) · `build` 6/6 · `actionlint` clean (the same
pinned container the `workflows` job uses).

## 3. Four things worth writing down

### 3.1 The rule is about setup, not about failure classes

`ci.yml`'s own header said *"one per failure class, each its own job so a red PR says which gate
failed"*. That reasoning is sound and it is not what made four jobs expensive: the four gates are
**one script with four arguments**, so they share a checkout, a Node, and a `pnpm install`. The
sharper rule, now in the header: *a job earns its own name by having its own setup, not merely its
own failure class.* `workflows` (actionlint) keeps its name under that rule — it installs nothing
and runs a container action; `database` keeps it because it needs Docker.

### 3.2 A failing gate needs an annotation, not just a summary

`$GITHUB_STEP_SUMMARY` is the run recap, one click away from the pull request. What the four job
names actually provided was a red name *on the Checks tab*, with no click at all. `::error
title=gate: spec-present::…` puts it back there. Two details that are easy to get wrong and silent
when you do: newlines must be `%0A`-encoded or GitHub keeps the first line only, and `%` must be
escaped first or it corrupts the encodings that follow.

### 3.3 Every gate runs, whatever the one before it decided

Four jobs had one genuine advantage this ticket had to keep: they ran in parallel, so a branch that
broke two of them learned both at once. Four `run:` **steps** would not — a failing step ends the
job. Hence `--all` inside one process: the gates are evaluated, then the exit code is decided. A
branch with no spec and a work-address commit now gets both in the same round trip, which on this
repo is ~13 minutes of feedback either way.

### 3.4 `agents-drift` is about this repository, not about the working directory

Found by a test, not by reading: the runner spawns the generator, and the generator resolves
`agents/roles` relative to the working directory. A test that points the git gates at a scratch
repository would therefore have made `agents-drift` report drift in a directory that has no agents
at all. The spawn uses `REPO_ROOT`, resolved from `import.meta.url` — the git-reading gates keep
using the working directory on purpose, because their subject *is* whatever repository the caller
is standing in.

## 4. The one thing that changed behaviour

`author-identity` no longer fails on a commit whose committer is `noreply@github.com`. The gate has
fired exactly once in this repo's history and that was the case: `03e8651`, the squash-merge commit
GitHub wrote when #256 was merged (`MEM-2026-09-17-16`). Its author is still judged, which is the
trailer `IDENTITY.md` is actually about — every platform path (squash merge, "Update branch", a
web-UI edit) leaves the author untouched.

The operator's steer said the gate is "not very useful", and the ticket left its survival open. It
survives because `ADR-008` and `IDENTITY.md` both name it as the enforcement that cannot be
bypassed — push authentication is the `OPS-19` App, commit authorship is the personal identity, and
that split only holds while something checks — and because after the collapse it costs one
`git log` in a job that already has the history: no runner slot, no billed minute, no check name.
**Spec §6 Q1 stays open**: retiring it is a one-line change if the operator wants it gone anyway.

## 5. What this does not do

- **It does not touch branch protection.** `OPS-03` is `[H]` and has not run. The names to use are
  in spec §4; if `OPS-03` had already run, this PR would have had to change the settings in the
  same change, and the ticket said so.
- **It does not merge `workflows` in.** One more billed minute, and it would mix *"this YAML is
  malformed"* with *"this branch has no spec"* (`L10`).
- **It does not change what any gate asserts**, except §4.

## 6. Numbers

| | before | after |
|---|---|---|
| jobs per run | 11 | 8 |
| jobs running `scripts/gates/run.ts` | 4 | 1 |
| `pnpm install` per run | 10 | 7 |
| required check names (`OPS-03`) | 10 | 7 |
| billed minutes per run, gates only | ~4 | ~1 |

At the observed rate of the first 273 runs, ~3 minutes a run is ~345 minutes — 17% of every minute
this repository has billed. Minutes are free while the repo is public; the three runner slots per
push are the part that is still worth having.
