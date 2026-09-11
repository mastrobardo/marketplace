/**
 * Join class names into a string.
 *
 * It exists for the compiler, not for convenience: `noUncheckedIndexedAccess` types a CSS Module
 * lookup as `string | undefined`, and `exactOptionalPropertyTypes` then refuses to pass that to a
 * `className`. Both settings are right — a typo'd class name silently doing nothing is exactly the
 * bug they catch — so the join is where the `undefined` is dealt with, once.
 */
export function cx(...names: Array<string | undefined | false>): string {
  return names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');
}
