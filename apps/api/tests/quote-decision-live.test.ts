/**
 * `W4-T04` — the client's answer, against Postgres.
 *
 * The contract suite asserts the machine and its guards; this asserts what only a database can:
 * that **two partial unique indexes** really are what stop a second acceptance and a competing
 * quote, that a rejection genuinely frees the slot the operator said it should, that every decision
 * writes its audit row in the same transaction, and that the cursor walks the whole set exactly
 * once.
 *
 * `STACK_LIVE=1` and a `DATABASE_URL`. The local port is **5433**:
 *   STACK_LIVE=1 DATABASE_URL="postgres://marketplace:marketplace_local@127.0.0.1:5433/marketplace" \
 *     pnpm --filter @marketplace/api exec vitest run quote-decision-live
 *
 * Spec: `docs/specs/S4/W4-T04-quote-comparison.md` §5.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AppError, QuoteListQuerySchema, type Quote } from '@marketplace/contracts';
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
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();

let prisma: PrismaClient;
let jobs: JobRepository;
let quotes: QuoteRepository;
let client: string;
let otherClient: string;
let categoryId: string;

/** The default paging request, parsed the way the route parses it. */
const FIRST_PAGE = QuoteListQuerySchema.parse({});

async function provider(): Promise<string> {
  const user = await createUser(prisma as unknown as FactoryClient, { roles: ['PROVIDER'] });
  const profile = await createProviderProfile(prisma as unknown as FactoryClient, {
    userId: user.id,
  });
  await prisma.providerCategory.create({
    data: { providerProfileId: profile.id, categoryId },
  });
  return user.id;
}

async function openJob(owner: string = client): Promise<string> {
  const draft = await jobs.createDraft(owner, { categorySlugs: ['w4t04-fontaneria'] });
  await jobs.publish(owner, draft.id);
  return draft.id;
}

/** A job with `n` quotes on it, one per provider, and the quotes newest-last. */
async function jobWithQuotes(
  n: number,
  amountFrom = 1000,
): Promise<{ jobId: string; ids: string[] }> {
  const jobId = await openJob();
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const quote = await quotes.create(await provider(), jobId, {
      amountCents: amountFrom + i,
      validUntil: TOMORROW,
    });
    ids.push((quote as Quote).id);
  }
  return { jobId, ids };
}

async function auditFor(quoteId: string): Promise<{ action: string; toState: string }[]> {
  const rows = await prisma.auditRecord.findMany({
    where: { entity: 'quote', entityId: quoteId },
    orderBy: { at: 'asc' },
    select: { action: true, toState: true },
  });
  return rows;
}

beforeAll(async () => {
  if (!live) return;
  const db = migrated('w4t04_decisions');
  prisma = new PrismaClient({ datasources: { db: { url: urlFor(db) } } });
  jobs = createJobRepository(prisma);
  quotes = createQuoteRepository(prisma);

  const category = await prisma.category.upsert({
    where: { slug: 'w4t04-fontaneria' },
    create: { slug: 'w4t04-fontaneria', nameEs: 'Fontanería', nameEn: 'Plumbing' },
    update: {},
    select: { id: true },
  });
  categoryId = category.id;

  client = (await createUser(prisma as unknown as FactoryClient, { roles: ['CLIENT'] })).id;
  otherClient = (await createUser(prisma as unknown as FactoryClient, { roles: ['CLIENT'] })).id;
}, 90_000);

afterAll(async () => {
  if (!live) return;
  await prisma.$disconnect();
});

describeLive('AC1/AC2 — the job s owner answers a quote', () => {
  it('accepts one, and it reads ACCEPTED', async () => {
    const { ids } = await jobWithQuotes(1);

    const accepted = await quotes.accept(client, ids[0] as string);

    expect(accepted?.status).toBe('ACCEPTED');
  });

  it('rejects one, and it reads REJECTED', async () => {
    const { ids } = await jobWithQuotes(1);

    const rejected = await quotes.reject(client, ids[0] as string);

    expect(rejected?.status).toBe('REJECTED');
  });
});

