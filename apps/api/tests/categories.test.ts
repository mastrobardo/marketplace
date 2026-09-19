/**
 * `W3-T01` — `GET /api/categories` at its HTTP boundary.
 *
 * Everything here runs without a database: the route receives a `CategoryRepository`, so what is
 * asserted is the boundary's own work — the prefix, the locale it asks for, and above all §3.2's
 * wire rule, *a category on the wire is a thing you can pick*. The SQL is
 * `categories-live.test.ts`'s subject.
 *
 * **Where the wire rules live, and why they are here rather than in the repository.** §7 says
 * AC1–AC14 run against a stub, and four of them — AC3 (roots are not served), AC8 (`isActive`),
 * AC9 and AC10 (the order) — are only a real assertion if the *route* applies them. So the
 * repository's job is the data plus the locale, and the route's job is the wire: filter to active
 * leaves, sort by `position` then `slug`, project to the three contract fields, parse on the way
 * out. The repository is free to order in SQL as well (§3.8), and `categories-live.test.ts` pins
 * that it does — but the boundary does not depend on it, which is what makes these criteria
 * testable without Postgres.
 *
 * Spec: `docs/specs/S3/W3-T01-category-tree.md` §3.2, §3.7, §3.8, §4, §7.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { CATEGORY_SLUG, CategoryListSchema } from '@marketplace/contracts';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  type CategoryCriteria,
  type CategoryNode,
  type CategoryRepository,
} from '../src/modules/categories/repository.js';

const ENV = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  LOG_LEVEL: 'silent',
  APP_VERSION: '1.2.3-test',
};

/** The two family roots, by id — `parentId: null` is what makes a row a root (§3.2). */
const REFORMAS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0100';
const MANTENIMIENTO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0200';

/**
 * One row as the repository hands it over: the contract's three fields, plus the three structural
 * columns the wire rule is computed from and which never reach the client.
 */
function node(overrides: Partial<CategoryNode> = {}): CategoryNode {
  return {
    slug: 'fontaneria',
    name: 'Fontanería',
    requiresLicence: false,
    parentId: MANTENIMIENTO,
    position: 1,
    parentPosition: 2,
    isActive: true,
    ...overrides,
  };
}

/**
 * A repository that records what it was asked for. The recording is the point: the locale criteria
 * assert what the route *asked* for, not only what it did with the answer.
 */
function stubRepository(nodes: readonly CategoryNode[] = []) {
  const calls: CategoryCriteria[] = [];
  const repository: CategoryRepository = (criteria) => {
    calls.push(criteria);
    return Promise.resolve(nodes);
  };
  return { repository, calls };
}

interface Envelope {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

describe('GET /api/categories', () => {
  let app: FastifyInstance;
  let calls: CategoryCriteria[];

  function boot(nodes: readonly CategoryNode[] = []): void {
    const stub = stubRepository(nodes);
    calls = stub.calls;
    app = buildApp({ config: loadConfig(ENV), categories: stub.repository });
  }

  async function list(headers: Record<string, string> = {}) {
    const response = await app.inject({ method: 'GET', url: '/api/categories', headers });
    return { status: response.statusCode, body: response.body, json: response.json() as unknown };
  }

  beforeEach(() => {
    boot([node()]);
  });

  afterEach(async () => {
    await app.close();
  });

  // ── AC1 — the prefix, and a body the contract accepts ─────────────────────────────────────

  it('AC1 — answers 200 under /api with a body CategoryListSchema parses', async () => {
    const { status, json } = await list();

    expect(status).toBe(200);
    const parsed = CategoryListSchema.safeParse(json);
    expect(
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    ).toEqual([]);
  });

  it('AC1 — does not answer at the root, where the edge would serve index.html', async () => {
    // `W0-T28`: one origin, split by path. A domain route that escapes `/api` is answered with the
    // SPA's own `index.html` — a 200 full of HTML that only fails in a deployed environment.
    const response = await app.inject({ method: 'GET', url: '/categories' });

    expect(response.statusCode).toBe(404);
    expect((JSON.parse(response.body) as Envelope).error.code).toBe('NOT_FOUND');
  });

  // ── AC2 — every slug is a slug, every name has content ────────────────────────────────────

  it('AC2 — every served item matches CATEGORY_SLUG and carries a non-empty name', async () => {
    boot([
      node({ slug: 'fontaneria', name: 'Fontanería', position: 1 }),
      node({ slug: 'alicatado-solados', name: 'Alicatado y solados', position: 2 }),
      node({ slug: 'placas-solares', name: 'Placas solares', position: 3 }),
    ]);

    const { items } = CategoryListSchema.parse((await list()).json);

    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.slug, `${item.slug} is not a slug`).toMatch(CATEGORY_SLUG);
      expect(item.name.length, `${item.slug} has an empty name`).toBeGreaterThan(0);
    }
  });

