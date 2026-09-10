# Human intervention ledger

Append-only. One file per intervention, named `YYYY-MM-DD-<TASK-ID>-<n>.md`, from
[`_TEMPLATE.md`](_TEMPLATE.md). The contract is `TODO.md` §5.6.

**Why this exists.** It is the dataset that tells us which agents and which prompts are weak. A
rising `prompt-gap` count means the templates in `agents/prompts/` need work; a rising `spec-gap`
count means specs are being written too thin. Without the ledger, every correction is invisible the
moment the PR merges and the same class of failure is paid for again.

## When an entry is required

If a human **corrects the agent** — rejects, overrides, hand-edits, or redirects work already done —
the PR carries an `intervention:*` label and the entry goes in this folder. **A closed-without-merge
PR from an agent also requires one** — a rejection is the most informative signal we get.

**A re-prompt that redirects work already done is an intervention.** That is where almost all of
them happen, and it is what the old trigger missed: "a human closed a PR" fired once in thirteen
tasks while the session transcripts held ~125 operator turns. A re-prompt that *answers* a question
the agent asked is not an intervention — that is the pipeline working as designed. Only `prompt-gap`
and `spec-gap` entries require a corrective action; the rest are counted. See
[`ADR-010`](../adr/ADR-010-agent-telemetry.md).

| Label | Verdict |
|---|---|
| `intervention:rejected` | `REJECTED` — the work was thrown away |
| `intervention:reworked` | `REWORKED` — handed back, the agent redid it |
| `intervention:manual-fix` | `MANUAL_FIX` — a human edited the branch directly |
| `intervention:override` | `OVERRIDDEN` — a gate or a review finding was waived |
| `intervention:scope-change` | `SCOPE_CHANGE` — the requirement moved mid-task |

CI gate `intervention-logged` fails a labelled PR that adds no matching file. `_TEMPLATE.md` and
`ROLLUP.md` do not count — neither records anything that happened.

## Backfilled entries

An entry reconstructed from a session transcript rather than written at the time carries
`backfilled: true` in its frontmatter. It is evidence, not measurement — retrospective
self-assessment by the same model family that produced the work — and it must never be counted in a
trend alongside contemporaneous entries.

## Rollup

Weekly, `agent-qa` summarises into `ROLLUP.md`: interventions per agent, per root cause, per slice.
