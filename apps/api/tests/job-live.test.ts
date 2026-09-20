/**
 * `W4-T01` and `W4-T02` — posting and cancelling a job, against Postgres.
 *
 * `packages/contracts/tests/job.test.ts` asserts the shapes and the publish guard without a
 * database. This asserts the rows and the transition: that a draft with nothing in it exists, that
 * publishing writes an audit record inside the same transaction as the status change, that the
 * address is inferred rather than demanded, and that a stranger's job is invisible rather than
 * forbidden.
 *
 * `STACK_LIVE=1` and a `DATABASE_URL`, the gate every live suite uses. The local port is **5433**:
 *   STACK_LIVE=1 DATABASE_URL="postgres://marketplace:marketplace_local@127.0.0.1:5433/marketplace" \
 *     pnpm --filter @marketplace/api exec vitest run job-live
 *
 * Specs: `docs/specs/S4/W4-T01-job-posting.md` §5, `docs/specs/S4/W4-T02-job-state-machine.md` §5.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AppError, JobSchema } from '@marketplace/contracts';
import { createUser, type FactoryClient } from '@marketplace/testing';

import { createJobRepository, type JobRepository } from '../src/modules/jobs/repository.js';

const live = process.env['STACK_LIVE'] === '1';
const describeLive = live ? describe : describe.skip;

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const SCHEMA = join(apiRoot, 'prisma', 'schema.prisma');
const MIGRATIONS = join(apiRoot, 'prisma', 'migrations');

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

/** Its own database, for the reason `provider-write-live` gives: the factories share a sequence. */
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

let prisma: PrismaClient;
let jobs: JobRepository;
let client: string;
let stranger: string;

async function user(): Promise<string> {
  const created = await createUser(prisma as unknown as FactoryClient, { roles: ['CLIENT'] });
  return created.id;
}

async function category(slug: string, isActive = true): Promise<void> {
  await prisma.category.upsert({
    where: { slug },
    create: { slug, nameEs: slug, nameEn: slug, isActive },
    update: { isActive },
  });
}

async function addressFor(userId: string): Promise<string> {
  const row = await prisma.address.create({
    data: {
      userId,
      line1: 'Calle Mayor 1',
      city: 'Madrid',
      province: 'Madrid',
      postalCode: '28013',
      ...SOL,
    },
    select: { id: true },
  });
  return row.id;
}

beforeAll(async () => {
  if (!live) return;
  const db = migrated('w4t01_jobs');
  prisma = new PrismaClient({ datasources: { db: { url: urlFor(db) } } });
  jobs = createJobRepository(prisma);
  await category('w4t01-alicatado');
  await category('w4t01-fontaneria');
  await category('w4t01-electricidad');
  await category('w4t01-retired', false);
  client = await user();
  stranger = await user();
}, 60_000);

afterAll(async () => {
  if (!live) return;
  await prisma.$disconnect();
});

describeLive('AC1 — a draft asks for nothing', () => {
  it('creates a DRAFT from an empty body', async () => {
    const job = await jobs.createDraft(client, {});

    expect(job.status).toBe('DRAFT');
    expect(job.title).toBeNull();
    expect(job.description).toBeNull();
    expect(job.categories).toEqual([]);
    expect(job.publishedAt).toBeNull();
    // The wire shape is the contract's, not a convenient subset of it.
    expect(JobSchema.safeParse(job).success).toBe(true);
  });
});

