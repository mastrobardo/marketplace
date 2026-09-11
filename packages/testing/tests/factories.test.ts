import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ID_PREFIXES,
  buildAddress,
  buildAuditRecord,
  buildCategory,
  buildClientProfile,
  buildProviderCategory,
  buildProviderProfile,
  buildUser,
  createAddress,
  createAuditRecord,
  createCategory,
  createClientProfile,
  createProviderCategory,
  createProviderProfile,
  createUser,
  nextAt,
  resetFactories,
  type FactoryClient,
} from '../src/index.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const SCHEMA = join(repoRoot, 'apps', 'api', 'prisma', 'schema.prisma');

/** v4-shaped: version nibble 4, variant 8..b. What `@db.Uuid` and `z.uuid()` both accept. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const BUILDERS = {
  User: buildUser,
  ClientProfile: buildClientProfile,
  ProviderProfile: buildProviderProfile,
  Address: buildAddress,
  Category: buildCategory,
  ProviderCategory: buildProviderCategory,
  AuditRecord: buildAuditRecord,
} as const;

const CREATORS = {
  User: createUser,
  ClientProfile: createClientProfile,
  ProviderProfile: createProviderProfile,
  Address: createAddress,
  Category: createCategory,
  ProviderCategory: createProviderCategory,
  AuditRecord: createAuditRecord,
} as const;

/**
 * A recording fake. Ten lines, because `FactoryClient` is a structural interface rather than
 * `PrismaClient` (spec §4.3 Decision D) — which is what lets AC11..AC13 run in CI's `unit` job
 * instead of behind `STACK_LIVE`.
 */
function fakeClient(): FactoryClient & { calls: { model: string; data: unknown }[] } {
  const calls: { model: string; data: unknown }[] = [];
  const delegate = (model: string) => ({
    create: ({ data }: { data: unknown }) => {
      calls.push({ model, data });
      return Promise.resolve(data);
    },
  });
  return {
    calls,
    user: delegate('user'),
    clientProfile: delegate('clientProfile'),
    providerProfile: delegate('providerProfile'),
    address: delegate('address'),
    category: delegate('category'),
    providerCategory: delegate('providerCategory'),
    auditRecord: delegate('auditRecord'),
  } as FactoryClient & { calls: { model: string; data: unknown }[] };
}

/*
 * `resetFactories()` is hooked per-describe rather than once at the top of the file, on purpose.
 * A global hook makes every test in the file fail when the reset throws — including the structural
 * ones that never touch the sequence — which turns an honest red phase into a misleading one. Only
 * the blocks that consume the sequence reset it.
 */

/* ------------------------------------------------------------------------------------------- *
 * §7 AC1..AC2 — the package and its boundaries
 * ------------------------------------------------------------------------------------------- */

/** Every `.ts` under a directory, recursively. */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...sourcesUnder(path));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}

