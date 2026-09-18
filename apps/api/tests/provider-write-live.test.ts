/**
 * `W3-T02` — the write path against Postgres.
 *
 * `provider-write.test.ts` asserts who is refused and which bodies never reach the data layer; this
 * asserts the rows: that the first write creates three tables' worth of them, that an unchanged
 * address writes nothing, that a changed one is a *new* row rather than an edit of somebody's home,
 * that the category set is replaced rather than merged, and that a bad slug leaves the database
 * exactly as it was.
 *
 * `STACK_LIVE=1` and a `DATABASE_URL`, the same gate the other live suites use. The local port is
 * **5433**:
 *   STACK_LIVE=1 DATABASE_URL="postgres://marketplace:marketplace_local@127.0.0.1:5433/marketplace" \
 *     pnpm --filter @marketplace/api exec vitest run provider-write-live
 *
 * Spec: `docs/specs/S3/W3-T02-provider-profile-write.md` §3.5–§3.8, §7.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  ProviderProfileOwnSchema,
  ProviderProfileSchema,
  type ProviderProfileWrite,
} from '@marketplace/contracts';
import { createUser, type FactoryClient } from '@marketplace/testing';
import {
  createProviderOwnRepository,
  createProviderWriter,
} from '../src/modules/providers/write-repository.js';

const live = process.env['STACK_LIVE'] === '1';
const describeLive = live ? describe : describe.skip;

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const SCHEMA = join(apiRoot, 'prisma', 'schema.prisma');

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

/**
 * A migrated scratch database, as in `provider-live` and `search-live`.
 *
 * Not the shared one, and the reason is the factories: `packages/testing` generates **deterministic**
 * ids and emails from a sequence, so two live suites running in parallel against one database
 * collide on `app_user.email` — a unique violation inside `createUser`, a long way from anything
 * this suite is about.
 */
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

/** Puerta del Sol, at the precision a geocoder returns. */
const SOL = { latitude: 40.416775, longitude: -3.70379 };

let prisma: PrismaClient;
let write: ReturnType<typeof createProviderWriter>;
let own: ReturnType<typeof createProviderOwnRepository>;
let fontaneria: string;
let electricidad: string;
let retired: string;

function body(overrides: Partial<ProviderProfileWrite> = {}): ProviderProfileWrite {
  return {
    displayName: 'Fontanería Gómez',
    kind: 'PRO',
    bio: null,
    categories: ['w3t02-fontaneria'],
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
    ...overrides,
  };
}

/** A signed-up user is `auth`'s business; this suite needs only a row to own the profile. */
async function user(): Promise<string> {
  const created = await createUser(prisma as unknown as FactoryClient, {
    roles: ['CLIENT', 'PROVIDER'],
  });
  return created.id;
}

async function category(slug: string, isActive = true): Promise<string> {
  const row = await prisma.category.upsert({
    where: { slug },
    create: { slug, nameEs: slug, nameEn: slug, isActive },
    update: { isActive },
    select: { id: true },
  });
  return row.id;
}

beforeAll(async () => {
  if (!live) return;
  const db = migrated('w3t02_write');
  prisma = new PrismaClient({ datasources: { db: { url: urlFor(db) } } });
  write = createProviderWriter(prisma);
  own = createProviderOwnRepository(prisma);
  fontaneria = await category('w3t02-fontaneria');
  electricidad = await category('w3t02-electricidad');
  retired = await category('w3t02-retirada', false);
});

afterAll(async () => {
  if (!live) return;
  await prisma.$disconnect();
});

describeLive('W3-T02 §3.2 — the first write creates the profile', () => {
  it('AC4: writes a profile, an address and one row per category, all owned by that user', async () => {
    const userId = await user();

    const result = await write({ userId, locale: 'es', write: body() });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    const profile = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: {
        id: true,
        displayName: true,
        hourlyRateCents: true,
        baseAddress: { select: { userId: true, line1: true, countryCode: true } },
        categories: { select: { categoryId: true } },
      },
    });

    expect(profile.displayName).toBe('Fontanería Gómez');
    expect(profile.hourlyRateCents).toBe(4_200);
    expect(profile.baseAddress.userId, 'the address belongs to somebody else').toBe(userId);
    expect(profile.baseAddress.line1).toBe('Calle Mayor 1');
    // Not on the wire, defaulted by the column — the market decision is locked to ES.
    expect(profile.baseAddress.countryCode).toBe('ES');
    expect(profile.categories.map((row) => row.categoryId)).toEqual([fontaneria]);
  });

  it('AC5: GET /me has nothing before the first write, and everything after it', async () => {
    const userId = await user();

    expect(await own({ userId, locale: 'es' })).toBeUndefined();

    await write({ userId, locale: 'es', write: body() });
    const answer = await own({ userId, locale: 'es' });

    expect(ProviderProfileOwnSchema.safeParse(answer).success, JSON.stringify(answer)).toBe(true);
    // AC15: the owner sees what they typed — the lines and the precise point.
    expect(answer?.baseAddress).toMatchObject({ line1: 'Calle Mayor 1', ...SOL });
  });

  it('AC14: the answer is the public projection — coarse point, no address line', async () => {
    const userId = await user();

    const result = await write({ userId, locale: 'es', write: body() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ProviderProfileSchema.safeParse(result.profile).success).toBe(true);
    expect(JSON.stringify(result.profile)).not.toContain('Calle Mayor');
    expect(result.profile.point).toEqual({ latitude: 40.417, longitude: -3.704 });
  });

  it('AC13: a quote-only provider saves with a null rate', async () => {
    const userId = await user();

    await write({ userId, locale: 'es', write: body({ hourlyRateCents: null }) });

    const row = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: { hourlyRateCents: true },
    });
    expect(row.hourlyRateCents).toBeNull();
  });
});

