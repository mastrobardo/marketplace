/**
 * W1-T09 §7 AC14 — the factories against a real database.
 *
 * This is the one criterion `FactoryClient` cannot prove on its own. Because it is a *structural*
 * interface rather than `PrismaClient` (spec §4.3 Decision D), the recording-fake tests in
 * `packages/testing` prove the factories' logic but not that the interface still describes Prisma.
 * This file closes that gap, and also proves the builders' defaults satisfy constraints Prisma's
 * types know nothing about — the `postal_code` pattern, the radius bound, `lower(email)`.
 *
 * NOTE: not in the hand-maintained list in `.github/workflows/ci.yml`, so it does not run in the
 * `database` job — see spec §10 ESC-1 and issue #174.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import {
  buildUser,
  createAddress,
  createCategory,
  createClientProfile,
  createProviderCategory,
  createProviderProfile,
  createUser,
  resetFactories,
  type FactoryClient,
} from '@marketplace/testing';

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

function urlFor(database: string): string {
  const port = Number(dc('port', 'db', '5432').split(':').pop());
  return `postgres://marketplace:marketplace_local@127.0.0.1:${String(port)}/${database}`;
}

function migrated(name: string): string {
  psql('marketplace', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  psql('marketplace', `CREATE DATABASE "${name}"`);
  psql(name, 'CREATE EXTENSION IF NOT EXISTS postgis');
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', SCHEMA], {
    cwd: apiRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: urlFor(name) },
  });
  return name;
}

let prisma: PrismaClient | undefined;

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(() => {
  resetFactories();
});

describe.runIf(live)('live — the factories against a real database', () => {
  it('AC14 — every factory writes a row that reads back, through a real PrismaClient', async () => {
    const db = migrated('w1t09_factories');
    prisma = new PrismaClient({ datasourceUrl: urlFor(db) });

    // The assignment itself is half the criterion: if `FactoryClient` has drifted from Prisma's
    // shape, this line stops compiling, which is exactly the failure this test exists to catch.
    const client: FactoryClient = prisma as unknown as FactoryClient;

    const user = await createUser(client);
    const clientProfile = await createClientProfile(client);
    const provider = await createProviderProfile(client);
    const address = await createAddress(client, { userId: user.id });
    const category = await createCategory(client);
    const link = await createProviderCategory(client);

    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(
      await prisma.clientProfile.findUnique({ where: { id: clientProfile.id } }),
    ).not.toBeNull();
    expect(await prisma.providerProfile.findUnique({ where: { id: provider.id } })).not.toBeNull();
    expect(await prisma.address.findUnique({ where: { id: address.id } })).not.toBeNull();
    expect(await prisma.category.findUnique({ where: { id: category.id } })).not.toBeNull();
    expect(
      await prisma.providerCategory.findUnique({
        where: {
          providerProfileId_categoryId: {
            providerProfileId: link.providerProfileId,
            categoryId: link.categoryId,
          },
        },
      }),
    ).not.toBeNull();

    // The generated geography column is maintained by Postgres from the builder's coordinates.
    // A default that Prisma accepts but PostGIS cannot place would still be a broken fixture.
    expect(psql(db, `SELECT location IS NOT NULL FROM address WHERE id = '${address.id}'`)).toBe(
      't',
    );
  }, 180_000);

  it('AC14 — consecutive users do not collide on the lower(email) unique index', async () => {
    const db = migrated('w1t09_unique');
    prisma = new PrismaClient({ datasourceUrl: urlFor(db) });
    const client = prisma as unknown as FactoryClient;

    await createUser(client);
    await createUser(client);
    await createUser(client);
    expect(await prisma.user.count()).toBe(3);
  }, 180_000);

  it('AC14 — a builder default that violates a CHECK is rejected by the database, not silently kept', async () => {
    const db = migrated('w1t09_checks');
    prisma = new PrismaClient({ datasourceUrl: urlFor(db) });
    const client = prisma as unknown as FactoryClient;

    // Proves the CHECKs are live in this database, so the passing rows above mean something.
    const user = await createUser(client);
    await expect(
      createAddress(client, { userId: user.id, postalCode: 'NOT-A-POSTCODE' }),
    ).rejects.toThrow();
    await expect(
      createProviderProfile(client, { userId: buildUser().id, serviceRadiusMetres: -1 }),
    ).rejects.toThrow();
  }, 180_000);
});
