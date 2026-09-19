/**
 * `W0-T30` — a seed run that can reach a deployed database.
 *
 * Two separate refusals used to make `pnpm db:seed` useless outside a laptop, and this suite pins
 * both halves of the fix:
 *
 * 1. `assertSafeTarget` judged the **registry**, so one `localOnly` fixture refused the whole run —
 *    including seeders deliberately marked safe to travel. `--only` narrows what is judged (§3.1).
 * 2. `auth.demo-users` carried a password that is a literal in a public repository, which is why it
 *    was `localOnly` in the first place. It now resolves one from the environment and refuses to
 *    write the published one anywhere but a local host (§3.3).
 *
 * No database: `selectSeeders` and `assertSafeTarget` are pure, and the demo-user seeder is handed
 * a recorder. `apps/api/tests/db.test.ts` owns the unfiltered gate (AC18 there) and still asserts
 * it — this file must not weaken that.
 *
 * Spec: `docs/specs/S0/W0-T30-seed-a-deployed-database.md` §5.
 */
import { describe, expect, it } from 'vitest';

import { type Prisma } from '@prisma/client';
import { verifyPassword } from 'better-auth/crypto';

import { PUBLISHED_LOCAL_PASSWORD, authDemoUsers } from '../prisma/seed/auth-demo-users.js';
import { seeders } from '../prisma/seed/registry.js';
import { assertSafeTarget, selectSeeders } from '../prisma/seed/run.js';
import { type SeedContext, type Seeder } from '../prisma/seed/types.js';

const REMOTE_URL = 'postgres://u:p@db.example.com:5432/marketplace';
const LOCAL_URL = 'postgres://u:p@127.0.0.1:5432/marketplace';

function seeder(id: string, overrides: Partial<Seeder> = {}): Seeder {
  return {
    id,
    description: `test seeder ${id}`,
    run: async () => {},
    ...overrides,
  };
}

/** The registry's real shape: one `localOnly` fixture ahead of two seeders meant to travel. */
const REGISTRY: readonly Seeder[] = [
  seeder('auth.demo-users', { localOnly: true }),
  seeder('categories.taxonomy'),
  seeder('providers.demo-world'),
];

/** A transaction client that records `user.create` instead of writing it. */
function recorder(): { rows: Record<string, unknown>[]; db: Prisma.TransactionClient } {
  const rows: Record<string, unknown>[] = [];
  const db = {
    user: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        rows.push(data);
        return Promise.resolve(data);
      },
    },
  };
  return { rows, db: db as unknown as Prisma.TransactionClient };
}

function context(overrides: Partial<SeedContext> = {}): SeedContext {
  const { db } = recorder();
  return { db, target: { isLocal: true }, demoPassword: undefined, ...overrides };
}

/** The hash better-auth stored, dug out of the nested `accounts.create` the seeder writes. */
function storedHash(row: Record<string, unknown>): string {
  const accounts = row['accounts'] as { create: { password: string } };
  return accounts.create.password;
}

describe('AC1 — a filtered run reaches a remote host the unfiltered one could not', () => {
  it('passes the gate when the filter excludes every localOnly seeder', () => {
    const selected = selectSeeders(REGISTRY, ['categories.taxonomy', 'providers.demo-world']);
    expect(() => {
      assertSafeTarget(REMOTE_URL, selected);
    }).not.toThrow();
  });
});

describe('AC2 — the unfiltered gate is unchanged', () => {
  it('still refuses the whole registry against a remote host', () => {
    expect(() => {
      assertSafeTarget(REMOTE_URL, REGISTRY);
    }).toThrow(/SEED_UNSAFE_TARGET.*auth\.demo-users/s);
  });
});

describe('AC3 — the filter narrows what is judged, it does not grant an exemption', () => {
  it('still refuses a localOnly seeder that was named explicitly', () => {
    const selected = selectSeeders(REGISTRY, ['auth.demo-users']);
    expect(() => {
      assertSafeTarget(REMOTE_URL, selected);
    }).toThrow(/SEED_UNSAFE_TARGET.*auth\.demo-users/s);
  });
});

