/**
 * `W3-T05` — the search against a real PostGIS.
 *
 * What `search.test.ts` cannot prove: that `ST_DWithin` against each provider's own
 * `service_radius_metres` selects the set §2.3 describes, that the keyset pages over a total order,
 * that the facets count the matched set rather than the page, and that it is all one statement.
 *
 * Gated on `STACK_LIVE=1` like every other live suite. CI's `database` job runs the whole
 * `apps/api` suite under that flag, so this runs there without `ci.yml` naming it.
 *
 * Spec: `docs/specs/S5/W3-T05-geo-search.md` §3.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import {
  buildProviderProfile,
  createAddress,
  createCategory,
  createProviderCategory,
  createUser,
  type FactoryClient,
} from '@marketplace/testing';
import { PAGE_LIMIT_DEFAULT, type SearchResult } from '@marketplace/contracts';
import { createSearchRepository, type SearchCriteria } from '../src/modules/search/repository.js';
import { resolvePlace } from '../src/modules/search/places.js';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const SCHEMA = join(apiRoot, 'prisma', 'schema.prisma');

const live = process.env['STACK_LIVE'] === '1';

function dc(...args: string[]): string {
  return execFileSync('docker', ['compose', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function psql(database: string, sql: string): string {
  return dc('exec', '-T', 'db', 'psql', '-U', 'marketplace', '-d', database, '-tAc', sql);
}

function hostPort(): number {
  return Number(dc('port', 'db', '5432').split(':').pop());
}

function urlFor(database: string): string {
  return `postgres://marketplace:marketplace_local@127.0.0.1:${String(hostPort())}/${database}`;
}

/** A migrated scratch database, as in `core-schema.test.ts` and `audit-record.test.ts`. */
function migrated(name: string): string {
  psql('marketplace', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  psql('marketplace', `CREATE DATABASE "${name}"`);
  psql(name, 'CREATE EXTENSION IF NOT EXISTS postgis');
  const output = execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', SCHEMA], {
    cwd: apiRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: urlFor(name) },
  });
  expect(output).toMatch(/successfully applied|No pending migrations/);
  return name;
}

/** The centre every case below is measured from — what `resolvePlace('Madrid')` returns. */
const CENTRE = resolvePlace('Madrid') ?? { latitude: 40.4168, longitude: -3.7038 };

/** One degree of latitude is ~111.32 km everywhere, which is precise enough to place a fixture. */
function northOf(metres: number): { latitude: number; longitude: number } {
  return { latitude: CENTRE.latitude + metres / 111_320, longitude: CENTRE.longitude };
}

interface Fixture {
  readonly id: string;
  readonly displayName: string;
}

const criteria = (overrides: Partial<SearchCriteria> = {}): SearchCriteria => ({
  centre: CENTRE,
  limit: PAGE_LIMIT_DEFAULT,
  sort: [
    { field: 'distanceMetres', direction: 'asc' },
    { field: 'id', direction: 'asc' },
  ],
  locale: 'es',
  ...overrides,
});

