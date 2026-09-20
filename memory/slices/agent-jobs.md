# Slice memory — agent-jobs

Durable knowledge for this slice only. Written and owned by this agent alone. Read it at the start
of every task; add to it at the end of every task that taught you something reusable.

Entry format (see `agents/policies/memory.md`):

```markdown
### <short title>
- **id**: MEM-<date>-<n>
- **scope**: slice:S6
- **fact**:
- **why**:
- **apply**:
- **evidence**: <PR / file:line / ADR / intervention id>
- **status**: active
```

Keep it to facts that changed how you would work. Task-specific detail stays in the session file.

---

### `jobMachine` carries two debts `W4-T02` must pay, and neither fails a test today
- **id**: MEM-2026-09-20-11
- **scope**: slice:S4
- **fact**: `W4-T01` left two things that are correct now and become wrong the moment the job
  lifecycle grows past `DRAFT → OPEN`:
  1. **`jobMachine.terminal` lists `OPEN`.** `defineMachine` refuses a state with no outgoing
     transition unless it is declared terminal, and within `W4-T01` `OPEN` genuinely has no exit.
     The declaration is honest today and a lie the moment `AWARDED` exists.
  2. **"Only a draft may be edited" is a hand-written `if` in `repository.update`**, not a machine
     rule. Nothing ties it to the machine's states.
- **why**: Both keep behaving correctly as more states arrive — the `if` refuses `AWARDED` and
  `CANCELLED` too, but *by accident*, because they are not `DRAFT`. Correct-by-accident is the
  failure mode no test catches: there is nothing red to notice, and the rule silently stops
  expressing what anyone intended.
- **apply**: `W4-T02` removes `OPEN` from `terminal` **in the same change** that gives it an exit,
  and moves the edit rule into the machine — an `EDIT` event guarded on state, or an explicit
  `editableStates` the repository reads. Do not let either survive a lifecycle change. More
  generally in this slice: when a rule about *which states allow an action* is written as an `if`,
  it belongs in the machine, which is the one place that knows what the states are.
- **evidence**: `W4-T01` run record self-assessment; `packages/contracts/src/job.ts` `jobMachine`;
  `apps/api/src/modules/jobs/repository.ts` `update`
- **status**: active
