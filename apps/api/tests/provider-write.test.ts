/**
 * `W3-T02` — `GET`/`PUT /api/providers/me` at their HTTP boundary.
 *
 * No database: the routes take the same kind of injected data layer `W3-T07` established, and the
 * guard takes `W2-T03`'s `ResolveSession` port. What is asserted here is the boundary's own work —
 * who is refused and with which code, which bodies never reach the writer, the two projections, and
 * the fact that `/me` is not captured by `/:id`. Rows are `provider-write-live.test.ts`'s subject.
 *
 * Spec: `docs/specs/S3/W3-T02-provider-profile-write.md` §3, §7.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  coarsenPoint,
  type ProviderProfile,
  type ProviderProfileOwn,
  type ProviderProfileWrite,
} from '@marketplace/contracts';
import { ProviderProfileSchema } from '@marketplace/contracts';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildGuards, type Principal, type ResolveSession } from '../src/modules/auth/guard.js';
import { providerRoutes } from '../src/modules/providers/routes.js';
import {
  type ProviderOwnRepository,
  type ProviderWriteResult,
  type ProviderWriter,
} from '../src/modules/providers/write-repository.js';

const ENV = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  LOG_LEVEL: 'silent',
  APP_VERSION: '1.2.3-test',
};

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SOL = { latitude: 40.416775, longitude: -3.70379 };

interface Envelope {
  error: { code: string; message: string; requestId: string; details?: { issues?: unknown[] } };
}

function body(overrides: Partial<ProviderProfileWrite> = {}): ProviderProfileWrite {
  return {
    displayName: 'Fontanería Gómez',
    kind: 'PRO',
    bio: null,
    categories: ['fontaneria'],
    serviceRadiusMetres: 15_000,
    hourlyRateCents: 4_200,
    baseAddress: {
      label: null,
      line1: 'Calle Mayor 1',
      line2: null,
      city: 'Madrid',
      province: 'Madrid',
      postalCode: '28013',
      ...SOL,
    },
    ...overrides,
  };
}

function publicProfile(): ProviderProfile {
  return {
    id: PROFILE_ID,
    displayName: 'Fontanería Gómez',
    kind: 'PRO',
    bio: null,
    categories: [{ slug: 'fontaneria', name: 'Fontanería' }],
    ratingAvg: null,
    ratingCount: 0,
    hourlyRateCents: 4_200,
    city: 'Madrid',
    province: 'Madrid',
    serviceRadiusMetres: 15_000,
    memberSince: '2026-03-01T09:00:00.000Z',
    point: coarsenPoint(SOL),
  };
}

function ownProfile(): ProviderProfileOwn {
  const { point: _coarse, ...rest } = publicProfile();
  return { ...rest, baseAddress: body().baseAddress };
}

function principal(roles: Principal['roles']): Principal {
  return { userId: USER_ID, roles: [...roles], sessionId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' };
}

/**
 * The app under test: the public read route `W3-T07` shipped, plus the two private ones, wired the
 * way `app.ts` wires them.
 */
function boot(options: {
  session?: Principal | null;
  writeResult?: ProviderWriteResult;
  own?: ProviderProfileOwn | undefined;
  /** Omitting the guard is the point of one test — a private route must then not exist at all. */
  withPrivate?: boolean;
}) {
  const calls = { read: 0, own: 0, write: [] as ProviderProfileWrite[] };

  const resolveSession: ResolveSession = () => Promise.resolve(options.session ?? null);

  const ownRepository: ProviderOwnRepository = () => {
    calls.own += 1;
    return Promise.resolve(options.own);
  };

  const writer: ProviderWriter = ({ write }) => {
    calls.write.push(write);
    return Promise.resolve(options.writeResult ?? { ok: true, profile: publicProfile() });
  };

  const app = buildApp({ config: loadConfig(ENV) });
  app.register(
    providerRoutes({
      repository: () => {
        calls.read += 1;
        return Promise.resolve(publicProfile());
      },
      ...(options.withPrivate === false
        ? {}
        : { guards: buildGuards({ resolveSession }), own: ownRepository, writer }),
    }),
    { prefix: '/api' },
  );

  return { app, calls };
}

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

async function put(instance: FastifyInstance, payload: unknown) {
  return instance.inject({
    method: 'PUT',
    url: '/api/providers/me',
    payload: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
  });
}

describe('W3-T02 §3.1 — the guard, and who is refused', () => {
  it('AC1: refuses both routes with no session, and asks the data layer nothing', async () => {
    const booted = boot({ session: null });
    app = booted.app;

    const read = await app.inject({ method: 'GET', url: '/api/providers/me' });
    const written = await put(app, body());

    expect(read.statusCode).toBe(401);
    expect(written.statusCode).toBe(401);
    expect((JSON.parse(written.body) as Envelope).error.code).toBe('UNAUTHENTICATED');
    expect(booted.calls.own).toBe(0);
    expect(booted.calls.write).toHaveLength(0);
  });

  it('AC2: refuses a CLIENT the write, and nothing is handed to the writer', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await put(app, body());

    expect(response.statusCode).toBe(403);
    expect((JSON.parse(response.body) as Envelope).error.code).toBe('FORBIDDEN');
    expect(booted.calls.write).toHaveLength(0);
  });

  it('AC2: a CLIENT may still ask for their own profile, and simply has none', async () => {
    const booted = boot({ session: principal(['CLIENT']), own: undefined });
    app = booted.app;

    const response = await app.inject({ method: 'GET', url: '/api/providers/me' });

    expect(response.statusCode).toBe(404);
    expect((JSON.parse(response.body) as Envelope).error.code).toBe('NOT_FOUND');
  });

  it('AC3: lets a PROVIDER through, with the principal as the row it writes', async () => {
    const booted = boot({ session: principal(['CLIENT', 'PROVIDER']) });
    app = booted.app;

    const response = await put(app, body());

    expect(response.statusCode, response.body).toBe(200);
    expect(booted.calls.write).toHaveLength(1);
  });
});

