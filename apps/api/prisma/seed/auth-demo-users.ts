import { hashPassword } from 'better-auth/crypto';

import { SeedError, type Seeder } from './types.js';

/**
 * Two accounts a developer can log in as — `W2-T01` §8.4.
 *
 * **This seeder used to be `localOnly`, and `W0-T30` is why it no longer is.** The flag was never
 * about the rows being fake; it was about the password below being a literal in a public
 * repository. A known-credential account on `marketplace-api-staging.fly.dev` is a real account
 * anyone who can read this file can use.
 *
 * "Don't travel" turned out to be the wrong answer to that, because staging needs an account QA can
 * sign in as (operator, 2026-09-19). The right answer is to travel **without the published
 * password**: off a local host the value comes from `SEED_DEMO_PASSWORD`, and a run that has no
 * such value is refused rather than silently writing the public one (§3.3).
 *
 * The hash comes from better-auth's own `hashPassword`, not from a reimplementation. A seeder that
 * hashes passwords its own way produces rows that look right and cannot sign in, and the symptom —
 * "the seeded user's password is wrong" — points at the password rather than at the algorithm.
 */

/**
 * The convenience password for a laptop, and **public by construction** — it is committed.
 *
 * Exported so that `seed-filter.test.ts` can assert the thing that matters: that a hash written
 * against a non-local target does *not* verify against this value. A test that repeated the
 * literal would keep passing after somebody changed it here.
 */
export const PUBLISHED_LOCAL_PASSWORD = 'seed-password-local-only';

/** better-auth's own floor for a credential, and the shortest thing worth putting in a secret. */
const MIN_SUPPLIED_LENGTH = 12;

/**
 * Which password these accounts get, and whether they may be written at all.
 *
 * Exported for the same reason as the literal: the decision is the interesting part of this file,
 * and it is worth asserting directly rather than through a hash.
 */
export function resolvePassword(
  target: { isLocal: boolean },
  supplied: string | undefined,
): string {
  if (supplied !== undefined && supplied.trim() !== '') {
    if (supplied.trim().length < MIN_SUPPLIED_LENGTH) {
      throw new SeedError(
        'SEED_WEAK_CREDENTIAL',
        `SEED_DEMO_PASSWORD is shorter than ${String(MIN_SUPPLIED_LENGTH)} characters. ` +
          'These accounts are reachable from the internet in every environment that needs this ' +
          'variable set.',
      );
    }
    return supplied.trim();
  }

  if (target.isLocal) return PUBLISHED_LOCAL_PASSWORD;

  throw new SeedError(
    'SEED_WEAK_CREDENTIAL',
    'refusing to seed demo accounts against a non-local database without SEED_DEMO_PASSWORD. ' +
      'The fallback password is committed to a public repository, so writing it here would ' +
      'publish working credentials for this environment. Set the secret (W0-T30 §6) or leave ' +
      'these accounts out of the run with --only.',
  );
}

/** Fixed uuids so a developer can reference them, and so a re-seeded database is the same one. */
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';

interface DemoUser {
  id: string;
  email: string;
  name: string;
  roles: ('CLIENT' | 'PROVIDER' | 'ADMIN')[];
}

const USERS: DemoUser[] = [
  { id: CLIENT_ID, email: 'client@marketplace.local', name: 'Ana Cliente', roles: ['CLIENT'] },
  {
    id: PROVIDER_ID,
    email: 'provider@marketplace.local',
    name: 'Paco Fontanero',
    roles: ['CLIENT', 'PROVIDER'],
  },
];

export const authDemoUsers: Seeder = {
  id: 'auth.demo-users',
  description: 'Two verified, active accounts QA and developers can sign in as (W2-T01 §8.4)',

  async run({ db, target, demoPassword }) {
    // Resolved **before** the loop, so a refusal happens before any row is written. The seeder runs
    // inside a transaction anyway, but a fixture that half-writes and then throws is harder to read
    // in a deploy log than one that refuses first.
    const password = await hashPassword(resolvePassword(target, demoPassword));
    const now = new Date();

    for (const user of USERS) {
      await db.user.create({
        data: {
          id: user.id,
          // Lowercase already. `app_user_email_lowercase` would reject anything else, which is the
          // point of §4.2 — the guarantee holds for our writes too, not only for better-auth's.
          email: user.email,
          name: user.name,
          roles: user.roles,
          // Verified, because `requireEmailVerification` is on (§4.6) and a seeded account nobody
          // can sign in as is a seeded account that wastes an afternoon.
          emailVerified: true,
          emailVerifiedAt: now,
          accounts: {
            create: {
              providerId: 'credential',
              // better-auth matches the credential account by `accountId === user.id`
              // (`sign-in.mjs:316`). Anything else here produces a user with a password row that
              // sign-in does not find.
              accountId: user.id,
              password,
            },
          },
        },
      });
    }
  },
};
