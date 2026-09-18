/**
 * `W2-T03` — the guards at their HTTP boundary.
 *
 * Everything here runs without a database and without better-auth: `buildGuards` takes a
 * `ResolveSession` port, so a stub answers the one question the guard asks. What is asserted is the
 * boundary's own work — 401 vs 403 as two different answers, the envelope, the principal on the
 * request, one resolution per request, and fail-closed when the resolver throws. The adapter that
 * speaks to better-auth and Postgres is `guard-live.test.ts`'s subject.
 *
 * Spec: `docs/specs/S2/W2-T03-route-guards.md` §3, §7.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type IncomingHttpHeaders } from 'node:http';
import { UserRole } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  buildGuards,
  principalOf,
  type Principal,
  type ResolveSession,
} from '../src/modules/auth/guard.js';
import { ALL_ROLES, PERMISSIONS } from '../src/modules/auth/permissions.js';

const ENV = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  LOG_LEVEL: 'silent',
  APP_VERSION: '1.2.3-test',
};

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '99999999-9999-4999-8999-999999999999';

interface Envelope {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

function principal(roles: readonly UserRole[]): Principal {
  return { userId: USER_ID, roles: [...roles], sessionId: SESSION_ID };
}

/** What the stub does when asked: answer, refuse, or fail outright (AC13). */
type StubAnswer = Principal | null | { readonly throws: true };

/** A resolver that records how often it was asked. AC14 is about the count. */
function stubResolver(answer: StubAnswer) {
  const calls: IncomingHttpHeaders[] = [];
  const resolveSession: ResolveSession = async (headers) => {
    calls.push(headers);
    if (answer !== null && 'throws' in answer) {
      throw new Error('session backend unreachable');
    }
    return answer;
  };
  return { resolveSession, calls };
}

/**
 * A probe app: `buildApp` for the error handler and the envelope, plus routes that exist only to
 * be guarded. No product route is private yet — `W3-T02` is the first — so the guard's proof is a
 * route the test owns rather than one invented in `src/`.
 */
function boot(
  resolver: ReturnType<typeof stubResolver>,
  permissions: Record<string, readonly UserRole[]> = PERMISSIONS,
) {
  const app = buildApp({ config: loadConfig(ENV) });
  const guards = buildGuards({ resolveSession: resolver.resolveSession, permissions });

  app.get('/api/probe/session', { preHandler: guards.requireSession }, (request) =>
    principalOf(request),
  );

  for (const permission of Object.keys(permissions)) {
    app.get(
      permissionUrl(permission),
      { preHandler: guards.requirePermission(permission) },
      (request) => principalOf(request),
    );
  }

  // Two guards on one route: AC14 asserts the session is resolved once, not twice.
  app.get(
    '/api/probe/twice',
    {
      preHandler: [guards.requireSession, guards.requirePermission('provider-profile:update-own')],
    },
    (request) => principalOf(request),
  );

  return app;
}

/**
 * A probe path per permission, slugged.
 *
 * Not `encodeURIComponent`: a `:` is a **parameter** in a Fastify path, and percent-encoding it
 * does not help — find-my-way decodes the incoming path before matching, so a route registered as
 * `%3A` is a route nothing can reach. Both sides call this function, so they cannot disagree.
 */
function permissionUrl(permission: string): string {
  return `/api/probe/permission/${permission.replace(/[^a-z0-9]+/gi, '-')}`;
}

describe('W2-T03 — 401: there is nobody here', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('AC1: refuses a request with no cookie, and the handler never runs', async () => {
    const resolver = stubResolver(null);
    app = boot(resolver);

    const response = await app.inject({ method: 'GET', url: '/api/probe/session' });
    const body = JSON.parse(response.body) as Envelope;

    expect(response.statusCode).toBe(401);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(body.error.details).toBeUndefined();
  });

  it('AC2: answers a stale cookie identically to no cookie at all', async () => {
    const resolver = stubResolver(null);
    app = boot(resolver);

    const absent = await app.inject({ method: 'GET', url: '/api/probe/session' });
    const stale = await app.inject({
      method: 'GET',
      url: '/api/probe/session',
      headers: { cookie: 'better-auth.session_token=a-token-nobody-has' },
    });

    const strip = (raw: string): unknown => {
      const body = JSON.parse(raw) as Envelope;
      return { ...body.error, requestId: '<id>' };
    };

    expect(stale.statusCode).toBe(absent.statusCode);
    expect(strip(stale.body)).toEqual(strip(absent.body));
  });
});

