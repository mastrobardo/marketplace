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
