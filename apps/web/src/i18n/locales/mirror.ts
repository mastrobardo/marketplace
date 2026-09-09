/**
 * The shape an `en/` namespace must have: exactly the keys its `es/` counterpart defines.
 *
 * Used with `satisfies` on a **direct object literal**, which is what makes it enforce both
 * directions — a missing key is an assignability error naming it, and a key Spanish never defined
 * is an excess-property error. Both are the compile failures `W0-T04` set out to guarantee; this
 * type is only their per-namespace form.
 */
export type Mirror<T> = Record<keyof T, string>;
