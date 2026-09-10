# Prompt 07 — intervention triage

**Trigger**: a human **corrected the agent** — rejected, overrode, hand-edited, redirected work
already done, or closed an agent PR without merging.
**Output**: `docs/interventions/<YYYY-MM-DD>-<TASK-ID>-<n>.md`, before merge.

A re-prompt that redirects work already done **is** an intervention, and it is where almost all of
them happen. A re-prompt that answers a question the agent asked is not — that is the pipeline
working. The old trigger was "a human closed a PR"; it fired once in thirteen tasks while the
session transcripts held ~125 operator turns, so the ledger was measuring the rarest failure mode
and missing the common one (`docs/adr/ADR-010-agent-telemetry.md`).

---

This is not blame. It is the only dataset that tells us which prompts and specs are weak.

```markdown
---
task:          W5-T04
pr:            #142
agent:         agent-money
verdict:       REJECTED | REWORKED | OVERRIDDEN | MANUAL_FIX | SCOPE_CHANGE
intervened_by: <human>
at:            <ISO timestamp>
---
## What the agent proposed
<one paragraph, factual>

## What was wrong
<the observable defect — not "it was bad">

## Root cause
spec-gap | prompt-gap | missing-test | missing-gate | model-error | context-missing |
requirement-changed
<one sentence justifying the choice>

## What was done instead

## Corrective action
- [ ] spec updated: <path>
- [ ] prompt template updated: agents/prompts/<file>
- [ ] new test/gate added: <path>
- [ ] charter updated: agents/roles/<file>
- [ ] memory written: <memory path> — so no agent repeats this
- [ ] none needed — one-off, requirement changed
```

Rules:
- Root cause is exactly one value. If it feels like two, pick the earliest point where it could
  have been caught.
- **Only `prompt-gap` and `spec-gap` require a corrective action.** The rest are counted. Lowering
  the trigger multiplies entries roughly tenfold, and a ledger that demands a fix for every entry
  is a ledger that gets abandoned inside a week.
- `requirement-changed` is not a failure — but if it shows up repeatedly, specs are being written
  before the product is decided. That is a finding about the process.
- Every entry with a `prompt-gap` or `spec-gap` cause **must** have a corrective action ticked.
- Promote the lesson into memory in the same PR (`prompts/09-memory-write.md`).

`agent-qa` aggregates weekly into `docs/interventions/ROLLUP.md`: interventions per agent, per root
cause, per slice, with the trend. Rising `prompt-gap` → fix the templates. Rising `spec-gap` →
specs are too thin. Rising `missing-gate` → CI is not catching what it should.
