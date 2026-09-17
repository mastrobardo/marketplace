/**
 * `W3-T05` — `GET /api/search` at its HTTP boundary.
 *
 * Everything here runs without a database: the route receives a `SearchRepository`, so what is
 * asserted is the boundary's own work — the prefix, the 400s and the fact that they cost no query,
 * the locale, the sort, and above all the outbound parse that makes the privacy rules a gate rather
 * than a convention. The SQL is `search-live.test.ts`'s subject.
 *
 * Spec: `docs/specs/S5/W3-T05-geo-search.md` §3.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  PAGE_LIMIT_DEFAULT,
  coarsenPoint,
  type SearchFacets,
  type SearchResult,
} from '@marketplace/contracts';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { resolvePlace } from '../src/modules/search/places.js';
import { type SearchCriteria, type SearchRepository } from '../src/modules/search/repository.js';

const ENV = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  LOG_LEVEL: 'silent',
  APP_VERSION: '1.2.3-test',
};

/** A point that has already been through `coarsenPoint`, as the contract demands. */
const MADRID = coarsenPoint({ latitude: 40.416775, longitude: -3.70379 });

const EMPTY_FACETS: SearchFacets = { categories: [], kinds: [] };

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: crypto.randomUUID(),
    displayName: 'Fontanería Ejemplo',
    kind: 'MANITAS',
    bio: null,
    categories: [{ slug: 'fontaneria', name: 'Fontanería' }],
    ratingAvg: null,
    ratingCount: 0,
    hourlyRateCents: 3_500,
    distanceMetres: 1_200,
    city: 'Madrid',
    province: 'Madrid',
    point: MADRID,
    ...overrides,
  };
}

/**
 * A repository that records what it was asked for. The recording is the point: several criteria
 * assert that a rejected request never reaches it.
 */
function stubRepository(rows: SearchResult[] = [], facets: SearchFacets = EMPTY_FACETS) {
  const calls: SearchCriteria[] = [];
  const repository: SearchRepository = (criteria) => {
    calls.push(criteria);
    return Promise.resolve({ rows, facets });
  };
  return { repository, calls };
}

interface Envelope {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

describe('GET /api/search', () => {
  let app: FastifyInstance;
  let calls: SearchCriteria[];

  function boot(rows: SearchResult[] = [], facets: SearchFacets = EMPTY_FACETS): void {
    const stub = stubRepository(rows, facets);
    calls = stub.calls;
    app = buildApp({ config: loadConfig(ENV), search: stub.repository });
  }

  beforeEach(() => {
    boot();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── AC1 — the prefix ──────────────────────────────────────────────────────────────────────

  it('answers under /api', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/search?where=Madrid' });
    expect(response.statusCode).toBe(200);
  });

  it('does not answer at the root, where the edge would serve index.html', async () => {
    const response = await app.inject({ method: 'GET', url: '/search?where=Madrid' });

    expect(response.statusCode).toBe(404);
    expect((JSON.parse(response.body) as Envelope).error.code).toBe('NOT_FOUND');
  });

  // ── AC2, AC3 — a rejected request costs no query ──────────────────────────────────────────

  it('rejects a query with no `where`, and issues no database query', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/search' });
    const body = JSON.parse(response.body) as Envelope;

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toMatchObject({ issues: expect.any(Array) });
    expect(calls).toHaveLength(0);
  });

  it('rejects an unknown parameter rather than ignoring it', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/search?where=Madrid&offset=40' });

    expect(response.statusCode).toBe(400);
    expect((JSON.parse(response.body) as Envelope).error.code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('rejects a `what` that is not a category slug', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/search?where=Madrid&what=${encodeURIComponent('fontanería')}`,
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  // ── AC4 — a place we cannot resolve ───────────────────────────────────────────────────────

  it('rejects a `where` the gazetteer cannot resolve, naming the field', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/search?where=${encodeURIComponent('Ciudad Inventada de la Nada')}`,
    });
    const body = JSON.parse(response.body) as Envelope;

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(body.error.details)).toContain('where');
    expect(calls).toHaveLength(0);
  });

  it('resolves the centre before asking the repository for anything', async () => {
    await app.inject({ method: 'GET', url: '/api/search?where=Madrid' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.centre.latitude).toBeCloseTo(40.41, 1);
    expect(calls[0]?.centre.longitude).toBeCloseTo(-3.7, 1);
  });

  // ── AC7, AC8 — filters ────────────────────────────────────────────────────────────────────

  it('passes `what` and `mode` through to the repository', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/search?where=Madrid&what=fontaneria&mode=booking',
    });

