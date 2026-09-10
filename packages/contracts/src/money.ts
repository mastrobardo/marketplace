/**
 * Money — integer cents, and the only two places a cent may be rounded.
 *
 * `TODO.md` §2 rule 4 and `MEM-2026-09-07-03` already forbid floats. What neither covers is
 * division, which every fee, refund and ledger entry performs. `W1-T06` states the division rules
 * once, here, so that two slices cannot disagree by a cent.
 *
 * Frozen seam — changing a shape here costs an ADR (`agents/policies/contract-change.md`).
 * Spec: `docs/specs/S1/W1-T06-money-value-object.md`.
 */
import { z } from 'zod';

/**
 * Decision A. One currency, as a literal rather than a 3-letter string, so a mismatch is a compile
 * error rather than a runtime one. Widening this to `z.enum([...])` is additive when a second
 * market arrives; every runtime currency guard below exists so that widening stays safe.
 */
export type Currency = 'EUR';

const CURRENCY: Currency = 'EUR';

/**
 * Prisma `Int` is a Postgres `integer`: 32-bit signed. An amount outside it is a defect or an
 * attack, and the alternative to catching it here is a range error raised by Postgres inside a
 * transaction that has already done work.
 */
const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;

/**
 * A defect in the caller, never a client error — see spec §4.5. Untrusted input is rejected by
 * `MoneySchema` at the route boundary, where zod's failure already becomes `VALIDATION_FAILED`.
 * A `MoneyError` reaching the handler is an `INTERNAL_ERROR`, which is the correct classification
 * for arithmetic that was asked to do something impossible.
 */
export class MoneyError extends Error {
  public override readonly name = 'MoneyError';
}

/**
 * The wire and in-memory shape. `strictObject` for the same reason the error envelope uses it: a
 * body carrying both `amountCents` and a stray `amount: 12.34` is a client that has misread the
 * contract, and saying so at the boundary beats guessing which field to trust.
 *
 * `z.int32()` covers "integer", "finite" and "storable" in one predicate.
 */
export const MoneySchema = z.strictObject({
  amountCents: z.int32(),
  currency: z.literal(CURRENCY),
});

/**
 * A plain frozen object, not a class instance: `Money` crosses the seam, so it must survive
 * `JSON.stringify` without a revive step on the far side. `Object.freeze` makes an accidental
 * mutation a `TypeError` under strict mode instead of a silent shared-reference bug.
 */
export type Money = z.infer<typeof MoneySchema>;

function assertStorable(amountCents: number, operation: string): void {
  if (!Number.isInteger(amountCents)) {
    throw new MoneyError(
      `${operation}: ${amountCents} is not a whole number of cents. Money is integer cents — ` +
        `see TODO.md §2 rule 4.`,
    );
  }
  if (amountCents < INT32_MIN || amountCents > INT32_MAX) {
    throw new MoneyError(
      `${operation}: ${amountCents} is outside the storable range ${INT32_MIN}…${INT32_MAX} ` +
        `(Postgres integer, which is what Prisma Int is).`,
    );
  }
}

/**
 * Construct. Throws on anything the column could not hold.
 *
 * `+ 0` normalises `-0`, which `negate(zero())` and `prorate` would otherwise produce. There is
 * one zero amount, not two: `Object.is(-0, 0)` is `false`, so a stray `-0` makes an assertion or a
 * `Map` key behave differently from an amount that is arithmetically identical.
 */
export function money(amountCents: number, currency: Currency = CURRENCY): Money {
  assertStorable(amountCents, 'money');
  return Object.freeze({ amountCents: amountCents + 0, currency });
}

export const zero = (currency: Currency = CURRENCY): Money => money(0, currency);

/**
 * Decision A makes a mixed pair inexpressible in TypeScript, so this can only fire on a value that
 * never passed through `MoneySchema` — a row read straight from Postgres, an inbound webhook body.
 * It stays because that is precisely the case the type system cannot see, and because it is what
 * makes "widening the currency is additive" true rather than hopeful.
 */
function sameCurrency(a: Money, b: Money, operation: string): Currency {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `${operation}: cannot mix ${a.currency} and ${b.currency}. Convert first, explicitly.`,
    );
  }
  return a.currency;
}

