# Spec — W1-T06 one way to do arithmetic on money

|               |                                                                              |
| ------------- | ---------------------------------------------------------------------------- |
| **Task**      | `W1-T06` `[A]`                                                               |
| **Slice**     | S1 Contracts                                                                 |
| **Owner**     | `agent-contracts`                                                            |
| **Reviewers** | `agent-money` (second reviewer — money, per `TODO.md` §5.4) · `agent-devops`  |
| **Issues**    | [#60](https://github.com/mastrobardo/marketplace/issues/60)                  |
| **Status**    | in progress                                                                  |

---

## 1. Purpose

`TODO.md` §2 rule 4 and `MEM-2026-09-07-03` already say money is integer cents and never a float.
Neither says what happens when you have to **divide** it — and every money path in the MVP divides.
The platform fee is a percentage of a booking (`W5-T02`), a refund is a fraction of a payment
(`W5-T06`), the ledger double-enters both and must reconcile to zero (`W5-T10`).

Without this task, `agent-money` invents the rounding rule inside a service, `agent-jobs` invents a
different one for quote breakdowns, and the two disagree by one cent on some fraction of bookings —
which is exactly the reconciliation failure `MEM-2026-09-07-03` was written to prevent, arriving by
the one route that memory does not close. The person who suffers is whoever has to explain a
payout that is a cent short, months later, from the ledger alone.

So: one module in the seam, with the division rules stated as invariants and enforced by tests, and
no way for a slice to do money arithmetic without going through it.

## 2. Decisions taken before this spec

`W1-T01` established that seam decisions are settled with the operator **before** the spec, because
afterwards each costs an ADR (`agents/policies/contract-change.md`). Three were put to the operator
with a recommendation each; the instruction back was to start, so they stand as written below and
§10 keeps them open for objection until this PR merges.

| #   | Decision                                                                                                                      | Consequence                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **`currency` is the literal `'EUR'`**, not an open string or a 3-letter pattern.                                              | §1 locks EUR-only and multi-currency is out of MVP scope. Widening a literal to an enum is additive, so this costs nothing later. Meanwhile every `Money` in the system is provably one currency at compile time.        |
| B   | **Rounding is half-up away from zero, and it happens in exactly two functions** — `prorate` and `allocate`.                   | Banker's rounding is for statistics, not for a fee a client sees. Confining rounding to two named functions means a reviewer can find every rounding site in the codebase by grepping for two identifiers.               |
| C   | **Negative amounts are legal.**                                                                                               | Refunds, credits and the credit side of every ledger entry need them. The alternative — unsigned amounts plus a direction flag — puts the sign somewhere the type system cannot see it.                                  |

## 3. Scope

**In:** a `Money` shape in `packages/contracts` as a zod schema; construction that rejects what the
database cannot store; exact addition, subtraction and integer multiplication; the two rounding
primitives from decision B; comparison and aggregation; a currency guard that survives the widening
in decision A.

**Out:** formatting. `MEM-2026-09-07-03` says formatting happens at render, and a locale-aware
`Intl.NumberFormat` belongs to `agent-ui` with the i18n catalogues, not to the seam.

**Out:** the money ADR. That is `W1-T08`, it is `[M]`, and it needs the operator's signature. This
spec's §2 is the input to it, not a substitute for it.

**Out:** tax and IVA. Rates are legal text and a human decision (`policies/human-boundaries.md`);
`prorate` is the mechanism they will eventually be expressed through.

**Out:** Prisma columns. The domain models in `TODO.md` §3 carry `Int` cents fields
(`amountCents`, `priceCents`, `platformFeeCents`) and land in `W1-T05`. This task defines the
in-memory and on-the-wire value; the column type is what §4.2 bounds it against.

## 4. Design

### 4.1 A plain frozen object, not a class

```ts
export const MoneySchema = z.strictObject({
  amountCents: z.int32(),
  currency: z.literal('EUR'),
});
export type Money = z.infer<typeof MoneySchema>;
```

`Money` crosses the seam, so it has to survive `JSON.stringify` and `structuredClone` without a
revive step. A class instance does not: it arrives at the client as a bare object with its methods
gone, and the failure appears in the consumer rather than at the boundary. So the value is a plain
object, the operations are free functions, and every returned value is `Object.freeze`d — which
makes accidental mutation a `TypeError` under the workspace's strict mode rather than a silent
shared-reference bug.

`z.strictObject` matters here for the same reason it does in the envelope: a body carrying
`{ amountCents, currency, amount: 12.34 }` is a client that has misunderstood the contract, and
saying so at the boundary is cheaper than discovering which of the two fields the code trusted.

### 4.2 The bound is `Int32`, because that is what the column is

Prisma `Int` is a Postgres `integer`: 32-bit signed, so ±2 147 483 647 cents — ±€21.4 M. An amount
outside that range is not a large booking, it is a bug or an attack, and the two places it can be
caught are here or as a Postgres range error inside a transaction that has already done work.

`z.int32()` also rejects `1.5`, `NaN`, `Infinity` and `-0`-adjacent nonsense in one predicate, so
one schema covers decision-B's "never a float" and the column bound together.

`BigInt` cents was considered and rejected: it does not serialise to JSON, which would put a custom
reviver in the generated client from `W1-T03` onward, and no MVP amount comes near €21 M.

### 4.3 Two rounding sites, each with an invariant

`prorate(m, numerator, denominator)` is the only function that can produce a fraction of a cent. It
rounds **half away from zero**: `prorate(€0.05, 1, 2)` is 3 cents, and `prorate(-€0.05, 1, 2)` is
−3 cents. Symmetry around zero is the property that matters — a refund of half a payment must not
differ in magnitude from the fee on the same payment because one is negative.

Everything percentage-shaped is expressed through it in basis points, so no float ever enters money
arithmetic:

```ts
export const applyBasisPoints = (m: Money, bps: number): Money => prorate(m, bps, 10_000);
```

A take rate of 12 % is `1200`, an integer, and `W5-T02` reads it from config where a human put it.

`allocate(m, weights)` is the other, and its invariant is stronger: **the parts sum to exactly the
original, always**. It floors each share, then hands the leftover cents out one at a time to the
largest fractional remainders, ties going to the lowest index. `allocate(€1.00, [1, 1, 1])` is
`[34, 33, 33]`, not three times 33 with a cent unaccounted for, and not three times 34 with a cent
invented. This is the Fowler largest-remainder allocation, and it is the function `W5-T10`'s
double-entry reconciliation depends on.

`multiply(m, factor)` requires an **integer** factor and is therefore exact — it is for quantities
(three hours at an hourly rate), not for rates. A non-integer factor throws rather than rounding
silently, because a caller reaching for `multiply(m, 0.12)` wants `applyBasisPoints(m, 1200)` and
should be told so at the point of the mistake.

### 4.4 The currency guard is unreachable today, and stays

`add`, `subtract`, `compare`, `min`, `max` and `sum` all reject mixed currencies at runtime, even
though decision A makes that impossible to express in TypeScript. Two reasons: values parsed from
the database or an inbound webhook have not been through `MoneySchema`, and the guard is the thing
that makes decision A's "widening is additive" claim true rather than hopeful. A test asserts it
fires, using a deliberately cast value.

### 4.5 Failure is a bug, not a client error

`money()` and the arithmetic functions throw `MoneyError extends Error` — never an `AppError`.
Money arithmetic is domain logic, and a caller passing 1.5 cents has a defect, which is an
`INTERNAL_ERROR` and a log line, not a `VALIDATION_FAILED` handed to a user. Untrusted input is
validated by `MoneySchema` at the route boundary, where zod's failure already maps to
`VALIDATION_FAILED` via the existing error handler. Keeping `AppError` out of this module also keeps
the seam acyclic: `money.ts` imports nothing from `errors.ts`.

### 4.6 Module surface

| Function                                | Behaviour                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `money(amountCents, currency?)`         | Construct. Throws `MoneyError` on a non-`Int32`. `currency` defaults to `'EUR'`. |
| `zero(currency?)`                       | `money(0)`.                                                                     |
| `add(a, b)` · `subtract(a, b)`          | Exact. Throws on mixed currency or on an `Int32` overflow of the result.         |
| `negate(m)`                             | Sign flip.                                                                      |
| `multiply(m, factor)`                   | Exact. Throws on a non-integer factor or an overflow.                            |
| `prorate(m, numerator, denominator)`    | Half away from zero. Throws on a zero denominator or non-integer arguments.      |
| `applyBasisPoints(m, bps)`              | `prorate(m, bps, 10_000)`.                                                       |
| `allocate(m, weights)`                  | Largest remainder; the parts sum to `m` exactly. Throws on empty or all-zero weights, or a negative weight. |
| `split(m, parts)`                       | `allocate(m, [1, 1, …])`.                                                        |
| `sum(items, currency?)`                 | Empty list is `zero(currency)`. Throws on mixed currency.                        |
| `compare(a, b)` · `equals(a, b)`        | `-1 \| 0 \| 1`; structural equality.                                            |
| `min(a, b)` · `max(a, b)`               | By amount.                                                                      |
| `isZero` · `isPositive` · `isNegative`  | Sign predicates. Zero is neither positive nor negative.                          |

## 5. State machine

None. A value object has no lifecycle — the `from → event → to` table would have one row and no
events. `W1-T07` is the task that owns state machines.

## 6. API surface

No endpoint. `Money` is a shape other slices' request and response schemas compose:
`QuoteSchema.amount`, `BookingSchema.agreedAmount`, `PaymentSchema.platformFee`. It is exported from
`@marketplace/contracts` and appears in OpenAPI as a component schema once `W1-T03` generates it.

## 7. Permissions matrix

Not applicable — no route, no actor, nothing to authorise. The permissions that govern *who may
name an amount* belong to the slices that own those routes.

## 8. Error cases

Every failure in this module is a programming defect, so there is no user-facing row here and no
new envelope code. `MoneyError` reaches the client only as `INTERNAL_ERROR` through the handler in
`apps/api/src/app.ts`, which is the correct classification for a bug.

| Condition                                          | Thrown        | Message names                          |
| -------------------------------------------------- | ------------- | -------------------------------------- |
| `amountCents` not a safe integer, or outside `Int32` | `MoneyError`  | the offending value and the bound      |
| mixed currencies in a binary operation             | `MoneyError`  | both currencies                        |
| non-integer `multiply` factor                      | `MoneyError`  | the factor, and points at `prorate`    |
| `prorate` denominator of `0`                       | `MoneyError`  | the numerator and denominator          |
| `allocate` weights empty, all zero, or negative    | `MoneyError`  | the weights                            |
| a result outside `Int32`                           | `MoneyError`  | the operation and the operands         |

Invalid money arriving from the wire is a `VALIDATION_FAILED` produced by `MoneySchema` at the route
boundary, not by this module.

## 9. Acceptance criteria

Each is a test in `packages/contracts/tests/money.test.ts` unless stated otherwise.

1. **Given** `1234`, **when** `money(1234)`, **then** the value is `{ amountCents: 1234, currency: 'EUR' }` and it is frozen.
2. **Given** `12.34`, **when** `money(12.34)`, **then** it throws `MoneyError` naming the value.
3. **Given** `2_147_483_648`, **when** `money(...)`, **then** it throws `MoneyError` naming the `Int32` bound; **and** `money(2_147_483_647)` succeeds.
4. **Given** a wire object with a float `amountCents`, an unknown currency, or an extra key, **when** `MoneySchema.safeParse`, **then** `success` is `false` for each; **and** `true` for a valid one.
5. **Given** `money(100)` and `money(23)`, **when** `add`, **then** `123`; **when** `subtract`, **then** `77`. Neither input is mutated.
6. **Given** `money(2_147_483_600)` twice, **when** `add`, **then** it throws rather than returning a value the column cannot hold.
7. **Given** two values whose `currency` has been cast to `'USD'` and `'EUR'`, **when** `add`, **then** it throws `MoneyError` naming both currencies.
8. **Given** `money(1000)` and `3`, **when** `multiply`, **then** `3000`; **given** `0.12`, **then** it throws and the message mentions `prorate`.
9. **Given** `money(5)`, **when** `prorate(m, 1, 2)`, **then** `3` — half away from zero, not `2`.
10. **Given** `money(-5)`, **when** `prorate(m, 1, 2)`, **then** `-3` — symmetric with AC9.
11. **Given** any `Money` and `bps` of `1200`, **when** `applyBasisPoints`, **then** the result equals `prorate(m, 1200, 10_000)`.
12. **Given** a denominator of `0`, **when** `prorate`, **then** it throws `MoneyError`.
13. **Given** `money(100)`, **when** `split(m, 3)`, **then** `[34, 33, 33]` and the parts sum to exactly `100`.
14. **Given** `money(1000)` and weights `[1, 2, 7]`, **when** `allocate`, **then** `[100, 200, 700]`; **given** weights `[1, 1, 1]` and `money(100)`, **then** the leftover cent goes to the lowest index.
15. **Given** `money(-100)`, **when** `split(m, 3)`, **then** the parts sum to exactly `-100` and each is negative.
16. **Given** weights `[]`, `[0, 0]`, or `[1, -1]`, **when** `allocate`, **then** each throws `MoneyError`.
17. **Given** an empty list, **when** `sum`, **then** `zero('EUR')`; **given** three values, **then** their exact total.
18. **Given** `money(100)` and `money(200)`, **when** `compare`, **then** `-1`; `equals` is `false`; `min` is the first; `max` is the second; **and** `equals(money(100), money(100))` is `true`.
19. **Given** `zero()`, **then** `isZero` is `true` and both `isPositive` and `isNegative` are `false`.
20. **Given** 500 pseudo-random amount/weight combinations with a fixed seed, **when** `allocate` and `prorate` run over them, **then** every result is an integer within `Int32` **and** every `allocate` sums to exactly its input. (Property test — the invariants from §4.3 asserted over a range, not three examples.)
21. **Given** a type-level fixture under `tests/fixtures/`, **when** `tsc` runs, **then** a fixture pairing `Money` with `'EUR'` compiles **and** a fixture using `'USD'` fails to compile. (Follows the `errors.test.ts` harness; the positive sibling is required by `MEM-2026-09-09-09`.)
22. **Given** the exported surface, **when** a consumer imports from `@marketplace/contracts`, **then** every function in §4.6 is reachable and `pnpm verify` is clean.

## 10. Open questions

```
ESCALATION
Task:      W1-T06
Question:  Do decisions A, B and C in §2 stand as recorded?
Options:   A) they stand — merge as specced
           B) one changes — say which; it is a spec edit now, an ADR after this merges
Recommend: A. Each is the conservative reading of a constraint the repo already committed to
           (EUR-only in §1, integer cents in MEM-2026-09-07-03, refunds in W5-T06), and all three
           widen additively if the product moves.
Blocked:   nothing
Not blocked: the whole task — the decisions were put before the spec, per W1-T01's precedent, and
           the instruction back was to proceed.
```

One genuine open question for `W1-T08`, recorded here so it is not lost: **who absorbs the
remainder on a three-way split** where the platform, the provider and a promotion all take a share.
`allocate` guarantees the cents land somewhere deterministic (lowest index), but *which party sits
at index 0* is a commercial decision, not a rounding one. `W5-T02` must state it; this task only
guarantees no cent is created or destroyed.
