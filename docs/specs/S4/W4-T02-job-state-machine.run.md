# Run record — W4-T02 job state machine

```
Agent:        agent-jobs
Model:        claude-opus-5
Skills used:  test-driven-development, api-and-interface-design, documentation-and-adrs
Started:      2026-09-20T14:05Z
Finished:     2026-09-20T15:10Z
```

## Prompts

### 1. Scope, settled before anything was written

The board line is `DRAFT → OPEN → AWARDED → IN_PROGRESS → COMPLETED / CANCELLED`, and the question
put to the operator was whether this ticket ships all of it, given that `AWARDED` has no producer
until quotes exist. Three options were offered; the answer was the first:

> cancel now, award with quotes

and, on whether a published job stays editable:

> no — drafts only, expressed in the machine

**The first answer is the spec.** §2.1 and §6.1 are that sentence turned into a rule and a table.
Writing the table is what made the finding below visible: three of the four missing states are
`agent-money`'s, not this slice's, so the board row was never one ticket's work.

### 2. The route spelling, raised by the operator

> A part jobs/me ( or better me/jobs ). ANother PR to improve states at a later time?

Two things at once. The second is answered by §6.1. The first was **right, and the repo already
agreed with it** — `W2-T03` §3.7 writes `app.put('/providers/me')` and `app.get('/me/addresses')` in
one code block without ever naming the rule that separates them. `W4-T01` then picked the wrong half
for a collection.

Checked before agreeing: `grep` found no caller in `apps/web`, so the rename costs nothing today and
gets more expensive with every slice that copies it. The rule that was implicit is now written into
`W2-T03` §3.6 as a dated amendment, because a convention that lives only in the spec of the ticket
that noticed it is not a convention.

### 3. Corrections

**None from the operator.** The plan was confirmed as written, including the two additions the route
question produced (§2.4 and the `W2-T03` amendment).

## Red phase

The first failure was the *type checker*, and it is the assertion this ticket exists to make. With
`AWARDED` added to `JobStatusSchema` and nothing else touched:

```
src/job.ts(151,7): error TS2741: Property 'AWARDED' is missing in type
  '{ DRAFT: true; OPEN: false; CANCELLED: false; }'
  but required in type 'Record<"DRAFT" | "OPEN" | "AWARDED" | "CANCELLED", boolean>'.
```

That is `MEM-2026-09-20-11` paid in full. The `if` it replaces would have compiled, run, and gone on
refusing `AWARDED` correctly for the wrong reason. **This was run deliberately as an experiment and
reverted** — it is the only way to demonstrate that the mechanism works rather than assert it.

Then the ordinary reds, all from changing the contract before the layers beneath it:

```
src/modules/jobs/repository.ts(74,22): error TS2339: Property 'cancelledAt' does not exist on type …
src/modules/jobs/repository.ts(329,19): error TS2322: Type '"CANCELLED"' is not assignable to type 'JobStatus' …
tests/job.test.ts(70,9): error TS2741: Property 'cancel' is missing in type … but required in type 'JobRepository'
```

**Final:** contracts 35/35 · api routes 26/26 · api live 29/29 · whole api suite **430/430** under
`STACK_LIVE=1` (was 405 before this ticket) · `pnpm verify` green.

The migration was applied by every live run and rolled back by `db.test.ts` AC10 in reverse order
with the rest; `migrate diff` reports no drift.

## Deviations from spec

**None in behaviour.** Two things were decided while building that the spec did not pin down, both
now written into it:

1. **`JobContext` replaced `JobPublishContext`.** `defineMachine` is generic over *one* context type
   for the whole machine, so `CANCEL` — which has no guard and reads nothing — still has to be
   handed one. The choice was to pass a truthful `categoryCount` loaded from the row, or a `0` that
   is not true. Faking it would have been cheaper by one count subquery and would have planted a
   value somebody later guards on. Renaming the type was free: nothing imported it.

2. **`publish()` and `cancel()` share a `move()` helper.** The `TransitionRejected` → `AppError`
   mapping and the transaction-bound recorder were about to exist twice. Two copies of "which
   failures are the client's fault" eventually disagree.

## Self-assessment

**Weakest part of this change.** `JobStatusSchema` and `jobMachine.states` can still drift apart.
The experiment above proves a new enum member fails the build at `EDITABLE_IN` — but it does **not**
fail at the machine, because `states` is a hand-written array and a shorter one is still valid
TypeScript. A state could therefore exist on the wire, be storable in Postgres, and be unknown to
the machine, which would then refuse every transition out of it with "cannot go from X". The guard
against that is a test — `expect(jobMachine.states.length).toBe(JobStatusSchema.options.length)` —
and a test is weaker than a compile error. Deriving `states` from the schema's `options` would close
it properly and was not attempted here, because `defineMachine`'s generics take `const S extends
string` and the change belongs to `state-machine.ts`, which is `agent-contracts`' file and every
other slice's dependency.

**What a reviewer should look at hardest:**

1. **Whether `CANCELLED` should be terminal at all.** A client who cancels by accident has no way
   back and must re-post, losing the draft they had typed. §2.2 argues a restartable lifecycle is an
   audit trail that must be read backwards to be understood — but the counter-argument is a real
   user in a real hurry, and `W4-T03` will be the first ticket where someone notices.
2. **The permission split.** `job:cancel-own` is deliberately separate from `job:update-own` on the
   grounds that ending a job and editing one are different capabilities. That is five job
   permissions for five routes, and if `W5-T08`'s entitlements never need to name them separately,
   it is ceremony.
3. **`cancelled_at` next to `published_at`.** Two nullable timestamp columns that each mean "a
   transition happened", while `audit_record` holds both facts already. The justification is the
   same one `W4-T01` gave, and it is worth asking once, now, whether a job with four more states
   wants four more such columns — because the answer is no, and the line has to be drawn somewhere.
4. **The rollback guard is asserted by one live test that shells out to `psql`.** It creates its own
   database, cancels a job, runs `down.sql` and expects the exception. If that test ever becomes
   flaky it will be tempting to delete, and what it protects — a rollback that would silently
   republish abandoned work — has no other assertion anywhere.

**Not built, and named in §6:** `AWARDED`, `IN_PROGRESS`, `COMPLETED`, amendment of a published job,
cursor pagination, admin or system-actor cancellation. The question `W4-T05` inherits is in §6.1:
**does a job track `IN_PROGRESS` and `COMPLETED` at all, or read them off its `Booking`?**