function assertWholeCount(value: number, label: string, operation: string): void {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${operation}: ${label} must be a whole number, got ${value}.`);
  }
}

export function add(a: Money, b: Money): Money {
  const currency = sameCurrency(a, b, 'add');
  const total = a.amountCents + b.amountCents;
  assertStorable(total, `add(${a.amountCents}, ${b.amountCents})`);
  return money(total, currency);
}

export function subtract(a: Money, b: Money): Money {
  const currency = sameCurrency(a, b, 'subtract');
  const difference = a.amountCents - b.amountCents;
  assertStorable(difference, `subtract(${a.amountCents}, ${b.amountCents})`);
  return money(difference, currency);
}

export const negate = (m: Money): Money => money(-m.amountCents, m.currency);

/**
 * For quantities — three hours at an hourly rate — and therefore exact. A fractional factor is
 * refused rather than rounded, because a caller reaching for `multiply(m, 0.12)` wants a rate, and
 * a rate goes through `prorate` where the rounding rule is stated.
 */
export function multiply(m: Money, factor: number): Money {
  if (!Number.isInteger(factor)) {
    throw new MoneyError(
      `multiply: ${factor} is not a whole quantity. For a rate or a percentage use ` +
        `prorate(m, numerator, denominator) or applyBasisPoints(m, bps), where the rounding rule ` +
        `is explicit.`,
    );
  }
  const product = m.amountCents * factor;
  assertStorable(product, `multiply(${m.amountCents}, ${factor})`);
  return money(product, m.currency);
}

/**
 * Rounding site one of two (decision B). **Half away from zero**: `prorate(5, 1, 2)` is 3 and
 * `prorate(-5, 1, 2)` is -3. The symmetry is the point — a refund of half a payment must not
 * differ in magnitude from the fee on the same payment merely because one carries a minus sign.
 *
 * `Math.round` was not used: it rounds half *up* on the number line, so it gives -2 for -2.5 and
 * breaks that symmetry.
 */
export function prorate(m: Money, numerator: number, denominator: number): Money {
  assertWholeCount(numerator, 'numerator', 'prorate');
  assertWholeCount(denominator, 'denominator', 'prorate');
  if (denominator === 0) {
    throw new MoneyError(`prorate: denominator is 0 (numerator ${numerator}).`);
  }

  // The product is computed as a double, which holds integers exactly only up to 2^53. Every
  // realistic ratio stays far below that, but an unrealistic one would round *before* the division
  // and lose cents silently — the one failure mode this module exists to make impossible.
  const product = m.amountCents * numerator;
  if (!Number.isSafeInteger(product)) {
    throw new MoneyError(
      `prorate: ${m.amountCents} × ${numerator} exceeds the exact-integer range, so the ratio ` +
        `cannot be applied without losing cents. Reduce the ratio before applying it.`,
    );
  }

  const exact = product / denominator;
  const rounded = Math.sign(exact) * Math.round(Math.abs(exact));
  assertStorable(rounded, `prorate(${m.amountCents}, ${numerator}, ${denominator})`);
  return money(rounded, m.currency);
}

/**
 * Percentages in basis points, so no float ever enters money arithmetic: a 12 % take rate is the
 * integer `1200`, read from config where a human put it (`policies/human-boundaries.md` — the
 * number is a product decision, the mechanism is ours).
 */
export const applyBasisPoints = (m: Money, bps: number): Money => prorate(m, bps, 10_000);

/**
 * Rounding site two of two, with the stronger invariant: **the parts sum to exactly `m`**.
 *
 * Largest-remainder allocation. Each share is truncated toward zero, then the leftover cents are
 * handed out one at a time to the largest fractional remainders, ties going to the lowest index.
 * `allocate(100, [1, 1, 1])` is `[34, 33, 33]` — not three 33s with a cent unaccounted for, and
 * not three 34s with a cent invented. `W5-T10`'s double-entry reconciliation depends on this
 * holding for every input, which is why AC20 asserts it over a seeded range rather than at three
 * examples.
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    throw new MoneyError('allocate: no weights — there is nobody to allocate to.');
  }
  for (const weight of weights) {
    assertWholeCount(weight, `weight ${weight}`, 'allocate');
    if (weight < 0) {
      throw new MoneyError(`allocate: negative weight ${weight} in [${weights.join(', ')}].`);
    }
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    throw new MoneyError(
      `allocate: every weight is 0 in [${weights.join(', ')}] — the shares would be undefined.`,
    );
  }

  const sign = m.amountCents < 0 ? -1 : 1;
  const magnitude = Math.abs(m.amountCents);

  // Truncate on the magnitude, then distribute, so a negative total behaves as the mirror of its
  // positive twin instead of depending on how the runtime truncates negative division.
  const shares = weights.map((weight) => Math.floor((magnitude * weight) / totalWeight));
  const remainders = weights.map(
    (weight, index) => (magnitude * weight) / totalWeight - (shares[index] ?? 0),
  );

  let leftover = magnitude - shares.reduce((a, b) => a + b, 0);
  const byRemainder = remainders
    .map((remainder, index) => ({ remainder, index }))
    // Ties go to the lowest index, so the same input always produces the same allocation. Which
    // party sits at index 0 is a commercial decision — see the spec's §10.
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const { index } of byRemainder) {
    if (leftover === 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    leftover -= 1;
  }

  return shares.map((share) => money(sign * share, m.currency));
}

export function split(m: Money, parts: number): Money[] {
  assertWholeCount(parts, 'parts', 'split');
  if (parts < 1) {
    throw new MoneyError(`split: ${parts} parts is not a split.`);
  }
  return allocate(
    m,
    Array.from({ length: parts }, () => 1),
  );
}

/** An empty list still has a currency, which is why it is a parameter and not an inference. */
export function sum(items: readonly Money[], currency: Currency = CURRENCY): Money {
  return items.reduce<Money>((total, item) => add(total, item), zero(currency));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b, 'compare');
  if (a.amountCents < b.amountCents) return -1;
  if (a.amountCents > b.amountCents) return 1;
  return 0;
}

export const equals = (a: Money, b: Money): boolean =>
  a.currency === b.currency && a.amountCents === b.amountCents;

export const min = (a: Money, b: Money): Money => (compare(a, b) <= 0 ? a : b);

export const max = (a: Money, b: Money): Money => (compare(a, b) >= 0 ? a : b);

export const isZero = (m: Money): boolean => m.amountCents === 0;

export const isPositive = (m: Money): boolean => m.amountCents > 0;

export const isNegative = (m: Money): boolean => m.amountCents < 0;
