import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertResettable } from '../prisma/reset.js';
import { seeders } from '../prisma/seed/registry.js';
import { assertSafeTarget, assertUniqueSeederIds, runSeeders } from '../prisma/seed/run.js';
import type { Seeder } from '../prisma/seed/types.js';
import { disconnect, getPrismaClient } from '../src/db/client.js';
import { loadConfig } from '../src/config.js';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA = join(apiRoot, 'prisma', 'schema.prisma');
const MIGRATIONS = join(apiRoot, 'prisma', 'migrations');

function schema(): string {
  expect(existsSync(SCHEMA), 'prisma/schema.prisma does not exist').toBe(true);
  return readFileSync(SCHEMA, 'utf8');
}

function migrationFolders(): string[] {
  expect(existsSync(MIGRATIONS), 'prisma/migrations does not exist').toBe(true);
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const LOCAL_URL = 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace';

function config(overrides: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_URL: LOCAL_URL,
    // Required since `W2-T01` §4.8, and `loadConfig` refuses the whole environment when one is
    // missing — which is the behaviour that ticket wants, so the fixture satisfies it rather than
    // the schema relaxing to suit a test.
    BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
    BETTER_AUTH_URL: 'http://127.0.0.1:5173',
    ...overrides,
  });
}

/* ------------------------------------------------------------------------------------------- *
 * Schema and client — AC1..AC5
 * ------------------------------------------------------------------------------------------- */

describe('AC1 — the client generates without a database', () => {
  it('generates against an unreachable DATABASE_URL', () => {
    const run = (): string =>
      execFileSync('pnpm', ['exec', 'prisma', 'generate', '--schema', SCHEMA], {
        cwd: apiRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/does-not-exist',
        },
      });
    expect(run).not.toThrow();
  }, 180_000);
});