    expect(calls[0]).toMatchObject({ what: 'fontaneria', mode: 'booking' });
  });

  it('accepts `when` and changes nothing by it', async () => {
    await app.inject({ method: 'GET', url: '/api/search?where=Madrid&when=urgente' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('when');
  });

  // ── AC9 — the sort comes from the query ───────────────────────────────────────────────────

  it('defaults to ascending distance with an id tiebreaker', async () => {
    await app.inject({ method: 'GET', url: '/api/search?where=Madrid' });

    expect(calls[0]?.sort).toEqual([
      { field: 'distanceMetres', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ]);
  });

  it('honours `?sort=-distanceMetres` rather than hardcoding the direction', async () => {
    await app.inject({ method: 'GET', url: '/api/search?where=Madrid&sort=-distanceMetres' });

    expect(calls[0]?.sort[0]).toEqual({ field: 'distanceMetres', direction: 'desc' });
  });

  it('rejects a sort field that is not sortable here', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/search?where=Madrid&sort=ratingAvg',
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  // ── AC11 — paging is `pageOf` over a `fetchLimit` over-fetch ──────────────────────────────

  it('asks the repository for one row more than the page, and reports hasMore from it', async () => {
    const rows = Array.from({ length: PAGE_LIMIT_DEFAULT + 1 }, (_, index) =>
      result({ distanceMetres: index * 100 }),
    );
    boot(rows);

    const response = await app.inject({ method: 'GET', url: '/api/search?where=Madrid' });
    const body = JSON.parse(response.body) as {
      items: SearchResult[];
      page: { hasMore: boolean; nextCursor: string | null };
    };

    expect(calls[0]?.limit).toBe(PAGE_LIMIT_DEFAULT);
    expect(body.items).toHaveLength(PAGE_LIMIT_DEFAULT);
    expect(body.page.hasMore).toBe(true);
    expect(body.page.nextCursor).toEqual(expect.any(String));
  });

  it('reports the end of the list when the repository returns no more than the page', async () => {
    boot([result()]);

    const response = await app.inject({ method: 'GET', url: '/api/search?where=Madrid&limit=5' });
    const body = JSON.parse(response.body) as {
      items: SearchResult[];
      page: { hasMore: boolean; nextCursor: string | null };
    };

    expect(body.items).toHaveLength(1);
    expect(body.page).toEqual({ hasMore: false, nextCursor: null });
  });

  it('forwards a cursor to the repository as a decoded position', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/search?where=Madrid' });
    expect(first.statusCode).toBe(200);

    boot(Array.from({ length: 2 }, () => result()));
    const cursor = 'eyJ2IjpbMTIwMF0sImlkIjoiYS1yb3ctaWQifQ';
    await app.inject({ method: 'GET', url: `/api/search?where=Madrid&cursor=${cursor}` });

    expect(calls[0]?.cursor).toMatchObject({ v: [1200], id: 'a-row-id' });
  });

  it('rejects a malformed cursor', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/search?where=Madrid&cursor=not-a-cursor',
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  // ── AC13, AC14 — the outbound parse is the privacy gate ───────────────────────────────────

  it('refuses to serve a provider whose point was not coarsened', async () => {
    // The stored coordinate, forwarded verbatim — the bug this refinement exists to catch.
    boot([result({ point: { latitude: 40.416775, longitude: -3.70379 } })]);

    const response = await app.inject({ method: 'GET', url: '/api/search?where=Madrid' });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('40.416775');
  });

  /**
   * The escalation in `memory/sessions/2026-09-17-agent-discovery-W3-T05.md`, as a test.
   *
   * `coarsenPoint` is the contract's own helper and `SearchPointSchema` is the contract's own
   * refinement, and for ~1.63% of coordinates the second rejects the first: `isCoarse` asks
   * `Math.round(v * 1000) === v * 1000`, and `40.764 * 1000` is `40763.99999999999` in a double.
   *
   * This coordinate is a real one — Guadalajara province — found by sampling Spain's bounding box.
   * Red until `packages/contracts` fixes the predicate; the endpoint 500s on it today.
   */
  it('serves a provider whose coarsened point is not exactly representable', async () => {
    boot([result({ point: coarsenPoint({ latitude: 40.764013, longitude: -2.039469 }) })]);

    const response = await app.inject({ method: 'GET', url: '/api/search?where=Madrid' });

    expect(response.statusCode).toBe(200);
  });

  it('refuses to serve a row carrying a field the projection excludes', async () => {
    boot([{ ...result(), line1: 'Calle Mayor 1' } as unknown as SearchResult]);

    const response = await app.inject({ method: 'GET', url: '/api/search?where=Madrid' });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('Calle Mayor');
  });

  it('returns the facets the repository computed', async () => {
    boot([result()], {
      categories: [{ slug: 'fontaneria', name: 'Fontanería', count: 7 }],
      kinds: [{ kind: 'MANITAS', count: 7 }],
    });

    const response = await app.inject({ method: 'GET', url: '/api/search?where=Madrid' });
    const body = JSON.parse(response.body) as { facets: SearchFacets };

    expect(body.facets.categories[0]).toEqual({
      slug: 'fontaneria',
      name: 'Fontanería',
      count: 7,
    });
  });

  // ── AC15 — locale ─────────────────────────────────────────────────────────────────────────

  it('asks for Spanish category names by default', async () => {
    await app.inject({ method: 'GET', url: '/api/search?where=Madrid' });

    expect(calls[0]?.locale).toBe('es');
  });

  it('asks for English category names when Accept-Language says so', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/search?where=Madrid',
      headers: { 'accept-language': 'en-GB,en;q=0.9' },
    });

    expect(calls[0]?.locale).toBe('en');
  });
});

/**
 * The gazetteer — §2.2. A pure lookup, so it is tested as one.
 *
 * It exists because `OPS-12` has not happened and `W3-T06` cannot. `resolvePlace` is the whole
 * surface a real geocoder has to satisfy later, which is why these assertions are about the
 * function and not about whichever table currently backs it.
 */
describe('resolvePlace', () => {
  it('resolves a provincial capital by name', () => {
    const madrid = resolvePlace('Madrid');

    expect(madrid?.latitude).toBeCloseTo(40.41, 1);
    expect(madrid?.longitude).toBeCloseTo(-3.7, 1);
  });

  it('resolves a five-digit postal code', () => {
    expect(resolvePlace('28001')).toBeDefined();
  });

  it('is indifferent to case, accents and surrounding space', () => {
    const plain = resolvePlace('Malaga');
    const accented = resolvePlace('  MÁLAGA ');

    expect(accented).toEqual(plain);
    expect(accented).toBeDefined();
  });

  it('returns undefined for a place it does not know, rather than guessing', () => {
    expect(resolvePlace('Ciudad Inventada de la Nada')).toBeUndefined();
  });

  it('returns undefined for a postal code outside Spain', () => {
    expect(resolvePlace('99999')).toBeUndefined();
  });
});
