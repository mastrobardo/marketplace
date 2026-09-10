/**
 * Money — integer cents, and the two places a cent may be rounded.
 *
 * STUB. The surface exists so that `W1-T06`'s tests fail on behaviour rather than on module
 * resolution (`MEM-2026-09-09-06`). No function here is implemented.
 *
 * Spec: `docs/specs/S1/W1-T06-money-value-object.md`.
 */
import { z } from 'zod';

/** §4.4 decision A — one currency, as a literal, so a mismatch is a compile error. */
export type Currency = 'EUR';

export interface Money {
  readonly amountCents: number;
  readonly currency: Currency;
}

/** Thrown for a defect in the caller — never an `AppError`, see spec §4.5. */
export class MoneyError extends Error {
  public override readonly name = 'MoneyError';
}

const notImplemented = (fn: string): never => {
  throw new Error(`not implemented: ${fn}`);
};

/** STUB: validates nothing, which is what an unimplemented validator does. */
export const MoneySchema = z.custom<Money>(() => true);

export const money = (_amountCents: number, _currency: Currency = 'EUR'): Money =>
  notImplemented('money');

export const zero = (_currency: Currency = 'EUR'): Money => notImplemented('zero');

export const add = (_a: Money, _b: Money): Money => notImplemented('add');

export const subtract = (_a: Money, _b: Money): Money => notImplemented('subtract');

export const negate = (_m: Money): Money => notImplemented('negate');

export const multiply = (_m: Money, _factor: number): Money => notImplemented('multiply');

export const prorate = (_m: Money, _numerator: number, _denominator: number): Money =>
  notImplemented('prorate');

export const applyBasisPoints = (_m: Money, _bps: number): Money =>
  notImplemented('applyBasisPoints');

export const allocate = (_m: Money, _weights: readonly number[]): Money[] =>
  notImplemented('allocate');

export const split = (_m: Money, _parts: number): Money[] => notImplemented('split');

export const sum = (_items: readonly Money[], _currency: Currency = 'EUR'): Money =>
  notImplemented('sum');

export const compare = (_a: Money, _b: Money): -1 | 0 | 1 => notImplemented('compare');

export const equals = (_a: Money, _b: Money): boolean => notImplemented('equals');

export const min = (_a: Money, _b: Money): Money => notImplemented('min');

export const max = (_a: Money, _b: Money): Money => notImplemented('max');

export const isZero = (_m: Money): boolean => notImplemented('isZero');

export const isPositive = (_m: Money): boolean => notImplemented('isPositive');

export const isNegative = (_m: Money): boolean => notImplemented('isNegative');
