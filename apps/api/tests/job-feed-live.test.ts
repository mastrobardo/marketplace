/**
 * `W4-T07` — the feed against Postgres.
 *
 * The contract suite asserts shapes and `job-feed.test.ts` asserts the boundary; this asserts the
 * things only a database can. That the radius is the **provider's own**, so raising it changes what
 * they see and nothing else does. That a job with no address is in nobody's feed. That the keyset
 * over `published_at` serves every row exactly once even when two jobs share a millisecond. And that
 * the body on the wire carries no coordinate, no street and nothing about the client.
 *
 * `STACK_LIVE=1` and a running compose stack:
 *   STACK_LIVE=1 pnpm --filter @marketplace/api exec vitest run job-feed-live
 *
 * Spec: `docs/specs/S4/W4-T07-provider-job-feed.md` §5.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { JobFeedPageSchema, JobFeedQuerySchema, type JobFeedItem } from '@marketplace/contracts';
import {
  createAddress,
  createProviderProfile,
  createUser,
  type FactoryClient,
} from '@marketplace/testing';

import { createJobRepository, type JobRepository } from '../src/modules/jobs/repository.js';
import {
  createJobFeedRepository,
  type JobFeedRepository,
} from '../src/modules/jobs/feed-repository.js';
import { createQuoteRepository, type QuoteRepository } from '../src/modules/quotes/repository.js';
import { seeders } from '../prisma/seed/registry.js';
import { runSeeders } from '../prisma/seed/run.js';

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

/** Puerta del Sol, which is where the provider works from. */
const BASE = { latitude: 40.416775, longitude: -3.70379 } as const;
/** Two kilometres north. A pure latitude offset, so the expected distance is checkable in SQL. */
const NEAR = { latitude: 40.43478, longitude: -3.70379 } as const;
/** Forty kilometres north: outside a 15 km radius, inside a 50 km one. */
const FAR = { latitude: 40.77678, longitude: -3.70379 } as const;

const FIRST_PAGE = JobFeedQuerySchema.parse({});

let prisma: PrismaClient;
let jobs: JobRepository;
let quotes: QuoteRepository;
let feed: JobFeedRepository;
let database: string;

let clientUser: string;
let clientAddress: string;
let farAddress: string;
let providerUser: string;
let providerProfile: string;
let categoryIds: Record<string, string>;

/** Prefixed, so nothing here can collide with another suite's taxonomy in a shared database. */
const SLUGS = {
  fontaneria: 'w4t07-fontaneria',
  electricidad: 'w4t07-electricidad',
  gas: 'w4t07-gas',
  cerrajeria: 'w4t07-cerrajeria',
} as const;

async function category(slug: string, requiresLicence = false): Promise<string> {
  const row = await prisma.category.upsert({
    where: { slug },
    create: { slug, nameEs: slug, nameEn: slug, requiresLicence },
    update: { requiresLicence },
    select: { id: true },
  });
  return row.id;
}

/** An `OPEN` job at an address, naming trades. Published through the repository, like a client. */
async function openJob(options: {
  slugs: readonly string[];
  addressId?: string | null;
  title?: string;
  publishedAt?: Date;
}): Promise<string> {
  const draft = await jobs.createDraft(clientUser, {
    categorySlugs: [...options.slugs],
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.addressId === undefined || options.addressId === null
      ? {}
      : { addressId: options.addressId }),
  });
  await jobs.publish(clientUser, draft.id);
  if (options.publishedAt !== undefined) {
    // The feed's paging order, pinned. `publish()` stamps `now`, which is right in production and
    // useless for asserting an order, so the timestamp is set afterwards rather than faked in.
    await prisma.job.update({
      where: { id: draft.id },
      data: { publishedAt: options.publishedAt },
    });
  }
  return draft.id;
}

async function read(query = FIRST_PAGE): Promise<readonly JobFeedItem[]> {
  const page = await feed.read(providerUser, query);
  // Parsed exactly as the route parses it: the invariants (§3.1) are asserted on every read here,
  // not only in the one test that names them.
  return JobFeedPageSchema.parse(page).items;
}

async function ids(query = FIRST_PAGE): Promise<string[]> {
  return (await read(query)).map((item) => item.id);
}

