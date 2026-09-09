# Human intervention ledger

Append-only. One file per intervention, named `YYYY-MM-DD-<TASK-ID>-<n>.md`, from
[`_TEMPLATE.md`](_TEMPLATE.md). The contract is `TODO.md` §5.6.

**Why this exists.** It is the dataset that tells us which agents and which prompts are weak. A
rising `prompt-gap` count means the templates in `agents/prompts/` need work; a rising `spec-gap`
count means specs are being written too thin. Without the ledger, every correction is invisible the
moment the PR merges and the same class of failure is paid for again.

## When an entry is required

If a human rejects, overrides, or hand-edits agent work on a branch, the PR carries an
`intervention:*` label and the entry goes in this folder. **A closed-without-merge PR from an agent
also requires one** — a rejection is the most informative signal we get.

| Label | Verdict |
|---|---|
| `intervention:rejected` | `REJECTED` — the work was thrown away |
| `intervention:reworked` | `REWORKED` — handed back, the agent redid it |
| `intervention:manual-fix` | `MANUAL_FIX` — a human edited the branch directly |
| `intervention:override` | `OVERRIDDEN` — a gate or a review finding was waived |
| `intervention:scope-change` | `SCOPE_CHANGE` — the requirement moved mid-task |

CI gate `intervention-logged` fails a labelled PR that adds no matching file. `_TEMPLATE.md` and
`ROLLUP.md` do not count — neither records anything that happened.

## Rollup

Weekly, `agent-qa` summarises into `ROLLUP.md`: interventions per agent, per root cause, per slice.