describe('AC2 — the datasource is declared, never hardcoded', () => {
  it('reads postgresql from env("DATABASE_URL")', () => {
    const source = schema();
    expect(source).toMatch(/provider\s*=\s*"postgresql"/);
    expect(source).toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
  });

  it('contains no connection string literal', () => {
    expect(schema()).not.toMatch(/postgres(ql)?:\/\//);
  });
});

describe('AC3 — the client is built from Config, never from the ambient environment', () => {
  it('never reads process.env', () => {
    const source = readFileSync(join(apiRoot, 'src', 'db', 'client.ts'), 'utf8');
    expect(source).not.toContain('process.env');
  });

  it('builds a client from a validated Config', () => {
    expect(() => getPrismaClient(config())).not.toThrow();
  });
});

describe('AC4 — one client per process', () => {
  it('returns the same instance on a second call', () => {
    expect(getPrismaClient(config())).toBe(getPrismaClient(config()));
  });
});

describe('AC5 — nothing connects at boot', () => {
  it('does not let the composition root import the database module', () => {
    const source = readFileSync(join(apiRoot, 'src', 'app.ts'), 'utf8');
    expect(source, 'app.ts imports the db client — boot would open a pool').not.toMatch(
      /from '\.\/db\//,
    );
  });

  it('exposes a disconnect for shutdown hooks and tests', async () => {
    await expect(disconnect()).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Migration conventions — AC9, AC11
 * ------------------------------------------------------------------------------------------- */

describe('AC9 — every migration carries an explicit rollback', () => {
  it('has at least one migration', () => {
    expect(migrationFolders().length).toBeGreaterThan(0);
  });

  it('pairs every migration.sql with a non-empty down.sql', () => {
    for (const folder of migrationFolders()) {
      const up = join(MIGRATIONS, folder, 'migration.sql');
      const down = join(MIGRATIONS, folder, 'down.sql');
      expect(existsSync(up), `${folder} has no migration.sql`).toBe(true);
      expect(existsSync(down), `${folder} has no down.sql — see spec §8`).toBe(true);
      expect(
        readFileSync(down, 'utf8').trim().length,
        `${folder}/down.sql is empty`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('AC11 — migration folders are ordered and unambiguous', () => {
  it('names every folder NNNN_snake_case, contiguous from 0000', () => {
    const folders = migrationFolders();
    const numbers: number[] = [];
    for (const folder of folders) {
      expect(folder, `${folder} is not NNNN_snake_case`).toMatch(/^\d{4}_[a-z0-9]+(_[a-z0-9]+)*$/);
      numbers.push(Number(folder.slice(0, 4)));
    }
    expect(numbers).toEqual(numbers.map((_, index) => index));
  });
});

describe('AC8 (static half) — the first migration asserts PostGIS rather than creating it', () => {
  it('raises with the command a human must run, and never creates the extension', () => {
    const sql = readFileSync(join(MIGRATIONS, '0000_require_postgis', 'migration.sql'), 'utf8');
    expect(sql).toMatch(/CREATE EXTENSION postgis/);
    expect(sql, 'the migration creates the extension instead of asserting it').not.toMatch(
      /^\s*CREATE EXTENSION/im,
    );
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Seed scaffold — AC13, AC17, AC18, AC19
 * ------------------------------------------------------------------------------------------- */

function seeder(id: string, overrides: Partial<Seeder> = {}): Seeder {
  return {
    id,
    description: `test seeder ${id}`,
    run: async () => {},
    ...overrides,
  };
}

describe('AC13 — an empty registry is a working registry', () => {
  /**
   * This used to assert `seeders` was literally `[]`, which was true when `W0-T05` shipped the
   * scaffold and became false the moment a slice did what the registry's own comment invites —
   * `W2-T01` appended `auth.demo-users`. An assertion that the list is empty is not AC13; AC13 is
   * that the *pipeline* works with nothing in it, which the test below is.
   *
   * What is worth pinning about the registry's contents is that every entry is well-formed, so a
   * seeder added without an id or a reason fails here rather than at 03:00 against a real database.
   */
  it('ships only well-formed seeders', () => {
    for (const entry of seeders) {
      expect(entry.id, 'a seeder needs a stable, permanent id — it is the ledger key').toMatch(
        /^[a-z0-9]+(\.[a-z0-9-]+)+$/,
      );
      expect(entry.description.length, `${entry.id} needs a description`).toBeGreaterThan(10);
      expect(typeof entry.run).toBe('function');
    }
    expect(() => {
      assertUniqueSeederIds([...seeders]);
    }).not.toThrow();
  });

  it('accepts an empty list without complaint', () => {
    expect(() => {
      assertUniqueSeederIds([]);
    }).not.toThrow();
  });
});

describe('AC17 — duplicate seeder ids fail before anything connects', () => {
  it('names the duplicated id', () => {
    expect(() => {
      assertUniqueSeederIds([seeder('categories.base'), seeder('categories.base')]);
    }).toThrow(/SEED_DUPLICATE_ID.*categories\.base/s);
  });

  it('allows distinct ids', () => {
    expect(() => {
      assertUniqueSeederIds([seeder('a'), seeder('b')]);
    }).not.toThrow();
  });
});

describe('AC18 — a localOnly seeder refuses a non-local target', () => {
  it('refuses a remote host', () => {
    expect(() => {
      assertSafeTarget('postgres://u:p@db.example.com:5432/marketplace', [
        seeder('demo', { localOnly: true }),
      ]);
    }).toThrow(/SEED_UNSAFE_TARGET.*db\.example\.com/s);
  });

  it('allows loopback', () => {
    expect(() => {
      assertSafeTarget(LOCAL_URL, [seeder('demo', { localOnly: true })]);
    }).not.toThrow();
  });

  it('allows a remote host when no seeder is localOnly', () => {
    expect(() => {
      assertSafeTarget('postgres://u:p@db.example.com:5432/marketplace', [seeder('safe')]);
    }).not.toThrow();
  });
});

describe('AC19 — reset never runs in production', () => {
  it('refuses, naming the variable', () => {
    expect(() => {
      assertResettable({ NODE_ENV: 'production' });
    }).toThrow(/RESET_IN_PRODUCTION.*NODE_ENV/s);
  });

  it('allows development and test', () => {
    expect(() => {
      assertResettable({ NODE_ENV: 'development' });
    }).not.toThrow();
    expect(() => {
      assertResettable({ NODE_ENV: 'test' });
    }).not.toThrow();
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Live criteria — AC6, AC7, AC8, AC10, AC12, AC14..AC16.
 * Gated exactly like W0-T02's stack tests: the default gate needs no daemon; CI opts in.
 * ------------------------------------------------------------------------------------------- */

const live = process.env['STACK_LIVE'] === '1';
const repoRoot = join(apiRoot, '..', '..');

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
  const mapping = dc('port', 'db', '5432');
  return Number(mapping.split(':').pop());
}

function urlFor(database: string): string {
  return `postgres://marketplace:marketplace_local@127.0.0.1:${String(hostPort())}/${database}`;
}

interface RunResult {
  status: number;
  output: string;
}

/** Runs the CLI verbatim — `--schema` is passed by the caller, because `migrate diff` rejects it. */
function prisma(args: string[], databaseUrl: string): RunResult {
  try {
    const output = execFileSync('pnpm', ['exec', 'prisma', ...args], {
      cwd: apiRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

/** A throwaway database per test, so nothing here can corrupt the developer's own. */
function scratch(name: string, withPostgis: boolean): string {
  psql('marketplace', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  psql('marketplace', `CREATE DATABASE "${name}"`);
  if (withPostgis) psql(name, 'CREATE EXTENSION IF NOT EXISTS postgis');
  return name;
}

describe.runIf(live)('live — migrations against a real PostGIS database', () => {
  it('AC6 — applies every migration to an empty database', () => {
    const db = scratch('w0t05_apply', true);
    const result = prisma(['migrate', 'deploy', '--schema', SCHEMA], urlFor(db));
    expect(result.output).toBeTruthy();
    expect(result.status, result.output).toBe(0);
  }, 180_000);

  it('AC7 — is a no-op the second time', () => {
    const db = scratch('w0t05_idempotent', true);
    expect(prisma(['migrate', 'deploy', '--schema', SCHEMA], urlFor(db)).status).toBe(0);
    const second = prisma(['migrate', 'deploy', '--schema', SCHEMA], urlFor(db));
    expect(second.status, second.output).toBe(0);
    expect(second.output).toMatch(/No pending migrations/i);
  }, 180_000);

  it('AC8 — refuses a database without PostGIS', () => {
    const db = scratch('w0t05_nogis', false);
    const result = prisma(['migrate', 'deploy', '--schema', SCHEMA], urlFor(db));
    expect(result.status, 'the migration succeeded without PostGIS').not.toBe(0);
    expect(result.output).toMatch(/postgis/i);
    // It must stop, not press on: no later migration may have created its table.
    const ledger = psql(db, `SELECT to_regclass('public._seed_run') IS NOT NULL`);
    expect(ledger).toBe('f');
  }, 180_000);

  it('AC12 — leaves no drift between the migrations and the schema', () => {
    const db = scratch('w0t05_drift', true);
    expect(prisma(['migrate', 'deploy', '--schema', SCHEMA], urlFor(db)).status).toBe(0);
    const diff = prisma(
      ['migrate', 'diff', '--from-url', urlFor(db), '--to-schema-datamodel', SCHEMA, '--exit-code'],
      urlFor(db),
    );
    expect(diff.status, `drift detected:\n${diff.output}`).toBe(0);
  }, 180_000);

  it('AC10 — every down.sql rolls its migration back, in reverse order', () => {
    const db = scratch('w0t05_down', true);
    expect(prisma(['migrate', 'deploy', '--schema', SCHEMA], urlFor(db)).status).toBe(0);
    expect(psql(db, `SELECT to_regclass('public._seed_run') IS NOT NULL`)).toBe('t');

    for (const folder of [...migrationFolders()].reverse()) {
      const down = readFileSync(join(MIGRATIONS, folder, 'down.sql'), 'utf8');
      dc(
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
      );
    }

    expect(psql(db, `SELECT to_regclass('public._seed_run') IS NOT NULL`)).toBe('f');
  }, 180_000);
});

describe.runIf(live)('live — the seed runner', () => {
  async function withSeededDatabase<T>(
    name: string,
    body: (url: string) => Promise<T>,
  ): Promise<T> {
    const db = scratch(name, true);
    const url = urlFor(db);
    expect(prisma(['migrate', 'deploy', '--schema', SCHEMA], url).status).toBe(0);
    const client = getPrismaClient(config({ DATABASE_URL: url }), { fresh: true });
    try {
      return await body(url);
    } finally {
      await client.$disconnect();
    }
  }

  it('AC14 — runs a pending seeder once and records it', async () => {
    await withSeededDatabase('w0t05_seed_once', async (url) => {
      let runs = 0;
      const result = await runSeeders({
        databaseUrl: url,
        seeders: [
          seeder('demo.one', {
            run: async () => {
              runs += 1;
            },
          }),
        ],
      });
      expect(runs).toBe(1);
      expect(result.ran).toEqual(['demo.one']);
      expect(result.skipped).toEqual([]);
    });
  }, 180_000);

  it('AC15 — skips a seeder that already ran, leaving its ledger row untouched', async () => {
    await withSeededDatabase('w0t05_seed_twice', async (url) => {
      let runs = 0;
      const one = seeder('demo.one', {
        run: async () => {
          runs += 1;
        },
      });
      const first = await runSeeders({ databaseUrl: url, seeders: [one] });
      const second = await runSeeders({ databaseUrl: url, seeders: [one] });
      expect(runs).toBe(1);
      expect(second.ran).toEqual([]);
      expect(second.skipped).toEqual(['demo.one']);
      expect(second.ledger['demo.one']).toEqual(first.ledger['demo.one']);
    });
  }, 180_000);

  it('AC16 — records nothing when a seeder throws', async () => {
    await withSeededDatabase('w0t05_seed_throws', async (url) => {
      await expect(
        runSeeders({
          databaseUrl: url,
          seeders: [
            seeder('demo.boom', {
              run: async () => {
                throw new Error('boom');
              },
            }),
          ],
        }),
      ).rejects.toThrow(/boom/);
      const after = await runSeeders({ databaseUrl: url, seeders: [] });
      expect(Object.keys(after.ledger)).not.toContain('demo.boom');
    });
  }, 180_000);
});
