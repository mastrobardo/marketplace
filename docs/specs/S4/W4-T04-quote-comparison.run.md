# Run record — W4-T04 quote comparison

Agent:        agent-jobs
Model:        claude-opus-5
Skills used:  test-driven-development, spec-driven-development, api-and-interface-design,
              frontend-ui-engineering, git-workflow-and-versioning
Started:      2026-09-20T18:05Z

## Prompts

### 1. Task selection

> Please,  W4-T04 or whatever is next ;)

Open-ended. The agent read `memory/LONG_TERM.md`, `memory/slices/agent-jobs.md`, the `W4-T03`
session file and `TODO.md`'s `▶ NEXT` banner, and checked `gh pr list` first — `MEM-2026-09-20`
records that the banner on `main` is only true when nothing is open. Nothing was, so the banner was
trustworthy and `W4-T04` was next.

### 2. Three scoping decisions put to the operator

Asked before any file was written, because each one changes what gets built rather than how:

1. **UI scope** — API only, API + screen + seeder, or API + screen + job-posting form?
2. **After a rejection** — does the provider get to quote again?
3. **On acceptance** — do the sibling quotes stay `PENDING` or get auto-rejected?

All three came back as the recommended option: **API + comparison screen + seeder**, **rejection
frees the slot**, **siblings stay `PENDING`**.

### 3. The seam question, answered from a lost session

> I did answer on this, but probably we lost it: BOTH. Booking and job should reflect the same
> state. THis will be also a way to check if smtg is going badly

This answered `MEM-2026-09-20-14`'s open question — does a job track `IN_PROGRESS`/`COMPLETED`, or
read them off its `Booking`? **Not a correction and not an intervention**: it answered a question the
agent had surfaced as open, which `ADR-010` and `W11-T19` explicitly exclude from the intervention
ledger.

The agent checked before recording it and found ADR-013 §1/§2 **already said exactly this** —
reconciled, not coupled, with a reconciler writing a finding on divergence. So the answer needed no
new decision; three stale references to the question did need correcting (`MEM-2026-09-20-14`,
`TODO.md`'s banner, `W4-T05`'s row). Recorded in the spec §4, and it changes no code here.

### 4. Go-ahead

> COnfirmed

## Red phase

<paste of the failing test run, before implementation>

## Deviations from spec

<none so far>

## Self-assessment

- **Weakest part of this change**:
- **What a reviewer should look at hardest**:
