import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MoneyError,
  MoneySchema,
  add,
  allocate,
  applyBasisPoints,
  compare,
  equals,
  isNegative,
  isPositive,
  isZero,
  max,
  min,
  money,
  multiply,
  negate,
  prorate,
  split,
  subtract,
  sum,
  zero,
  type Money,
} from '../src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Postgres `integer`, which is what Prisma `Int` is — see spec §4.2. */
const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;

const cents = (m: Money): number => m.amountCents;

describe('AC1/AC2/AC3 — construction refuses what the column cannot hold', () => {
  it('builds a frozen EUR value from integer cents', () => {
    const built = money(1234);
    expect(built).toEqual({ amountCents: 1234, currency: 'EUR' });
    expect(Object.isFrozen(built), 'a Money that can be mutated is a shared-reference bug').toBe(
      true,
    );
  });

  it('refuses a fractional cent, naming the value', () => {
    expect(() => money(12.34)).toThrow(MoneyError);
    expect(() => money(12.34)).toThrow(/12\.34/);
  });

  it('refuses NaN and Infinity', () => {
    expect(() => money(Number.NaN)).toThrow(MoneyError);
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('accepts the Int32 bounds and refuses one step beyond either', () => {
    expect(cents(money(INT32_MAX))).toBe(INT32_MAX);
    expect(cents(money(INT32_MIN))).toBe(INT32_MIN);
    expect(() => money(INT32_MAX + 1)).toThrow(MoneyError);
    expect(() => money(INT32_MIN - 1)).toThrow(MoneyError);
  });

  it('names the bound in the message, so the reader learns why 21 million is the limit', () => {
    expect(() => money(INT32_MAX + 1)).toThrow(/2147483647/);
  });
});

describe('AC4 — the schema is the boundary for untrusted money', () => {
  it('accepts a well-formed wire object', () => {
    expect(MoneySchema.safeParse({ amountCents: 1234, currency: 'EUR' }).success).toBe(true);
  });

  it('rejects a float amount', () => {
    expect(MoneySchema.safeParse({ amountCents: 12.34, currency: 'EUR' }).success).toBe(false);
  });

  it('rejects an amount outside Int32', () => {
    expect(MoneySchema.safeParse({ amountCents: INT32_MAX + 1, currency: 'EUR' }).success).toBe(
      false,
    );
  });

  it('rejects a currency the platform does not trade in', () => {
    expect(MoneySchema.safeParse({ amountCents: 1234, currency: 'USD' }).success).toBe(false);
  });

  it('rejects an extra key, because a second amount field means the client misread the contract', () => {
    expect(
      MoneySchema.safeParse({ amountCents: 1234, currency: 'EUR', amount: 12.34 }).success,
    ).toBe(false);
  });
});

describe('AC5/AC6/AC7 — addition is exact, bounded and single-currency', () => {
  it('adds and subtracts exactly', () => {
    expect(cents(add(money(100), money(23)))).toBe(123);
    expect(cents(subtract(money(100), money(23)))).toBe(77);
  });

  it('leaves both operands untouched', () => {
    const a = money(100);
    const b = money(23);
    add(a, b);
    expect(cents(a)).toBe(100);
    expect(cents(b)).toBe(23);
  });

  it('negates, and negating zero stays zero', () => {
    expect(cents(negate(money(100)))).toBe(-100);
    expect(cents(negate(money(0)))).toBe(0);
  });

  it('refuses a sum the column could not store', () => {
    const nearlyMax = money(2_147_483_600);
    expect(() => add(nearlyMax, nearlyMax)).toThrow(MoneyError);
  });

  it('refuses a difference below the Int32 floor', () => {
    expect(() => subtract(money(INT32_MIN), money(1))).toThrow(MoneyError);
  });

  it('refuses mixed currencies, naming both', () => {
    // Cast on purpose: decision A makes this unreachable in TypeScript, and §4.4 says the runtime
    // guard stays anyway — a row read from Postgres has not been through MoneySchema.
    const dollars = { amountCents: 100, currency: 'USD' } as unknown as Money;
    expect(() => add(dollars, money(100))).toThrow(MoneyError);
    expect(() => add(dollars, money(100))).toThrow(/USD/);
    expect(() => add(dollars, money(100))).toThrow(/EUR/);
  });
});

describe('AC8 — multiply is for quantities, not for rates', () => {
  it('multiplies by an integer quantity exactly', () => {
    expect(cents(multiply(money(1000), 3))).toBe(3000);
    expect(cents(multiply(money(1000), 0))).toBe(0);
    expect(cents(multiply(money(1000), -2))).toBe(-2000);
  });

  it('refuses a fractional factor and points the caller at prorate', () => {
    expect(() => multiply(money(1000), 0.12)).toThrow(MoneyError);
    expect(() => multiply(money(1000), 0.12)).toThrow(/prorate/);
  });

  it('refuses a product outside Int32', () => {
    expect(() => multiply(money(INT32_MAX), 2)).toThrow(MoneyError);
  });
});

describe('AC9/AC10/AC11/AC12 — prorate is one of the two rounding sites', () => {
  it('rounds half away from zero', () => {
    expect(cents(prorate(money(5), 1, 2))).toBe(3);
  });

  it('rounds a negative half away from zero too, so a refund mirrors the fee', () => {
    expect(cents(prorate(money(-5), 1, 2))).toBe(-3);
  });

  it('is exact when the division is exact', () => {
    expect(cents(prorate(money(1000), 1, 4))).toBe(250);
  });

  it('rounds a third up only when the remainder earns it', () => {
    expect(cents(prorate(money(100), 1, 3))).toBe(33);
    expect(cents(prorate(money(200), 1, 3))).toBe(67);
  });

  it('expresses a percentage in basis points, never a float', () => {
    const fee = applyBasisPoints(money(9999), 1200);
    expect(cents(fee)).toBe(cents(prorate(money(9999), 1200, 10_000)));
    expect(cents(fee)).toBe(1200);
  });

  it('refuses a zero denominator', () => {
    expect(() => prorate(money(100), 1, 0)).toThrow(MoneyError);
  });

  it('refuses fractional numerators and denominators', () => {
    expect(() => prorate(money(100), 1.5, 2)).toThrow(MoneyError);
    expect(() => prorate(money(100), 1, 2.5)).toThrow(MoneyError);
  });

  it('refuses a ratio whose product would round before the division', () => {
    // amountCents × numerator is a double: exact only below 2^53. Beyond it the division would
    // operate on an already-rounded product and lose cents with no error anywhere.
    expect(() => prorate(money(2_000_000_000), 1_000_000_000, 1_000_000_000)).toThrow(MoneyError);
    expect(() => prorate(money(2_000_000_000), 1_000_000_000, 1_000_000_000)).toThrow(/cents/);
  });
});

describe('AC13/AC14/AC15/AC16 — allocate never creates or destroys a cent', () => {
  it('splits 100 three ways as 34/33/33', () => {
    const parts = split(money(100), 3).map(cents);
    expect(parts).toEqual([34, 33, 33]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('allocates proportionally when the weights divide cleanly', () => {
    expect(allocate(money(1000), [1, 2, 7]).map(cents)).toEqual([100, 200, 700]);
  });

  it('gives the leftover cent to the lowest index, deterministically', () => {
    expect(allocate(money(100), [1, 1, 1]).map(cents)).toEqual([34, 33, 33]);
    expect(allocate(money(10), [1, 1, 1, 1]).map(cents)).toEqual([3, 3, 2, 2]);
  });

  it('keeps the sign and the exact total for a negative amount', () => {
    const parts = split(money(-100), 3).map(cents);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-100);
    for (const part of parts) expect(part).toBeLessThan(0);
  });

  it('allocates zero to a zero weight without disturbing the total', () => {
    const parts = allocate(money(100), [1, 0, 1]).map(cents);
    expect(parts[1]).toBe(0);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('refuses weights it cannot allocate against', () => {
    expect(() => allocate(money(100), [])).toThrow(MoneyError);
    expect(() => allocate(money(100), [0, 0])).toThrow(MoneyError);
    expect(() => allocate(money(100), [1, -1])).toThrow(MoneyError);
  });

  it('refuses a split into fewer than one part', () => {
    expect(() => split(money(100), 0)).toThrow(MoneyError);
    expect(() => split(money(100), 1.5)).toThrow(MoneyError);
  });
});

describe('AC17 — sum has a currency even when it has no items', () => {
  it('totals an empty list as zero EUR', () => {
    expect(sum([])).toEqual({ amountCents: 0, currency: 'EUR' });
  });

  it('totals exactly', () => {
    expect(cents(sum([money(100), money(23), money(-3)]))).toBe(120);
  });

  it('refuses a mixed-currency list', () => {
    const dollars = { amountCents: 100, currency: 'USD' } as unknown as Money;
    expect(() => sum([money(100), dollars])).toThrow(MoneyError);
  });
});

describe('AC18/AC19 — comparison and sign', () => {
  it('orders by amount', () => {
    expect(compare(money(100), money(200))).toBe(-1);
    expect(compare(money(200), money(100))).toBe(1);
    expect(compare(money(100), money(100))).toBe(0);
  });

  it('is structural about equality', () => {
    expect(equals(money(100), money(100))).toBe(true);
    expect(equals(money(100), money(200))).toBe(false);
  });

  it('picks the smaller and the larger', () => {
    expect(cents(min(money(100), money(200)))).toBe(100);
    expect(cents(max(money(100), money(200)))).toBe(200);
  });

  it('treats zero as neither positive nor negative', () => {
    expect(isZero(zero())).toBe(true);
    expect(isPositive(zero())).toBe(false);
    expect(isNegative(zero())).toBe(false);
  });

  it('reads the sign of a non-zero amount', () => {
    expect(isPositive(money(1))).toBe(true);
    expect(isNegative(money(-1))).toBe(true);
    expect(isZero(money(-1))).toBe(false);
  });
});

/**
 * AC20. §4.3 states two invariants — every result is an integer inside Int32, and an allocation
 * sums to exactly its input. Three examples do not establish an invariant; a seeded range does,
 * and it stays reproducible because the seed is fixed.
 */
describe('AC20 — the invariants hold across a seeded range, not just at the examples', () => {
  function* seeded(count: number): Generator<number> {
    let state = 0x2f6e2b1;
    for (let i = 0; i < count; i += 1) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      yield state;
    }
  }

  it('keeps every prorate result an integer inside Int32', () => {
    for (const draw of seeded(500)) {
      const amount = (draw % 4_000_001) - 2_000_000;
      const denominator = (draw % 9_973) + 1;
      // A numerator bounded by the denominator: a ratio that scales *down*, which is what every
      // caller — fee, refund, share of a total — actually asks for. Ratios above 1 are legal and
      // exercised by the examples above; here the point is the invariant, and "never exceeds the
      // input" only holds for a fraction.
      const numerator = draw % (denominator + 1);
      const result = cents(prorate(money(amount), numerator, denominator));
      expect(Number.isInteger(result), `prorate(${amount}, ${numerator}, ${denominator})`).toBe(
        true,
      );
      expect(
        Math.abs(result),
        `prorate(${amount}, ${numerator}, ${denominator})`,
      ).toBeLessThanOrEqual(Math.abs(amount));
    }
  });

  it('keeps every allocation summing to exactly its input', () => {
    for (const draw of seeded(500)) {
      const amount = (draw % 4_000_001) - 2_000_000;
      const parts = (draw % 7) + 1;
      const weights = Array.from({ length: parts }, (_, i) => ((draw >> (i + 1)) % 9) + 1);
      const allocated = allocate(money(amount), weights).map(cents);
      expect(allocated).toHaveLength(parts);
      for (const part of allocated) expect(Number.isInteger(part)).toBe(true);
      expect(
        allocated.reduce((a, b) => a + b, 0),
        `allocate(${amount}, [${weights.join(',')}]) lost or invented a cent`,
      ).toBe(amount);
    }
  });
});

/**
 * AC21. Decision A is a compile-time claim, so it is only true if a compiler is asked. Same
 * harness as `errors.test.ts`; the positive sibling is not optional — `MEM-2026-09-09-09` records
 * a check that always failed and a check that always passed being indistinguishable without one.
 */
/**
 * The local binary, not `npx tsc`: `npx` re-resolves the package on every call, and this suite
 * spawns it twice while turbo runs the other packages' suites in parallel.
 */
const tsc = fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url));

function typecheckFixture(name: string): { ok: boolean; output: string } {
  try {
    execFileSync(tsc, ['-p', `tests/fixtures/${name}/tsconfig.json`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: '' };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('AC21 — a currency other than EUR is a compile error', () => {
  // Shelling out to a compiler on a two-core runner does not fit the 5s default, and
  // `MEM-2026-09-09-02`: only the options-object form of the override is honoured by Vitest 5.
  it('compiles a fixture that pairs Money with EUR', { timeout: 120_000 }, () => {
    const result = typecheckFixture('money-valid');
    expect(result.ok, `the valid money fixture did not compile:\n${result.output}`).toBe(true);
  });

  it('refuses a fixture that names another currency', { timeout: 120_000 }, () => {
    const result = typecheckFixture('money-wrong-currency');
    expect(result.ok, 'USD compiled as a Currency').toBe(false);
  });
});

describe('AC22 — the surface is reachable from the package root', () => {
  it('exports every function the spec lists', () => {
    const surface = {
      money,
      zero,
      add,
      subtract,
      negate,
      multiply,
      prorate,
      applyBasisPoints,
      allocate,
      split,
      sum,
      compare,
      equals,
      min,
      max,
      isZero,
      isPositive,
      isNegative,
    };
    for (const [name, fn] of Object.entries(surface)) {
      expect(typeof fn, `${name} is not exported as a function`).toBe('function');
    }
    expect(typeof MoneySchema.safeParse).toBe('function');
  });
});
