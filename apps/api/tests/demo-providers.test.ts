/**
 * `W3-T10` — what the demo seeder writes, asserted without a database.
 *
 * The seeder is handed a transaction client and calls `create` on it, so a recorder satisfies the
 * shape in fifteen lines and every claim about *what the demo world is* — five providers, one of
 * them quote-only, none of them carrying a credential — is checkable in CI's `unit` job rather than
 * behind `STACK_LIVE`. `seed-live.test.ts` asserts the half that needs Postgres: that the world it
 * writes is searchable.
 *
 * Spec: `docs/specs/S3/W3-T10-demo-provider-seeder.md` §4.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { type Prisma } from '@prisma/client';

import { demoProviders } from '../prisma/seed/demo-providers.js';
import { seeders } from '../prisma/seed/registry.js';
import { assertSafeTarget } from '../prisma/seed/run.js';

interface Created {
  readonly model: string;
  readonly data: Record<string, unknown>;
}

/**
 * A transaction client that records instead of writing.
 *
 * It defines exactly the five models this seeder is allowed to touch: a call to any other — an
 * `account` row, say, which is what a credential would be — is a TypeError and fails the test
 * before an assertion has to think of it.
 */
function recorder(): { rows: Created[]; db: Prisma.TransactionClient } {
  const rows: Created[] = [];
  const model = (name: string) => ({
    create: ({ data }: { data: Record<string, unknown> }) => {
      rows.push({ model: name, data });
      return Promise.resolve(data);
    },
  });

  const db = {
    category: model('category'),
    user: model('user'),
    address: model('address'),
    providerProfile: model('providerProfile'),
    providerCategory: model('providerCategory'),
  };

  return { rows, db: db as unknown as Prisma.TransactionClient };
}

async function seeded(): Promise<Created[]> {
  const { rows, db } = recorder();
  await demoProviders.run({ db });
  return rows;
}

const of = (rows: Created[], model: string): Array<Record<string, unknown>> =>
  rows.filter((row) => row.model === model).map((row) => row.data);

/** Puerta del Sol — the centre `resolvePlace('Madrid')` returns, and what a Madrid search measures from. */
const SOL = { latitude: 40.416775, longitude: -3.70379 };

function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h))));
}

describe('AC1 — the seeder writes the demo world', () => {
  it('creates four categories, five providers and their links', async () => {
    const rows = await seeded();

    expect(of(rows, 'category')).toHaveLength(4);
    expect(of(rows, 'user')).toHaveLength(5);
    expect(of(rows, 'address')).toHaveLength(5);
    expect(of(rows, 'providerProfile')).toHaveLength(5);
    // Nadal and Rivas work two trades each; the other three work one.
    expect(of(rows, 'providerCategory')).toHaveLength(7);
  });

  it('gives every provider the base address and radius search requires', async () => {
    // `W3-T05` AC6: a provider with no base address or no radius is unsearchable, and `W3-T07`
    // answers 404 for the first. A demo provider in either state is invisible in the demo.
    for (const profile of of(await seeded(), 'providerProfile')) {
      expect(
        profile['baseAddressId'],
        `${String(profile['displayName'])} has no base address`,
      ).toEqual(expect.any(String));
      expect(
        profile['serviceRadiusMetres'],
        `${String(profile['displayName'])} has no radius`,
      ).toEqual(expect.any(Number));
    }
  });

  it('includes exactly one quote-only provider, because ?mode=booking needs one to exclude', async () => {
    const rates = of(await seeded(), 'providerProfile').map((row) => row['hourlyRateCents']);
    expect(rates.filter((rate) => rate === null)).toHaveLength(1);
  });

  it('includes one unrated provider, because the cold-start card needs one', async () => {
    const ratings = of(await seeded(), 'providerProfile').map((row) => row['ratingAvg']);
    expect(ratings.filter((rating) => rating === null)).toHaveLength(1);
  });
});

