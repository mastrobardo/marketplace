import { hashPassword } from 'better-auth/crypto';

import { type Seeder } from './types.js';

/**
 * Two accounts a developer can log in as — `W2-T01` §8.4.
 *
 * `localOnly`, and the reason is not squeamishness about fake data: these rows have a **published
 * password**. `W0-T20` branches preview and staging from sanitised data, and a known-credential
 * account reaching an environment somebody demos is a real account somebody else can use.
 *
 * The hash comes from better-auth's own `hashPassword`, not from a reimplementation. A seeder that
 * hashes passwords its own way produces rows that look right and cannot sign in, and the symptom —
 * "the seeded user's password is wrong" — points at the password rather than at the algorithm.
 */
const PASSWORD = 'seed-password-local-only';

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
  description: 'Two verified, active accounts with a known local password (W2-T01 §8.4)',
  localOnly: true,

  async run({ db }) {
    const password = await hashPassword(PASSWORD);
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
