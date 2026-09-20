/**
 * `W4-T04` §3.4 — what the quote seeder writes, asserted without a database.
 *
 * The same recorder shape `demo-providers.test.ts` established: the seeder is handed a transaction
 * client and calls `create` on it, so every claim about *what the demo comparison is* is checkable
 * in CI's `unit` job rather than behind `STACK_LIVE`.
 *
 * **What is asserted is the four load-bearing rows**, not the prose. A demo whose cheapest quote is
 * also its best-rated one demonstrates nothing about the rule this screen exists to keep, and a
 * demo with no unrated provider never shows the cold-start sort. Those are properties of the data,
 * so they are tested as properties of the data.
 */
import { describe, expect, it } from 'vitest';
import { type Prisma } from '@prisma/client';

import { demoQuotes } from '../prisma/seed/demo-quotes.js';
import { seeders } from '../prisma/seed/registry.js';
import { localSeedContext } from './seed-context.js';

interface Created {
  readonly model: string;
  readonly data: Record<string, unknown>;
}

/** The two trades this job names, as `categories.taxonomy` seeds them. */
const CATEGORIES = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', slug: 'fontaneria' },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002', slug: 'electricidad' },
];

/** The providers `providers.demo-world` writes, with the ratings that make the demo work. */
const PROFILES = [
  { id: 'dddddddd-dddd-4ddd-8ddd-dddddddd0001', displayName: 'Fontanería Gómez', ratingAvg: 4.7 },
  { id: 'dddddddd-dddd-4ddd-8ddd-dddddddd0002', displayName: 'Electricidad Nadal', ratingAvg: 4.2 },
  { id: 'dddddddd-dddd-4ddd-8ddd-dddddddd0003', displayName: 'Manitas Rivas', ratingAvg: null },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddd0004',
    displayName: 'Cerrajería 24h Chamberí',
    ratingAvg: 3.9,
  },
];

function recorder(options: { categories?: typeof CATEGORIES; profiles?: typeof PROFILES } = {}): {
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

  // Only the three models this seeder may touch. A call to any other — an `account` row, which is
  // what a credential would be — is a TypeError before an assertion has to think of it.
  const db = {
    category: { findMany: () => Promise.resolve(options.categories ?? CATEGORIES) },
    providerProfile: { findMany: () => Promise.resolve(options.profiles ?? PROFILES) },
    user: model('user'),
    job: model('job'),
    quote: model('quote'),
  };

  return { rows, db: db as unknown as Prisma.TransactionClient };
}

async function seeded(): Promise<Created[]> {
  const { rows, db } = recorder();
  await demoQuotes.run(localSeedContext(db));
  return rows;
}

const of = (rows: Created[], model: string): Array<Record<string, unknown>> =>
  rows.filter((row) => row.model === model).map((row) => row.data);

/** The quote rows, joined back to the rating of whoever wrote them. */
async function quotesWithRating(): Promise<
  { amountCents: number; ratingAvg: number | null; validUntil: Date }[]
> {
  const rows = of(await seeded(), 'quote');
  const byId = new Map(PROFILES.map((profile) => [profile.id, profile.ratingAvg]));
  return rows.map((row) => ({
    amountCents: row['amountCents'] as number,
    ratingAvg: byId.get(row['providerId'] as string) ?? null,
    validUntil: row['validUntil'] as Date,
  }));
}

describe('AC23 — one open job, four quotes, and its own client', () => {
  it('creates a client of its own rather than depending on auth.demo-users', async () => {
    const users = of(await seeded(), 'user');

    expect(users).toHaveLength(1);
    // `auth.demo-users` correctly refuses on a deployed database, so its rows are absent exactly
    // where a preview needs this one — depending on them would break it there and nowhere else.
    expect(users[0]?.['roles']).toEqual(['CLIENT']);
  });

  it('creates no credential, which is what lets it travel off a laptop', async () => {
    const rows = await seeded();

    expect(of(rows, 'account'), 'a seeded credential would make this localOnly').toHaveLength(0);
    expect(demoQuotes.localOnly ?? false).toBe(false);
  });

  it('publishes one OPEN job across both trades', async () => {
    const jobs = of(await seeded(), 'job');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.['status']).toBe('OPEN');
    expect(jobs[0]?.['publishedAt']).toBeInstanceOf(Date);
    // Many-to-many, because a bathroom needs more than one trade (`W4-T01`, operator's words).
    expect((jobs[0]?.['categories'] as { create: unknown[] }).create).toHaveLength(2);
  });

  it('writes four quotes, every one of them PENDING', async () => {
    const quotes = of(await seeded(), 'quote');

    expect(quotes).toHaveLength(4);
    // The demo is the moment *before* the client chooses. A seeded ACCEPTED row would take the
    // screen's own decision away from whoever is looking at it.
    expect(quotes.every((quote) => quote['status'] === 'PENDING')).toBe(true);
  });
});

describe('AC23 — the four rows the screen has branches for', () => {
  it('makes the cheapest quote NOT the best rated — or the rule proves nothing', async () => {
    const quotes = await quotesWithRating();

    const cheapest = quotes.reduce((a, b) => (a.amountCents <= b.amountCents ? a : b));
    const bestRated = quotes.reduce((a, b) => ((a.ratingAvg ?? -1) >= (b.ratingAvg ?? -1) ? a : b));

    expect(
      cheapest.amountCents,
      'the cheapest quote is also the best rated, so "do not hide the cheapest" demonstrates nothing',
    ).not.toBe(bestRated.amountCents);
  });

  it('includes a provider with no reviews at all — the cold-start sort', async () => {
    expect((await quotesWithRating()).some((quote) => quote.ratingAvg === null)).toBe(true);
  });

  it('includes a quote that has already lapsed, and only one', async () => {
    const lapsed = (await quotesWithRating()).filter(
      (quote) => quote.validUntil.getTime() < Date.now(),
    );

    // One, not none: the screen renders it as expired with no accept control, and the API refuses
    // to accept it. Not all four, or there is nothing left to choose between.
    expect(lapsed).toHaveLength(1);
  });

  it('includes a provider who does not list one of the job s trades', async () => {
    // `Electricidad Nadal` lists `electricidad` and `climatizacion`, never `fontaneria` — so
    // coverage on its quote says the gap out loud while enforcing nothing (`W4-T03` §2.3).
    const rows = of(await seeded(), 'quote');
    const nadal = PROFILES.find((profile) => profile.displayName === 'Electricidad Nadal');

    expect(rows.some((row) => row['providerId'] === nadal?.id)).toBe(true);
  });
});

describe('AC23 — it refuses rather than seeding something unusable', () => {
  it('throws when the taxonomy has not run', async () => {
    const { db } = recorder({ categories: [] });

    await expect(demoQuotes.run(localSeedContext(db))).rejects.toThrow(/categories\.taxonomy/);
  });

  it('throws when the demo providers have not run', async () => {
    const { db } = recorder({ profiles: [] });

    await expect(demoQuotes.run(localSeedContext(db))).rejects.toThrow(/providers\.demo-world/);
  });

  it('is registered last, after everything it resolves', async () => {
    const ids = seeders.map((seeder) => seeder.id);

    expect(ids).toContain('quotes.demo-comparison');
    expect(ids.indexOf('quotes.demo-comparison')).toBeGreaterThan(
      ids.indexOf('providers.demo-world'),
    );
    expect(ids.indexOf('quotes.demo-comparison')).toBeGreaterThan(
      ids.indexOf('categories.taxonomy'),
    );
  });
});