/** What Postgres itself says the distance is, so the API is compared with the source of the number. */
async function distanceFrom(latitude: number, longitude: number): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ metres: number }[]>(
    `SELECT ROUND(ST_Distance(
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography))::int AS metres`,
    longitude,
    latitude,
    BASE.longitude,
    BASE.latitude,
  );
  return Number(rows[0]?.metres);
}

describeLive('live — the job feed', () => {
  beforeAll(async () => {
    database = migrated('w4t07_feed');
    prisma = new PrismaClient({ datasourceUrl: urlFor(database) });
    jobs = createJobRepository(prisma);
    quotes = createQuoteRepository(prisma);
    feed = createJobFeedRepository(prisma);

    categoryIds = {
      [SLUGS.fontaneria]: await category(SLUGS.fontaneria),
      [SLUGS.electricidad]: await category(SLUGS.electricidad, true),
      [SLUGS.gas]: await category(SLUGS.gas, true),
      [SLUGS.cerrajeria]: await category(SLUGS.cerrajeria),
    };

    const client = await createUser(prisma as unknown as FactoryClient, { roles: ['CLIENT'] });
    clientUser = client.id;
    clientAddress = (
      await createAddress(prisma as unknown as FactoryClient, { userId: clientUser, ...NEAR })
    ).id;
    farAddress = (
      await createAddress(prisma as unknown as FactoryClient, { userId: clientUser, ...FAR })
    ).id;

    const provider = await createUser(prisma as unknown as FactoryClient, { roles: ['PROVIDER'] });
    providerUser = provider.id;
    const base = await createAddress(prisma as unknown as FactoryClient, {
      userId: providerUser,
      ...BASE,
    });
    providerProfile = (
      await createProviderProfile(prisma as unknown as FactoryClient, {
        userId: providerUser,
        baseAddressId: base.id,
        serviceRadiusMetres: 15_000,
      })
    ).id;

    // The trades this provider lists: plumbing and electrics. Not `gas`, which is the licensed gap
    // AC4 is about, and not `cerrajeria`, which AC3 is about.
    for (const slug of [SLUGS.fontaneria, SLUGS.electricidad]) {
      await prisma.providerCategory.create({
        data: { providerProfileId: providerProfile, categoryId: categoryIds[slug] as string },
      });
    }
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('AC1 — lists an open job in trade and in range, with the distance Postgres computed', async () => {
    const job = await openJob({ slugs: [SLUGS.fontaneria], addressId: clientAddress });

    const items = await read();
    const row = items.find((item) => item.id === job);
    expect(row, 'the job was not in the feed').toBeDefined();
    expect(row?.distanceMetres).toBe(await distanceFrom(NEAR.latitude, NEAR.longitude));
    expect(row?.location).toEqual({ city: 'Madrid', province: 'Madrid', postalCode: '28001' });
    expect(row?.coverage).toEqual([
      {
        slug: SLUGS.fontaneria,
        nameEs: SLUGS.fontaneria,
        nameEn: SLUGS.fontaneria,
        requiresLicence: false,
        listedByProvider: true,
      },
    ]);
    expect(row?.myQuote).toBeNull();
  });

  it('AC2 — the radius is the provider’s own: raising it is what changes the feed', async () => {
    const job = await openJob({ slugs: [SLUGS.fontaneria], addressId: farAddress });
    expect(await ids()).not.toContain(job);

    await prisma.providerProfile.update({
      where: { id: providerProfile },
      data: { serviceRadiusMetres: 50_000 },
    });
    try {
      expect(await ids()).toContain(job);
    } finally {
      await prisma.providerProfile.update({
        where: { id: providerProfile },
        data: { serviceRadiusMetres: 15_000 },
      });
    }
  });

  it('AC3 — a job in a trade the provider does not list is absent, however close', async () => {
    const job = await openJob({ slugs: [SLUGS.cerrajeria], addressId: clientAddress });
    expect(await ids()).not.toContain(job);
  });

  it('AC4 — a job naming a regulated trade the provider does not list is present and labelled', async () => {
    // The intersection is the match (§2.1): plumbing is shared, gas is not, and the row says so
    // rather than being withheld. This is the label that replaced the charter's gate (§2.2).
    const job = await openJob({
      slugs: [SLUGS.fontaneria, SLUGS.gas],
      addressId: clientAddress,
    });

    const row = (await read()).find((item) => item.id === job);
    expect(row).toBeDefined();
    const gas = row?.coverage.find((entry) => entry.slug === SLUGS.gas);
    expect(gas).toEqual({
      slug: SLUGS.gas,
      nameEs: SLUGS.gas,
      nameEn: SLUGS.gas,
      requiresLicence: true,
      listedByProvider: false,
    });
  });

  it('AC5 — a job with no address is in nobody’s feed', async () => {
    const job = await openJob({ slugs: [SLUGS.fontaneria], addressId: null });
    const row = await prisma.job.findUniqueOrThrow({
      where: { id: job },
      select: { status: true, addressId: true },
    });
    // The premise of the test, asserted: this really is an OPEN job with no address (`W4-T01` §2.5).
    expect(row).toEqual({ status: 'OPEN', addressId: null });
    expect(await ids()).not.toContain(job);
  });

  it('AC6 — a draft is absent, because it is invisible to everyone but its owner', async () => {
    const draft = await jobs.createDraft(clientUser, {
      categorySlugs: [SLUGS.fontaneria],
      addressId: clientAddress,
    });
    expect(await ids()).not.toContain(draft.id);
  });

  it('AC7 — a cancelled job is absent, in range and in trade', async () => {
    const job = await openJob({ slugs: [SLUGS.fontaneria], addressId: clientAddress });
    expect(await ids()).toContain(job);
    await jobs.cancel(clientUser, job, {});
    expect(await ids()).not.toContain(job);
  });

  it('AC8 — a job the caller has already quoted stays in the feed, marked', async () => {
    const job = await openJob({ slugs: [SLUGS.fontaneria], addressId: clientAddress });
    const quote = await quotes.create(providerUser, job, {
      amountCents: 42_000,
      validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    expect(quote).not.toBeNull();

    const row = (await read()).find((item) => item.id === job);
    expect(row?.myQuote).toEqual({ id: quote?.id, status: 'PENDING' });
  });

  it('AC9 — a lapsed quote reads EXPIRED, which is how a provider learns the slot is free', async () => {
    const job = await openJob({ slugs: [SLUGS.fontaneria], addressId: clientAddress });
    const quote = await quotes.create(providerUser, job, {
      amountCents: 42_000,
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    // Backdated in the row rather than by waiting a minute: `quoteStatusOf` is arithmetic over the
    // column, and the column is what the feed reads.
    await prisma.quote.update({
      where: { id: quote?.id as string },
      data: { validUntil: new Date(Date.now() - 86_400_000) },
    });

    const row = (await read()).find((item) => item.id === job);
    expect(row?.myQuote?.status).toBe('EXPIRED');
  });

  it('AC10 — pages the whole set exactly once, with no row served twice and none skipped', async () => {
    const database2 = migrated('w4t07_paging');
    const scratch = new PrismaClient({ datasourceUrl: urlFor(database2) });
    try {
      const repository = createJobFeedRepository(scratch);
      const jobRepository = createJobRepository(scratch);
      const trade = await scratch.category.create({
        data: { slug: SLUGS.fontaneria, nameEs: 'f', nameEn: 'f' },
        select: { id: true },
      });

      const owner = await createUser(scratch as unknown as FactoryClient, { roles: ['CLIENT'] });
      const where = await createAddress(scratch as unknown as FactoryClient, {
        userId: owner.id,
        ...NEAR,
      });
      const reader = await createUser(scratch as unknown as FactoryClient, { roles: ['PROVIDER'] });
      const base = await createAddress(scratch as unknown as FactoryClient, {
        userId: reader.id,
        ...BASE,
      });
      const profile = await createProviderProfile(scratch as unknown as FactoryClient, {
        userId: reader.id,
        baseAddressId: base.id,
        serviceRadiusMetres: 15_000,
      });
      await scratch.providerCategory.create({
        data: { providerProfileId: profile.id, categoryId: trade.id },
      });

      const expected: string[] = [];
      for (let n = 0; n < 25; n += 1) {
        const draft = await jobRepository.createDraft(owner.id, {
          categorySlugs: [SLUGS.fontaneria],
          addressId: where.id,
          title: `Trabajo ${String(n)}`,
        });
        await jobRepository.publish(owner.id, draft.id);
        await scratch.job.update({
          where: { id: draft.id },
          // Distinct, descending in creation order, so the expected page order is knowable.
          data: { publishedAt: new Date(Date.UTC(2026, 8, 1, 0, n)) },
        });
        expected.push(draft.id);
      }

      const first = JobFeedPageSchema.parse(await repository.read(reader.id, FIRST_PAGE));
      expect(first.items).toHaveLength(20);
      expect(first.page.hasMore).toBe(true);
      expect(first.page.nextCursor).not.toBeNull();

      const second = JobFeedPageSchema.parse(
        await repository.read(
          reader.id,
          JobFeedQuerySchema.parse({ cursor: first.page.nextCursor as string }),
        ),
      );
      expect(second.items).toHaveLength(5);
      expect(second.page.hasMore).toBe(false);

      const served = [...first.items, ...second.items].map((item) => item.id);
      expect(new Set(served).size, 'a row was served twice').toBe(25);
      expect([...served].sort()).toEqual([...expected].sort());
      // Newest first, which is the order the index and the cursor agree on.
      expect(served[0]).toBe(expected[expected.length - 1]);
    } finally {
      await scratch.$disconnect();
    }
  }, 240_000);

  it('AC11 — two jobs sharing a millisecond are each served exactly once', async () => {
    const stamp = new Date('2026-09-26T08:00:00.000Z');
    const a = await openJob({
      slugs: [SLUGS.fontaneria],
      addressId: clientAddress,
      publishedAt: stamp,
    });
    const b = await openJob({
      slugs: [SLUGS.fontaneria],
      addressId: clientAddress,
      publishedAt: stamp,
    });

    const one = JobFeedPageSchema.parse(
      await feed.read(providerUser, JobFeedQuerySchema.parse({ limit: '1' })),
    );
    const seen = [one.items[0]?.id];
    let cursor = one.page.nextCursor;
    // Walk the whole feed a row at a time. The tiebreaker is the only thing separating `a` and `b`,
    // so a keyset that compared the timestamp alone would loop or skip here (Decision F).
    while (cursor !== null && seen.length < 40) {
      const next = JobFeedPageSchema.parse(
        await feed.read(providerUser, JobFeedQuerySchema.parse({ limit: '1', cursor })),
      );
      seen.push(next.items[0]?.id);
      cursor = next.page.nextCursor;
    }

    expect(seen.filter((id) => id === a)).toHaveLength(1);
    expect(seen.filter((id) => id === b)).toHaveLength(1);
  });

  it('AC14 — a provider with no profile is told to create one, not handed an empty page', async () => {
    const stranger = await createUser(prisma as unknown as FactoryClient, { roles: ['PROVIDER'] });
    await expect(feed.read(stranger.id, FIRST_PAGE)).rejects.toThrow(/provider profile/i);
  });

  it('AC15 — a profile with no radius is unserviceable, and says so', async () => {
    await prisma.providerProfile.update({
      where: { id: providerProfile },
      data: { serviceRadiusMetres: null },
    });
    try {
      await expect(feed.read(providerUser, FIRST_PAGE)).rejects.toThrow(/how far/i);
    } finally {
      await prisma.providerProfile.update({
        where: { id: providerProfile },
        data: { serviceRadiusMetres: 15_000 },
      });
    }
  });

  it('AC17 — the rows carry no coordinate, no street and nothing about the client', async () => {
    await openJob({
      slugs: [SLUGS.fontaneria],
      addressId: clientAddress,
      title: 'Fuga en la cocina',
    });
    const items = await read();
    expect(items.length).toBeGreaterThan(0);

    const serialised = JSON.stringify(items);
    for (const forbidden of ['latitude', 'longitude', 'line1', 'line2', 'clientId', 'userId']) {
      expect(serialised, `${forbidden} reached the wire`).not.toContain(forbidden);
    }
    // And the values, not only the key names: a rename would defeat the check above.
    expect(serialised).not.toContain('40.43');
    expect(serialised).not.toContain(clientUser);
  });
});

/**
 * AC21 — the seeded world, read through the repository as the account a person can sign in as.
 *
 * `demo-feed.test.ts` asserts what the seeder writes; this asserts the only thing that matters on the
 * day somebody opens `/es/feed` on a preview: that **the three jobs §3.4's table marks *yes* are the
 * three that come back**. A recorder cannot answer that — the radius, the intersection and the
 * addressless row are all PostGIS and SQL.
 *
 * `W4-T04`'s lesson, applied: seed a real database and read the rows back rather than trusting the
 * recorder.
 */
describeLive('live — the seeded feed a person can sign in and read', () => {
  let seededPrisma: PrismaClient;

  beforeAll(async () => {
    const name = migrated('w4t07_seeded');
    seededPrisma = new PrismaClient({ datasourceUrl: urlFor(name) });
    await runSeeders({ databaseUrl: urlFor(name), seeders, client: seededPrisma });
  }, 300_000);

  afterAll(async () => {
    await seededPrisma?.$disconnect();
  });

  it('returns exactly the jobs in the demo provider’s trades and radius, newest first', async () => {
    const paco = await seededPrisma.user.findUniqueOrThrow({
      where: { email: 'provider@marketplace.local' },
      select: { id: true },
    });

    const page = JobFeedPageSchema.parse(
      await createJobFeedRepository(seededPrisma).read(paco.id, FIRST_PAGE),
    );

    expect(page.items.map((item) => item.title)).toEqual([
      // Plumbing + gas: matched on plumbing, labelled on gas.
      'Radiadores y caldera',
      // Regulated and listed.
      'Cuadro eléctrico y diferencial',
      // Already quoted, and still here.
      'Cambiar el termo eléctrico',
    ]);

    // The four that must not be there, each for its own reason (§3.4).
    const titles = page.items.map((item) => item.title);
    expect(titles).not.toContain('Aire acondicionado en el salón'); // out of radius
    expect(titles).not.toContain('Cerradura forzada'); // not his trade
    expect(titles).not.toContain('Pintar el pasillo'); // no address
    expect(titles).not.toContain('Cambiar el plato de ducha'); // cancelled
  });

  it('labels the regulated trade he does not list, and only that one', async () => {
    const paco = await seededPrisma.user.findUniqueOrThrow({
      where: { email: 'provider@marketplace.local' },
      select: { id: true },
    });
    const page = JobFeedPageSchema.parse(
      await createJobFeedRepository(seededPrisma).read(paco.id, FIRST_PAGE),
    );

    const boiler = page.items.find((item) => item.title === 'Radiadores y caldera');
    expect(boiler?.coverage.find((entry) => entry.slug === 'gas')).toEqual({
      slug: 'gas',
      // The taxonomy's own names, not a guess: `categories.taxonomy` calls it *Instalaciones de gas*.
      nameEs: 'Instalaciones de gas',
      nameEn: 'Gas installations',
      requiresLicence: true,
      listedByProvider: false,
    });
    expect(boiler?.coverage.find((entry) => entry.slug === 'fontaneria')?.listedByProvider).toBe(
      true,
    );

    const board = page.items.find((item) => item.title === 'Cuadro eléctrico y diferencial');
    // Regulated **and** listed: the label is a fact about coverage, not a warning about legality.
    expect(board?.coverage[0]).toMatchObject({ requiresLicence: true, listedByProvider: true });
  });

  it('marks the job he has already quoted, and the quote is still live', async () => {
    const paco = await seededPrisma.user.findUniqueOrThrow({
      where: { email: 'provider@marketplace.local' },
      select: { id: true },
    });
    const page = JobFeedPageSchema.parse(
      await createJobFeedRepository(seededPrisma).read(paco.id, FIRST_PAGE),
    );

    const quoted = page.items.find((item) => item.title === 'Cambiar el termo eléctrico');
    expect(quoted?.myQuote?.status).toBe('PENDING');
  });

  it('shows the out-of-radius job to the provider whose own radius reaches it', async () => {
    // `Clima Costa` covers 50 km from Alcalá; every other seeded provider covers 15. The same job,
    // two providers, two answers — `W3-T05`'s rule, now visible from the jobs side too.
    const clima = await seededPrisma.providerProfile.findFirstOrThrow({
      where: { displayName: 'Clima Costa' },
      select: { userId: true },
    });
    const page = JobFeedPageSchema.parse(
      await createJobFeedRepository(seededPrisma).read(clima.userId, FIRST_PAGE),
    );

    expect(page.items.map((item) => item.title)).toContain('Aire acondicionado en el salón');
  });
});
