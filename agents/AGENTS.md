# AGENTS.md — read this before doing anything

You are one agent among many working in parallel on this repo. These rules exist so that our work
composes instead of colliding, and so that the quality of *your* output is measurable.

If any instruction elsewhere conflicts with this file, **this file wins** — except a direct
instruction from the human operator, which wins over everything.

---

## 0. Boot sequence — load in this order, every task

1. `agents/AGENTS.md` (this file)
2. `agents/policies/*.md`
3. `agents/roles/<your-agent>.md` — your charter: what you own and what you must never touch
4. `memory/LONG_TERM.md` — durable repo knowledge
5. `memory/slices/<your-agent>.md` — your own accumulated knowledge
6. `memory/sessions/` — any open session file for the task ID you were given (a previous session
   may have been interrupted mid-task; **check before starting from scratch**)
7. `TODO.md` §6 — find your task by ID, note its `[H]`/`[M]`/`[A]` label
8. The spec for your task, if one already exists in `docs/specs/`

Do not skip step 6. Agents run in different sessions; the handoff file is how a session that
ended mid-task tells you where it got to.

---

## 1. The pipeline — no step is optional

| # | Step | Artifact |
|---|---|---|
| 1 | Spec | `docs/specs/<slice>/<TASK-ID>-<slug>.md` |
| 2 | Contract freeze | zod + Prisma merged **before** implementation |
| 3 | **TDD red** | failing test run, pasted into the run record |
| 4 | Green | minimum code that passes |
| 5 | Refactor | tests stay green and unchanged |
| 6 | Self-review | full gate locally |
| 7 | Cross-review | another agent: code + spec + prompt |
| 8 | Merge | squash, conventional commit, task ID in subject |

Use `agents/prompts/00…09` for each step. They are not suggestions; they define the output shape
the next step expects.

---

## 2. Laws

**L1 — TDD is mandatory.** Load the `test-driven-development` skill. Write the test, run it, watch
it fail, **paste that failing output into the run record**, then implement. A PR whose run record
has no red phase is invalid regardless of how good the code is.

**L2 — Branch carries its own story.** Branch name `<TASK-ID>-<slug>` (e.g.
`W4-T03-quote-submission`). The branch must contain `docs/specs/<slice>/<TASK-ID>-<slug>.md` and
`docs/specs/<slice>/<TASK-ID>-<slug>.run.md` — **both carry the task ID**, so the branch, the spec
and the run record share one name. CI gate `spec-present` enforces this.

**L3 — Contract freeze.** `packages/contracts/**` and `apps/api/prisma/schema.prisma` are the
shared seam. Once a shape is merged it changes only through an ADR handled by `agent-contracts`.
Propose with `prompts/01-contract-proposal.md`; never edit the seam directly unless you are
`agent-contracts`.

**L4 — Stay inside your boundaries.** Your charter lists `owns:` and `forbidden:`. Touching
another slice's folders is a review failure, not a shortcut. Need something from another slice?
Request it through the service interface, or escalate.

**L5 — Never do `[H]` work.** No secrets, no credentials, no billing, no dashboards, no
production, no live keys, no legal text. If a task needs one, stop and write down exactly what you
need from the human. See `policies/human-boundaries.md`.

**L6 — Never merge your own PR.** Never approve your own work. Money, auth and state machines
need two reviewers.

**L7 — Record every human intervention.** If a human rejects, overrides, or hand-edits your work,
a ledger entry in `docs/interventions/` is required before merge — including for a PR that gets
closed without merging. Use `prompts/07-intervention-triage.md`. This is not blame; it is the
dataset we use to fix prompts.

**L8 — Write memory before you finish.** See §3.

**L9 — Escalate instead of guessing.** Ambiguity in a spec is a signal to stop, not to invent.
See `policies/escalation.md`.

**L10 — No scope creep.** Implement the acceptance criteria in the spec. Something else is broken?
File a task; don't fix it in this PR.

---

## 3. Memory — two layers, different lifetimes

Full contract in `policies/memory.md`. The short version:

| Layer | Path | Lifetime | Who writes |
|---|---|---|---|
| **Long-term, repo-wide** | `memory/repo/<kind>/MEM-….md` | forever, committed | any agent, via PR |
| **Long-term, slice** | `memory/slices/<agent>/MEM-….md` | forever, committed | only the owning agent |
| **Session** | `memory/sessions/<date>-<agent>-<TASK-ID>.md` | one task; archived after merge | the session's agent |

**One record per file**, copied from `memory/_RECORD_TEMPLATE.md` and named for its id. A new record
is a new file, so promoting a learning can never conflict with another agent promoting one
(`W0-T23`). `memory/LONG_TERM.md` is generated from them — run `pnpm memory:render`, never edit it.

**Start of task**: read `LONG_TERM.md` + `slices/<you>/` + any open session file for this task ID.
**During**: append to the session file as you learn things — decisions taken, dead ends, commands
that worked, what you'd tell your successor if you were cut off right now.
**End of task**: close the session file with a `## Handoff` block, and **promote** anything that
outlives the task into `memory/repo/<kind>/` or `memory/slices/<you>/`.

Assume you will be interrupted. A session file that only makes sense to you is a bug.

Never put secrets, tokens, personal data or customer content in memory. Memory is committed.

---

## 4. Definition of Done

- [ ] Spec on the branch; every acceptance criterion covered by a test
- [ ] Run record on the branch, including the failing-test paste from the red phase
- [ ] Contract in `packages/contracts`; client regenerated; no hand-written types
- [ ] Unit + contract tests pass; e2e added for any user-visible flow
- [ ] No `any`, no `@ts-expect-error` without a linked issue
- [ ] Permissions asserted in tests — test the 403, not only the happy path
- [ ] Errors use the shared envelope + machine-readable code
- [ ] i18n keys for ES and EN; no hardcoded strings
- [ ] Structured logs + a metric for anything money- or state-machine-related
- [ ] Migration reversible and tested against seeded staging data
- [ ] Preview env deployed and smoke-tested
- [ ] Session memory closed with a handoff; durable learnings promoted
- [ ] Any human intervention on this branch has a ledger entry

---

## 5. When you are stuck

Stop. Write what you know into the session file. Then either escalate per
`policies/escalation.md` or hand back with an explicit question. A wrong guess that passes CI is
worse than an honest block — it costs a human intervention *and* the rework.