  // ── AC3, AC4 — a category on the wire is a thing you can pick (§3.2) ──────────────────────

  it('AC3 — serves neither family root, because a root is storage and not pickable', async () => {
    boot([
      node({ slug: 'reformas', name: 'Reformas', parentId: null, position: 1 }),
      node({ slug: 'mantenimiento', name: 'Mantenimiento', parentId: null, position: 2 }),
      node({ slug: 'pintura', name: 'Pintura', parentId: REFORMAS, position: 1 }),
      node({ slug: 'fontaneria', name: 'Fontanería', parentId: MANTENIMIENTO, position: 1 }),
    ]);

    const slugs = CategoryListSchema.parse((await list()).json).items.map((item) => item.slug);

    expect(slugs).not.toContain('reformas');
    expect(slugs).not.toContain('mantenimiento');
  });

  it('AC4 — serves every child of every root', async () => {
    boot([
      node({ slug: 'reformas', name: 'Reformas', parentId: null, position: 1 }),
      node({ slug: 'mantenimiento', name: 'Mantenimiento', parentId: null, position: 2 }),
      node({ slug: 'pintura', name: 'Pintura', parentId: REFORMAS, position: 1 }),
      node({ slug: 'carpinteria', name: 'Carpintería', parentId: REFORMAS, position: 2 }),
      node({ slug: 'fontaneria', name: 'Fontanería', parentId: MANTENIMIENTO, position: 1 }),
    ]);

    const slugs = CategoryListSchema.parse((await list()).json).items.map((item) => item.slug);

    expect(slugs.sort()).toEqual(['carpinteria', 'fontaneria', 'pintura']);
  });

  // ── AC5, AC6, AC7 — the locale, asked for and applied ─────────────────────────────────────

  it('AC5 — accept-language: en-GB asks the repository for English', async () => {
    boot([node({ name: 'Plumbing' })]);

    const { items } = CategoryListSchema.parse(
      (await list({ 'accept-language': 'en-GB' })).json,
    );

    expect(calls[0]?.locale).toBe('en');
    expect(items[0]?.name).toBe('Plumbing');
  });

  it('AC6 — no accept-language header is Spanish, because the market is Spain', async () => {
    const { items } = CategoryListSchema.parse((await list()).json);

    expect(calls[0]?.locale).toBe('es');
    expect(items[0]?.name).toBe('Fontanería');
  });

  it('AC7 — accept-language: fr falls back to Spanish rather than failing', async () => {
    // The fallback is the criterion. A 406 here would make a French browser a broken storefront.
    const { status } = await list({ 'accept-language': 'fr' });

    expect(status).toBe(200);
    expect(calls[0]?.locale).toBe('es');
  });

  // ── AC8 — retirement removes a trade from the wire, and from nothing else (§3.8) ──────────

  it('AC8 — does not serve a leaf whose isActive is false', async () => {
    boot([
      node({ slug: 'fontaneria', position: 1 }),
      node({ slug: 'desatascos', name: 'Desatascos', position: 2, isActive: false }),
    ]);

    const slugs = CategoryListSchema.parse((await list()).json).items.map((item) => item.slug);

    expect(slugs).toEqual(['fontaneria']);
  });

  // ── AC9, AC10 — the curated order, and a deterministic tie-break ──────────────────────────

  it('AC9 — orders by position, not by the order the repository returned', async () => {
    boot([
      node({ slug: 'segunda', name: 'Segunda', position: 2 }),
      node({ slug: 'primera', name: 'Primera', position: 1 }),
      node({ slug: 'tercera', name: 'Tercera', position: 3 }),
    ]);

    const slugs = CategoryListSchema.parse((await list()).json).items.map((item) => item.slug);

    expect(slugs).toEqual(['primera', 'segunda', 'tercera']);
  });

