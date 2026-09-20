/**
 * `W4-T03` — quotes against Postgres.
 *
 * The contract suite asserts shapes; this asserts the things only a database can: that the partial
 * unique index really is what stops a second active quote, that withdrawing frees the slot, and
 * that coverage is computed from the provider's categories at the moment somebody reads.
 *
 * `STACK_LIVE=1` and a `DATABASE_URL`. The local port is **5433**:
 *   STACK_LIVE=1 DATABASE_URL="postgres://marketplace:marketplace_local@127.0.0.1:5433/marketplace" \
 *     pnpm --filter @marketplace/api exec vitest run quote-live
 *
 * Spec: `docs/specs/S4/W4-T03-quote-submission.md` §5.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { QuoteSchema } from '@marketplace/contracts';
import { createProviderProfile, createUser, type FactoryClient } from '@marketplace/testing';

import { createJobRepository, type JobRepository } from '../src/modules/jobs/repository.js';
import { createQuoteRepository, type QuoteRepository } from '../src/modules/quotes/repository.js';

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

const TOMORROW = new Date(Date.now() + 86_400_000).toISOString();

let prisma: PrismaClient;
let jobs: JobRepository;
let quotes: QuoteRepository;
let client: string;
let plumberUser: string;
let electricianUser: string;
let categoryIds: Record<string, string>;

async function category(slug: string, requiresLicence = false): Promise<string> {
  const row = await prisma.category.upsert({
    where: { slug },
    create: { slug, nameEs: slug, nameEn: slug, requiresLicence },
    update: { requiresLicence },
    select: { id: true },
  });
  return row.id;
}

/** A provider with a profile and the categories they claim to work in. */
async function provider(slugs: readonly string[]): Promise<string> {
  const user = await createUser(prisma as unknown as FactoryClient, { roles: ['PROVIDER'] });
  const profile = await createProviderProfile(prisma as unknown as FactoryClient, {
    userId: user.id,
  });
  for (const slug of slugs) {
    await prisma.providerCategory.create({
      data: { providerProfileId: profile.id, categoryId: categoryIds[slug] as string },
    });
  }
  return user.id;
}

/** An OPEN job naming the three trades a bathroom needs. */
async function openJob(
  slugs: readonly string[] = ['w4t03-alicatado', 'w4t03-fontaneria', 'w4t03-electricidad'],
): Promise<string> {
  const draft = await jobs.createDraft(client, { categorySlugs: [...slugs] });
  await jobs.publish(client, draft.id);
  return draft.id;
}

beforeAll(async () => {
  if (!live) return;
  const db = migrated('w4t03_quotes');
  prisma = new PrismaClient({ datasources: { db: { url: urlFor(db) } } });
  jobs = createJobRepository(prisma);
  quotes = createQuoteRepository(prisma);

  categoryIds = {
    'w4t03-alicatado': await category('w4t03-alicatado'),
    'w4t03-fontaneria': await category('w4t03-fontaneria'),
    // Gated: this is the one a plumber quoting the whole bathroom does not list.
    'w4t03-electricidad': await category('w4t03-electricidad', true),
  };

  client = (await createUser(prisma as unknown as FactoryClient, { roles: ['CLIENT'] })).id;
  plumberUser = await provider(['w4t03-fontaneria']);
  electricianUser = await provider(['w4t03-electricidad']);
}, 90_000);

afterAll(async () => {
  if (!live) return;
  await prisma.$disconnect();
});

describeLive('AC1/AC5 — one quote, for the whole job, from whoever wants to write it', () => {
  it('a plumber quotes a three-trade job', async () => {
    const jobId = await openJob();

    const quote = await quotes.create(plumberUser, jobId, {
      amountCents: 250000,
      validUntil: TOMORROW,
    });

    expect(quote?.amountCents).toBe(250000);
    expect(quote?.status).toBe('PENDING');
    expect(QuoteSchema.safeParse(quote).success).toBe(true);
  });

  it('a provider listing none of the job s trades may still quote — AC5', async () => {
    // "It is up to the professional to decide to apply or not." Nothing here gates on coverage.
    const jobId = await jobs
      .createDraft(client, { categorySlugs: ['w4t03-fontaneria'] })
      .then(async (draft) => {
        await jobs.publish(client, draft.id);
        return draft.id;
      });

    const quote = await quotes.create(electricianUser, jobId, {
      amountCents: 1000,
      validUntil: TOMORROW,
    });

    expect(quote, 'a provider was blocked for not listing the trade').not.toBeNull();
    expect(quote?.coverage[0]?.listedByProvider).toBe(false);
  });

  it('records no per-category price — there is nowhere to put one', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(plumberUser, jobId, {
      amountCents: 999,
      validUntil: TOMORROW,
    });
    expect(Object.keys(quote as object)).not.toContain('categoryAmounts');
  });
});

