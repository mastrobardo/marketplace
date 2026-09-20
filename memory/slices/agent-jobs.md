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
- **status**: **paid by `W4-T02`, 2026-09-20.** `terminal` is `['CANCELLED']` and `OPEN` has an exit;
  the `if` is now `canEditJob`, an exhaustive `Record<JobStatus, boolean>` that fails the build when
  a state is added without a decision — generalised to the whole repo as `MEM-2026-09-20-13`. Kept
  rather than deleted because the reasoning is why the next lifecycle should not repeat it.

### The job lifecycle is not this slice's to finish — three of its states are `agent-money`'s

- **id**: MEM-2026-09-20-14
- **scope**: slice:S4
- **fact**: `TODO.md`'s `W4-T02` row reads `DRAFT → OPEN → AWARDED → IN_PROGRESS → COMPLETED /
  CANCELLED` as though it were one ticket. It is not. Each state belongs to whatever can **produce**
  it: `AWARDED` to `W4-T05` (an accepted quote from `W4-T03` to award to), `IN_PROGRESS` to the
  booking lifecycle in `W5`, `COMPLETED` to `W5-T04` (completion is what triggers capture), and
  cancelling *after* an award to `W5-T05`, because by then it is a refund decision. `W4-T02` shipped
  `CANCELLED` from `DRAFT`/`OPEN` and nothing else.
- **why**: a state nothing can write is the empty promise this repo keeps refusing — the same rule
  that stops `permissions.ts` holding a row for a route that does not exist. Shipping four enum
  values to satisfy a board line would have made the machine read as finished while three of its
  states were unreachable, and would have had this slice invent award semantics that `W4-T05` then
  rewrites.
- **apply**: when a ticket's title describes a whole lifecycle, list what produces each arrow before
  estimating it. **The open question, which `W4-T05` inherits:** does a job track `IN_PROGRESS` and
  `COMPLETED` at all, or read them off its `Booking`? Two machines over one engagement can disagree,
  and a job reading `COMPLETED` while its booking reads `DISPUTED` costs a refund. Settle it with
  `agent-money` before either slice writes a state — it is a seam question, not a jobs one.
- **evidence**: `docs/specs/S4/W4-T02-job-state-machine.md` §6.1;
  `apps/api/prisma/migrations/0011_job_cancellation/migration.sql`
- **status**: active

### A cancellation reason is audit metadata, not a column

- **id**: MEM-2026-09-20-15
- **scope**: slice:S4
- **fact**: `POST /api/jobs/:id/cancel` takes an optional `reason` and writes it to
  `audit_record.metadata`. There is no `cancellation_reason` column and `JobSchema` has no field for
  it. `cancelled_at` **is** a column, mirroring `published_at`.
- **why**: the audit row already records who ended the job, when, and from which state. A column
  would be a second home for one fact, and two homes drift as soon as anything writes one of them.
  The timestamp is different: a list screen needs it without joining `audit_record`.
- **apply**: reuse this split for every lifecycle reason in this slice — *why* it happened goes to
  `metadata`, *when* it happened earns a column only if a screen needs it without a join. If a
  reason ever has to be shown in a list, read it from `audit_record` before adding a column; and
  note `W4-T02`'s own run record flags the two-timestamp pattern as not scaling past a few states.
- **evidence**: `packages/contracts/src/job.ts` `JobCancelInputSchema`;
  `docs/specs/S4/W4-T02-job-state-machine.md` §2.5; `apps/api/tests/job-live.test.ts` AC5
- **status**: active
