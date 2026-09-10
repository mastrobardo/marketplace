# Slice memory — agent-contracts

Durable knowledge for this slice only. Written and owned by this agent alone. Read it at the start
of every task; add to it at the end of every task that taught you something reusable.

Entry format (see `agents/policies/memory.md`):

```markdown
### <short title>
- **id**: MEM-<date>-<n>
- **scope**: slice:S1
- **fact**:
- **why**:
- **apply**:
- **evidence**: <PR / file:line / ADR / intervention id>
- **status**: active
```

Keep it to facts that changed how you would work. Task-specific detail stays in the session file.

---

### Money arithmetic has exactly two rounding sites, and they are named
- **id**: MEM-2026-09-10-01
- **scope**: slice:S1
- **fact**: Every rounding of a cent in this codebase happens in `prorate` or `allocate`
  (`packages/contracts/src/money.ts`). `prorate` rounds half **away from zero**; `allocate`
  distributes by largest remainder so the parts sum to exactly the input. `multiply` refuses a
  fractional factor instead of rounding it.
- **why**: A rate that rounds at an unnamed call site is how two slices end up a cent apart, and a
  reconciliation failure found months later is the most expensive bug class in the product.
- **apply**: Reviewing a slice that touches money: grep for `Math.round`, `Math.floor`, `/` and
  `*` near a `Cents` field. Any hit outside `money.ts` is a review finding. A caller who wants a
  percentage uses `applyBasisPoints(m, bps)` with an integer bps from config.
- **evidence**: `docs/specs/S1/W1-T06-money-value-object.md` §4.3; PR for `W1-T06`
- **status**: active

### The Int32 bound in the seam comes from the column, not from the domain
- **id**: MEM-2026-09-10-02
- **scope**: slice:S1
- **fact**: `MoneySchema` caps `amountCents` at ±2 147 483 647 because Prisma `Int` is a Postgres
  `integer`. The bound is a storage fact that has been frozen into the contract.
- **why**: The alternative to rejecting an over-large amount at the boundary is a Postgres range
  error raised inside a transaction that has already done work. `BigInt` was rejected because it
  does not serialise to JSON and would put a custom reviver into the generated client.
- **apply**: If `W1-T05` or a later migration ever makes a cents column `BigInt`, `MoneySchema` and
  its tests must move with it — and that is a breaking seam change, so it needs an ADR and a
  consumer sweep, not an edit.
- **evidence**: `packages/contracts/src/money.ts`; spec §4.2
- **status**: active

### A stub surface is what makes a red phase real for a new module
- **id**: MEM-2026-09-10-03
- **scope**: slice:S1
- **fact**: When the deliverable *is* the module, the honest red phase needs the surface to exist
  first as functions that throw, and any schema as a validator that accepts everything. Some tests
  will still pass vacuously; name each one and say why in the run record.
- **why**: `MEM-2026-09-09-06` covers the collection error. What it does not cover is the next trap:
  a partial red where the passes are unexplained. In `W1-T06`, one criterion (the currency literal)
  never went red at all, because a type alias delivers it and the stub needed the alias to compile.
- **apply**: Write the four-column table — test, why it passed, verdict — into the run record. A
  reviewer can then tell a vacuous pass from a criterion that was never tested.
- **evidence**: `docs/specs/S1/W1-T06-money-value-object.run.md` §3
- **status**: active

### Paging goes through `pagination.ts` or it is wrong
- **id**: MEM-2026-09-10-07
- **scope**: slice:S1
- **fact**: `W1-T02` froze cursor (keyset) paging for every list endpoint: `listQuery` for the
  request, `pageEnvelope` for the response, `fetchLimit` + `pageOf` for the `limit + 1` trick, and
  `keysetPredicate` for the "rows after this position" comparison. There is no `offset` anywhere and
  `strictObject` rejects one. Every sort gets `id asc` appended, because keyset paging over a
  non-total order drops or repeats rows at page boundaries.
- **why**: The lexicographic expansion (`a < T OR (a = T AND id > X)`, generalised) is the part a
  slice would reimplement per endpoint, and a subtly wrong version does not error — it silently
  skips rows, on page two, under concurrent insert. Nine MVP endpoints return a list.
- **apply**: If you are writing `skip`, `offset`, or `take: limit` without `fetchLimit`, stop. Map
  `keysetPredicate`'s output onto Prisma with the three lines in spec §4.5 — do not hand-roll the
  comparison a second time. Sortable columns must be **non-nullable**: the cursor encoder throws on
  a null rather than encode an ordering that needs `NULLS FIRST/LAST` agreement.
- **evidence**: `packages/contracts/src/pagination.ts`;
  `docs/specs/S1/W1-T02-list-conventions.md` §4.5
- **status**: active

