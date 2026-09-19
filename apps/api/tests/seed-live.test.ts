/**
 * `W3-T10` — the seeded demo world, through the real endpoints.
 *
 * `demo-providers.test.ts` asserts what the seeder writes. This asserts the thing that actually
 * matters on the day the storefront's mocks are deleted: that a visitor arriving at the dev server
 * — or at a preview — **sees providers**. It runs the real seed pipeline against a migrated
 * database and then drives `buildApp` over it with `inject`, so the route, the repository, PostGIS
 * and the contract are all in the path.
 *
 * It is also where `apps/web/tests/mocks.test.ts` AC14 comes to live: *a search body satisfies
 * `SearchResponseSchema`*. That was asserted through the MSW handler this ticket deletes, and the
 * live search suite asserted fields rather than the whole body — spec §3.1 is the mapping.
 *
 * Gated on `STACK_LIVE=1` like every other live suite. CI's `database` job runs the whole
 * `apps/api` suite under that flag, so this runs there without `ci.yml` naming it.
 *
 * Spec: `docs/specs/S3/W3-T10-demo-provider-seeder.md` §4.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { type FastifyInstance } from 'fastify';
import { ProviderProfileSchema, SearchResponseSchema } from '@marketplace/contracts';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createSearchRepository } from '../src/modules/search/repository.js';
import { createProviderRepository } from '../src/modules/providers/repository.js';
import { seeders } from '../prisma/seed/registry.js';
import { demoProviders } from '../prisma/seed/demo-providers.js';
import { TAXONOMY } from '../prisma/seed/categories.js';
import { runSeeders } from '../prisma/seed/run.js';

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

/** A migrated scratch database, as in `search-live.test.ts` and `provider-live.test.ts`. */
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

describe.runIf(live)(
  'live — the demo world, end to end',
  () => {
    let prisma: PrismaClient;
    let app: FastifyInstance;
    let database: string;

    const search = async (query: string): Promise<{ status: number; body: unknown }> => {
      const response = await app.inject({ method: 'GET', url: `/api/search?${query}` });
      return { status: response.statusCode, body: response.json() };
    };

    const page = async (query: string) => SearchResponseSchema.parse((await search(query)).body);

    beforeAll(async () => {
      database = migrated('w3t10_seed');
      prisma = new PrismaClient({ datasourceUrl: urlFor(database) });

      /**
       * The **real registry**, not a hand-picked list. A seeder that is not wired in is a seeder that
       * does not exist, and `pnpm db:seed` is what a developer actually runs.
       *
       * `auth.demo-users` is `localOnly` and this target is loopback, so it runs here too — which is
       * the arrangement AC4 cares about: the demo providers must not be *relying* on its rows.
       */
      const result = await runSeeders({ databaseUrl: urlFor(database), seeders, client: prisma });
      expect(result.ran, 'the demo seeder did not run').toContain(demoProviders.id);

      app = buildApp({
        config: loadConfig({
          DATABASE_URL: urlFor(database),
          BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
          BETTER_AUTH_URL: 'http://127.0.0.1:5173',
        }),
        search: createSearchRepository(prisma),
        providers: createProviderRepository(prisma),
      });
      await app.ready();
    }, 120_000);

    describe('AC1/AC3 — the seeder is ledgered, and runs once', () => {
      it('wrote the world it claims', async () => {
        // The categories are `categories.taxonomy`'s since `W3-T01` — two roots and twenty trades,
        // of which this seeder resolves four. It creates none of them, which is why this asserts
        // the taxonomy's size rather than `4 + 18`: a demo seeder that added one would show up here
        // as a number nobody could explain.
        expect(await prisma.category.count()).toBe(TAXONOMY.length);
        expect(await prisma.providerProfile.count()).toBe(5);
        expect(await prisma.providerCategory.count()).toBe(7);
      });

      it('skips itself on a second run and writes nothing new', async () => {
        const before = await prisma.providerProfile.count();
        const result = await runSeeders({ databaseUrl: urlFor(database), seeders, client: prisma });

        expect(result.skipped).toContain(demoProviders.id);
        expect(result.ran).not.toContain(demoProviders.id);
        expect(await prisma.providerProfile.count()).toBe(before);
      });
    });

    describe('AC7 — a visitor searching Madrid sees the demo world', () => {
      it('returns every seeded provider', async () => {
        const body = await page('where=28013');
        expect(
          body.items.map((item) => item.displayName).sort(),
          'the storefront would show an empty results page',
        ).toHaveLength(5);
      });

      it('orders them by distance, nearest first', async () => {
        const distances = (await page('where=28013')).items.map((item) => item.distanceMetres);
        expect(distances).toEqual([...distances].sort((a, b) => a - b));
      });

      it('includes the far provider, because its own radius reaches Madrid', async () => {
        // `W3-T05`'s headline rule — *who will travel to me*, not *who is near me* — made visible in
        // the demo data rather than only in a fixture built for the assertion.
        const items = (await page('where=28013')).items;
        const far = items[items.length - 1];

        // ~29.8 km by PostGIS, from Alcalá's real coordinates. Twice the 15 km radius every other
        // seeded provider covers, so a distance filter would drop it and the radius rule keeps it.
        expect(far?.distanceMetres).toBeGreaterThan(25_000);
        expect(far?.city).toBe('Alcalá de Henares');
      });
    });

    describe('AC8 — the filters have something to filter', () => {
      it('`what=fontaneria` returns the two plumbers and nobody else', async () => {
        const body = await page('where=28013&what=fontaneria');
        expect(body.items).toHaveLength(2);
        for (const item of body.items) {
          expect(item.categories.map((category) => category.slug)).toContain('fontaneria');
        }
      });

      it('`mode=booking` excludes the quote-only provider', async () => {
        const all = await page('where=28013');
        const booking = await page('where=28013&mode=booking');

        expect(all.items.some((item) => item.hourlyRateCents === null)).toBe(true);
        expect(booking.items.every((item) => item.hourlyRateCents !== null)).toBe(true);
        expect(booking.items).toHaveLength(all.items.length - 1);
      });
    });

    describe('AC9 — every seeded provider has a profile page that works', () => {
      it('answers 200 with a body the contract accepts, for all five', async () => {
        const ids = (await page('where=28013')).items.map((item) => item.id);
        expect(ids).toHaveLength(5);

        for (const id of ids) {
          const response = await app.inject({ method: 'GET', url: `/api/providers/${id}` });
          expect(response.statusCode, `provider ${id} is not servable`).toBe(200);

          const parsed = ProviderProfileSchema.safeParse(response.json());
          expect(
            parsed.success
              ? []
              : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          ).toEqual([]);
        }
      });
    });

    describe('AC11 — mocks.test.ts AC14, re-homed on the real endpoint', () => {
      it('a search body satisfies SearchResponseSchema, whole', async () => {
        // The criterion `W12-T08` wrote and the MSW handler answered until this ticket. The live
        // search suite asserts fields; nothing asserted the entire body against the schema.
        const { status, body } = await search('where=28013');
        expect(status).toBe(200);

        const parsed = SearchResponseSchema.safeParse(body);
        expect(
          parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        ).toEqual([]);
      });

      it('a rejected query is still a 400 envelope over real data', async () => {
        const { status, body } = await search('what=FONTANERIA');
        expect(status).toBe(400);
        expect(body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      });
    });
  },
  180_000,
);
