/**
 * W1-T05 — the core schema, proved against a real PostGIS database.
 *
 * Spec: docs/specs/S1/W1-T05-core-schema.md §10. One `it` per acceptance criterion, named for it,
 * so a failure names the criterion it broke rather than a table.
 *
 * The live helpers below duplicate `db.test.ts` rather than extracting a shared module. That file
 * belongs to `W0-T05` / `agent-devops`, and refactoring another slice's tests to save forty lines
 * is the non-functional restructuring `agents/prompts/00-spec-authoring.md` says to get agreed
 * first — see this task's run record.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = join(apiRoot, '..', '..');
const SCHEMA = join(apiRoot, 'prisma', 'schema.prisma');
const MIGRATIONS = join(apiRoot, 'prisma', 'migrations');

const live = process.env['STACK_LIVE'] === '1';

const TABLES = [
  'app_user',
  'client_profile',
  'provider_profile',
  'address',
  'category',
  'provider_category',
] as const;

const ENUMS = ['user_role', 'user_status', 'provider_kind', 'locale'] as const;

/**
 * Every migration after the `0001` state this task started from, in apply order — **derived**.
 *
 * This was a hand-written list of four, and `W2-T01` is what it cost. `migrated()` applies *all*
 * migrations; the rollback below walks this list in reverse. With `0006`–`0008` missing from it,
 * `session` and `account` were still present when `0003`'s `down.sql` tried to drop `app_user`:
 *
 *     ERROR:  cannot drop table app_user because other objects depend on it
 *
 * `0006_audit_record` had been missing for just as long and never failed, because `audit_record`
 * carries no foreign key to `app_user` by design — so the gap was invisible until a migration
 * added one. That is the fourth time a hand-written subject list in this repo has silently
 * measured less than it claimed (MEM: "CI gates fail open — and fail silent").
 *
 * `0000` and `0001` are excluded by number, not by name: they are the state the rollback stops at,
 * asserted at the end of AC-2.
 */
const NEW_MIGRATIONS: readonly string[] = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{4}_/.test(entry.name))
  .map((entry) => entry.name)
  .sort()
  .filter((name) => !name.startsWith('0000_') && !name.startsWith('0001_'));

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

/**
 * Runs SQL and returns the SQLSTATE it failed with, or `NO_ERROR` if it succeeded.
 *
 * `VERBOSITY verbose` is what makes psql print the five-character code at all; without it the
 * output is prose, and a test asserting on prose asserts on a translation.
 */
function sqlstate(database: string, sql: string): string {
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
      '-c',
      String.raw`\set VERBOSITY verbose`,
      '-tAc',
      sql,
    );
    return 'NO_ERROR';
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    return /ERROR:\s+([0-9A-Z]{5}):/.exec(output)?.[1] ?? output;
  }
}

/**
 * The value of a `RETURNING` insert. psql prints the row *and* its `INSERT 0 1` status tag, and
 * feeding the pair back in as a uuid produces a parse error that looks like a schema bug.
 */
function returned(output: string): string {
  return output.split('\n')[0]?.trim() ?? '';
}

function hostPort(): number {
  return Number(dc('port', 'db', '5432').split(':').pop());
}

function urlFor(database: string): string {
  return `postgres://marketplace:marketplace_local@127.0.0.1:${String(hostPort())}/${database}`;
}

interface RunResult {
  status: number;
  output: string;
}

