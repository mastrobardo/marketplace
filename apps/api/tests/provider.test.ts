/**
 * `W3-T07` — `GET /api/providers/:id` at its HTTP boundary.
 *
 * Everything here runs without a database: the route receives a `ProviderRepository`, so what is
 * asserted is the boundary's own work — the prefix, 400-before-404 and the fact that the 400 costs
 * no lookup, the locale, and the outbound parse that makes the privacy rules a gate rather than a
 * convention. The columns and their conversions are `provider-live.test.ts`'s subject.
 *
 * Spec: `docs/specs/S3/W3-T07-provider-profile-api.md` §3.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { coarsenPoint, type ProviderProfile } from '@marketplace/contracts';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { type ProviderCriteria, type ProviderRepository } from '../src/modules/providers/repository.js';

const ENV = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  LOG_LEVEL: 'silent',
  APP_VERSION: '1.2.3-test',
};

/** Puerta del Sol, already through `coarsenPoint` as the contract demands. */
const MADRID = coarsenPoint({ latitude: 40.416775, longitude: -3.70379 });

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: ID,
    displayName: 'Fontanería Ejemplo',
    kind: 'MANITAS',
    bio: null,
    categories: [{ slug: 'fontaneria', name: 'Fontanería' }],
    ratingAvg: null,
    ratingCount: 0,
    hourlyRateCents: 3_500,
    city: 'Madrid',
    province: 'Madrid',
    serviceRadiusMetres: 15_000,
    memberSince: '2026-03-01T09:00:00.000Z',
    point: MADRID,
    ...overrides,
  };
}

/**
 * A repository that records what it was asked for. The recording is the point: AC2 asserts that a
 * malformed id never reaches it.
 */
function stubRepository(answer: ProviderProfile | undefined) {
  const calls: ProviderCriteria[] = [];
  const repository: ProviderRepository = (criteria) => {
    calls.push(criteria);
    return Promise.resolve(answer);
  };
  return { repository, calls };
}

interface Envelope {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

describe('GET /api/providers/:id', () => {
  let app: FastifyInstance;
  let calls: ProviderCriteria[];

  /**
   * Rest args rather than a default parameter: `boot(undefined)` would *fire* the default, so
   * "the repository found nothing" and "the repository found the fixture" would be the same call.
   * The arity is the distinction.
   */
  function boot(...args: [] | [ProviderProfile | undefined]): void {
    const stub = stubRepository(args.length === 0 ? profile() : args[0]);
    calls = stub.calls;
    app = buildApp({ config: loadConfig(ENV), providers: stub.repository });
  }

  beforeEach(() => {
    boot();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── AC1 — the prefix ──────────────────────────────────────────────────────────────────────

  it('answers under /api', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/providers/${ID}` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ id: ID, displayName: 'Fontanería Ejemplo' });
  });

  it('does not answer at the root, where the edge would serve index.html', async () => {
    const response = await app.inject({ method: 'GET', url: `/providers/${ID}` });

    expect(response.statusCode).toBe(404);
    expect((JSON.parse(response.body) as Envelope).error.code).toBe('NOT_FOUND');
  });

  // ── AC2 — a malformed id is a 400, and it costs no lookup ─────────────────────────────────

  it('rejects an id that is not a uuid, and issues no database query', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/providers/not-a-uuid' });
    const body = JSON.parse(response.body) as Envelope;

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toMatchObject({ issues: expect.any(Array) });
    expect(calls).toHaveLength(0);
  });

  it('does not treat a malformed id as a missing provider', async () => {
    const malformed = await app.inject({ method: 'GET', url: '/api/providers/42' });

    // The distinction the storefront is taught by the mock: one is a request nobody should have
    // sent, the other is a provider who is gone, and only the second says "no longer listed".
    expect(malformed.statusCode).not.toBe(404);
  });

  // ── AC3, AC4 — nothing to serve is a 404 in the envelope ──────────────────────────────────

  it('answers 404 in the error envelope when the repository has nothing', async () => {
    boot(undefined);
    const response = await app.inject({ method: 'GET', url: `/api/providers/${ID}` });
    const body = JSON.parse(response.body) as Envelope;

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(calls).toHaveLength(1);
  });

  // ── AC5, AC6 — a profile is not a search hit ──────────────────────────────────────────────

  it('serves a provider whose service radius is not set', async () => {
    boot(profile({ serviceRadiusMetres: null }));
    const response = await app.inject({ method: 'GET', url: `/api/providers/${ID}` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ serviceRadiusMetres: null });
  });

  it('serves a quote-only provider, which `mode=booking` would have excluded', async () => {
    boot(profile({ hourlyRateCents: null }));
    const response = await app.inject({ method: 'GET', url: `/api/providers/${ID}` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ hourlyRateCents: null });
  });

  // ── AC10 — the locale is resolved server-side ─────────────────────────────────────────────

  it('passes `en` to the repository for an English Accept-Language', async () => {
    await app.inject({
      method: 'GET',
      url: `/api/providers/${ID}`,
      headers: { 'accept-language': 'en-GB,en;q=0.9' },
    });

    expect(calls[0]?.locale).toBe('en');
  });

  it('defaults to `es`, because the market is Spain', async () => {
    await app.inject({ method: 'GET', url: `/api/providers/${ID}` });
    await app.inject({
      method: 'GET',
      url: `/api/providers/${ID}`,
      headers: { 'accept-language': 'fr-FR' },
    });

    expect(calls.map((call) => call.locale)).toEqual(['es', 'es']);
  });

  it('passes the parsed id through, not the raw parameter', async () => {
    await app.inject({ method: 'GET', url: `/api/providers/${ID}` });

    expect(calls[0]?.id).toBe(ID);
  });

  // ── AC11, AC12 — the outbound parse is the gate ───────────────────────────────────────────

  it('refuses to serve a stored coordinate that has not been coarsened', async () => {
    // The privacy rule as a failure rather than a convention: a repository that forwarded the
    // stored point would fail `SearchPointSchema`'s refinement here, not in front of a visitor.
    boot(profile({ point: { latitude: 40.416775, longitude: -3.70379 } }));
    const response = await app.inject({ method: 'GET', url: `/api/providers/${ID}` });

    expect(response.statusCode).toBe(500);
    expect((JSON.parse(response.body) as Envelope).error.code).toBe('INTERNAL_ERROR');
  });

  it('refuses to serve a field the contract does not declare', async () => {
    // `strictObject`: the fields that are absent are the ones doing the work — `userId`,
    // `baseAddressId`, `line1`, `line2`. A repository that grew one fails here.
    boot({ ...profile(), userId: 'leaked' } as ProviderProfile);
    const response = await app.inject({ method: 'GET', url: `/api/providers/${ID}` });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('leaked');
  });

  it('serves a body that is exactly the contract, with no address lines', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/providers/${ID}` });
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(
      [
        'bio',
        'categories',
        'city',
        'displayName',
        'hourlyRateCents',
        'id',
        'kind',
        'memberSince',
        'point',
        'province',
        'ratingAvg',
        'ratingCount',
        'serviceRadiusMetres',
      ].sort(),
    );
    expect(response.body).not.toContain('line1');
    expect(response.body).not.toContain('line2');
  });
});
