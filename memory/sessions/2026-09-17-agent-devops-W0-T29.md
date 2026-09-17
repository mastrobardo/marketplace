---
task:    W0-T29
agent:   agent-devops
session: 2026-09-17
status:  closed
---

# Session — W0-T29

## Goal

Collapse the four gate jobs — `spec-present`, `intervention-logged`, `author-identity`,
`agents-drift` — into one job. Each is `scripts/gates/run.ts` with a different argument, and each
pays ~30s of `checkout` + `setup-node` + `pnpm install` to run ~2s of gate, then bills a whole
minute. Keep `spec-present`'s failure legible, and choose the branch-protection check names
deliberately now, before `OPS-03` puts them in repository settings.

## Current state

- Branch `W0-T29-gate-consolidation`, cut from `origin/main` at `07ebec5`. The previous branch
  (`W3-T07-followup-next-block`) was content-identical to `main` — #259 squashed it — so nothing
  was carried over.
- `ci.yml` has 11 jobs. Four of them are the gates; `perf` is a reporter, not a gate.
- `tests/ci-workflow.test.ts` (`GATES`), `tests/ci-gates.test.ts` (AC6) and
  `tests/cd-workflows.test.ts` (AC26) all hard-code the four job names.
- Skills loaded: `test-driven-development` (L1), `ci-cd-and-automation`.

## Log

- Boot: `AGENTS.md`, `policies/*`, charter, `LONG_TERM.md`, `slices/agent-devops.md`, `sessions/`
  (no open file for this ID), `TODO.md` §6 `W0-T29`, `W0-T06` and `W0-T12`'s specs.
- **Decision — one job named `gates`.** The ticket's "middle option", which the operator's steer
  points at: one job, every gate reported in the run summary. Seven gate names survive
  (`typecheck`, `lint`, `unit`, `build`, `database`, `workflows`, `gates`) plus the `perf` reporter.
- **Decision — `author-identity` survives, inside the collapsed job, with its false positive
  fixed.** The operator's steer says it is "not very useful", and the ticket leaves its survival
  open. Against retiring it: `ADR-008` §*Credentials* and `docs/board/IDENTITY.md` both name it as
  the enforcement that cannot be bypassed, so deleting it silently falsifies two documents; and
  after the collapse it costs ~1s of `git log` in a job that already checks out full history — the
  cost half of the steer is answered by the collapse itself. The precision half is answered by
  `MEM-2026-09-17-16`: a commit whose *committer* is `noreply@github.com` was committed by GitHub,
  never by a person, so its committer trailer is not evidence of anything. Its author still is.
  Raised in the spec §6 as a one-line reversal if the operator wants it gone anyway.
- **Decision — `workflows` (actionlint) stays its own job.** It installs nothing, runs a container
  action, and is a different failure class. Folding it in would save a billed minute and mix
  "the YAML is malformed" with "the branch has no spec" (`L10`).
- **Decision — `agents-drift` is judged by the same runner, not a second step.** It is the only
  one of the four that needs no pull-request context, so it is also the only one that still runs
  on a push to `main`. The runner spawns `scripts/generate-claude-agents.ts --check` rather than
  re-implementing the comparison: the generator stays the single source of truth for what a
  generated charter looks like.

## Open questions

- §6 Q1 — retire `author-identity` altogether? Kept here, for the reasons above.

## Handoff

**`W0-T29` is complete.** One `gates` job, seven required check names, `pnpm gates` locally, spec
and run record on the branch, memory promoted. Gates run locally before pushing: typecheck 10/10 ·
lint clean · format:check clean · test 10 turbo tasks + 283 root (277 passed, 6 skipped) · build
6/6 · actionlint clean through the same pinned container the `workflows` job uses.

**Next action: `W3-T10`** — the demo provider seeder, then retire `mocks/search.ts`,
`mocks/provider.ts` and their two handlers, re-pointing `tests/mocks.test.ts` AC14–AC16 at the
contract rather than the handler. `TODO.md`'s NEXT block carries the detail.

**`OPS-03` is a human task and did not run here.** When it does, the seven names are in the spec's
§4 and `perf` must never be among them. Nothing in this PR touches repository settings.

**Do not redo:**
- Folding `workflows` (actionlint) into `gates`. It installs nothing and runs a container action;
  it would save a billed minute and mix two failure classes with no shared setup (spec §3.6).
- The `REPO_ROOT` resolution in `run.ts`. `agents-drift` must judge *this* repository, not the
  working directory, or a run from anywhere else reports drift that does not exist — there is a
  test for it.
- `author-identity`'s committer rule. Ignoring `noreply@github.com` on a committer trailer is
  deliberate and documented in `IDENTITY.md`, the spec §3.4 and `MEM-2026-09-17-20`.

**Carry forward — one question for the operator:** spec §6 Q1. `author-identity` survived the
collapse; the steer said it was not very useful. It now costs one `git log` in a job that already
has the history, and `ADR-008` plus `IDENTITY.md` both promise it. Retiring it is one entry out of
`GATES`, the module, its tests, and two sentences in those documents.

**Skills used**: `test-driven-development` (the red phase in the run record §1 — three suites, 144
tests, three failures and one suite that would not collect), `ci-cd-and-automation` (the job/setup
rule now in `conventions.md` as `MEM-2026-09-17-18`).
