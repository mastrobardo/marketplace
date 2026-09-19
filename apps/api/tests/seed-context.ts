/**
 * A `SeedContext` for suites that are testing a seeder's *data*, not its environment.
 *
 * `W0-T30` widened the context from `{ db }` to `{ db, target, demoPassword }`, because
 * `auth.demo-users` now behaves differently off a local host (§3.3). Every other seeder ignores
 * both new fields, so their tests should not have to restate them — and more importantly, a suite
 * that spelled out `target: { isLocal: true }` inline would silently keep asserting the local path
 * if the default ever changed.
 *
 * Not a `.test.ts` file, so vitest does not collect it.
 */
import { type Prisma } from '@prisma/client';

import { type SeedContext } from '../prisma/seed/types.js';

/** The laptop case: a local target, and no supplied password. */
export function localSeedContext(
  db: Prisma.TransactionClient,
  overrides: Partial<Omit<SeedContext, 'db'>> = {},
): SeedContext {
  return { db, target: { isLocal: true }, demoPassword: undefined, ...overrides };
}
