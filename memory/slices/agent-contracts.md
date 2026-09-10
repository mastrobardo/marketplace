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

### Test data comes from `packages/testing`, and AC10 is what keeps it that way
- **id**: MEM-2026-09-11-01
- **scope**: slice:S1
- **fact**: `W1-T09` built the package `MEM-2026-09-07-06` had promised since before it existed.
  Pure builders (`buildUser`) and persisting factories (`createUser(client, overrides)`), one entry
  point, **zero runtime dependencies**. Determinism is a counter, not a seeded PRNG: ids are
  v4-shaped but derived from an 8-hex per-entity prefix plus an ordinal, and `nextAt()` returns a
  fixed epoch plus one minute per call. `resetFactories()` in `beforeEach` is mandatory.
- **why**: The counter beats `faker` because the values are legible —
  `00000001-0000-4000-8000-000000000003` reads as "the third user" in a failure message. The
  strictly-increasing clock is load-bearing rather than cosmetic: keyset paging ([[W1-T02]],
  MEM-2026-09-10-07) drops rows at page boundaries without a total order, and rows sharing a
  `createdAt` cannot demonstrate it.
- **apply**: Adding a table? Add a builder and a factory — `tests/factories.test.ts` parses
  `schema.prisma` and fails until you do, which is what makes the no-inline-fixtures convention
  hold without anyone policing it in review. Need a *scenario* rather than a row, build it in your
  own slice; composite builders in `packages/testing` would become a dumping ground. When #195
  merges, `AuditRecord` will need one.
- **evidence**: `packages/testing/src/`; `docs/specs/S1/W1-T09-test-factories.md` §4
- **status**: active

### A structural client interface moves database tests into the job that actually runs
- **id**: MEM-2026-09-11-02
- **scope**: slice:S1
- **fact**: `packages/testing`'s `FactoryClient` declares only the `create` calls the factories
  make, so `PrismaClient` satisfies it structurally and the package imports `@prisma/client`
  nowhere. Same trick as `W1-T07`'s `AuditRecorder`. A recording fake then satisfies it in ten
  lines.
- **why**: The payoff is not purity, it is coverage. `ci.yml` names its live suites by hand, so a
  new `STACK_LIVE` test does not run (#174) — `W1-T07` lost five criteria to this. Typing against a
  structural interface moved all the factory *logic* into the `unit` job, leaving exactly one
  criterion ("does the interface still match Prisma?") needing a database.
- **apply**: Writing something that talks to Prisma from a shared package? Declare the two or three
  methods you call as an interface and take it as a parameter. Then add **one** live test that
  assigns a real `PrismaClient` to it — that assignment is the drift detector, and without it the
  structural type is a lie nobody checks.
- **evidence**: `packages/testing/src/persist.ts`; `apps/api/tests/factories-live.test.ts`
- **status**: active

### A red phase can lie through its setup hook
- **id**: MEM-2026-09-11-03
- **scope**: slice:S1
- **fact**: `W1-T09`'s first red run reported 27/27 failed. It was wrong: a file-level
  `beforeEach(resetFactories)` threw on the stub, so every test failed **in the hook**, including
  the structural ones that never touch the sequence. Scoped to the two describes that need it, the
  honest figure was 19 failed, 8 passed.
- **why**: 27/27 is the number an agent wants to see and would have written into the run record,
  hiding eight vacuous passes — four of which are weak assertions about *absences* that a stub
  satisfies trivially. The vacuous-pass table (MEM-2026-09-10-03) only works if the red run is
  measuring what it claims to.
- **apply**: If a setup hook calls the thing under test, scope it to the blocks that need it, never
  the file. And read the red output's *failure reason*, not just its count — the same rule caught a
  stale `dist/` in `W1-T07`. If a test file was written in the red phase but only executed after
  the implementation existed, it never went red: restore the stub, rebuild, run it, and say in the
  run record that the red was reconstructed.
- **evidence**: `docs/specs/S1/W1-T09-test-factories.run.md` §Red phase
- **status**: active