describeLive('AC6/AC7 — coverage states the gap and enforces nothing', () => {
  it('names every category the job asked for, and which the provider lists', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(plumberUser, jobId, {
      amountCents: 250000,
      validUntil: TOMORROW,
    });

    const byslug = Object.fromEntries((quote?.coverage ?? []).map((entry) => [entry.slug, entry]));

    expect(Object.keys(byslug).sort()).toEqual([
      'w4t03-alicatado',
      'w4t03-electricidad',
      'w4t03-fontaneria',
    ]);
    expect(byslug['w4t03-fontaneria']?.listedByProvider).toBe(true);
    // The whole point: a licensed trade the quoting provider does not list, said plainly.
    expect(byslug['w4t03-electricidad']?.listedByProvider).toBe(false);
    expect(byslug['w4t03-electricidad']?.requiresLicence).toBe(true);
    expect(byslug['w4t03-alicatado']?.listedByProvider).toBe(false);
  });

  it('carries no verification field — nothing in this schema knows one', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(plumberUser, jobId, {
      amountCents: 1,
      validUntil: TOMORROW,
    });
    for (const entry of quote?.coverage ?? []) {
      expect(Object.keys(entry)).not.toContain('verified');
    }
  });

  it('follows the provider s categories rather than a stored copy', async () => {
    // Coverage is a fact about two tables at the moment somebody asks. A provider who adds the
    // trade tomorrow changes what every quote they wrote says — a column would keep yesterday's.
    const jobId = await openJob();
    await quotes.create(plumberUser, jobId, { amountCents: 1, validUntil: TOMORROW });

    const profile = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId: plumberUser },
      select: { id: true },
    });
    await prisma.providerCategory.create({
      data: {
        providerProfileId: profile.id,
        categoryId: categoryIds['w4t03-electricidad'] as string,
      },
    });

    const after = await quotes.listForJob(client, jobId);
    const electric = after?.[0]?.coverage.find((e) => e.slug === 'w4t03-electricidad');
    expect(electric?.listedByProvider, 'coverage was stored rather than computed').toBe(true);

    await prisma.providerCategory.delete({
      where: {
        providerProfileId_categoryId: {
          providerProfileId: profile.id,
          categoryId: categoryIds['w4t03-electricidad'] as string,
        },
      },
    });
  });
});

