/**
 * `W3-T01` — the taxonomy in Postgres, and the endpoint over it.
 *
 * `categories.test.ts` asserts the HTTP boundary against a stub and `categories-seed.test.ts`
 * asserts the constant against a recorder. This asserts the things only a database can answer: that
 * `pnpm db:seed` writes the tree, that running it twice is safe, that retiring a trade does not take
 * a provider's history with it, that `W3-T02`'s write path accepts every slug in the table, and that
 * the compliance query returns exactly five rows.
 *
 * `STACK_LIVE=1`, the same gate every other live suite uses. CI's `database` job runs the whole
 * `apps/api` suite under that flag, so this runs there without `ci.yml` naming it:
 *   STACK_LIVE=1 pnpm --filter @marketplace/api exec vitest run categories-live
 *
 * Spec: `docs/specs/S3/W3-T01-category-tree.md` §3.6, §3.8, §7, §8.3, §8.4.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { type FastifyInstance } from 'fastify';
import { CategoryListSchema, type ProviderProfileWrite } from '@marketplace/contracts';
import { createUser, type FactoryClient } from '@marketplace/testing';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createCategoryRepository } from '../src/modules/categories/repository.js';
import { createProviderWriter } from '../src/modules/providers/write-repository.js';
import { TAXONOMY, categoryTaxonomy } from '../prisma/seed/categories.js';
import { demoProviders } from '../prisma/seed/demo-providers.js';
import { seeders } from '../prisma/seed/registry.js';
import { runSeeders } from '../prisma/seed/run.js';

const live = process.env['STACK_LIVE'] === '1';
const describeLive = live ? describe : describe.skip;

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const SCHEMA = join(apiRoot, 'prisma', 'schema.prisma');

const GATED = ['climatizacion', 'electricidad', 'gas', 'placas-solares', 'telecomunicaciones'];

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

function urlFor(database: string): string {
  const port = Number(dc('port', 'db', '5432').split(':').pop());
  return `postgres://marketplace:marketplace_local@127.0.0.1:${String(port)}/${database}`;
}

/** Its own scratch database — the factories' deterministic emails collide across parallel suites. */
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

const SOL = { latitude: 40.416775, longitude: -3.70379 };

const leafSlugs = () => TAXONOMY.filter((row) => row.parent !== null).map((row) => row.slug);

let prisma: PrismaClient;
let app: FastifyInstance;
let database: string;

async function list(headers: Record<string, string> = {}) {
  const response = await app.inject({ method: 'GET', url: '/api/categories', headers });
  return { status: response.statusCode, body: response.body, json: response.json() as unknown };
}

beforeAll(async () => {
  if (!live) return;
  database = migrated('w3t01_categories');
  prisma = new PrismaClient({ datasources: { db: { url: urlFor(database) } } });

  /**
   * The **real registry**, not a hand-picked list. A seeder that is not wired in is a seeder that
   * does not exist, and `pnpm db:seed` is what a developer actually runs — which is also what makes
   * this the live half of AC18: if the order were wrong, `providers.demo-world` would throw here.
   */
  const result = await runSeeders({ databaseUrl: urlFor(database), seeders, client: prisma });
  expect(result.ran, 'the taxonomy seeder did not run').toContain(categoryTaxonomy.id);
  expect(result.ran, 'the demo seeder did not run').toContain(demoProviders.id);

  app = buildApp({
    config: loadConfig({
      DATABASE_URL: urlFor(database),
      BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
      BETTER_AUTH_URL: 'http://127.0.0.1:5173',
      LOG_LEVEL: 'silent',
    }),
    categories: createCategoryRepository(prisma),
  });
  await app.ready();
}, 180_000);

afterAll(async () => {
  if (!live) return;
  await app.close();
  await prisma.$disconnect();
});