  it('AC9 — groups each family before ordering inside it, because position is per sibling set', async () => {
    /**
     * The regression this exists for: `position` restarts at 1 in every family (§8.3), so a sort on
     * `position` alone interleaves them — `fontaneria, reforma-integral, albanileria, electricidad`
     * — and the curated order reaches the client as a shuffle. Found in review, not by AC9 above,
     * which only ever fed one family.
     */
    boot([
      node({ slug: 'pintura', parentId: REFORMAS, parentPosition: 1, position: 4 }),
      node({ slug: 'fontaneria', parentId: MANTENIMIENTO, parentPosition: 2, position: 1 }),
      node({ slug: 'reforma-integral', parentId: REFORMAS, parentPosition: 1, position: 1 }),
      node({ slug: 'gas', parentId: MANTENIMIENTO, parentPosition: 2, position: 5 }),
    ]);

    const slugs = CategoryListSchema.parse((await list()).json).items.map((item) => item.slug);

    expect(slugs).toEqual(['reforma-integral', 'pintura', 'fontaneria', 'gas']);
  });

  it('AC10 — two leaves sharing a position answer byte-identically twice, tie-broken by slug', async () => {
    boot([
      node({ slug: 'zzz-ultima', name: 'Última', position: 7 }),
      node({ slug: 'aaa-primera', name: 'Primera', position: 7 }),
    ]);

    const first = await list();
    const second = await list();

    // Byte-identical, not merely equal: a paging-free list that swaps two rows between requests
    // breaks a snapshot test and, worse, moves a menu item under a visitor's cursor.
    expect(second.body).toBe(first.body);
    expect(CategoryListSchema.parse(first.json).items.map((item) => item.slug)).toEqual([
      'aaa-primera',
      'zzz-ultima',
    ]);
  });

  // ── AC11 — the outbound parse is a gate, and seed data is its input (§6) ──────────────────

  it('AC11 — answers 500 rather than shipping a row with an empty name', async () => {
    boot([node({ name: '' })]);

    const { status, json } = await list();

    expect(status).toBe(500);
    expect((json as Envelope).error.code).toBe('INTERNAL_ERROR');
    // The malformed item must not be in the body at all — not even as a partial list.
    expect(JSON.stringify(json)).not.toContain('fontaneria');
  });

  it('AC11 — answers 500 rather than shipping a slug the contract would reject', async () => {
    // A bad seeder edit is the realistic source of this, which is why it is a 500 and not a filter:
    // dropping the row silently would ship a menu that is quietly missing a trade.
    boot([node({ slug: 'Fontanería' })]);

    const { status, json } = await list();

    expect(status).toBe(500);
    expect((json as Envelope).error.code).toBe('INTERNAL_ERROR');
  });

  // ── AC13 — a closed list arrives whole, with no paging ceremony (§4) ──────────────────────

  it('AC13 — returns every active leaf in one response, with no cursor and no next', async () => {
    const leaves = Array.from({ length: 20 }, (_unused, index) =>
      node({
        slug: `categoria-${String(index + 1)}`,
        name: `Categoría ${String(index + 1)}`,
        position: index + 1,
      }),
    );
    boot(leaves);

    const { json } = await list();
    const body = json as Record<string, unknown>;

    expect(CategoryListSchema.parse(body).items).toHaveLength(20);
    // `items` and nothing else: no `page`, no `next`, no `cursor`. `CategoryListSchema` is a
    // `strictObject`, so this is belt and braces — and it is the criterion as written.
    expect(Object.keys(body)).toEqual(['items']);
  });

  // ── AC14 — public, and no guard attached by accident (§5) ─────────────────────────────────

  it('AC14 — answers 200 with no session cookie, and reaches the repository', async () => {
    const { status } = await list();

    expect(status).toBe(200);
    // The second half matters: a guard that rejected before the handler would also be a 200 if the
    // route were missing entirely. This says the request went all the way through.
    expect(calls).toHaveLength(1);
  });

  it('AC14 — answers 200 for an unparseable cookie, because nothing reads one', async () => {
    const { status } = await list({ cookie: 'better-auth.session_token=not-a-real-session' });

    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});
