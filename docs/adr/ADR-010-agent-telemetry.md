# ADR-010: Agent telemetry — what we monitor, and why

## Status
Proposed — 2026-09-11 · extends [ADR-008](ADR-008-autonomous-agent-orchestration.md) (orchestration)
and [ADR-009](ADR-009-model-tiering.md) (model tiering). Implemented by `W11-T19` (issue
[#197](https://github.com/mastrobardo/marketplace/issues/197)).

---

## Summary — what we monitor, and why

We monitor **four signals**. Each exists because it names a file somebody can go and fix.

**1. Correction rate, by root cause.** Every time a human corrects an agent — not only when a PR is
closed — one ledger entry in `docs/interventions/`, carrying exactly one of the seven root causes in
`agents/prompts/07-intervention-triage.md`. *Why:* it is the only signal that identifies **which
artifact is wrong**. A rising `prompt-gap` points at `agents/prompts/`, `spec-gap` at how specs are
written, `missing-gate` at CI, `context-missing` at the context pack. Cost and pass rates tell you
something is wrong; only this tells you where. Today's trigger is "a human closed a PR", which has
fired **once in thirteen tasks** while the transcripts show ~125 operator turns — so the ledger is
currently measuring the rarest failure mode and missing the common one.

**2. Run-record completeness.** A mechanical check that each `*.run.md` carries a non-empty
`## Prompts` section with verbatim prompts and a corrections block. *Why:* it is the **input** to
signal 1, and it decayed without anyone noticing. All eight `S0` run records carry verbatim prompts;
all five `S1` records dropped them for narrative prose. The records got better as *writing* and
useless as *data*, exactly when the tasks became hard enough to be worth learning from. A convention
that is not a gate does not survive a deadline (`TODO.md` R11).

**3. Cost and attempts per completed task.** Dollars, wall-clock, and attempts per *merged* ticket —
never per request. *Why:* it is the denominator `W11-T14` needs before a cheaper tier can be trusted.
A tier that costs half as much and re-attempts three times is more expensive, and per-request pricing
hides that. Baseline today: **~$185 across 13 sessions, ~$14/task, spread $0.72 → $34.51**.

**4. Memory hit rate.** Whether an agent tripped over something a `MEM-*` entry already recorded.
*Why:* 64 memory entries only pay for themselves if they are read. A repeat of a documented gotcha is
a **context-pack failure**, not a model failure, and the two have opposite fixes — one is `W11-T04`,
the other is a prompt or a tier change. Without this signal every repeat looks like the model was
careless.

**What we deliberately do not monitor.** No dashboard before `W9-T06`. No statistics, trends or A/B
claims on a corpus of thirteen tasks — the corpus is read, not averaged. No vector store over the
history (ADR-008 rejects RAG for the context pack; the same reasoning applies here). No per-token
telemetry: the unit is a finished ticket.

*(~430 words)*

---

## Context

`TODO.md` §5.6 already designed the learning loop: a human intervenes, a ledger entry is written, a
root cause is chosen, a corrective action lands in a prompt or a charter. `agents/prompts/08` already
requires the run record that feeds it. Both are CI-gated. An audit on 2026-09-11, across thirteen
completed tasks, found the loop is **open** — data goes in, nothing comes back out.

| Source | Volume | State |
|---|---|---|
| Specs + run records | 13 tasks, `docs/specs/S0,S1/*.run.md` | Rich, but the format changed silently |
| Intervention ledger | **1 entry** (`W0-T23`, `spec-gap`, REJECTED) | The designated learning dataset is n=1 |
| Memory | 31 repo-wide + 33 slice `MEM-*` entries | Healthy, actively written |
| Session files | 11 in `memory/sessions/` | Narrative, per task |
| Claude Code transcripts | 15 JSONL, 20 MB, **outside git** | 125 human turns, 3 053 assistant messages, 1 597 Bash calls, 40 tool errors, per-session cost — never analysed |

Three findings drive this ADR.

**The highest-value field decayed exactly when the work got hard.** `agents/prompts/08-run-record.md`
demands verbatim prompts and a "why a re-prompt was needed" block. Every `S0` record has them. No
`S1` record does — `W1-T01`, `T02`, `T05`, `T06` are careful essays about the *code* and contain not
one re-runnable prompt. The `spec-present` gate checks only that the file exists.

**Almost every correction is invisible.** ~125 operator turns produced one ledger entry, because
§5.6's trigger is a closed PR and PRs are not how corrections happen — re-prompting mid-session is.
`W1-T06` §2 is the clearest case: three seam decisions were put to the operator, the answer was
*"let's start"*, and the agent proceeded on its own recommendations and said so honestly. That is a
textbook `context-missing` signal. It produced no entry and no corrective action.

**The cost baseline already exists and nobody has read it.** `cost-state` records in the transcripts
carry `totalCostUSD`, `totalAPIDuration`, `totalLinesAdded` and a per-model token split — most of what
`W11-T14` proposes to build.

The corpus is **too small for statistics and exactly the right size for a read-through**. Thirteen
tasks will not support A/B testing a prompt. They will support extracting every correction,
classifying it, and patching the artifact that let it through — which is the loop `07` already
describes, applied where corrections actually occur.

## Decision

**Instrument the four signals above at the point where the work already produces them, and change no
agent's job description to do it.**

| Signal | Collected where | Enforced by |
|---|---|---|
| Correction rate by root cause | `docs/interventions/*.md`, trigger lowered to in-session corrections | `intervention-logged` (existing) |
| Run-record completeness | `docs/specs/<slice>/*.run.md` | `spec-present`, extended to assert **sections** |
| Cost / attempts per task | `cost-state` today; per-phase run-record table from `W11-T09` | Reported, not gated |
| Memory hit rate | Ledger entries whose root cause is `context-missing` and which name an existing `MEM-*` | Reported in `ROLLUP.md` |

Two of the four are already-built gates that need a wider trigger or a stricter assertion. That is
deliberate: a monitoring plan whose first step is a new service is a monitoring plan that does not
ship.

**The ledger trigger moves from "a human closed a PR" to "a human corrected the agent".** A re-prompt
that redirects the work is an intervention. A re-prompt that answers a question the agent asked is
not. `MANUAL_FIX` and `OVERRIDDEN` keep their existing meanings; the new volume lands under
`REWORKED` and `SCOPE_CHANGE`.

**`spec-present` grows a second assertion**: a `*.run.md` must contain a `## Prompts` heading with a
non-empty body and a corrections subsection. Mechanical, one regex, no judgement. This is the gate
whose absence caused finding 1, and `W0-T26` is the standing proof that a gate nobody can see fail is
a gate that is not running.

## Backfill

The transcripts are the only record of the ~124 corrections that were never logged, and **they are
not in git** — they live in `~/.claude/projects/<slug>/*.jsonl` on one laptop, are pruned by the
harness, and die with the machine. Backfilling them is the one piece of this ADR with a deadline.

Procedure: extract every human turn with its surrounding assistant context; classify each as
*steering* (answers a question, confirms a plan), *correction* (redirects work already done), or
*decision* (settles a seam question); write a ledger entry for each correction, dated to the original
task, with root cause and corrective action. Entries are marked `backfilled: true` in frontmatter so
they are never mistaken for contemporaneous records.

**What backfill cannot recover: per-phase attribution.** Transcripts have turn order, not pipeline
phase boundaries, so a correction cannot be attributed to *which prompt template was in play*. That
arrives free with `W11-T09`'s per-phase run records and is not worth reconstructing by hand.

**Transcripts are untrusted, sensitive input.** They contain verbatim prompts, file contents, command
output and environment values. They are read locally, never sent to a third-party model, and anything
extracted into `docs/` is redacted first. ADR-009's egress boundary applies unchanged: this data is
`sensitive`, and `ghostc screen` is the chokepoint if it ever moves.

## Consequences

### What gets better
- A rejection becomes a patch to a named file instead of a story about a bad afternoon.
- `W11-T14` starts with a real baseline (~$14/task) rather than an invented one.
- The `S0` → `S1` format decay cannot recur silently; the gate fails the PR.
- Repeated gotchas get correctly attributed to the context pack rather than to the model.

### What gets worse, and must be handled first
- **The ledger gets noisier.** Lowering the trigger multiplies entries by roughly ten. If every entry
  demands a corrective action the loop will be abandoned within a week — so only `prompt-gap` and
  `spec-gap` keep the mandatory corrective action they have today (`07`, unchanged). The rest are
  counted.
- **Judgement enters the trigger.** "Did that re-prompt redirect the work?" is not mechanical, and
  agents grading their own corrections will under-report. Accepted: an under-reported ledger with ten
  times the entries still beats an accurate one with one.
- **Backfill is retrospective self-assessment**, done by the same model family that produced the
  work. It is evidence, not measurement. Marked as such in frontmatter.
- **One more thing to write per task.** Mitigated by writing it where the work already happens.

## Alternatives rejected

**Ship `W9-T06`'s dashboard now.** A dashboard over thirteen tasks and one ledger entry renders an
empty chart. The bottleneck is collection, not display. Rejected until the ledger has volume.

**Commit the transcripts to the repo.** Solves durability, but 20 MB of unredacted prompts, file
contents and command output in a git history is exactly the leak `W11-T15`–`T18` exist to prevent,
and git history is permanent. Rejected — extract findings, redact, discard the source.

**Automate classification with a model over the transcripts.** Tempting at 20 MB. Rejected for now:
the corpus is small enough to read, and a classifier tuned on thirteen tasks would encode this
month's failure modes as if they were permanent. Revisit when the ledger passes ~100 entries.

**Score agents on a quality metric.** Rejected on principle — `07` opens with *"this is not blame"*,
and a scored agent produces run records written for the score. Every signal here names an artifact,
never an agent.

## Open questions

- Does the corrective-action rate — entries whose action actually landed — deserve to be a fifth
  signal, or is it just the ledger read honestly?
- When `W11` runs tickets unattended, "a human corrected the agent" stops covering most corrections;
  a failed gate retried by the graph is the same signal. Does the ledger absorb `W11-T07`'s
  `ledger` node, or do they stay separate datasets?
- The transcripts' `totalCostUSD` covers a *session*, which is sometimes two tasks and sometimes half
  of one. Is the per-task baseline honest enough to hold `W11-T14` to, or does it only become real
  with per-phase records?