describe.runIf(live)('live — geo search against PostGIS', () => {
  let prisma: PrismaClient;
  let client: FactoryClient;
  let fontaneria: string;
  let electricidad: string;
  const seeded: Record<string, Fixture> = {};

  /**
   * One world, built once. Every provider below exists to make exactly one row of §2.3's table
   * fail or pass, so a broken predicate names itself.
   */
  async function provider(
    key: string,
    options: {
      readonly metres: number | null;
      readonly radius: number | null;
      readonly hourlyRateCents?: number | null;
      readonly categoryId?: string;
      readonly kind?: 'MANITAS' | 'PRO';
    },
  ): Promise<void> {
    const user = await createUser(client);
    const address =
      options.metres === null
        ? undefined
        : await createAddress(client, { userId: user.id, ...northOf(options.metres) });

    /**
     * The builder supplies the defaults; Prisma applies the nullable fields.
     *
     * Not a preference — `ProviderProfileInput` types `serviceRadiusMetres` and `hourlyRateCents`
     * as non-nullable `number` and has no `baseAddressId` at all, while the schema makes all three
     * nullable/optional. So the factories cannot currently express a provider with no radius, a
     * quote-only provider, or a provider with a base address — which is every case this suite
     * exists to distinguish. Widening `packages/testing` is `agent-qa`'s call, not a change to
     * smuggle in here; noted in the session file.
     */
    const profile = await prisma.providerProfile.create({
      data: {
        ...buildProviderProfile({
          userId: user.id,
          displayName: key,
          kind: options.kind ?? 'MANITAS',
        }),
        serviceRadiusMetres: options.radius,
        hourlyRateCents: options.hourlyRateCents === undefined ? 3_500 : options.hourlyRateCents,
        baseAddressId: address?.id ?? null,
      },
    });

    if (options.categoryId !== undefined) {
      await createProviderCategory(client, {
        providerProfileId: profile.id,
        categoryId: options.categoryId,
      });
    }

    seeded[key] = { id: profile.id, displayName: key };
  }

  beforeAll(async () => {
    const db = migrated('w3t05_search');
    prisma = new PrismaClient({ datasourceUrl: urlFor(db) });
    client = prisma as unknown as FactoryClient;

    fontaneria = (
      await createCategory(client, {
        slug: 'fontaneria',
        nameEs: 'Fontanería',
        nameEn: 'Plumbing',
        position: 1,
      })
    ).id;
    electricidad = (
      await createCategory(client, {
        slug: 'electricidad',
        nameEs: 'Electricidad',
        nameEn: 'Electrical',
        position: 2,
      })
    ).id;

    // Covers the centre from close by — the ordinary case.
    await provider('near-covers', { metres: 1_000, radius: 15_000, categoryId: fontaneria });
    // Far away but travels far: §2.3's whole point.
    await provider('far-covers', { metres: 60_000, radius: 80_000, categoryId: fontaneria });
    // Closer, but will not come this far.
    await provider('near-refuses', { metres: 5_000, radius: 2_000, categoryId: fontaneria });
    // "Not set" is neither zero nor infinite.
    await provider('no-radius', { metres: 1_000, radius: null, categoryId: fontaneria });
    // No base address at all — `schema.prisma:127` says not searchable.
    await provider('no-address', { metres: null, radius: 15_000, categoryId: fontaneria });
    // Quote-only: nothing to book against.
    await provider('quote-only', {
      metres: 2_000,
      radius: 15_000,
      hourlyRateCents: null,
      categoryId: fontaneria,
    });
    // A different trade, to prove `what` filters and to give the facets a second bucket.
    await provider('electrician', {
      metres: 3_000,
      radius: 15_000,
      categoryId: electricidad,
      kind: 'PRO',
    });
  }, 120_000);

  const names = (rows: readonly SearchResult[]): string[] => rows.map((row) => row.displayName);

  it('AC5 — a provider whose radius reaches the centre is returned, however far away', async () => {
    const { rows } = await createSearchRepository(prisma)(criteria());

    expect(names(rows)).toContain('far-covers');
  });

  it('AC5 — a nearer provider whose radius does not reach the centre is not', async () => {
    const { rows } = await createSearchRepository(prisma)(criteria());

    expect(names(rows)).not.toContain('near-refuses');
  });

  it('AC6 — a null radius and a missing base address are both unsearchable', async () => {
    const { rows } = await createSearchRepository(prisma)(criteria());

    expect(names(rows)).not.toContain('no-radius');
    expect(names(rows)).not.toContain('no-address');
  });

  it('AC7 — `what` filters by category slug', async () => {
    const { rows } = await createSearchRepository(prisma)(criteria({ what: 'electricidad' }));

    expect(names(rows)).toEqual(['electrician']);
  });

  it('AC7 — `mode=booking` excludes a provider with no hourly rate', async () => {
    const all = await createSearchRepository(prisma)(criteria());
    const booking = await createSearchRepository(prisma)(criteria({ mode: 'booking' }));

    expect(names(all.rows)).toContain('quote-only');
    expect(names(booking.rows)).not.toContain('quote-only');
  });

  it('AC9 — results ascend by distance, and the far one really is far', async () => {
    const { rows } = await createSearchRepository(prisma)(criteria());
    const distances = rows.map((row) => row.distanceMetres);

    expect([...distances]).toEqual([...distances].sort((a, b) => a - b));
    const far = rows.find((row) => row.displayName === 'far-covers');
    expect(far?.distanceMetres).toBeGreaterThan(55_000);
    expect(far?.distanceMetres).toBeLessThan(65_000);
  });

  it('AC9 — `-distanceMetres` reverses the order', async () => {
    const { rows } = await createSearchRepository(prisma)(
      criteria({
        sort: [
          { field: 'distanceMetres', direction: 'desc' },
          { field: 'id', direction: 'asc' },
        ],
      }),
    );

    expect(rows[0]?.displayName).toBe('far-covers');
  });

  it('AC10 — walking every page yields each provider exactly once', async () => {
    const repository = createSearchRepository(prisma);
    const all = await repository(criteria());
    const expected = names(all.rows).sort();

    const seen: string[] = [];
    let cursor: SearchCriteria['cursor'];

    for (let guard = 0; guard < 10; guard += 1) {
      const page = await repository(criteria({ limit: 1, cursor }));
      const first = page.rows[0];
      if (first === undefined) break;
      seen.push(first.displayName);
      // The repository over-fetches, so a second row means there is another page.
      if (page.rows.length < 2) break;
      cursor = { v: [first.distanceMetres], id: first.id };
    }

    expect(seen.sort()).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('AC12 — facets count the matched set, not the page', async () => {
    const { rows, facets } = await createSearchRepository(prisma)(criteria({ limit: 1 }));

    expect(rows.length).toBeLessThanOrEqual(2);
    const plumbing = facets.categories.find((facet) => facet.slug === 'fontaneria');
    // near-covers, far-covers and quote-only all match and all carry the slug.
    expect(plumbing?.count).toBe(3);
    expect(facets.kinds.find((facet) => facet.kind === 'PRO')?.count).toBe(1);
  });

  it('AC13 — no response row carries an address line or an account id', async () => {
    const { rows } = await createSearchRepository(prisma)(criteria());

    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'bio',
          'categories',
          'city',
          'displayName',
          'distanceMetres',
          'hourlyRateCents',
          'id',
          'kind',
          'point',
          'province',
          'ratingAvg',
          'ratingCount',
        ].sort(),
      );
    }
  });

  it('AC13 — the pin is coarse, never the stored coordinate', async () => {
    const { rows } = await createSearchRepository(prisma)(criteria());
    const near = rows.find((row) => row.displayName === 'near-covers');

    expect(near?.point.latitude).toBe(Number(near?.point.latitude.toFixed(3)));
    expect(near?.point.latitude).not.toBe(CENTRE.latitude + 1_000 / 111_320);
  });

  it('AC15 — Accept-Language selects the category name column', async () => {
    const es = await createSearchRepository(prisma)(criteria({ what: 'fontaneria' }));
    const en = await createSearchRepository(prisma)(criteria({ what: 'fontaneria', locale: 'en' }));

    expect(es.rows[0]?.categories[0]?.name).toBe('Fontanería');
    expect(en.rows[0]?.categories[0]?.name).toBe('Plumbing');
    expect(en.facets.categories[0]?.name).toBe('Plumbing');
  });

  it('AC16 — one statement per search, with no per-provider category query', async () => {
    const counted = new PrismaClient({
      datasourceUrl: urlFor('w3t05_search'),
      log: [{ emit: 'event', level: 'query' }],
    });
    const statements: string[] = [];
    counted.$on('query', (event) => {
      // Prisma emits its own transaction bookkeeping; only real statements are the subject.
      if (!/^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE)/i.test(event.query)) statements.push(event.query);
    });

    try {
      await createSearchRepository(counted)(criteria());
      expect(statements).toHaveLength(1);
    } finally {
      await counted.$disconnect();
    }
  });
});
