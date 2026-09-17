/**
 * `W3-T07` — the provider profile against a real Postgres.
 *
 * What `provider.test.ts` cannot prove: that the two `Decimal` columns cross the boundary as JSON
 * numbers, that the category join filters `is_active` and orders by `position`, that a null radius
 * and a quote-only rate are both served rather than excluded, that a provider with no base address
 * is "nothing to serve" rather than a 500, and that no response carries an address line.
 *
 * Gated on `STACK_LIVE=1` like every other live suite. CI's `database` job runs the whole
 * `apps/api` suite under that flag, so this runs there without `ci.yml` naming it.
 *
 * Spec: `docs/specs/S3/W3-T07-provider-profile-api.md` §3.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import {
  createAddress,
  createCategory,
  createProviderCategory,
  createProviderProfile,
  createUser,
  type FactoryClient,
} from '@marketplace/testing';
import { ProviderProfileSchema } from '@marketplace/contracts';
import { createProviderRepository } from '../src/modules/providers/repository.js';

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

/** A migrated scratch database, as in `search-live.test.ts`. */
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

/** Puerta del Sol — the stored coordinate, at full precision, so coarsening has work to do. */
const SOL = { latitude: 40.416775, longitude: -3.70379 };

describe.runIf(live)('live — provider profile against Postgres', () => {
  let prisma: PrismaClient;
  let client: FactoryClient;
  let repository: ReturnType<typeof createProviderRepository>;

  const seeded: Record<string, string> = {};

  /**
   * One world, built once. Every provider exists to make exactly one criterion pass or fail, so a
   * broken projection names itself.
   *
   * The factories express all of this directly now — `baseAddressId`, a null radius and a null
   * rate are ordinary overrides since `MEM-2026-09-17-10` was closed in this PR. `W3-T05` had to
   * reach past them to Prisma for exactly these rows.
   */
  async function provider(
    key: string,
    options: {
      readonly withAddress?: boolean;
      readonly serviceRadiusMetres?: number | null;
      readonly hourlyRateCents?: number | null;
      readonly categoryIds?: readonly string[];
      readonly ratingAvg?: string | null;
      readonly kind?: 'MANITAS' | 'PRO';
    } = {},
  ): Promise<void> {
    const user = await createUser(client);
    const address =
      options.withAddress === false
        ? undefined
        : await createAddress(client, {
            userId: user.id,
            line1: 'Calle Secreta 7',
            // No `line2`: `AddressInput` has no such field, while the column is `line2 String?` —
            // the same factory gap `MEM-2026-09-17-10` names, in a second builder. Widening it is
            // not this ticket's (`agent-qa` owns shared fixtures), and `line1` is the column
            // `W1-T05` §8 names first; the key-for-key assertion below excludes `line2` anyway.
            city: 'Madrid',
            province: 'Madrid',
            ...SOL,
          });

    const profile = await createProviderProfile(client, {
      userId: user.id,
      displayName: key,
      kind: options.kind ?? 'MANITAS',
      baseAddressId: address?.id ?? null,
      serviceRadiusMetres:
        options.serviceRadiusMetres === undefined ? 15_000 : options.serviceRadiusMetres,
      hourlyRateCents: options.hourlyRateCents === undefined ? 3_500 : options.hourlyRateCents,
    });

    // `ratingAvg` is `Decimal(3,2)` and not in the factories at all (`W12-T12` Q3), so it is
    // applied here — the one field this suite still reaches past them for.
    if (options.ratingAvg !== undefined && options.ratingAvg !== null) {
      await prisma.providerProfile.update({
        where: { id: profile.id },
        data: { ratingAvg: options.ratingAvg, ratingCount: 12 },
      });
    }

    for (const categoryId of options.categoryIds ?? []) {
      await createProviderCategory(client, { providerProfileId: profile.id, categoryId });
    }

    seeded[key] = profile.id;
  }

  beforeAll(async () => {
    const db = migrated('w3t07_provider');
    prisma = new PrismaClient({ datasourceUrl: urlFor(db) });
    client = prisma as unknown as FactoryClient;
    repository = createProviderRepository(prisma);

    const fontaneria = (
      await createCategory(client, {
        slug: 'fontaneria',
        nameEs: 'Fontanería',
        nameEn: 'Plumbing',
        position: 2,
      })
    ).id;
    const electricidad = (
      await createCategory(client, {
        slug: 'electricidad',
        nameEs: 'Electricidad',
        nameEn: 'Electrical',
        position: 1,
      })
    ).id;
    const retired = (
      await createCategory(client, {
        slug: 'obsoleta',
        nameEs: 'Obsoleta',
        nameEn: 'Retired',
        position: 3,
        isActive: false,
      })
    ).id;

    await provider('ordinary', {
      categoryIds: [fontaneria, electricidad, retired],
      ratingAvg: '4.75',
      kind: 'PRO',
    });
    await provider('no-radius', { serviceRadiusMetres: null });
    await provider('quote-only', { hourlyRateCents: null });
    await provider('no-address', { withAddress: false });
  }, 120_000);

  // ── AC3 — a uuid nobody has ───────────────────────────────────────────────────────────────

  it('has nothing to serve for a uuid that is not a provider', async () => {
    const answer = await repository({
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      locale: 'es',
    });

    expect(answer).toBeUndefined();
  });

  // ── AC4 — the transitional 404 (§2.4) ─────────────────────────────────────────────────────

  it('has nothing to serve for a provider with no base address', async () => {
    // Not a 500: `city`, `province` and `point` are non-null in the contract, and such a provider
    // is already unsearchable (`schema.prisma:213`). The product rule that removes this state is
    // `W3-T02`; until then the endpoint must not fall over on it.
    const answer = await repository({ id: seeded['no-address'] ?? '', locale: 'es' });

    expect(answer).toBeUndefined();
  });

  // ── AC5, AC6 — a profile is not a search hit ──────────────────────────────────────────────

  it('serves a provider whose service radius is not set', async () => {
    const answer = await repository({ id: seeded['no-radius'] ?? '', locale: 'es' });

    expect(answer?.serviceRadiusMetres).toBeNull();
    expect(() => ProviderProfileSchema.parse(answer)).not.toThrow();
  });

  it('serves a quote-only provider', async () => {
    const answer = await repository({ id: seeded['quote-only'] ?? '', locale: 'es' });

    expect(answer?.hourlyRateCents).toBeNull();
    expect(() => ProviderProfileSchema.parse(answer)).not.toThrow();
  });

  // ── AC7, AC8 — the columns that do not survive JSON untouched ─────────────────────────────

  it('converts both Decimal columns to numbers', async () => {
    const answer = await repository({ id: seeded['ordinary'] ?? '', locale: 'es' });

    // A `Decimal` serialises to JSON as an object, not a number, so this is what stands between
    // the column and a response the contract rejects.
    expect(typeof answer?.ratingAvg).toBe('number');
    expect(answer?.ratingAvg).toBe(4.75);
    expect(typeof answer?.point.latitude).toBe('number');
    expect(typeof answer?.point.longitude).toBe('number');
    expect(JSON.parse(JSON.stringify(answer))).toMatchObject({ ratingAvg: 4.75 });
  });

  it('serves `memberSince` as an ISO-8601 UTC instant', async () => {
    const answer = await repository({ id: seeded['ordinary'] ?? '', locale: 'es' });

    expect(answer?.memberSince).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  // ── AC9, AC10 — the category join ─────────────────────────────────────────────────────────

  it('lists only active categories, ordered by position', async () => {
    const answer = await repository({ id: seeded['ordinary'] ?? '', locale: 'es' });

    expect(answer?.categories).toEqual([
      { slug: 'electricidad', name: 'Electricidad' },
      { slug: 'fontaneria', name: 'Fontanería' },
    ]);
  });

  it('resolves category names to the requested locale', async () => {
    const answer = await repository({ id: seeded['ordinary'] ?? '', locale: 'en' });

    expect(answer?.categories.map((category) => category.name)).toEqual(['Electrical', 'Plumbing']);
  });

  // ── AC11 — the privacy projection, against real columns ───────────────────────────────────

  it('never carries an address line, a user id or a base address id', async () => {
    const answer = await repository({ id: seeded['ordinary'] ?? '', locale: 'es' });
    const serialised = JSON.stringify(answer);

    // The row really does have them — the fixture sets `line1` and `line2` — so this asserts the
    // projection, not the absence of data. `W1-T05` §8 states the rule; this is its test.
    expect(serialised).not.toContain('Calle Secreta');
    expect(Object.keys(answer ?? {})).not.toContain('userId');
    expect(Object.keys(answer ?? {})).not.toContain('baseAddressId');
    expect(Object.keys(answer ?? {})).not.toContain('line1');
    expect(Object.keys(answer ?? {})).not.toContain('line2');
  });

  it('coarsens the stored coordinate rather than publishing it', async () => {
    const answer = await repository({ id: seeded['ordinary'] ?? '', locale: 'es' });

    expect(answer?.point).toEqual({ latitude: 40.417, longitude: -3.704 });
    expect(answer?.point.latitude).not.toBe(SOL.latitude);
  });

  it('serves a body the contract accepts, field for field', async () => {
    const answer = await repository({ id: seeded['ordinary'] ?? '', locale: 'es' });

    // `strictObject`: an extra column reaching this far would throw here rather than ship.
    expect(() => ProviderProfileSchema.parse(answer)).not.toThrow();
  });
});