describe('W2-T03 — a principal, and what the route may see of it', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('AC3: runs the handler when the roles carry the permission', async () => {
    const resolver = stubResolver(principal(['PROVIDER']));
    app = boot(resolver);

    const response = await app.inject({
      method: 'GET',
      url: permissionUrl('provider-profile:update-own'),
    });

    expect(response.statusCode).toBe(200);
  });

  it('AC4: request.auth is exactly { userId, roles, sessionId } — no account state', async () => {
    const resolver = stubResolver(principal(['PROVIDER']));
    app = boot(resolver);

    const response = await app.inject({ method: 'GET', url: '/api/probe/session' });
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(['roles', 'sessionId', 'userId']);
    expect(body).toEqual({ userId: USER_ID, roles: ['PROVIDER'], sessionId: SESSION_ID });
    // §3.3, operator's rule: a suspended/blocked/deleted user returns no data — not even
    // `deletedAt`. State is a filter in the adapter, so there is nothing here to leak.
    expect(body['status']).toBeUndefined();
    expect(body['deletedAt']).toBeUndefined();
    expect(body['email']).toBeUndefined();
  });

  it('AC14: resolves the session once for a route carrying two guards', async () => {
    const resolver = stubResolver(principal(['PROVIDER']));
    app = boot(resolver);

    const response = await app.inject({ method: 'GET', url: '/api/probe/twice' });

    expect(response.statusCode).toBe(200);
    expect(resolver.calls).toHaveLength(1);
  });
});

describe('W2-T03 §5 — 403: every deny in the matrix', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('AC5: refuses a principal whose roles lack the permission', async () => {
    const resolver = stubResolver(principal(['CLIENT']));
    app = boot(resolver);

    const response = await app.inject({
      method: 'GET',
      url: permissionUrl('provider-profile:update-own'),
    });
    const body = JSON.parse(response.body) as Envelope;

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.details).toBeUndefined();
  });

  /**
   * AC6 — the table enumerates itself. A permission added without a deny test cannot exist: this
   * loop is the test, and it grows with the matrix rather than alongside it.
   */
  for (const [permission, allowed] of Object.entries(PERMISSIONS)) {
    for (const role of ALL_ROLES) {
      const expected = (allowed as readonly UserRole[]).includes(role) ? 200 : 403;

      it(`AC6: ${role} → ${permission} is ${expected}`, async () => {
        const resolver = stubResolver(principal([role]));
        app = boot(resolver);

        const response = await app.inject({ method: 'GET', url: permissionUrl(permission) });

        expect(response.statusCode).toBe(expected);
      });
    }
  }

  it('AC7: ADMIN gets no implicit bypass', async () => {
    const resolver = stubResolver(principal(['ADMIN']));
    app = boot(resolver);

    const response = await app.inject({
      method: 'GET',
      url: permissionUrl('provider-profile:update-own'),
    });

    expect(response.statusCode).toBe(403);
  });

  it('AC15: an explicit grant to ADMIN works — the mechanism the money view will use', async () => {
    // Over a fixture matrix, not the product one: there are no transactions to read yet (`W5-T10`),
    // and a cell no route enforces is the empty promise §3.5.1 refuses to ship.
    const fixture = { 'ledger:read-fixture': ['ADMIN'] } as const;
    const resolver = stubResolver(principal(['ADMIN']));
    app = boot(resolver, fixture);

    const response = await app.inject({ method: 'GET', url: permissionUrl('ledger:read-fixture') });

    expect(response.statusCode).toBe(200);
  });
});

describe('W2-T03 — the envelope, the log, and the public routes', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('AC12: refusals answer in W1-T01 envelope, never better-auth’s shape', async () => {
    const denied = stubResolver(principal(['CLIENT']));
    app = boot(denied);

    const forbidden = await app.inject({
      method: 'GET',
      url: permissionUrl('provider-profile:update-own'),
    });
    const body = JSON.parse(forbidden.body) as Record<string, unknown>;

    expect(Object.keys(body)).toEqual(['error']);
    expect(body['code']).toBeUndefined(); // better-auth puts the code at the top level
  });

  it('AC11: leaves the public routes alone', async () => {
    const resolver = stubResolver(null);
    app = boot(resolver);

    const health = await app.inject({ method: 'GET', url: '/health' });

    expect(health.statusCode).toBe(200);
    expect(resolver.calls).toHaveLength(0);
  });

  it('AC13: a resolver that throws is a closed door, not an open one', async () => {
    const broken = stubResolver({ throws: true });
    app = boot(broken);

    const response = await app.inject({ method: 'GET', url: '/api/probe/session' });
    const body = JSON.parse(response.body) as Envelope;

    expect(response.statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
