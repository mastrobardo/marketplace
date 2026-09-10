# Run record — W1-T06 money value object

|                  |                                                                                |
| ---------------- | ------------------------------------------------------------------------------ |
| **Task**         | `W1-T06` · issue [#60](https://github.com/mastrobardo/marketplace/issues/60)   |
| **Agent**        | `agent-contracts` (charter rev 1)                                              |
| **Model**        | `claude-opus-5`                                                                |
| **Skills used**  | `test-driven-development`                                                      |
| **Date**         | 2026-09-10                                                                     |
| **Spec**         | `W1-T06-money-value-object.md`                                                 |
| **Session file** | `memory/sessions/2026-09-10-agent-contracts-W1-T06.md`                         |

---

## 1. What landed

`packages/contracts/src/money.ts`: `MoneySchema`, `Money`, `MoneyError`, and eighteen functions.
47 tests in `packages/contracts/tests/money.test.ts` plus two type-level fixtures. `pnpm verify`
clean end to end — typecheck, lint, format, 224 tests across 10 files, both builds.

Nothing outside `packages/contracts` was touched. `apps/api` has no money path yet, so there is no
consumer to migrate; `W1-T05` adds the `Int` cents columns this value is bounded against.

## 2. The decisions were put before the spec, and only partly answered

`W1-T01` established that a seam decision goes to the operator before the spec is written, because
afterwards it costs an ADR. Three went up — currency as a literal, rounding half away from zero
confined to two functions, negative amounts legal — each with a recommendation and its consequence.

The instruction back was *"let's start"*, without picking through them. Read literally that is not
an answer to three questions; read in context it is an instruction to proceed on the
recommendations. I took the second reading and made the ambiguity visible instead of silent: §2 of
the spec records all three as standing, and §10 carries them as an open `ESCALATION` that stays open
until this PR merges. If one is wrong it is still a spec edit today, and an ADR tomorrow.

That is the honest account. The alternative — blocking on a second round of confirmation for
decisions the operator had already been shown and had chosen not to contest — would have cost a
cycle to learn nothing.

## 3. The red phase

`MEM-2026-09-09-06` is explicit that `Cannot find module` is not a red phase, so the module surface
went in first as stubs that throw, and the schema as `z.custom<Money>(() => true)` — which is what
an unimplemented validator does: accept everything.

```
 RUN  v5.0.0 /Users/davide.arcinotti/experiments/marketplace/packages/contracts

 ✓ tests/money.test.ts > AC21 … > refuses a fixture that names another currency 432ms
 × tests/money.test.ts > AC1/AC2/AC3 … > builds a frozen EUR value from integer cents 2ms
   → not implemented: money
 × tests/money.test.ts > AC1/AC2/AC3 … > refuses a fractional cent, naming the value 1ms
   → expected error to be instance of MoneyError
 × tests/money.test.ts > AC1/AC2/AC3 … > refuses NaN and Infinity 0ms
   → expected error to be instance of MoneyError
 × tests/money.test.ts > AC1/AC2/AC3 … > accepts the Int32 bounds and refuses one step beyond either 0ms
   → not implemented: money
 × tests/money.test.ts > AC1/AC2/AC3 … > names the bound in the message … 1ms
   → expected [Function] to throw error matching /2147483647/ but got 'not implemented: money'
 ✓ tests/money.test.ts > AC4 … > accepts a well-formed wire object 0ms
 × tests/money.test.ts > AC4 … > rejects a float amount 1ms
   → expected true to be false
 …

 Test Files  1 failed (1)
      Tests  42 failed | 4 passed (46)
```

**Four tests passed before any implementation existed, and each needs its excuse checked:**

| Test                                     | Why it passed                                                                                                                                                                                   | Verdict                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| AC21 — `USD` fails to compile            | Decision A is carried entirely by `type Currency = 'EUR'`, and the stub had to contain that alias to typecheck at all.                                                                          | **Never went red.** Real regression guard, no red phase. Stated, not hidden.           |
| AC21 — the valid fixture compiles        | Same reason, in the other direction.                                                                                                                                                            | Same.                                                                                  |
| AC4 — accepts a well-formed wire object  | The stub schema accepts everything, so the positive case passes vacuously. The four negative cases in the same block all failed, which is what made the block honest overall.                    | Vacuous, and its siblings prove it.                                                    |
| AC22 — the surface is exported           | The stubs *are* functions, so a `typeof === 'function'` check over the surface is satisfied by definition.                                                                                       | Vacuous by construction. It guards a later deletion, not this implementation.          |

## 4. Two defects the tests found

**`negate(zero())` returned `-0`.** `Object.is(-0, 0)` is `false`, so an amount arithmetically
identical to zero compared unequal to it, and any test or `Map` key touching it behaved differently
from the zero next to it. `JSON.stringify(-0)` is `"0"`, so the value would have healed on the way
across the seam and stayed broken on the server side — the sort of asymmetry that gets found months
later in a reconciliation. Fixed in the constructor (`amountCents + 0`), which catches every path
into a `Money` rather than just `negate`.

**`prorate` could lose cents silently.** The property test drew a numerator above the denominator,
which failed an assertion I had written — but reading *why* turned up something the assertion was
not about: `m.amountCents * numerator` is a double, exact only below 2^53. A large enough ratio
rounds the product *before* the division, and the function returns a plausible integer that is
simply wrong, with no error anywhere. That is precisely the failure mode `MEM-2026-09-07-03` exists
to prevent, arriving inside the module written to prevent it. Now guarded by
`Number.isSafeInteger(product)` with its own test.

## 5. One test was wrong, not the code

The AC20 property test asserted `|prorate(m, n, d)| ≤ |m|` over the whole seeded range while
drawing numerators up to 10 000 against denominators up to 9 973 — so it demanded that a ratio
above 1 scale *down*. `prorate(x, 3, 2)` is legitimately larger than `x`, and AC20 as specced only
claims integrality and exact allocation, not monotonicity.

Fixed by bounding the drawn numerator by its denominator and saying in a comment why: the invariant
under test is what §4.3 promises; ratios above 1 are covered by the examples. Changing a test after
watching it fail deserves the scrutiny, so: the assertion was an extra I added beyond the criterion,
it encoded a property the spec never claimed, and no acceptance criterion was weakened.

## 6. Decisions worth reviewing

- **A plain frozen object, not a class.** `Money` crosses the seam and must survive
  `JSON.stringify` without a revive step; a class arrives at the client with its methods gone, and
  that failure shows up in the consumer rather than at the boundary. Cost: eighteen free functions
  instead of methods, and `add(a, b)` rather than `a.add(b)`.

- **`Int32`, not `BigInt`.** ±€21.4 M is the Postgres `integer` bound, and no MVP amount is near
  it. `BigInt` does not serialise to JSON, which would put a custom reviver into the generated
  client from `W1-T03` onward.

- **The currency guard is unreachable today and stays.** Six functions check a currency match that
  decision A makes inexpressible in TypeScript. It fires only for a value that never passed through
  `MoneySchema` — a row read straight from Postgres, a webhook body — which is exactly the case the
  type system cannot see, and it is what makes "widening the currency later is additive" true rather
  than hopeful. Tested with a deliberate cast.

- **`multiply` refuses `0.12` instead of rounding it.** The error names `prorate` and
  `applyBasisPoints`. A rate that rounds silently at an unnamed call site is how two slices end up
  a cent apart, which is the whole reason this task exists.

- **`allocate` breaks ties to the lowest index.** Deterministic, so the same booking always splits
  the same way. *Which party sits at index 0* is a commercial decision, not a rounding one — spec
  §10 hands that to `W5-T02` rather than quietly deciding it here.

## 7. Deviations from spec

- **AC20's numerator bound** — §5 above.
- **One guard added beyond the spec**: `prorate` rejecting an unsafe intermediate product (§4).
  Additive, no shape change, no ADR.
- The spec's §4.6 table said `allocate` throws on "a negative weight"; the implementation also
  rejects a **fractional** weight, for the same reason. Additive.

## 8. Human input received

The three decisions in §2 were shown to the operator with recommendations before the spec was
written; the reply was to start. No hand-edits, no overrides, so no ledger entry under L7. The
mapping exercise that chose this task over W0-T20 and W1-T09 is in the session file.

## 9. Self-assessment

- **Weakest part of this change.** `allocate`'s remainder distribution. The invariant is asserted
  over 500 seeded cases and every example in the spec, but the sort comparator carries two rules
  (remainder descending, then index ascending) and only the second has a dedicated test. A
  floating-point remainder comparison is also, in principle, the kind of thing that could tie where
  exact arithmetic would not — it cannot change the *total*, only which index gets the cent.

- **What a reviewer should look at hardest.** `prorate`'s rounding line:
  `Math.sign(exact) * Math.round(Math.abs(exact))`. `Math.round` alone rounds half *up the number
  line*, giving −2 for −2.5 and breaking the fee/refund symmetry decision B is about. That one
  expression is decision B; if it is wrong, every fee in the platform is wrong by a cent in one
  direction. Second: whether `Int32` is the right bound to freeze into the seam, given it is a
  property of a column type that `W1-T05` has not written yet.

- **What I would tell the next agent in this slice.** Money arithmetic goes through this module or
  it does not happen — if you find yourself writing `Math.round` near a cents field, the function
  you want is `prorate` or `allocate`. And when a property test fails, read *why* before fixing the
  assertion: one of the two real defects here was found that way, and the assertion was the part
  that was wrong.