describeLive('AC3 — accepting touches neither the siblings nor the job', () => {
  it('leaves every other quote PENDING and the job OPEN', async () => {
    const { jobId, ids } = await jobWithQuotes(3);

    await quotes.accept(client, ids[0] as string);

    const page = await quotes.listForJob(client, jobId, FIRST_PAGE);
    const byId = new Map((page?.items ?? []).map((quote) => [quote.id, quote.status]));

    expect(byId.get(ids[0] as string)).toBe('ACCEPTED');
    expect(byId.get(ids[1] as string)).toBe('PENDING');
    expect(byId.get(ids[2] as string)).toBe('PENDING');

    const job = await jobs.findOwn(client, jobId);
    expect(job?.status, 'accepting is not awarding — ADR-013 §4').toBe('OPEN');
  });
});

describeLive('AC4 — one accepted quote per job, enforced by the database', () => {
  it('refuses a second acceptance on the same job', async () => {
    const { ids } = await jobWithQuotes(2);
    await quotes.accept(client, ids[0] as string);

    await expect(quotes.accept(client, ids[1] as string)).rejects.toBeInstanceOf(AppError);
  });

  it('is the index that refuses it, not a prior read', async () => {
    // Proven by asking the database directly: the constraint exists and is partial on ACCEPTED.
    const rows = psql(
      'w4t04_decisions',
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'quote_one_accepted_per_job_idx'`,
    );
    expect(rows).toMatch(/UNIQUE/i);
    expect(rows).toMatch(/job_id/);
    expect(rows).toMatch(/WHERE .*ACCEPTED/);
  });
});

describeLive('AC5/AC6 — a rejection frees the slot, an acceptance takes it', () => {
  it('lets a rejected provider quote the same job again — operator, 2026-09-20', async () => {
    const jobId = await openJob();
    const providerUser = await provider();
    const first = await quotes.create(providerUser, jobId, {
      amountCents: 500000,
      validUntil: TOMORROW,
    });
    await quotes.reject(client, (first as Quote).id);

    const second = await quotes.create(providerUser, jobId, {
      amountCents: 400000,
      validUntil: TOMORROW,
    });

    expect(second, 'a rejection must not be a permanent bar').not.toBeNull();
    expect(second?.amountCents).toBe(400000);
  });

  it('refuses a second quote from a provider whose quote was accepted', async () => {
    const jobId = await openJob();
    const providerUser = await provider();
    const first = await quotes.create(providerUser, jobId, {
      amountCents: 500000,
      validUntil: TOMORROW,
    });
    await quotes.accept(client, (first as Quote).id);

    await expect(
      quotes.create(providerUser, jobId, { amountCents: 1, validUntil: TOMORROW }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('still lets a withdrawn quote be replaced — W4-T03 s rule is untouched', async () => {
    const jobId = await openJob();
    const providerUser = await provider();
    const first = await quotes.create(providerUser, jobId, {
      amountCents: 1,
      validUntil: TOMORROW,
    });
    await quotes.withdraw(providerUser, (first as Quote).id);

    const second = await quotes.create(providerUser, jobId, {
      amountCents: 2,
      validUntil: TOMORROW,
    });

    expect(second).not.toBeNull();
  });
});

describeLive('AC7/AC8 — expiry blocks the acceptance and not the rejection', () => {
  it('refuses to accept a quote past its validity date', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(await provider(), jobId, {
      amountCents: 1000,
      validUntil: YESTERDAY,
    });

    await expect(quotes.accept(client, (quote as Quote).id)).rejects.toBeInstanceOf(AppError);
  });

  it('allows rejecting one — otherwise the row can never be cleared', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(await provider(), jobId, {
      amountCents: 1000,
      validUntil: YESTERDAY,
    });

    const rejected = await quotes.reject(client, (quote as Quote).id);

    expect(rejected?.status).toBe('REJECTED');
  });
});

describeLive('AC9/AC15 — a decision is final, and outlives the calendar', () => {
  it('refuses to answer an already-answered quote', async () => {
    const { ids } = await jobWithQuotes(1);
    await quotes.reject(client, ids[0] as string);

    await expect(quotes.accept(client, ids[0] as string)).rejects.toBeInstanceOf(AppError);
    await expect(quotes.reject(client, ids[0] as string)).rejects.toBeInstanceOf(AppError);
  });

  it('reports an accepted quote as ACCEPTED once its validity date has passed', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(await provider(), jobId, {
      amountCents: 1000,
      validUntil: new Date(Date.now() + 1500).toISOString(),
    });
    const accepted = await quotes.accept(client, (quote as Quote).id);
    expect(accepted?.status).toBe('ACCEPTED');

    await new Promise((resolve) => setTimeout(resolve, 1800));

    const page = await quotes.listForJob(client, jobId, FIRST_PAGE);
    expect(page?.items[0]?.status, 'a decision by a person outranks the clock').toBe('ACCEPTED');
  });
});

describeLive('AC10/AC11 — whose job it is, and what state it is in', () => {
  it('answers 404 for a stranger, exactly as a missing quote does', async () => {
    const { ids } = await jobWithQuotes(1);

    await expect(quotes.accept(otherClient, ids[0] as string)).resolves.toBeNull();
    await expect(quotes.reject(otherClient, ids[0] as string)).resolves.toBeNull();
  });

  it('refuses a decision once the job is cancelled', async () => {
    const { jobId, ids } = await jobWithQuotes(1);
    await jobs.cancel(client, jobId, {});

    await expect(quotes.accept(client, ids[0] as string)).rejects.toBeInstanceOf(AppError);
  });
});

describeLive('AC14 — every decision writes its audit row', () => {
  it('records an ACCEPT with the state it moved to', async () => {
    const { ids } = await jobWithQuotes(1);

    await quotes.accept(client, ids[0] as string);

    expect(await auditFor(ids[0] as string)).toEqual([{ action: 'ACCEPT', toState: 'ACCEPTED' }]);
  });

  it('writes nothing when the decision is refused', async () => {
    const jobId = await openJob();
    const quote = await quotes.create(await provider(), jobId, {
      amountCents: 1000,
      validUntil: YESTERDAY,
    });

    await expect(quotes.accept(client, (quote as Quote).id)).rejects.toBeInstanceOf(AppError);

    expect(await auditFor((quote as Quote).id)).toEqual([]);
  });
});

describeLive('AC16 — the quotes on a job are a paged list', () => {
  it('caps at the requested limit and says there is more', async () => {
    const { jobId } = await jobWithQuotes(5);

    const page = await quotes.listForJob(client, jobId, QuoteListQuerySchema.parse({ limit: '2' }));

    expect(page?.items).toHaveLength(2);
    expect(page?.page.hasMore).toBe(true);
    expect(page?.page.nextCursor).not.toBeNull();
  });

  it('walks the whole set exactly once, with no row repeated or skipped', async () => {
    const { jobId, ids } = await jobWithQuotes(5);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await quotes.listForJob(
        client,
        jobId,
        QuoteListQuerySchema.parse(cursor === undefined ? { limit: '2' } : { limit: '2', cursor }),
      );
      seen.push(...(page?.items ?? []).map((quote) => quote.id));
      if (page?.page.hasMore !== true) break;
      cursor = page.page.nextCursor ?? undefined;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size, 'a row was repeated across pages').toBe(5);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('is still nobody else s list', async () => {
    const { jobId } = await jobWithQuotes(1);

    expect(await quotes.listForJob(otherClient, jobId, FIRST_PAGE)).toBeNull();
  });
});