describeLive('AC3/AC4 — one active quote per provider per job, enforced by the database', () => {
  it('refuses a second quote from the same provider', async () => {
    const jobId = await openJob();
    await quotes.create(plumberUser, jobId, { amountCents: 100, validUntil: TOMORROW });

    await expect(
      quotes.create(plumberUser, jobId, { amountCents: 200, validUntil: TOMORROW }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('is the index doing it, not the service', async () => {
    // Proven by going around the repository entirely: a raw insert must fail the same way.
    const jobId = await openJob();
    await quotes.create(plumberUser, jobId, { amountCents: 100, validUntil: TOMORROW });

    const profile = await prisma.providerProfile.findUniqueOrThrow({
      where: { userId: plumberUser },
      select: { id: true },
    });

    await expect(
      prisma.quote.create({
        data: {
          jobId,
          providerId: profile.id,
          amountCents: 300,
          validUntil: new Date(TOMORROW),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a different provider to quote the same job', async () => {
    const jobId = await openJob();
    await quotes.create(plumberUser, jobId, { amountCents: 100, validUntil: TOMORROW });

    const second = await quotes.create(electricianUser, jobId, {
      amountCents: 200,
      validUntil: TOMORROW,
    });
    expect(second).not.toBeNull();
  });

  it('AC4 — withdrawing frees the slot, and both rows survive', async () => {
    const jobId = await openJob();
    const first = await quotes.create(plumberUser, jobId, {
      amountCents: 100,
      validUntil: TOMORROW,
    });

    const withdrawn = await quotes.withdraw(plumberUser, first?.id as string);
    expect(withdrawn?.status).toBe('WITHDRAWN');

    const second = await quotes.create(plumberUser, jobId, {
      amountCents: 200,
      validUntil: TOMORROW,
    });
    expect(second, 'a withdrawn quote was a permanent bar').not.toBeNull();

    // History, not a replacement: the withdrawn row is still there.
    expect(await prisma.quote.count({ where: { jobId } })).toBe(2);
  });

  it('records the withdrawal through the shared machine', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(plumberUser, jobId, {
      amountCents: 100,
      validUntil: TOMORROW,
    });
    await quotes.withdraw(plumberUser, quote?.id as string);

    const audit = await prisma.auditRecord.findFirst({ where: { entityId: quote?.id as string } });
    expect(audit?.entity).toBe('quote');
    expect(audit?.action).toBe('WITHDRAW');
    expect(audit?.fromState).toBe('PENDING');
    expect(audit?.toState).toBe('WITHDRAWN');
  });

  it('refuses a second withdrawal and writes no second audit row', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(plumberUser, jobId, {
      amountCents: 100,
      validUntil: TOMORROW,
    });
    await quotes.withdraw(plumberUser, quote?.id as string);

    await expect(quotes.withdraw(plumberUser, quote?.id as string)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await prisma.auditRecord.count({ where: { entityId: quote?.id as string } })).toBe(1);
  });
});

describeLive('AC2 — a job that is not OPEN', () => {
  it('a draft is 404, not 409 — its existence is not information', async () => {
    const draft = await jobs.createDraft(client, { categorySlugs: ['w4t03-fontaneria'] });

    const result = await quotes.create(plumberUser, draft.id, {
      amountCents: 100,
      validUntil: TOMORROW,
    });

    expect(result, 'a draft was visible to a provider').toBeNull();
  });

  it('a cancelled job is refused with CONFLICT — they were too slow, not snooping', async () => {
    const jobId = await openJob();
    await jobs.cancel(client, jobId, {});

    await expect(
      quotes.create(plumberUser, jobId, { amountCents: 100, validUntil: TOMORROW }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a job that never existed is null', async () => {
    const result = await quotes.create(plumberUser, '3f2504e0-4f89-41d3-9a0c-0305e82c3399', {
      amountCents: 100,
      validUntil: TOMORROW,
    });
    expect(result).toBeNull();
  });
});

describeLive('AC8 — expiry needs no worker', () => {
  it('reads EXPIRED once validUntil has passed, with nothing having run', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(plumberUser, jobId, {
      amountCents: 100,
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    });

    // The column still says PENDING; the reader does the arithmetic.
    expect(await psql('w4t03_quotes', `SELECT status FROM quote WHERE id = '${quote?.id}'`)).toBe(
      'PENDING',
    );

    const later = await quotes.listForJob(client, jobId, new Date(Date.now() + 120_000));
    expect(later?.[0]?.status).toBe('EXPIRED');
  });
});

describeLive('AC9 — who sees which quotes', () => {
  it('the job owner sees every quote on their job', async () => {
    const jobId = await openJob();
    await quotes.create(plumberUser, jobId, { amountCents: 100, validUntil: TOMORROW });
    await quotes.create(electricianUser, jobId, { amountCents: 200, validUntil: TOMORROW });

    const seen = await quotes.listForJob(client, jobId);
    expect(seen).toHaveLength(2);
  });

  it('a stranger sees nothing, and is told nothing', async () => {
    const jobId = await openJob();
    await quotes.create(plumberUser, jobId, { amountCents: 100, validUntil: TOMORROW });

    const stranger = (await createUser(prisma as unknown as FactoryClient, { roles: ['CLIENT'] }))
      .id;
    expect(await quotes.listForJob(stranger, jobId)).toBeNull();
  });

  it('a provider s own list carries only their own quotes', async () => {
    const jobId = await openJob();
    await quotes.create(plumberUser, jobId, { amountCents: 100, validUntil: TOMORROW });
    await quotes.create(electricianUser, jobId, { amountCents: 200, validUntil: TOMORROW });

    const mine = await quotes.listOwn(plumberUser, 50);
    const theirs = await quotes.listOwn(electricianUser, 50);

    expect(mine.every((q) => q.provider.displayName !== undefined)).toBe(true);
    expect(mine.some((q) => q.amountCents === 200 && q.jobId === jobId)).toBe(false);
    expect(theirs.some((q) => q.amountCents === 200 && q.jobId === jobId)).toBe(true);
  });

  it('a provider cannot withdraw somebody else s quote', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(plumberUser, jobId, {
      amountCents: 100,
      validUntil: TOMORROW,
    });

    expect(await quotes.withdraw(electricianUser, quote?.id as string)).toBeNull();
    expect(
      (await prisma.quote.findUniqueOrThrow({ where: { id: quote?.id as string } })).status,
    ).toBe('PENDING');
  });
});