describeLive('AC15 — pnpm db:seed writes the tree', () => {
  it('creates two roots and twenty leaves, and nothing else', async () => {
    expect(await prisma.category.count()).toBe(TAXONOMY.length);
    expect(await prisma.category.count({ where: { parentId: null } })).toBe(2);
    expect(await prisma.category.count({ where: { NOT: { parentId: null } } })).toBe(20);
  });

  it('gives the four adopted slugs their original uuids', async () => {
    // `MEM-2026-09-18-1`: a uuid in a screenshot still resolves after `db:reset && db:seed`. The
    // demo world's `provider_category` rows point at these four, so anything else orphans them.
    const rows = await prisma.category.findMany({
      where: { slug: { in: ['fontaneria', 'electricidad', 'cerrajeria', 'climatizacion'] } },
      select: { slug: true, id: true },
      orderBy: { slug: 'asc' },
    });

    expect(rows).toEqual([
      { slug: 'cerrajeria', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003' },
      { slug: 'climatizacion', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004' },
      { slug: 'electricidad', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002' },
      { slug: 'fontaneria', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001' },
    ]);
  });

  it('AC17 — the demo world exists and added no categories of its own', async () => {
    expect(await prisma.providerProfile.count()).toBe(5);
    expect(await prisma.providerCategory.count()).toBe(7);
    // The count above already pins it: four extra rows would make this `TAXONOMY.length + 4`.
    expect(await prisma.category.count()).toBe(TAXONOMY.length);
  });

  it('points every leaf at a real parent row', async () => {
    const orphans = await prisma.category.count({
      where: { parentId: { notIn: (await prisma.category.findMany({ where: { parentId: null }, select: { id: true } })).map((row) => row.id) }, NOT: { parentId: null } },
    });
    expect(orphans).toBe(0);
  });
});

describeLive('AC16 — seeding twice is safe', () => {
  it('skips the seeder on a second db:seed and writes nothing new', async () => {
    const before = await prisma.category.count();
    const result = await runSeeders({ databaseUrl: urlFor(database), seeders, client: prisma });

    expect(result.skipped).toContain(categoryTaxonomy.id);
    expect(await prisma.category.count()).toBe(before);
  });

  it('is idempotent when re-run directly, which is what the upsert is actually for', async () => {
    /**
     * Run past the ledger, deliberately. `run.ts` skips a seeder whose ledger row exists, so the
     * test above asserts the *ledger* — not idempotency. This calls the seeder itself a second time
     * against rows that already exist, which is the `category_slug_key` collision §8.4 describes.
     */
    const before = await prisma.category.count();
    await categoryTaxonomy.run({ db: prisma as unknown as Prisma.TransactionClient });

    expect(await prisma.category.count()).toBe(before);
  });
});

describeLive('AC20, AC21 — the compliance question is one query', () => {
  it('AC20 — exactly five rows carry requires_licence', async () => {
    const rows = await prisma.$queryRaw<{ slug: string }[]>`
      SELECT slug FROM category WHERE requires_licence ORDER BY slug
    `;
    expect(rows.map((row) => row.slug)).toEqual(GATED);
  });

  it('AC21 — no root and no parent row carries it', async () => {
    const gatedParents = await prisma.$queryRaw<{ slug: string }[]>`
      SELECT c.slug
      FROM category c
      WHERE c.requires_licence
        AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM category k WHERE k.parent_id = c.id))
    `;
    expect(gatedParents.map((row) => row.slug), 'a family is gated as a whole').toEqual([]);
  });

  it('AC21 — reforma-integral is not gated, however wide it is', async () => {
    const row = await prisma.category.findUnique({
      where: { slug: 'reforma-integral' },
      select: { requiresLicence: true },
    });
    expect(row?.requiresLicence).toBe(false);
  });
});

describeLive('AC1, AC13 — the endpoint over the real table', () => {
  it('serves every active leaf in one response, and no root', async () => {
    const { status, json } = await list();
    expect(status).toBe(200);

    const { items } = CategoryListSchema.parse(json);
    expect(items).toHaveLength(20);
    expect(items.map((item) => item.slug)).not.toContain('reformas');
    expect(Object.keys(json as Record<string, unknown>)).toEqual(['items']);
  });

  it('AC9, AC10 — is ordered by family, then position, then slug, and is stable', async () => {
    const expected = await prisma.$queryRaw<{ slug: string }[]>`
      SELECT c.slug FROM category c
      JOIN category p ON p.id = c.parent_id
      WHERE c.is_active AND c.parent_id IS NOT NULL
      ORDER BY p.position, c.position, c.slug
    `;

    const first = await list();
    const second = await list();

    expect(CategoryListSchema.parse(first.json).items.map((item) => item.slug)).toEqual(
      expected.map((row) => row.slug),
    );
    expect(second.body).toBe(first.body);
  });

  it('serves each family as a contiguous run, not interleaved', async () => {
    // The review finding, against the real twenty rows: `position` restarts per sibling set, so a
    // sort on it alone produced `fontaneria, reforma-integral, albanileria, electricidad, …`.
    const { items } = CategoryListSchema.parse((await list()).json);
    const rows = await prisma.category.findMany({
      where: { isActive: true, NOT: { parentId: null } },
      select: { slug: true, parent: { select: { slug: true } } },
    });
    const familyOf = new Map(rows.map((row) => [row.slug, row.parent?.slug ?? '']));

    const families = items.map((item) => familyOf.get(item.slug) ?? '');
    const runs = families.filter((family, index) => family !== families[index - 1]);

    expect(runs, 'a family is split across the list').toEqual(['reformas', 'mantenimiento']);
  });

  it('AC5, AC6 — resolves the name pair per request, and never ships both', async () => {
    const es = CategoryListSchema.parse((await list()).json);
    const en = CategoryListSchema.parse((await list({ 'accept-language': 'en-GB' })).json);

    expect(en.items.map((item) => item.slug)).toEqual(es.items.map((item) => item.slug));
    expect(en.items.map((item) => item.name)).not.toEqual(es.items.map((item) => item.name));

    const bySlug = new Map(en.items.map((item) => [item.slug, item.name]));
    expect(bySlug.get('fontaneria')).toBe('Plumbing');
    expect(JSON.stringify(en.items)).not.toContain('nameEs');
  });

  it('carries the licence flag onto the wire, which is what makes a badge possible', async () => {
    const { items } = CategoryListSchema.parse((await list()).json);
    const gated = items.filter((item) => item.requiresLicence).map((item) => item.slug);
    expect(gated.sort()).toEqual(GATED);
  });
});

describeLive('AC19 — the write path and this table agree (§8.5)', () => {
  it('accepts every leaf slug in the taxonomy, all twenty at once', async () => {
    /**
     * Through `createProviderWriter` rather than `PUT /api/providers/me`, the way
     * `provider-write-live.test.ts` does it: the slug resolution this criterion is about lives in
     * the writer, and `provider-write.test.ts` already pins that the route reaches it. Building a
     * better-auth session here would assert `W2-T03`, not this.
     *
     * Twenty is also exactly `PROVIDER_CATEGORY_MAX`, so this doubles as the bound §8.3 flagged:
     * a provider *can* now claim the entire taxonomy and still validate.
     */
    const write = createProviderWriter(prisma);
    const user = await createUser(prisma as unknown as FactoryClient, {
      roles: ['CLIENT', 'PROVIDER'],
    });

    const body: ProviderProfileWrite = {
      displayName: 'Todo Oficios',
      kind: 'PRO',
      bio: null,
      categories: leafSlugs(),
      serviceRadiusMetres: 15_000,
      hourlyRateCents: 4_200,
      baseAddress: {
        label: 'Taller',
        line1: 'Calle Mayor 1',
        line2: null,
        city: 'Madrid',
        province: 'Madrid',
        postalCode: '28013',
        ...SOL,
      },
    };

    const result = await write({ userId: user.id, locale: 'es', write: body });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(
      await prisma.providerCategory.count({ where: { providerProfile: { userId: user.id } } }),
    ).toBe(20);
  });
});

describeLive('AC12 — retirement takes a trade off the wire and nothing else (§3.8)', () => {
  it('keeps the provider_category row when its category is deactivated', async () => {
    const user = await createUser(prisma as unknown as FactoryClient, {
      roles: ['CLIENT', 'PROVIDER'],
    });
    const address = await prisma.address.create({
      data: {
        userId: user.id,
        label: 'Base',
        line1: 'Calle Retirada 1',
        city: 'Madrid',
        province: 'Madrid',
        postalCode: '28013',
        countryCode: 'ES',
        ...SOL,
      },
      select: { id: true },
    });
    const profile = await prisma.providerProfile.create({
      data: {
        userId: user.id,
        kind: 'MANITAS',
        displayName: 'Manitas Retirada',
        baseAddressId: address.id,
        serviceRadiusMetres: 10_000,
      },
      select: { id: true },
    });
    const mudanzas = await prisma.category.findUniqueOrThrow({
      where: { slug: 'mudanzas' },
      select: { id: true },
    });
    await prisma.providerCategory.create({
      data: { providerProfileId: profile.id, categoryId: mudanzas.id },
    });

    await prisma.category.update({ where: { slug: 'mudanzas' }, data: { isActive: false } });

    try {
      // Retirement is a decision to stop offering the trade, not to rewrite who did it. The foreign
      // key is `onDelete: Restrict` for exactly this, and `is_active` is the reversible half.
      expect(
        await prisma.providerCategory.count({
          where: { providerProfileId: profile.id, categoryId: mudanzas.id },
        }),
      ).toBe(1);

      const { items } = CategoryListSchema.parse((await list()).json);
      expect(items.map((item) => item.slug), 'a retired trade is still on the wire').not.toContain(
        'mudanzas',
      );
      expect(items).toHaveLength(19);
    } finally {
      await prisma.category.update({ where: { slug: 'mudanzas' }, data: { isActive: true } });
    }
  });
});