describeLive('W3-T02 §3.5 — the address is replaced, never edited in place', () => {
  it('AC7: an identical address writes no new row', async () => {
    const userId = await user();
    await write({ userId, locale: 'es', write: body() });
    const first = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: { baseAddressId: true },
    });

    await write({ userId, locale: 'es', write: body({ displayName: 'Fontanería Gómez e Hijos' }) });

    const second = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: { baseAddressId: true },
    });
    expect(second.baseAddressId, 'an unchanged form moved the address').toBe(first.baseAddressId);
    expect(await prisma.address.count({ where: { userId } })).toBe(1);
  });

  it('AC8: a changed address is a new row, and the old one survives untouched', async () => {
    const userId = await user();
    await write({ userId, locale: 'es', write: body() });
    const before = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: { baseAddressId: true },
    });

    await write({
      userId,
      locale: 'es',
      write: body({ baseAddress: { ...body().baseAddress, line1: 'Plaza Mayor 2' } }),
    });

    const after = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: { baseAddressId: true, baseAddress: { select: { line1: true } } },
    });

    expect(after.baseAddressId).not.toBe(before.baseAddressId);
    expect(after.baseAddress.line1).toBe('Plaza Mayor 2');

    // The old row is still there, unchanged: it may be where they live, and `client_profile` may
    // point at it. Deleting user data on an edit is `W2-T08`'s decision, not a side effect.
    const old = await prisma.address.findUniqueOrThrow({
      where: { id: before.baseAddressId },
      select: { line1: true },
    });
    expect(old.line1).toBe('Calle Mayor 1');
  });
});

describeLive('W3-T02 §3.7 — the category set is replaced', () => {
  it('AC6: removed slugs are gone, added ones present, and no pair is duplicated', async () => {
    const userId = await user();
    await write({ userId, locale: 'es', write: body() });

    await write({
      userId,
      locale: 'es',
      write: body({ categories: ['w3t02-electricidad'] }),
    });

    const profile = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: { id: true, categories: { select: { categoryId: true } } },
    });
    expect(profile.categories.map((row) => row.categoryId)).toEqual([electricidad]);
  });

  it('AC9: the same body twice leaves the same rows — idempotent by construction', async () => {
    const userId = await user();
    const payload = body({ categories: ['w3t02-fontaneria', 'w3t02-electricidad'] });

    await write({ userId, locale: 'es', write: payload });
    const first = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: { id: true, baseAddressId: true, categories: { select: { categoryId: true } } },
    });

    await write({ userId, locale: 'es', write: payload });
    const second = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: { id: true, baseAddressId: true, categories: { select: { categoryId: true } } },
    });

    expect(second.id).toBe(first.id);
    expect(second.baseAddressId).toBe(first.baseAddressId);
    expect(second.categories).toHaveLength(2);
    expect(await prisma.address.count({ where: { userId } })).toBe(1);
  });
});

describeLive('W3-T02 §3.8 — a refusal writes nothing at all', () => {
  it('AC10: an unknown slug names itself, and no row is created', async () => {
    const userId = await user();
    const addressesBefore = await prisma.address.count();

    const result = await write({
      userId,
      locale: 'es',
      write: body({ categories: ['w3t02-fontaneria', 'w3t02-inexistente'] }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unknownSlugs).toEqual(['w3t02-inexistente']);
    expect(await prisma.providerProfile.count({ where: { userId } })).toBe(0);
    expect(await prisma.address.count(), 'a refused write left an address behind').toBe(
      addressesBefore,
    );
  });

  it('AC11: a retired category is refused the same way — it is not one they may join', async () => {
    const userId = await user();

    const result = await write({
      userId,
      locale: 'es',
      write: body({ categories: ['w3t02-retirada'] }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unknownSlugs).toEqual(['w3t02-retirada']);
    expect(retired, 'the fixture category was never created').toMatch(/^[0-9a-f-]{36}$/);
  });

  it('AC10: a bad slug on an *existing* profile changes nothing', async () => {
    const userId = await user();
    await write({ userId, locale: 'es', write: body() });
    const before = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: { displayName: true, baseAddressId: true },
    });

    const result = await write({
      userId,
      locale: 'es',
      write: body({ displayName: 'Nombre Nuevo', categories: ['w3t02-inexistente'] }),
    });

    expect(result.ok).toBe(false);
    const after = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId },
      select: { displayName: true, baseAddressId: true },
    });
    expect(after.displayName, 'the transaction leaked a partial update').toBe(before.displayName);
    expect(after.baseAddressId).toBe(before.baseAddressId);
  });
});
