/**
 * W1-T07 §7 AC22..AC26 — the transition ledger against a real database.
 *
 * These prove the three things the pure suite in `packages/contracts` cannot: that a record
 * written through Prisma lands in the columns the schema declares, that the table refuses to be
 * edited, and that a failed audit write takes the state change down with it.
 *
 * NOTE: this file is not in the hand-maintained list in `.github/workflows/ci.yml`, so it does
 * not yet run in the `database` job — see the spec §10 ESC-1 and issue #174.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import {
  defineMachine,
  transition,
  type AuditRecord,
  type MachineDefinition,
} from '@marketplace/contracts';

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

/** The message Postgres raised, or `NO_ERROR`. Asserting on our own RAISE text, not a SQLSTATE. */
function failureOf(database: string, sql: string): string {
  try {
    dc(
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'marketplace',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-tAc',
      sql,
    );
    return 'NO_ERROR';
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
}

function hostPort(): number {
  return Number(dc('port', 'db', '5432').split(':').pop());
}

function urlFor(database: string): string {
  return `postgres://marketplace:marketplace_local@127.0.0.1:${String(hostPort())}/${database}`;
}

/** A migrated scratch database, as in `core-schema.test.ts`. */
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

/* ------------------------------------------------------------------------------------------- *
 * The reference machine — `app_user.status`, exactly as in the pure suite (spec §3).
 * ------------------------------------------------------------------------------------------- */

type UserState = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
type UserEvent = 'SUSPEND' | 'REINSTATE' | 'ERASE';

const definition: MachineDefinition<UserState, UserEvent, void> = {
  name: 'app_user',
  initial: 'ACTIVE',
  states: ['ACTIVE', 'SUSPENDED', 'DELETED'],
  terminal: ['DELETED'],
  transitions: [
    { from: 'ACTIVE', on: 'SUSPEND', to: 'SUSPENDED' },
    { from: 'SUSPENDED', on: 'REINSTATE', to: 'ACTIVE' },
    { from: ['ACTIVE', 'SUSPENDED'], on: 'ERASE', to: 'DELETED' },
  ],
};

describe.runIf(live)('live — the transition ledger against a real database', () => {
  it('AC22 — a transition writes the state and exactly one matching audit row', async () => {
    const db = migrated('w1t07_write');
    const prisma = new PrismaClient({ datasourceUrl: urlFor(db) });
    try {
      const machine = defineMachine(definition);
      const user = await prisma.user.create({ data: { email: 'ana@example.com' } });
      const admin = await prisma.user.create({ data: { email: 'admin@example.com' } });
      const at = new Date('2026-09-10T12:00:00.000Z');

      const result = await prisma.$transaction(async (tx) => {
        const applied = await transition(
          machine,
          {
            entityId: user.id,
            from: 'ACTIVE',
            event: 'SUSPEND',
            actor: { type: 'USER', id: admin.id },
            context: undefined,
            metadata: { note: 'repeated chargebacks' },
            now: () => at,
          },
          async (record: AuditRecord) => {
            await tx.auditRecord.create({ data: record });
          },
        );
        await tx.user.update({ where: { id: user.id }, data: { status: applied.to } });
        return applied;
      });

      expect(result.to).toBe('SUSPENDED');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe(
        'SUSPENDED',
      );

      const rows = await prisma.auditRecord.findMany({ where: { entityId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entity: 'app_user',
        entityId: user.id,
        action: 'SUSPEND',
        fromState: 'ACTIVE',
        toState: 'SUSPENDED',
        actorType: 'USER',
        actorId: admin.id,
        metadata: { note: 'repeated chargebacks' },
        at,
      });
    } finally {
      await prisma.$disconnect();
    }
  }, 180_000);

  it('AC23/AC24 — a written record can be neither updated nor deleted', () => {
    const db = migrated('w1t07_immutable');
    const userId = psql(
      db,
      `INSERT INTO app_user (email) VALUES ('ana@example.com') RETURNING id`,
    ).split('\n')[0];
    psql(
      db,
      `INSERT INTO audit_record (entity, entity_id, action, from_state, to_state, actor_type, at)
       VALUES ('app_user', '${String(userId)}', 'SUSPEND', 'ACTIVE', 'SUSPENDED', 'SYSTEM', now())`,
    );

    expect(failureOf(db, `UPDATE audit_record SET to_state = 'ACTIVE'`)).toMatch(
      /AUDIT_RECORD_IMMUTABLE/,
    );
    expect(failureOf(db, `DELETE FROM audit_record`)).toMatch(/AUDIT_RECORD_IMMUTABLE/);
    expect(psql(db, 'SELECT count(*) FROM audit_record'), 'the row did not survive').toBe('1');
  }, 180_000);

  it('AC25 — a failed audit write rolls the state change back', async () => {
    const db = migrated('w1t07_atomic');
    const prisma = new PrismaClient({ datasourceUrl: urlFor(db) });
    try {
      const machine = defineMachine(definition);
      const user = await prisma.user.create({ data: { email: 'ana@example.com' } });

      const failure = await prisma
        .$transaction(async (tx) => {
          const applied = await transition(
            machine,
            {
              entityId: user.id,
              from: 'ACTIVE',
              event: 'SUSPEND',
              actor: { type: 'SYSTEM' },
              context: undefined,
            },
            async () => {
              // What a violated constraint or a lost connection looks like from here.
              await tx.auditRecord.create({
                data: {
                  entity: 'app_user',
                  entityId: 'not-a-uuid',
                  action: 'SUSPEND',
                  fromState: 'ACTIVE',
                  toState: 'SUSPENDED',
                  actorType: 'SYSTEM',
                  at: new Date(),
                },
              });
            },
          );
          await tx.user.update({ where: { id: user.id }, data: { status: applied.to } });
          return applied;
        })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status,
        'the status moved even though the ledger write failed',
      ).toBe('ACTIVE');
      expect(await prisma.auditRecord.count()).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  }, 180_000);

  it('AC26 — the column refuses a SYSTEM actor carrying a user id', () => {
    const db = migrated('w1t07_pairing');
    const userId = psql(
      db,
      `INSERT INTO app_user (email) VALUES ('ana@example.com') RETURNING id`,
    ).split('\n')[0];
    const insert = (actorType: string, actorId: string) =>
      failureOf(
        db,
        `INSERT INTO audit_record (entity, entity_id, action, from_state, to_state, actor_type, actor_id, at)
         VALUES ('app_user', '${String(userId)}', 'SUSPEND', 'ACTIVE', 'SUSPENDED', '${actorType}', ${actorId}, now())`,
      );

    expect(insert('SYSTEM', `'${String(userId)}'`)).toMatch(/audit_record_actor_pairing_check/);
    expect(insert('USER', 'NULL')).toMatch(/audit_record_actor_pairing_check/);
    expect(insert('USER', `'${String(userId)}'`)).toBe('NO_ERROR');
    expect(insert('SYSTEM', 'NULL')).toBe('NO_ERROR');
  }, 180_000);
});