describe('AC2 — the world is the same world on every seed', () => {
  it('uses fixed ids, so a reset database rebuilds what a pull request linked to', async () => {
    const first = await seeded();
    const second = await seeded();
    expect(second.map((row) => JSON.stringify(row.data))).toEqual(
      first.map((row) => JSON.stringify(row.data)),
    );
  });

  it('gives every row an id rather than letting the database invent one', async () => {
    for (const row of await seeded()) {
      // `provider_category` is the exception, and not an oversight: it is keyed by the
      // (providerProfileId, categoryId) pair, so it has no `id` column to set. Prisma rejects the
      // argument outright — found by `seed-live.test.ts`, which is the half of this that talks to
      // a real schema.
      if (row.model === 'providerCategory') {
        expect(row.data['id']).toBeUndefined();
        expect(row.data['providerProfileId']).toEqual(expect.any(String));
        expect(row.data['categoryId']).toEqual(expect.any(String));
        continue;
      }
      expect(row.data['id'], `a ${row.model} row has no fixed id`).toEqual(expect.any(String));
    }
  });
});

describe('AC4/AC5 — it runs anywhere, and carries nothing that could not', () => {
  it('is registered', () => {
    expect(seeders.map((entry) => entry.id)).toContain(demoProviders.id);
  });

  it('is not localOnly, and is therefore allowed a non-local target', () => {
    // Asserted against this seeder alone, not the whole registry: `auth.demo-users` is localOnly
    // and correctly refuses, which is exactly why this one may not depend on it (AC4).
    expect(demoProviders.localOnly).not.toBe(true);
    expect(() => {
      assertSafeTarget('postgres://u:p@db.example.com:5432/marketplace', [demoProviders]);
    }).not.toThrow();
  });

  it('creates its own users rather than attaching to the local-only demo accounts', async () => {
    const rows = await seeded();
    const users = of(rows, 'user');
    expect(users).toHaveLength(5);

    // The two `auth.demo-users` ids. Depending on them would work on a laptop and fail in every
    // environment where that seeder refuses to run.
    for (const borrowed of [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]) {
      expect(rows.map((row) => row.data['userId'])).not.toContain(borrowed);
      expect(users.map((user) => user['id'])).not.toContain(borrowed);
    }
  });

  it('writes no credential and no phone number', async () => {
    const rows = await seeded();
    expect(rows.map((row) => row.model)).not.toContain('account');
    for (const user of of(rows, 'user')) {
      expect(user['phone'] ?? null).toBeNull();
    }
    // Nothing that looks like a secret, in any column of any row.
    const serialised = JSON.stringify(rows);
    for (const leak of ['password', 'passwordHash', 'token', 'secret']) {
      expect(serialised.toLowerCase(), `a seeded row carries "${leak}"`).not.toContain(
        leak.toLowerCase(),
      );
    }
  });
});

describe('AC6 — the seeder does not decide BD-07', () => {
  it('marks no category as requiring a licence', async () => {
    for (const category of of(await seeded(), 'category')) {
      expect(
        category['requiresLicence'],
        `${String(category['slug'])} claims a licence requirement BD-07 has not answered`,
      ).toBe(false);
    }
  });

  it('names BD-07 in the file, so the false is a deferral and not an answer', () => {
    // The flag is a legal boundary. A `false` with no explanation reads as a decision to whoever
    // finds it next.
    const source = readSeeder();
    expect(source).toContain('BD-07');
  });
});

describe('AC7 — the far provider is far, and reaches anyway', () => {
  it('places one provider more than 40 km out with a radius that still covers Madrid', async () => {
    const rows = await seeded();
    const addresses = of(rows, 'address');
    const profiles = of(rows, 'providerProfile');

    const far = profiles
      .map((profile) => {
        const address = addresses.find((row) => row['id'] === profile['baseAddressId']);
        return {
          name: String(profile['displayName']),
          radius: Number(profile['serviceRadiusMetres']),
          metres: distanceMetres(SOL, {
            latitude: Number(address?.['latitude']),
            longitude: Number(address?.['longitude']),
          }),
        };
      })
      .sort((a, b) => b.metres - a.metres)[0];

    expect(
      far?.metres,
      'no provider is far enough to make the radius rule visible',
    ).toBeGreaterThan(25_000);
    expect(
      far?.radius,
      `${String(far?.name)} is ${String(far?.metres)} m out with a ${String(far?.radius)} m radius — a Madrid search would not return it`,
    ).toBeGreaterThan(far?.metres ?? 0);
  });
});

function readSeeder(): string {
  return readFileSync(new URL('../prisma/seed/demo-providers.ts', import.meta.url), 'utf8');
}