describe('W3-T02 §3.4 — the two projections', () => {
  it('AC14: PUT answers the public profile — coarse point, no address line', async () => {
    const booted = boot({ session: principal(['PROVIDER']) });
    app = booted.app;

    const response = await put(app, body());
    const parsed = ProviderProfileSchema.safeParse(JSON.parse(response.body));

    expect(parsed.success, response.body).toBe(true);
    expect(response.body).not.toContain('Calle Mayor');
  });

  it('AC15: GET /me answers the owner projection — the lines they typed, precise point', async () => {
    const booted = boot({ session: principal(['PROVIDER']), own: ownProfile() });
    app = booted.app;

    const response = await app.inject({ method: 'GET', url: '/api/providers/me' });
    const answer = JSON.parse(response.body) as Record<string, unknown>;

    expect(response.statusCode).toBe(200);
    expect(answer['baseAddress']).toMatchObject({ line1: 'Calle Mayor 1', ...SOL });
    expect(
      answer['point'],
      'one precise address and one coarse copy is two answers',
    ).toBeUndefined();
  });
});

describe('W3-T02 §3.3 — a body that cannot be stored is never handed on', () => {
  const rejected: [string, unknown][] = [
    ['an empty category list', body({ categories: [] })],
    ['a radius of zero', body({ serviceRadiusMetres: 0 })],
    ['a radius above the column CHECK', body({ serviceRadiusMetres: 200_001 })],
    ['a negative rate', body({ hourlyRateCents: -1 })],
    [
      'a four-digit postal code',
      { ...body(), baseAddress: { ...body().baseAddress, postalCode: '2801' } },
    ],
    [
      'no address at all',
      (() => {
        const { baseAddress: _drop, ...rest } = body();
        return rest;
      })(),
    ],
    ['an unknown key', { ...body(), ratingAvg: 5 }],
  ];

  for (const [name, payload] of rejected) {
    it(`AC12: refuses ${name} with 400, and calls no writer`, async () => {
      const booted = boot({ session: principal(['PROVIDER']) });
      app = booted.app;

      const response = await put(app, payload);
      const envelope = JSON.parse(response.body) as Envelope;

      expect(response.statusCode, response.body).toBe(400);
      expect(envelope.error.code).toBe('VALIDATION_FAILED');
      expect(envelope.error.details?.issues).toEqual(expect.any(Array));
      expect(booted.calls.write).toHaveLength(0);
    });
  }

  it('AC13: accepts a null rate — quote-only is a rate, not a missing field', async () => {
    const booted = boot({ session: principal(['PROVIDER']) });
    app = booted.app;

    const response = await put(app, body({ hourlyRateCents: null }));

    expect(response.statusCode, response.body).toBe(200);
  });
});

describe('W3-T02 §3.7 — a slug nobody has is the provider’s mistake, not a 500', () => {
  it('AC10: answers 400 naming the field and the slug', async () => {
    const booted = boot({
      session: principal(['PROVIDER']),
      writeResult: { ok: false, unknownSlugs: ['fontaneria-espacial'] },
    });
    app = booted.app;

    const response = await put(app, body({ categories: ['fontaneria', 'fontaneria-espacial'] }));
    const envelope = JSON.parse(response.body) as Envelope;

    expect(response.statusCode).toBe(400);
    expect(envelope.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(envelope.error.details)).toContain('fontaneria-espacial');
    expect(JSON.stringify(envelope.error.details)).toContain('categories');
  });
});

describe('W3-T02 §3.1 — /me is not an id, and a build without a guard has no private route', () => {
  it('does not let /me fall through to GET /providers/:id', async () => {
    const booted = boot({ session: principal(['PROVIDER']), own: ownProfile() });
    app = booted.app;

    await app.inject({ method: 'GET', url: '/api/providers/me' });

    expect(booted.calls.read, 'the public by-id route answered /me').toBe(0);
    expect(booted.calls.own).toBe(1);
  });

  it('still serves the public route by id', async () => {
    const booted = boot({ session: null });
    app = booted.app;

    const response = await app.inject({ method: 'GET', url: `/api/providers/${PROFILE_ID}` });

    expect(response.statusCode).toBe(200);
    expect(booted.calls.read).toBe(1);
  });

  it('W2-T03 §3.7: registers no private route when there is no guard — never 200', async () => {
    const booted = boot({ session: principal(['PROVIDER']), withPrivate: false });
    app = booted.app;

    const written = await put(app, body());
    const read = await app.inject({ method: 'GET', url: '/api/providers/me' });

    // The write has no route at all.
    expect(written.statusCode, written.body).toBe(404);
    expect(booted.calls.write).toHaveLength(0);

    /**
     * The read is answered by the **public** route, because `/me` and `/:id` share a path space:
     * with the static segment unregistered, `me` is just an id — and a malformed one, so it is a
     * `400` rather than a `404`. Still a refusal, still no data, and asserted here rather than
     * discovered: the fail-closed property is "never 200", and the status it takes to get there
     * depends on which route is missing.
     */
    expect(read.statusCode, read.body).toBe(400);
    expect(JSON.parse(read.body)).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(booted.calls.own).toBe(0);
  });
});