describe('AC4 — an unknown id is a hard failure, never a silent no-op', () => {
  it('names the id it could not find', () => {
    expect(() => {
      selectSeeders(REGISTRY, ['categories.taxonmy']);
    }).toThrow(/SEED_UNKNOWN_ID.*categories\.taxonmy/s);
  });

  it('reports every unknown id, not just the first', () => {
    expect(() => {
      selectSeeders(REGISTRY, ['nope.one', 'nope.two']);
    }).toThrow(/nope\.one.*nope\.two/s);
  });
});

describe('AC5 — an empty filter refuses rather than seeding nothing successfully', () => {
  it('throws', () => {
    expect(() => {
      selectSeeders(REGISTRY, []);
    }).toThrow(/SEED_UNKNOWN_ID/);
  });

  it('returns the whole registry when no filter is given at all', () => {
    expect(selectSeeders(REGISTRY, undefined)).toEqual(REGISTRY);
  });
});

describe('AC6 — registry order survives whatever order the CLI used', () => {
  it('ignores the order of the ids given', () => {
    const selected = selectSeeders(REGISTRY, ['providers.demo-world', 'categories.taxonomy']);
    expect(selected.map((entry) => entry.id)).toEqual([
      'categories.taxonomy',
      'providers.demo-world',
    ]);
  });

  it('deduplicates a repeated id', () => {
    const selected = selectSeeders(REGISTRY, ['categories.taxonomy', 'categories.taxonomy']);
    expect(selected.map((entry) => entry.id)).toEqual(['categories.taxonomy']);
  });
});

describe('AC8 — the published password never reaches a non-local database', () => {
  it('refuses when the target is remote and no password was supplied', async () => {
    const { rows, db } = recorder();
    await expect(
      authDemoUsers.run({ db, target: { isLocal: false }, demoPassword: undefined }),
    ).rejects.toThrow(/SEED_WEAK_CREDENTIAL/);
    expect(rows, 'a refused seeder must write nothing').toHaveLength(0);
  });
});

describe('AC9 — a supplied password is the one that is stored', () => {
  it('stores a hash that verifies against the supplied value and not the published one', async () => {
    const { rows, db } = recorder();
    await authDemoUsers.run({ db, target: { isLocal: false }, demoPassword: 'a-staging-secret-1' });

    expect(rows.length).toBeGreaterThan(0);
    const hash = storedHash(rows[0] as Record<string, unknown>);
    await expect(verifyPassword({ hash, password: 'a-staging-secret-1' })).resolves.toBe(true);
    await expect(verifyPassword({ hash, password: PUBLISHED_LOCAL_PASSWORD })).resolves.toBe(false);
  });
});

describe('AC10 — a developer on a laptop is unaffected', () => {
  it('uses the published password when the target is local and nothing was supplied', async () => {
    const { rows, db } = recorder();
    await authDemoUsers.run(context({ db }));

    const hash = storedHash(rows[0] as Record<string, unknown>);
    await expect(verifyPassword({ hash, password: PUBLISHED_LOCAL_PASSWORD })).resolves.toBe(true);
  });

  it('prefers a supplied password even locally', async () => {
    const { rows, db } = recorder();
    await authDemoUsers.run({ db, target: { isLocal: true }, demoPassword: 'local-override-99' });

    const hash = storedHash(rows[0] as Record<string, unknown>);
    await expect(verifyPassword({ hash, password: 'local-override-99' })).resolves.toBe(true);
  });
});

describe('AC11 — nothing in the real registry is localOnly any more', () => {
  it('leaves the flag in the type for W0-T20 and unused by the registry', () => {
    for (const entry of seeders) {
      expect(entry.localOnly, `${entry.id} still refuses to travel`).not.toBe(true);
    }
  });

  it('means the real registry passes the gate against a remote host unfiltered', () => {
    expect(() => {
      assertSafeTarget(REMOTE_URL, seeders);
    }).not.toThrow();
  });
});

describe('the filter is honest about a local target too', () => {
  it('allows a localOnly seeder against loopback, filtered or not', () => {
    expect(() => {
      assertSafeTarget(LOCAL_URL, selectSeeders(REGISTRY, ['auth.demo-users']));
    }).not.toThrow();
  });
});