### The fixture projects are what keep `packages/contracts` runtime-agnostic
- **id**: MEM-2026-09-10-08
- **scope**: slice:S1
- **fact**: Every `tests/fixtures/*/tsconfig.json` compiles `../../src/**/*.ts` with `"types": []`.
  So any global from `@types/node` or the DOM — `Buffer`, `btoa`, `TextEncoder`, `process` — is a
  compile error in `src`, discovered by a fixture test rather than by the web app's bundler.
- **why**: This package is imported by both apps, including the browser bundle. `W1-T02` needed
  base64url for the cursor and could reach for none of the obvious three; the codec is hand-rolled
  over `charCodeAt` with the JSON pre-escaped to ASCII, which is why that function carries a
  paragraph of comment.
- **apply**: Before using a global in `src`, check it exists under `lib: ES2023` alone. If a future
  task genuinely needs a platform API here, the honest move is a narrow injected dependency, not
  widening a fixture's `types`.
- **evidence**: `packages/contracts/src/pagination.ts` (`asciiJson`, `toBase64Url`);
  `packages/contracts/tests/fixtures/valid/tsconfig.json`
- **status**: active

### A state change goes through `transition()`, and its recorder is not optional
- **id**: MEM-2026-09-10-09
- **scope**: slice:S1
- **fact**: `W1-T07` put one mechanism in `packages/contracts/src/state-machine.ts` for all six
  machines `TODO.md` §3 names. `defineMachine` validates the table at module load — unknown states,
  two rules for one `(from, event)`, unreachable states, and dead ends not declared `terminal` are
  all definition errors. `transition(machine, request, record)` takes the recorder as a **required
  third parameter**, so a caller cannot obtain the new state without having supplied something that
  persists the audit record.
- **why**: The alternative — returning the record and trusting the caller to write it — makes
  "every transition is recorded" a thing review has to notice on thirteen agents' pull requests.
  As a required parameter it is a thing the type checker enforces once.
- **apply**: Reviewing a slice with a status column: grep its updates for `status:` and
  `state:`. Any assignment not downstream of a `transition()` call is a review finding. Declare the
  machine at module scope, never per request, or `defineMachine`'s checks run on every call instead
  of at boot. Guards are synchronous and pure by design: load what the guard needs first and pass
  it as `context`.
- **evidence**: `packages/contracts/src/state-machine.ts`;
  `docs/specs/S1/W1-T07-state-machine.md` §4
- **status**: active

### `audit_record` is append-only and its `actor_id` deliberately dangles
- **id**: MEM-2026-09-10-10
- **scope**: slice:S1
- **fact**: A trigger raises `AUDIT_RECORD_IMMUTABLE` on any `UPDATE` or `DELETE` of
  `audit_record`, and `actor_id` carries **no foreign key** to `app_user`. A `CHECK` named
  `audit_record_actor_pairing_check` enforces `(actor_type = 'SYSTEM') = (actor_id IS NULL)`, which
  is the same rule `AuditRecordSchema`'s discriminated union states in zod.
- **why**: `W2-T08` (GDPR erasure) may hard-delete a user row. `ON DELETE CASCADE` would erase the
  ledger of what that user did, and `RESTRICT` would block the erasure the law requires — so the
  column stores a uuid nothing guarantees still resolves. This is the one place in the schema where
  that is correct. The trigger exists because "nobody updates the audit table" holds right up to
  the first backfill migration.
- **apply**: A wrong audit record is corrected by writing a new one, never by editing it — do not
  write a migration that backfills this table. Joining `actor_id` to `app_user` must be a LEFT
  join; an inner join silently drops the actions of erased users, which is the opposite of what an
  audit query is for. `pnpm db:reset` is unaffected: `prisma migrate reset` drops the schema, and
  row triggers do not fire on `TRUNCATE`.
- **evidence**: `apps/api/prisma/migrations/0006_audit_record/migration.sql`;
  `docs/specs/S1/W1-T07-state-machine.md` §8.2
- **status**: active

### When the deliverable is a database object, hold it out of the contract freeze
- **id**: MEM-2026-09-10-11
- **scope**: slice:S1
- **fact**: Refines [[MEM-2026-09-10-03]] for DDL. The pipeline puts the Prisma freeze *before* the
  red phase, so a trigger or a `CHECK` written in that step makes its tests pass on their first ever
  run. In `W1-T07` the freeze landed only what `prisma migrate diff` produced — table, enum,
  indexes — and the trigger and `CHECK` were added in the green phase, so all 26 criteria went red.
- **why**: A constraint test that has never failed is not evidence the constraint works; it is
  evidence the test ran. This is the only technique found so far that gives DDL an honest red
  phase, and it cost one `psql` call to drop two objects from the dev database.
- **apply**: Split the migration mentally into "what Prisma generates" (freeze) and "what I wrote by
  hand" (green). Never edit a migration that has already merged — this works only because the
  migration was still on the branch.
- **evidence**: `docs/specs/S1/W1-T07-state-machine.run.md` §Red phase
- **status**: active
