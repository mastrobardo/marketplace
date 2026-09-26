/**
 * `W4-T07` §3.4 — what the feed seeder writes, asserted without a database.
 *
 * The same recorder shape `demo-providers.test.ts` established and `demo-quotes.test.ts` reused: the
 * seeder is handed a transaction client and calls `create` on it, so every claim about *what the demo
 * feed is* is checkable in CI's `unit` job rather than behind `STACK_LIVE`.
 *
 * **What is asserted is the branches, not the prose.** A demo where every job matches proves nothing
 * about a radius, a demo with no licensed gap never shows the label that replaced a gate, and a demo
 * with no addressless job hides the one consequence `W4-T01` wrote down and left for this ticket. That
 * the *feed* then returns exactly the right three is `job-feed-live.test.ts` AC21's job, against a real
 * database — a recorder can only prove the rows were written.
 */
import { describe, expect, it } from 'vitest';
import { type Prisma } from '@prisma/client';

import { demoFeed } from '../prisma/seed/demo-feed.js';
import { seeders } from '../prisma/seed/registry.js';
import { localSeedContext } from './seed-context.js';

interface Created {
  readonly model: string;
  readonly data: Record<string, unknown>;
}

/** The accounts `auth.demo-users` writes, as this seeder resolves them: by email. */
const USERS = [
  { id: '11111111-1111-4111-8111-111111111111', email: 'client@marketplace.local' },
  { id: '22222222-2222-4222-8222-222222222222', email: 'provider@marketplace.local' },
];

/** Every slug this seeder resolves, as `categories.taxonomy` writes them. */
const SLUGS = [
  'fontaneria',
  'electricidad',
  'gas',
  'climatizacion',
  'cerrajeria',
  'pintura',
] as const;

function recorder(options: { users?: typeof USERS; slugs?: readonly string[] } = {}): {
  rows: Created[];
  db: Prisma.TransactionClient;
} {
  const rows: Created[] = [];
  const model = (name: string) => ({
    create: ({ data }: { data: Record<string, unknown> }) => {
      rows.push({ model: name, data });
      return Promise.resolve(data);
    },
  });

  // Only the models this seeder may touch. A call to any other — an `account` row, which is what a
  // credential would be — is a TypeError before an assertion has to think of it.
  const db = {
    user: { findMany: () => Promise.resolve(options.users ?? USERS) },
    category: {
      findMany: () =>
        Promise.resolve(
          (options.slugs ?? SLUGS).map((slug, index) => ({
            id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa${String(index).padStart(4, '0')}`,
            slug,
          })),
        ),
    },
    address: model('address'),
    providerProfile: model('providerProfile'),
    providerCategory: model('providerCategory'),
    clientProfile: model('clientProfile'),
    job: model('job'),
    quote: model('quote'),
  };

  return { rows, db: db as unknown as Prisma.TransactionClient };
}

async function seeded(): Promise<Created[]> {
  const { rows, db } = recorder();
  await demoFeed.run(localSeedContext(db));
  return rows;
}

const of = (rows: Created[], model: string): Array<Record<string, unknown>> =>
  rows.filter((row) => row.model === model).map((row) => row.data);

describe('AC21 — the professional side of the demo world', () => {
  it('gives the sign-in-able provider a profile with a radius and its trades', async () => {
    const rows = await seeded();
    const profiles = of(rows, 'providerProfile');

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.['userId']).toBe('22222222-2222-4222-8222-222222222222');
    // Without a radius the endpoint answers 409, which is exactly the state this seeder exists to end.
    expect(profiles[0]?.['serviceRadiusMetres']).toBe(15_000);
    // Unrated: the cold-start case, and the honest state for an account nobody has hired.
    expect(profiles[0]?.['ratingAvg']).toBeNull();

    expect(of(rows, 'providerCategory')).toHaveLength(2);
  });

  it('creates no credential, which is what keeps it out of the localOnly list', async () => {
    const rows = await seeded();

    // The recorder has no `account` model at all, so a credential would throw rather than be asserted
    // away. This states the property the type enforces.
    expect(of(rows, 'user'), 'this seeder resolves its users, it does not write them').toHaveLength(
      0,
    );
    expect(demoFeed.localOnly ?? false).toBe(false);
  });

  it('gives the client a default address, so a job posted by hand still has a location', async () => {
    const rows = await seeded();
    const profiles = of(rows, 'clientProfile');

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.['defaultAddressId']).toBeDefined();
  });
});

describe('AC21 — the jobs are the feed’s branches, not decoration', () => {
  it('writes seven jobs: six open and one cancelled', async () => {
    const jobs = of(await seeded(), 'job');

    expect(jobs).toHaveLength(7);
    expect(jobs.filter((job) => job['status'] === 'OPEN')).toHaveLength(6);
    expect(jobs.filter((job) => job['status'] === 'CANCELLED')).toHaveLength(1);
  });

  it('includes a job with no address at all', async () => {
    const jobs = of(await seeded(), 'job');
    const addressless = jobs.filter((job) => job['addressId'] === null);

    // `W4-T01` §2.5 allows this and named the consequence for this ticket: it matches no radius query,
    // so it is in nobody's feed. A demo without one cannot show that.
    expect(addressless).toHaveLength(1);
    expect(addressless[0]?.['status']).toBe('OPEN');
  });

  it('puts one job outside a 15 km radius and the rest inside', async () => {
    const rows = await seeded();
    const alcala = of(rows, 'address').find((address) => address['city'] === 'Alcalá de Henares');
    expect(alcala, 'the out-of-radius job has nowhere to be').toBeDefined();

    const jobs = of(rows, 'job');
    expect(jobs.filter((job) => job['addressId'] === alcala?.['id'])).toHaveLength(1);
  });

  it('asks for a regulated trade the provider does not list, and for one it does', async () => {
    const rows = await seeded();
    // `gas` is index 2 and `electricidad` index 1 in the recorder's taxonomy; the provider lists
    // `fontaneria` and `electricidad` only.
    const gas = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002';
    const electricity = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001';

    const linksOf = (job: Record<string, unknown>): string[] =>
      ((job['categories'] as { create: { categoryId: string }[] }).create ?? []).map(
        (link) => link.categoryId,
      );

    const jobs = of(rows, 'job');
    expect(jobs.filter((job) => linksOf(job).includes(gas))).toHaveLength(1);
    expect(jobs.filter((job) => linksOf(job).includes(electricity))).toHaveLength(1);
  });

  it('leaves exactly one job already quoted, and the quote still open', async () => {
    const quotes = of(await seeded(), 'quote');

    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.['status']).toBe('PENDING');
    expect((quotes[0]?.['validUntil'] as Date).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('AC21 — what it refuses', () => {
  it('throws when the sign-in-able accounts are absent, naming the seeder that writes them', async () => {
    const { db } = recorder({ users: [] });

    await expect(demoFeed.run(localSeedContext(db))).rejects.toThrow(/auth\.demo-users/);
  });

  it('throws when the taxonomy has not run, naming the missing trade', async () => {
    const { db } = recorder({ slugs: ['fontaneria'] });

    await expect(demoFeed.run(localSeedContext(db))).rejects.toThrow(/categories\.taxonomy/);
  });

  it('is registered after everything it resolves', () => {
    const ids = seeders.map((seeder) => seeder.id);

    expect(ids).toContain('jobs.demo-feed');
    expect(ids.indexOf('jobs.demo-feed')).toBeGreaterThan(ids.indexOf('auth.demo-users'));
    expect(ids.indexOf('jobs.demo-feed')).toBeGreaterThan(ids.indexOf('categories.taxonomy'));
  });
});