describe('AC1..AC2 — the package builds and stays on its side of the boundary', () => {
  it('AC1 — declares itself as a private ESM workspace package with the four scripts', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(manifest['name']).toBe('@marketplace/testing');
    expect(manifest['private']).toBe(true);
    expect(manifest['type']).toBe('module');
    const scripts = manifest['scripts'] as Record<string, string>;
    for (const script of ['build', 'typecheck', 'lint', 'test']) {
      expect(scripts[script], `missing script: ${script}`).toBeDefined();
    }
    // No runtime dependencies at all — Decision D is what makes that possible.
    expect(manifest['dependencies']).toBeUndefined();
  });

  it('AC1 — is a devDependency of every package that will build tests against it', () => {
    for (const consumer of ['apps/api', 'apps/web', 'packages/contracts']) {
      const manifest = JSON.parse(
        readFileSync(join(repoRoot, consumer, 'package.json'), 'utf8'),
      ) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
      expect(
        manifest.devDependencies?.['@marketplace/testing'],
        `${consumer} does not depend on @marketplace/testing`,
      ).toBe('workspace:*');
      expect(
        manifest.dependencies?.['@marketplace/testing'],
        `${consumer} has it as a runtime dependency; it is test-only`,
      ).toBeUndefined();
    }
  });

  it('AC2 — imports neither @prisma/client nor anything under apps/', () => {
    for (const file of sourcesUnder(join(packageRoot, 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} imports @prisma/client`).not.toMatch(/from\s+'@prisma\/client'/);
      expect(source, `${file} reaches into an app`).not.toMatch(/from\s+'.*apps\//);
    }
  });

  it('AC2 — no production source anywhere imports the factories', () => {
    for (const pkg of ['apps/api', 'apps/web', 'packages/contracts', 'packages/config']) {
      const src = join(repoRoot, pkg, 'src');
      let files: string[];
      try {
        files = sourcesUnder(src);
      } catch {
        continue;
      }
      for (const file of files) {
        expect(readFileSync(file, 'utf8'), `${file} imports test factories`).not.toMatch(
          /@marketplace\/testing/,
        );
      }
    }
  });
});

/* ------------------------------------------------------------------------------------------- *
 * §7 AC3..AC7 — the builders
 * ------------------------------------------------------------------------------------------- */

describe('AC3..AC7 — a builder produces a complete, distinct, ordered row', () => {
  beforeEach(resetFactories);

  it('AC3 — every builder fills every field its model requires', () => {
    expect(buildUser()).toMatchObject({
      id: expect.stringMatching(UUID_V4) as unknown as string,
      email: expect.stringContaining('@') as unknown as string,
      roles: expect.any(Array) as unknown as string[],
      status: 'ACTIVE',
      locale: 'ES',
    });
    expect(buildClientProfile()).toMatchObject({
      id: expect.stringMatching(UUID_V4) as unknown as string,
      userId: expect.stringMatching(UUID_V4) as unknown as string,
      displayName: expect.any(String) as unknown as string,
    });
    expect(buildProviderProfile()).toMatchObject({
      kind: expect.stringMatching(/^(MANITAS|PRO)$/) as unknown as string,
      displayName: expect.any(String) as unknown as string,
      ratingCount: expect.any(Number) as unknown as number,
    });
    expect(buildAddress()).toMatchObject({
      // The schema's CHECK is `postal_code ~ '^[0-9]{5}$'` — the default must satisfy it.
      postalCode: expect.stringMatching(/^[0-9]{5}$/) as unknown as string,
      countryCode: 'ES',
      latitude: expect.any(Number) as unknown as number,
      longitude: expect.any(Number) as unknown as number,
    });
    expect(buildCategory()).toMatchObject({
      slug: expect.any(String) as unknown as string,
      nameEs: expect.any(String) as unknown as string,
      nameEn: expect.any(String) as unknown as string,
      requiresLicence: false,
      isActive: true,
    });
    expect(buildProviderCategory()).toMatchObject({
      providerProfileId: expect.stringMatching(UUID_V4) as unknown as string,
      categoryId: expect.stringMatching(UUID_V4) as unknown as string,
    });
  });

  it('AC3 — the provider defaults satisfy the schema CHECKs, not merely its types', () => {
    const provider = buildProviderProfile();
    // CHECK (service_radius_metres > 0 AND <= 200000) and CHECK (hourly_rate_cents >= 0).
    expect(provider.serviceRadiusMetres).toBeGreaterThan(0);
    expect(provider.serviceRadiusMetres).toBeLessThanOrEqual(200_000);
    expect(provider.hourlyRateCents).toBeGreaterThanOrEqual(0);
  });

  it('AC4 — overrides replace defaults and leave everything else alone', () => {
    const built = buildUser({ email: 'ana@example.test', status: 'SUSPENDED' });
    expect(built.email).toBe('ana@example.test');
    expect(built.status).toBe('SUSPENDED');
    expect(built.locale).toBe('ES');
    expect(built.id).toMatch(UUID_V4);
  });

  it('AC5 — consecutive calls differ in id, and users differ in email', () => {
    const [first, second] = [buildUser(), buildUser()];
    expect(first.id).not.toBe(second.id);
    // The unique index is on lower(email), so a shared default is an immediate collision.
    expect(first.email.toLowerCase()).not.toBe(second.email.toLowerCase());
  });

  it('AC6 — ids are v4-shaped and never collide across entities', () => {
    const ids = [
      buildUser().id,
      buildClientProfile().id,
      buildProviderProfile().id,
      buildAddress().id,
      buildCategory().id,
    ];
    for (const id of ids) expect(id, `${id} is not a v4-shaped uuid`).toMatch(UUID_V4);
    expect(new Set(ids).size, 'two entities produced the same id').toBe(ids.length);
  });

  it('AC7 — createdAt is distinct and strictly increasing, so keyset paging has a total order', () => {
    const stamps = [buildUser(), buildUser(), buildUser()].map((u) => u.createdAt.getTime());
    expect(new Set(stamps).size).toBe(3);
    expect(stamps[1]).toBeGreaterThan(stamps[0] as number);
    expect(stamps[2]).toBeGreaterThan(stamps[1] as number);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * §7 AC8..AC9 — determinism
 * ------------------------------------------------------------------------------------------- */

describe('AC8..AC9 — the same sequence produces the same data, every run', () => {
  it('AC8 — resetFactories() restores byte-identical output', () => {
    const run = () => {
      resetFactories();
      return [buildUser(), buildAddress(), buildProviderProfile(), nextAt()];
    };
    expect(run()).toEqual(run());
  });

  it('AC8 — without a reset, the sequence advances rather than repeating', () => {
    resetFactories();
    const first = buildUser();
    const second = buildUser();
    expect(first).not.toEqual(second);
  });

  it('AC9 — nothing in src reaches for randomness or the wall clock', () => {
    // Comments are stripped first. A doc comment saying "never `new Date()`" is the *opposite* of
    // the hazard, and a scanner that cannot tell them apart punishes explaining the rule.
    const codeOf = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    for (const file of sourcesUnder(join(packageRoot, 'src'))) {
      const source = codeOf(readFileSync(file, 'utf8'));
      expect(source, `${file} uses Math.random`).not.toMatch(/Math\.random/);
      expect(source, `${file} uses Date.now`).not.toMatch(/Date\.now/);
      expect(source, `${file} constructs a Date from the current time`).not.toMatch(
        /new Date\(\s*\)/,
      );
    }
  });
});

/* ------------------------------------------------------------------------------------------- *
 * §7 AC10 — the criterion that makes the convention stick
 * ------------------------------------------------------------------------------------------- */

/** Models the factories deliberately do not cover, each with the reason. */
const NOT_COVERED: Readonly<Record<string, string>> = {
  SeedRun:
    'agent-devops infrastructure — the ledger of which seeders have run (MEM-2026-09-09-15), ' +
    'not domain data any test should fabricate.',
};

describe('AC10 — every model in the schema has a factory', () => {
  const schema = readFileSync(SCHEMA, 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((match) => ({
    name: match[1] as string,
    body: match[2] as string,
  }));

  it('finds the models at all — a regex that matches nothing would pass every test below', () => {
    expect(models.length).toBeGreaterThanOrEqual(7);
    expect(models.map((m) => m.name)).toContain('User');
  });

  for (const model of models) {
    const expected = NOT_COVERED[model.name] === undefined;

    it(`${model.name} — ${expected ? 'has a builder and a factory' : 'is allowlisted'}`, () => {
      if (!expected) {
        expect(
          NOT_COVERED[model.name]?.length,
          'an allowlisted model needs a reason',
        ).toBeGreaterThan(20);
        return;
      }
      expect(
        BUILDERS[model.name as keyof typeof BUILDERS],
        `no build${model.name}() — add one, or allowlist the model with a reason`,
      ).toBeTypeOf('function');
      expect(CREATORS[model.name as keyof typeof CREATORS], `no create${model.name}()`).toBeTypeOf(
        'function',
      );

      // Only a model with its own `id` column needs a prefix; ProviderCategory has a composite key.
      if (/^\s*id\s+/m.test(model.body)) {
        const prefixes: Readonly<Record<string, string | undefined>> = ID_PREFIXES;
        expect(
          prefixes[model.name],
          `${model.name} has an id column but no registered prefix`,
        ).toMatch(/^[0-9a-f]{8}$/);
      }
    });
  }
});

/* ------------------------------------------------------------------------------------------- *
 * §7 AC11..AC13 — persistence, against a recording fake
 * ------------------------------------------------------------------------------------------- */

describe('AC11..AC13 — the factories write what the builders built', () => {
  beforeEach(resetFactories);

  it('createAuditRecord issues one auditRecord.create and creates no parent', async () => {
    // No parent, deliberately: `AuditRecord` has no foreign key (W1-T05 §8.2 — GDPR erasure must be
    // able to hard-delete a user without erasing what they did), so unlike every other factory here
    // this one writes exactly one row. The count is the assertion.
    const client = fakeClient();
    const created = await createAuditRecord(client, { action: 'REFUND_ISSUED' });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.model).toBe('auditRecord');
    expect(client.calls[0]?.data).toEqual(created);
    expect(created.action).toBe('REFUND_ISSUED');
    expect(created.actorId).toBeNull();
  });

  it('AC11 — createUser issues exactly one user.create with the built row', async () => {
    const client = fakeClient();
    const created = await createUser(client, { email: 'ana@example.test' });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.model).toBe('user');
    expect(client.calls[0]?.data).toEqual(created);
    expect(created.email).toBe('ana@example.test');
  });

  it('AC12 — createProviderProfile with no userId creates the user it needs', async () => {
    const client = fakeClient();
    const profile = await createProviderProfile(client);
    expect(client.calls.map((c) => c.model)).toEqual(['user', 'providerProfile']);
    const user = client.calls[0]?.data as { id: string };
    expect(profile.userId, 'the profile did not point at the user it created').toBe(user.id);
  });

  it('AC13 — createProviderProfile with a userId creates no user', async () => {
    const client = fakeClient();
    const userId = buildUser().id;
    const profile = await createProviderProfile(client, { userId });
    expect(client.calls.map((c) => c.model)).toEqual(['providerProfile']);
    expect(profile.userId).toBe(userId);
  });

  it('AC12 — createAddress and createClientProfile create their user too', async () => {
    const client = fakeClient();
    await createAddress(client);
    await createClientProfile(client);
    expect(client.calls.map((c) => c.model)).toEqual(['user', 'address', 'user', 'clientProfile']);
  });

  it('AC12 — createProviderCategory creates both sides of the join', async () => {
    const client = fakeClient();
    const link = await createProviderCategory(client);
    const models = client.calls.map((c) => c.model);
    expect(models).toContain('providerProfile');
    expect(models).toContain('category');
    expect(models.at(-1)).toBe('providerCategory');
    expect(link.providerProfileId).toBeTruthy();
    expect(link.categoryId).toBeTruthy();
  });

  it('AC11 — createCategory needs no parent and issues one call', async () => {
    const client = fakeClient();
    await createCategory(client);
    expect(client.calls.map((c) => c.model)).toEqual(['category']);
  });
});