describeLive('AC2/AC10 — editing a draft', () => {
  it('merges a partial update and leaves absent keys alone', async () => {
    const created = await jobs.createDraft(client, { title: 'Reforma baño' });
    const updated = await jobs.update(client, created.id, { description: 'Cambiar azulejos' });

    expect(updated?.title, 'an absent key cleared a field it should have left alone').toBe(
      'Reforma baño',
    );
    expect(updated?.description).toBe('Cambiar azulejos');
  });

  it('clears a field when sent null', async () => {
    const created = await jobs.createDraft(client, { title: 'Temporal' });
    const updated = await jobs.update(client, created.id, { title: null });
    expect(updated?.title).toBeNull();
  });

  it('AC7 — refuses to edit a job that is no longer a draft', async () => {
    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-fontaneria'] });
    await jobs.publish(client, created.id);

    await expect(jobs.update(client, created.id, { title: 'Too late' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describeLive('AC3/AC4/AC5 — publishing', () => {
  it('refuses a job with no category and leaves it DRAFT', async () => {
    const created = await jobs.createDraft(client, { title: 'Algo' });

    await expect(jobs.publish(client, created.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    const after = await jobs.findOwn(client, created.id);
    expect(after?.status, 'a refused publish moved the job anyway').toBe('DRAFT');
    const audits = await prisma.auditRecord.count({ where: { entityId: created.id } });
    expect(audits, 'a refused publish wrote an audit row').toBe(0);
  });

  it('publishes with a category and nothing else — no title, no description, no budget', async () => {
    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-fontaneria'] });
    const published = await jobs.publish(client, created.id);

    expect(published?.status).toBe('OPEN');
    expect(published?.title, 'publishing invented a requirement §2.3 rejected').toBeNull();
    expect(published?.description).toBeNull();
    expect(published?.budget).toEqual({ minCents: null, maxCents: null });
    expect(published?.publishedAt).not.toBeNull();
  });

  it('records the transition through the shared machine', async () => {
    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-fontaneria'] });
    await jobs.publish(client, created.id);

    const audit = await prisma.auditRecord.findFirst({ where: { entityId: created.id } });
    expect(audit).not.toBeNull();
    expect(audit?.entity).toBe('job');
    expect(audit?.action).toBe('PUBLISH');
    expect(audit?.fromState).toBe('DRAFT');
    expect(audit?.toState).toBe('OPEN');
    expect(audit?.actorType).toBe('USER');
    expect(audit?.actorId).toBe(client);
  });
});

describeLive('AC12 — publishing twice', () => {
  it('is refused and writes no second audit row', async () => {
    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-fontaneria'] });
    await jobs.publish(client, created.id);

    await expect(jobs.publish(client, created.id)).rejects.toBeInstanceOf(AppError);

    const audits = await prisma.auditRecord.count({ where: { entityId: created.id } });
    expect(audits).toBe(1);
  });
});

describeLive('AC6/AC7 — location is inferred, never demanded', () => {
  it('takes the client default address at publish', async () => {
    const addressId = await addressFor(client);
    await prisma.clientProfile.upsert({
      where: { userId: client },
      create: { userId: client, displayName: 'Ana', defaultAddressId: addressId },
      update: { defaultAddressId: addressId },
    });

    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-fontaneria'] });
    expect(created.location, 'a draft should not have been given an address').toBeNull();

    const published = await jobs.publish(client, created.id);
    expect(published?.location).toMatchObject({ city: 'Madrid', postalCode: '28013' });
  });

  it('publishes without one when the client has no default either', async () => {
    const homeless = await user();
    const created = await jobs.createDraft(homeless, { categorySlugs: ['w4t01-fontaneria'] });
    const published = await jobs.publish(homeless, created.id);

    // AC7. It simply will not match a radius query until an address exists — refusing here would
    // reintroduce the requirement §2.3 rejected.
    expect(published?.status).toBe('OPEN');
    expect(published?.location).toBeNull();
  });
});

describeLive('AC8 — a bathroom is not one trade', () => {
  it('holds several categories and round-trips them in a stable order', async () => {
    // Sent in one order, read back in **taxonomy** order — the order the picker shows, not the
    // order they were typed. Insertion order does not exist: every link row written in one
    // transaction shares a `created_at`, which is how this assertion earned its keep.
    const sent = ['w4t01-fontaneria', 'w4t01-electricidad', 'w4t01-alicatado'];
    const byTaxonomy = ['w4t01-alicatado', 'w4t01-electricidad', 'w4t01-fontaneria'];
    const created = await jobs.createDraft(client, { categorySlugs: sent });

    expect(created.categories.map((entry) => entry.slug)).toEqual(byTaxonomy);

    const read = await jobs.findOwn(client, created.id);
    expect(
      read?.categories.map((entry) => entry.slug),
      'the set shuffled between reads',
    ).toEqual(byTaxonomy);
  });

  it('carries requiresLicence through, without gating anything', async () => {
    await prisma.category.update({
      where: { slug: 'w4t01-electricidad' },
      data: { requiresLicence: true },
    });
    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-electricidad'] });
    const published = await jobs.publish(client, created.id);

    // W3-T01 §3.5.2: the flag marks a verification, not an exclusion. A gated trade does not stop
    // the job being posted or seen.
    expect(published?.status).toBe('OPEN');
    expect(published?.categories[0]?.requiresLicence).toBe(true);
  });

  it('replaces the whole set on update, because a set has no other reading', async () => {
    const created = await jobs.createDraft(client, {
      categorySlugs: ['w4t01-alicatado', 'w4t01-fontaneria'],
    });
    const updated = await jobs.update(client, created.id, { categorySlugs: ['w4t01-fontaneria'] });

    expect(updated?.categories.map((entry) => entry.slug)).toEqual(['w4t01-fontaneria']);
  });
});

describeLive('AC9 — a category a client cannot legitimately pick', () => {
  it('refuses an unknown slug and writes nothing', async () => {
    const before = await prisma.job.count();
    await expect(jobs.createDraft(client, { categorySlugs: ['nope'] })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await prisma.job.count(), 'a refused draft left a row behind').toBe(before);
  });

  it('refuses a retired one, rather than silently dropping it', async () => {
    // Dropping it would publish a job that reaches fewer providers than the client believes.
    await expect(
      jobs.createDraft(client, { categorySlugs: ['w4t01-retired'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describeLive('AC11 — a stranger cannot see, edit or publish', () => {
  it('answers not-found rather than forbidden', async () => {
    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-fontaneria'] });

    // `null` becomes a 404 at the boundary. The existence of a stranger's draft is not information
    // this API gives away, so there is no 403 to distinguish it from a job that never existed.
    expect(await jobs.findOwn(stranger, created.id)).toBeNull();
    expect(await jobs.update(stranger, created.id, { title: 'Mine now' })).toBeNull();
    expect(await jobs.publish(stranger, created.id)).toBeNull();
    expect(await jobs.cancel(stranger, created.id, {})).toBeNull();
  });

  it('leaves the job untouched after all three attempts', async () => {
    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-fontaneria'] });
    await jobs.update(stranger, created.id, { title: 'Mine now' });
    await jobs.publish(stranger, created.id);

    const after = await jobs.findOwn(client, created.id);
    expect(after?.title).toBeNull();
    expect(after?.status).toBe('DRAFT');
  });
});

describeLive('AC13 — the owner list', () => {
  it('returns only the caller jobs, newest first', async () => {
    const mine = await user();
    const first = await jobs.createDraft(mine, { title: 'One' });
    const second = await jobs.createDraft(mine, { title: 'Two' });

    const listed = await jobs.listOwn(mine, 50);
    expect(listed.map((job) => job.id)).toEqual([second.id, first.id]);
    expect(await jobs.listOwn(stranger, 50)).not.toContainEqual(
      expect.objectContaining({ id: first.id }),
    );
  });
});

/* ------------------------------------------------------------------------------------------- *
 * W4-T02 — the way out
 * ------------------------------------------------------------------------------------------- */

describeLive('AC2/AC6 — cancelling a draft', () => {
  it('moves it to CANCELLED and stamps cancelled_at', async () => {
    const created = await jobs.createDraft(client, { title: 'Ya no hace falta' });
    expect(created.cancelledAt, 'a fresh draft was born cancelled').toBeNull();

    const cancelled = await jobs.cancel(client, created.id, {});

    expect(cancelled?.status).toBe('CANCELLED');
    expect(cancelled?.cancelledAt).not.toBeNull();
    expect(cancelled?.publishedAt, 'cancelling published it').toBeNull();
    expect(JobSchema.safeParse(cancelled).success).toBe(true);
  });

  it('records it through the shared machine, with no category requirement', async () => {
    // A draft with nothing in it can still be abandoned. Publishing has a floor; leaving does not.
    const created = await jobs.createDraft(client, {});
    await jobs.cancel(client, created.id, {});

    const audit = await prisma.auditRecord.findFirst({ where: { entityId: created.id } });
    expect(audit?.entity).toBe('job');
    expect(audit?.action).toBe('CANCEL');
    expect(audit?.fromState).toBe('DRAFT');
    expect(audit?.toState).toBe('CANCELLED');
    expect(audit?.actorId).toBe(client);
  });
});

describeLive('AC3 — cancelling an OPEN job, which is the exit OPEN was missing', () => {
  it('moves a published job to CANCELLED and keeps published_at', async () => {
    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-fontaneria'] });
    await jobs.publish(client, created.id);

    const cancelled = await jobs.cancel(client, created.id, {});

    expect(cancelled?.status).toBe('CANCELLED');
    expect(cancelled?.cancelledAt).not.toBeNull();
    // Both timestamps stand. The job *was* published, and a cancellation does not unsay that —
    // `audit_record` holds the same two facts in the same order.
    expect(cancelled?.publishedAt).not.toBeNull();
  });

  it('writes the second transition from OPEN, not from DRAFT', async () => {
    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-fontaneria'] });
    await jobs.publish(client, created.id);
    await jobs.cancel(client, created.id, {});

    const audits = await prisma.auditRecord.findMany({
      where: { entityId: created.id },
      orderBy: { at: 'asc' },
    });
    expect(audits.map((row) => [row.fromState, row.toState])).toEqual([
      ['DRAFT', 'OPEN'],
      ['OPEN', 'CANCELLED'],
    ]);
  });
});

describeLive('AC4 — cancelling twice', () => {
  it('is refused as a final state and writes no second audit row', async () => {
    const created = await jobs.createDraft(client, {});
    await jobs.cancel(client, created.id, {});

    await expect(jobs.cancel(client, created.id, {})).rejects.toMatchObject({ code: 'CONFLICT' });

    const audits = await prisma.auditRecord.count({ where: { entityId: created.id } });
    expect(audits, 'a refused cancel wrote an audit row').toBe(1);
  });

  it('says the state is final rather than naming a missing rule', async () => {
    const created = await jobs.createDraft(client, {});
    await jobs.cancel(client, created.id, {});

    await expect(jobs.cancel(client, created.id, {})).rejects.toThrow(/final state/i);
  });
});

describeLive('AC5 — the reason lives in the audit row', () => {
  it('writes it to metadata when given', async () => {
    const created = await jobs.createDraft(client, {});
    await jobs.cancel(client, created.id, { reason: 'lo arreglé yo mismo' });

    const audit = await prisma.auditRecord.findFirst({ where: { entityId: created.id } });
    expect(audit?.metadata).toEqual({ reason: 'lo arreglé yo mismo' });
  });

  it('leaves metadata NULL when not', async () => {
    // Omitted rather than `{}` or a null-valued key: an absent key is what produces a NULL column,
    // and "no reason given" should read as nothing recorded, not as a recorded nothing.
    const created = await jobs.createDraft(client, {});
    await jobs.cancel(client, created.id, {});

    const audit = await prisma.auditRecord.findFirst({ where: { entityId: created.id } });
    expect(audit?.metadata).toBeNull();
  });
});

describeLive('AC7/AC9 — a cancelled job is finished', () => {
  it('cannot be edited', async () => {
    const created = await jobs.createDraft(client, { title: 'Antes' });
    await jobs.cancel(client, created.id, {});

    await expect(jobs.update(client, created.id, { title: 'Después' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const after = await jobs.findOwn(client, created.id);
    expect(after?.title, 'a refused edit landed anyway').toBe('Antes');
  });

  it('cannot be published, even with the categories publishing would need', async () => {
    const created = await jobs.createDraft(client, { categorySlugs: ['w4t01-fontaneria'] });
    await jobs.cancel(client, created.id, {});

    await expect(jobs.publish(client, created.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    const after = await jobs.findOwn(client, created.id);
    expect(after?.status).toBe('CANCELLED');
    expect(after?.publishedAt).toBeNull();
  });
});

describeLive('AC13 — the rollback refuses data it cannot honestly undo', () => {
  it('fails loudly when a CANCELLED job exists, rather than rewriting it', async () => {
    // `db.test.ts` AC10 rolls every migration back against an *empty* database, which is the half
    // that proves the SQL is valid. This is the other half: Postgres cannot drop an enum value, so
    // 0011's down.sql rebuilds the type — and that is only safe while nothing holds the value.
    // Silently moving cancelled jobs to DRAFT would republish work their owners abandoned while
    // `audit_record` still said CANCEL, leaving the history and the column contradicting one
    // another. The rollback is supposed to stop instead.
    const db = migrated('w4t02_rollback');
    const scratch = new PrismaClient({ datasources: { db: { url: urlFor(db) } } });

    try {
      const owner = await createUser(scratch as unknown as FactoryClient, { roles: ['CLIENT'] });
      const repository = createJobRepository(scratch);
      const created = await repository.createDraft(owner.id, {});
      await repository.cancel(owner.id, created.id, {});
      await scratch.$disconnect();

      const down = readFileSync(join(MIGRATIONS, '0011_job_cancellation', 'down.sql'), 'utf8');

      expect(() =>
        execFileSync(
          'docker',
          [
            'compose',
            'exec',
            '-T',
            'db',
            'psql',
            '-U',
            'marketplace',
            '-d',
            db,
            '-v',
            'ON_ERROR_STOP=1',
            '-c',
            down,
          ],
          { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      ).toThrow(/cannot roll back 0011/);

      // And it stopped *before* touching anything: a rollback that half-ran would be worse than
      // one that refused, because the next attempt would start from a schema nobody described.
      expect(psql(db, `SELECT count(*) FROM "job" WHERE "status" = 'CANCELLED'`)).toBe('1');
      expect(
        psql(
          db,
          `SELECT count(*) FROM information_schema.columns WHERE table_name = 'job' AND column_name = 'cancelled_at'`,
        ),
      ).toBe('1');
    } finally {
      await scratch.$disconnect().catch(() => undefined);
      psql('marketplace', `DROP DATABASE IF EXISTS "w4t02_rollback" WITH (FORCE)`);
    }
  }, 120_000);
});