function prisma(args: string[], databaseUrl: string): RunResult {
  try {
    return {
      status: 0,
      output: execFileSync('pnpm', ['exec', 'prisma', ...args], {
        cwd: apiRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DATABASE_URL: databaseUrl },
      }),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

function scratch(name: string): string {
  psql('marketplace', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  psql('marketplace', `CREATE DATABASE "${name}"`);
  psql(name, 'CREATE EXTENSION IF NOT EXISTS postgis');
  return name;
}

/** A migrated scratch database. Every read-only criterion shares one; destructive ones take their own. */
function migrated(name: string): string {
  const db = scratch(name);
  const result = prisma(['migrate', 'deploy', '--schema', SCHEMA], urlFor(db));
  expect(result.status, result.output).toBe(0);
  return db;
}

/** A user row, returning its id. Enough columns to be valid, no more. */
function makeUser(db: string, email: string, roles = "'{CLIENT}'"): string {
  return returned(
    psql(
      db,
      `INSERT INTO app_user (email, roles) VALUES ('${email}', ${roles}::user_role[]) RETURNING id`,
    ),
  );
}

function makeAddress(db: string, userId: string, lat = 40.416775, lng = -3.70379): string {
  return returned(
    psql(
      db,
      `INSERT INTO address (user_id, line1, city, province, postal_code, latitude, longitude)
       VALUES ('${userId}', 'Calle Mayor 1', 'Madrid', 'Madrid', '28001', ${String(lat)}, ${String(lng)})
       RETURNING id`,
    ),
  );
}

/* ------------------------------------------------------------------------------------------- *
 * Static — the schema file and the migration folders. These need no database.
 * ------------------------------------------------------------------------------------------- */

describe('the schema declares what §5 specifies', () => {
  const source = (): string => {
    expect(existsSync(SCHEMA), 'prisma/schema.prisma does not exist').toBe(true);
    return readFileSync(SCHEMA, 'utf8');
  };

  it('declares all six models', () => {
    for (const model of [
      'User',
      'ClientProfile',
      'ProviderProfile',
      'Address',
      'Category',
      'ProviderCategory',
    ]) {
      expect(source(), `model ${model} is missing`).toMatch(new RegExp(`model\\s+${model}\\s*\\{`));
    }
  });

  it('declares all four enums', () => {
    for (const e of ['UserRole', 'UserStatus', 'ProviderKind', 'Locale']) {
      expect(source(), `enum ${e} is missing`).toMatch(new RegExp(`enum\\s+${e}\\s*\\{`));
    }
  });

  it('keeps the geography column Unsupported, so drift detection stays quiet (§4.1)', () => {
    expect(source()).toMatch(/Unsupported\("geography\(Point,\s*4326\)"\)/);
  });

  it('puts no latitude on provider_profile — Q2 moved it to address', () => {
    const model = /model\s+ProviderProfile\s*\{[\s\S]*?\n\}/.exec(source())?.[0] ?? '';
    expect(model, 'ProviderProfile still carries coordinates').not.toMatch(/latitude/);
    expect(model).toMatch(/baseAddressId/);
  });

  it('every new migration folder carries a non-empty down.sql (P3)', () => {
    for (const folder of NEW_MIGRATIONS) {
      const down = join(MIGRATIONS, folder, 'down.sql');
      expect(existsSync(down), `${folder}/down.sql does not exist`).toBe(true);
      expect(
        readFileSync(down, 'utf8').trim().length,
        `${folder}/down.sql is empty`,
      ).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Live — §10 AC-1..AC-17. AC-18 belongs to W3-T01 and is not tested here.
 * ------------------------------------------------------------------------------------------- */

describe.runIf(live)('live — the core schema against a real PostGIS database', () => {
  it('AC-1 — every migration applies, and all six tables and four enums exist', () => {
    const db = migrated('w1t05_apply');
    for (const table of TABLES) {
      expect(psql(db, `SELECT to_regclass('public."${table}"') IS NOT NULL`), table).toBe('t');
    }
    for (const name of ENUMS) {
      expect(
        psql(db, `SELECT count(*) FROM pg_type WHERE typname = '${name}' AND typtype = 'e'`),
        name,
      ).toBe('1');
    }
  }, 180_000);

  it('finds the migrations at all — an empty list would pass AC-2 vacuously', () => {
    // The failure the derivation replaces was a list that was *too short*, and a too-short list is
    // indistinguishable from a correct one unless something counts.
    expect(NEW_MIGRATIONS.length).toBeGreaterThanOrEqual(7);
    expect(NEW_MIGRATIONS).toContain('0003_core_identity');
    expect(NEW_MIGRATIONS[0]).toBe('0002_core_enums');
    expect(NEW_MIGRATIONS.some((name) => name.startsWith('0001_'))).toBe(false);
  });

  it('AC-2 — every down.sql rolls back, in reverse order, to the 0001 state', () => {
    const db = migrated('w1t05_down');
    for (const folder of [...NEW_MIGRATIONS].reverse()) {
      const sql = readFileSync(join(MIGRATIONS, folder, 'down.sql'), 'utf8');
      expect(() => psql(db, sql), `${folder}/down.sql failed`).not.toThrow();
    }
    for (const table of TABLES) {
      expect(psql(db, `SELECT to_regclass('public."${table}"') IS NULL`), table).toBe('t');
    }
    for (const name of ENUMS) {
      expect(psql(db, `SELECT count(*) FROM pg_type WHERE typname = '${name}'`), name).toBe('0');
    }
    // 0001 survives — the rollback stops where this task started.
    expect(psql(db, `SELECT to_regclass('public._seed_run') IS NOT NULL`)).toBe('t');
  }, 180_000);

  /**
   * The property is unchanged — a second `ana@example.com` never lands, in any case — but `W2-T01`
   * §4.2 changed *which* constraint says no, and the criterion is worth restating rather than
   * loosening to `not null`.
   *
   * `W1-T05` enforced this with a unique index on `lower(email)`, so a mixed-case duplicate was a
   * unique violation (`23505`). better-auth issues `WHERE email = $1`, which that index cannot
   * serve, so `0008` replaced it with a plain unique index plus `CHECK (email = lower(email))`.
   * Mixed case is now rejected *before* uniqueness is considered — a check violation (`23514`) —
   * which is strictly stronger: the old design let a mixed-case address be stored as long as no
   * lowercase twin existed, and this one does not let it be stored at all.
   */
  it('AC-3 — a duplicate email is rejected whatever its case', () => {
    const db = migrated('w1t05_email');
    makeUser(db, 'ana@example.com');

    // An exact duplicate: still the unique index, still 23505.
    expect(sqlstate(db, `INSERT INTO app_user (email) VALUES ('ana@example.com')`)).toBe('23505');

    // A mixed-case duplicate: 23514, the CHECK, before uniqueness is reached.
    expect(sqlstate(db, `INSERT INTO app_user (email) VALUES ('ANA@Example.com')`)).toBe('23514');

    // And mixed case is refused even with no twin to collide with — the part `W1-T05` could not
    // enforce, and the reason the swap is not a downgrade.
    expect(sqlstate(db, `INSERT INTO app_user (email) VALUES ('Nobody@Example.com')`)).toBe(
      '23514',
    );
  }, 180_000);

  it('AC-4 — the roles/profile detector finds an inconsistent user and clears a consistent one', () => {
    const db = migrated('w1t05_invariant');
    const detector = `SELECT count(*) FROM app_user u
        LEFT JOIN provider_profile p ON p.user_id = u.id
       WHERE ('PROVIDER' = ANY (u.roles)) <> (p.id IS NOT NULL)`;

    const consistent = makeUser(db, 'pro@example.com', "'{CLIENT,PROVIDER}'");
    // `base_address_id` is NOT NULL since `W3-T02` — a provider profile is not a row that can be
    // written on its own, here or anywhere else.
    psql(
      db,
      `INSERT INTO provider_profile (user_id, kind, display_name, base_address_id)
       VALUES ('${consistent}', 'PRO', 'Fontanería Ana', '${makeAddress(db, consistent)}')`,
    );
    expect(psql(db, detector), 'a consistent pair was reported as a violation').toBe('0');

    makeUser(db, 'liar@example.com', "'{CLIENT,PROVIDER}'");
    expect(psql(db, detector), 'a PROVIDER with no profile went undetected').toBe('1');
  }, 180_000);

  it('AC-5 — a user gets at most one client profile', () => {
    const db = migrated('w1t05_one_client');
    const user = makeUser(db, 'one@example.com');
    psql(db, `INSERT INTO client_profile (user_id, display_name) VALUES ('${user}', 'Ana')`);
    expect(
      sqlstate(
        db,
        `INSERT INTO client_profile (user_id, display_name) VALUES ('${user}', 'Ana 2')`,
      ),
    ).toBe('23505');
  }, 180_000);

  it('AC-6 — deleting a user takes every dependent row with it', () => {
    const db = migrated('w1t05_cascade');
    const user = makeUser(db, 'gone@example.com', "'{CLIENT,PROVIDER}'");
    psql(db, `INSERT INTO client_profile (user_id, display_name) VALUES ('${user}', 'Ana')`);
    const base = makeAddress(db, user);
    makeAddress(db, user, 41.3874, 2.1686);
    psql(
      db,
      `INSERT INTO provider_profile (user_id, kind, display_name, base_address_id)
       VALUES ('${user}', 'MANITAS', 'Ana', '${base}')`,
    );

    psql(db, `DELETE FROM app_user WHERE id = '${user}'`);

    expect(psql(db, `SELECT count(*) FROM client_profile`), 'client_profile orphan').toBe('0');
    expect(psql(db, `SELECT count(*) FROM provider_profile`), 'provider_profile orphan').toBe('0');
    expect(psql(db, `SELECT count(*) FROM address`), 'address orphan').toBe('0');
  }, 180_000);

  it('AC-7 — a category in use cannot be deleted', () => {
    const db = migrated('w1t05_restrict');
    const user = makeUser(db, 'pro2@example.com', "'{PROVIDER}'");
    const provider = returned(
      psql(
        db,
        `INSERT INTO provider_profile (user_id, kind, display_name, base_address_id)
         VALUES ('${user}', 'PRO', 'Ana', '${makeAddress(db, user)}') RETURNING id`,
      ),
    );
    const category = returned(
      psql(
        db,
        `INSERT INTO category (slug, name_es, name_en) VALUES ('fontaneria', 'Fontanería', 'Plumbing') RETURNING id`,
      ),
    );
    psql(
      db,
      `INSERT INTO provider_category (provider_profile_id, category_id) VALUES ('${provider}', '${category}')`,
    );
    expect(sqlstate(db, `DELETE FROM category WHERE id = '${category}'`)).toBe('23503');
  }, 180_000);

  it('AC-8 — deleting a default address leaves the client profile, without the pointer', () => {
    const db = migrated('w1t05_default_addr');
    const user = makeUser(db, 'client@example.com');
    const address = makeAddress(db, user);
    psql(
      db,
      `INSERT INTO client_profile (user_id, display_name, default_address_id)
       VALUES ('${user}', 'Ana', '${address}')`,
    );
    psql(db, `DELETE FROM address WHERE id = '${address}'`);
    expect(psql(db, `SELECT count(*) FROM client_profile`)).toBe('1');
    expect(psql(db, `SELECT default_address_id IS NULL FROM client_profile`)).toBe('t');
  }, 180_000);

  /**
   * `W1-T05` wrote this as *"deleting a base address leaves the provider, no longer searchable"* —
   * `ON DELETE SET NULL`, and a provider quietly dropped out of every search. `W3-T02` §8.1 made
   * the column `NOT NULL`, which makes that outcome impossible to express, and the foreign key had
   * to change with it: `RESTRICT` says the same intent correctly. You cannot delete the address a
   * provider works from while they work from it, and nobody is unlisted by a `DELETE` somewhere
   * else.
   */
  it('AC-9 / W3-T02 AC18 — deleting a base address is refused, not absorbed', () => {
    const db = migrated('w1t05_base_addr');
    const user = makeUser(db, 'pro3@example.com', "'{PROVIDER}'");
    const address = makeAddress(db, user);
    psql(
      db,
      `INSERT INTO provider_profile (user_id, kind, display_name, base_address_id)
       VALUES ('${user}', 'PRO', 'Ana', '${address}')`,
    );

    // 23503, foreign_key_violation — the delete does not happen.
    expect(sqlstate(db, `DELETE FROM address WHERE id = '${address}'`)).toBe('23503');
    expect(psql(db, `SELECT count(*) FROM provider_profile`)).toBe('1');
    expect(psql(db, `SELECT count(*) FROM address WHERE id = '${address}'`)).toBe('1');
  }, 180_000);

  /**
   * `W3-T02` AC16, and the home of two assertions that used to be runtime questions.
   *
   * `provider-live.test.ts` seeded a provider with no base address and asserted the endpoint had
   * nothing to serve; `search-live.test.ts` seeded one and asserted it was unsearchable. Neither
   * row can be written any more, so the claim belongs where impossibility is enforced rather than
   * observed (`W3-T02` §8.5).
   */
  it('W3-T02 AC16 — a provider profile with no base address cannot be written at all', () => {
    const db = migrated('w3t02_base_required');
    const user = makeUser(db, 'nobase@example.com', "'{PROVIDER}'");

    // 23502, not_null_violation.
    expect(
      sqlstate(
        db,
        `INSERT INTO provider_profile (user_id, kind, display_name)
         VALUES ('${user}', 'PRO', 'Sin base')`,
      ),
      'a provider profile without a base address was accepted',
    ).toBe('23502');

    expect(
      sqlstate(
        db,
        `INSERT INTO provider_profile (user_id, kind, display_name, base_address_id)
         VALUES ('${user}', 'PRO', 'Con base', '${makeAddress(db, user)}')`,
      ),
      'a provider profile with one was rejected',
    ).toBe('NO_ERROR');
  }, 180_000);

  it('AC-10 — a postal code must be five digits', () => {
    const db = migrated('w1t05_postcode');
    const user = makeUser(db, 'pc@example.com');
    expect(
      sqlstate(
        db,
        `INSERT INTO address (user_id, line1, city, province, postal_code, latitude, longitude)
         VALUES ('${user}', 'Calle', 'Madrid', 'Madrid', '2807', 40.4, -3.7)`,
      ),
    ).toBe('23514');
    expect(makeAddress(db, user)).toMatch(/^[0-9a-f-]{36}$/);
  }, 180_000);

  it('AC-11 — a service radius must be positive and at most 200 km', () => {
    const db = migrated('w1t05_radius');
    const user = makeUser(db, 'radius@example.com', "'{PROVIDER}'");
    const address = makeAddress(db, user);
    const insert = (metres: number): string =>
      `INSERT INTO provider_profile (user_id, kind, display_name, service_radius_metres, base_address_id)
       VALUES ('${user}', 'PRO', 'Ana', ${String(metres)}, '${address}')`;
    expect(sqlstate(db, insert(0)), 'zero was accepted').toBe('23514');
    expect(sqlstate(db, insert(250_000)), '250 km was accepted').toBe('23514');
    expect(sqlstate(db, insert(15_000)), '15 km was rejected').toBe('NO_ERROR');
  }, 180_000);

  it('AC-12 — longitude goes in first, so Puerta del Sol lands in Madrid', () => {
    const db = migrated('w1t05_axis');
    const user = makeUser(db, 'sol@example.com');
    makeAddress(db, user, 40.416775, -3.70379);
    expect(Number(psql(db, `SELECT ST_X(location::geometry) FROM address`))).toBeCloseTo(
      -3.70379,
      5,
    );
    expect(Number(psql(db, `SELECT ST_Y(location::geometry) FROM address`))).toBeCloseTo(
      40.416775,
      5,
    );
  }, 180_000);

  it('AC-13 — the generated column leaves no Prisma drift', () => {
    const db = migrated('w1t05_drift');
    const diff = prisma(
      ['migrate', 'diff', '--from-url', urlFor(db), '--to-schema-datamodel', SCHEMA, '--exit-code'],
      urlFor(db),
    );
    expect(diff.status, `drift detected — §13 Q4 applies:\n${diff.output}`).toBe(0);
  }, 180_000);

  it('AC-14 — location follows latitude, with no application code writing it', () => {
    const db = migrated('w1t05_generated');
    const user = makeUser(db, 'moves@example.com');
    const address = makeAddress(db, user, 40.416775, -3.70379);
    psql(
      db,
      `UPDATE address SET latitude = 41.387400, longitude = 2.168600 WHERE id = '${address}'`,
    );
    expect(Number(psql(db, `SELECT ST_Y(location::geometry) FROM address`))).toBeCloseTo(
      41.3874,
      5,
    );
  }, 180_000);

  it('AC-15 — ST_DWithin finds the near address and not the far one', () => {
    const db = migrated('w1t05_dwithin');
    const user = makeUser(db, 'near@example.com');
    makeAddress(db, user, 40.416775, -3.70379); // Puerta del Sol
    makeAddress(db, user, 40.4258, -3.6919); // ~1.4 km away
    const count = psql(
      db,
      `SELECT count(*) FROM address
        WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(-3.70379, 40.416775), 4326)::geography, 500)`,
    );
    expect(count).toBe('1');
  }, 180_000);

  it('AC-16 — the planner actually uses the GIST index', () => {
    const db = migrated('w1t05_index_used');
    const user = makeUser(db, 'many@example.com');
    psql(
      db,
      `INSERT INTO address (user_id, line1, city, province, postal_code, latitude, longitude)
       SELECT '${user}', 'Calle ' || g, 'Madrid', 'Madrid', '28001',
              40.0 + (g % 1000) * 0.001, -3.9 + (g / 1000.0) * 0.001
         FROM generate_series(1, 20000) g`,
    );
    psql(db, 'ANALYZE address');
    const plan = psql(
      db,
      `EXPLAIN (FORMAT TEXT) SELECT id FROM address
        WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(-3.70379, 40.416775), 4326)::geography, 200)`,
    );
    expect(plan, `the planner ignored the index:\n${plan}`).toMatch(/address_location_gist/);
  }, 300_000);

  it('AC-17 — a mixed-case lookup finds the account', () => {
    const db = migrated('w1t05_lower');
    makeUser(db, 'ana@example.com');
    expect(
      psql(db, `SELECT count(*) FROM app_user WHERE lower(email) = lower('ANA@example.com')`),
    ).toBe('1');
  }, 180_000);
});
