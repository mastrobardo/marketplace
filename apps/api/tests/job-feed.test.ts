/**
 * `W4-T07` — the feed at its HTTP boundary.
 *
 * No database. What is asserted here is the boundary's own work: which permission guards the route,
 * that the two unserviceable profile states arrive as `409` with a message naming the fix rather than
 * as an empty page, and that the response is **parsed on the way out** — which is what makes the
 * disclosure rule a gate instead of a comment. The geography and the paging over real rows are
 * `job-feed-live.test.ts`'s subject.
 *
 * Spec: `docs/specs/S4/W4-T07-provider-job-feed.md` §3.1, §5.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { AppError, type JobFeedItem, type Page } from '@marketplace/contracts';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildGuards, type Principal, type ResolveSession } from '../src/modules/auth/guard.js';
import { jobFeedRoutes } from '../src/modules/jobs/feed-routes.js';
import { type JobFeedRepository } from '../src/modules/jobs/feed-repository.js';

const ENV = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  LOG_LEVEL: 'silent',
  APP_VERSION: '1.2.3-test',
};

const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const URL = '/api/me/job-feed';

interface Envelope {
  error: { code: string; message: string; requestId: string };
}

function item(overrides: Partial<JobFeedItem> = {}): JobFeedItem {
  return {
    id: JOB_ID,
    title: 'Cambiar el termo eléctrico',
    description: null,
    categories: [
      { slug: 'fontaneria', nameEs: 'Fontanería', nameEn: 'Plumbing', requiresLicence: false },
    ],
    urgency: null,
    budget: { minCents: null, maxCents: null },
    location: { city: 'Madrid', province: 'Madrid', postalCode: '28013' },
    distanceMetres: 1840,
    coverage: [
      {
        slug: 'fontaneria',
        nameEs: 'Fontanería',
        nameEn: 'Plumbing',
        requiresLicence: false,
        listedByProvider: true,
      },
    ],
    myQuote: null,
    publishedAt: '2026-09-25T09:00:00.000Z',
    createdAt: '2026-09-24T18:00:00.000Z',
    ...overrides,
  };
}

function principal(roles: Principal['roles']): Principal {
  return { userId: USER_ID, roles: [...roles], sessionId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' };
}

function boot(options: {
  session?: Principal | null;
  page?: Page<JobFeedItem>;
  throws?: AppError;
  withGuards?: boolean;
}) {
  const calls: { read: number; limits: number[] } = { read: 0, limits: [] };
  const resolveSession: ResolveSession = () => Promise.resolve(options.session ?? null);

  const repository: JobFeedRepository = {
    read: (_userId, query) => {
      calls.read += 1;
      calls.limits.push(query.limit);
      if (options.throws !== undefined) return Promise.reject(options.throws);
      return Promise.resolve(
        options.page ?? { items: [item()], page: { nextCursor: null, hasMore: false } },
      );
    },
  };

  const app = buildApp({ config: loadConfig(ENV) });
  app.register(
    jobFeedRoutes({
      repository,
      ...(options.withGuards === false ? {} : { guards: buildGuards({ resolveSession }) }),
    }),
    { prefix: '/api' },
  );

  return { app, calls };
}

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe('AC16 — who may read the market', () => {
  it('refuses an anonymous caller with 401', async () => {
    const booted = boot({ session: null });
    app = booted.app;
    const response = await app.inject({ method: 'GET', url: URL });
    expect(response.statusCode).toBe(401);
    expect(booted.calls.read).toBe(0);
  });

  it('refuses a CLIENT-only principal with 403', async () => {
    // Reading the market and reading your own postings are different capabilities held by different
    // capacities of the same person (§2.9). A client has `job:read-own` and not this.
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;
    const response = await app.inject({ method: 'GET', url: URL });
    expect(response.statusCode).toBe(403);
    expect(booted.calls.read).toBe(0);
  });

  it('serves a PROVIDER, including one who is also a client', async () => {
    const booted = boot({ session: principal(['CLIENT', 'PROVIDER']) });
    app = booted.app;
    const response = await app.inject({ method: 'GET', url: URL });
    expect(response.statusCode).toBe(200);
    expect(booted.calls.read).toBe(1);
  });

  it('registers nothing at all without a guard', async () => {
    // `W2-T03` §3.7 — fail-closed is structural. A build with no `auth` answers 404 rather than
    // serving the market to anybody who asks.
    const booted = boot({ session: principal(['PROVIDER']), withGuards: false });
    app = booted.app;
    expect((await app.inject({ method: 'GET', url: URL })).statusCode).toBe(404);
  });
});

describe('AC14/AC15 — an unserviceable profile is refused, not answered empty', () => {
  for (const [what, message] of [
    ['no provider profile', 'create your provider profile'],
    ['no service radius', 'set how far you will travel'],
  ] as const) {
    it(`reports ${what} as a 409 naming the fix`, async () => {
      const booted = boot({
        session: principal(['PROVIDER']),
        throws: new AppError('CONFLICT', message),
      });
      app = booted.app;
      const response = await app.inject({ method: 'GET', url: URL });
      expect(response.statusCode).toBe(409);
      const body = response.json<Envelope>();
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain(message);
    });
  }
});

describe('AC12/AC13 — the query is parsed at the boundary', () => {
  for (const [query, why] of [
    ['limit=101', 'above the maximum'],
    ['sort=distanceMetres', 'not a sortable field'],
    ['categorySlug=fontaneria', 'a filter this endpoint does not have'],
    ['cursor=not-a-cursor', 'an undecodable cursor'],
  ] as const) {
    it(`refuses ?${query} — ${why}`, async () => {
      const booted = boot({ session: principal(['PROVIDER']) });
      app = booted.app;
      const response = await app.inject({ method: 'GET', url: `${URL}?${query}` });
      expect(response.statusCode).toBe(400);
      expect(response.json<Envelope>().error.code).toBe('VALIDATION_FAILED');
      // The repository is never reached: a bad request is refused before anything is read.
      expect(booted.calls.read).toBe(0);
    });
  }

  it('defaults the page size rather than making the handler decide', async () => {
    const booted = boot({ session: principal(['PROVIDER']) });
    app = booted.app;
    await app.inject({ method: 'GET', url: URL });
    expect(booted.calls.limits).toEqual([20]);
  });
});

describe('AC17 — the response is parsed on the way out', () => {
  it('answers the page envelope', async () => {
    const booted = boot({
      session: principal(['PROVIDER']),
      page: { items: [item()], page: { nextCursor: 'abc', hasMore: true } },
    });
    app = booted.app;
    const response = await app.inject({ method: 'GET', url: URL });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [item()],
      page: { nextCursor: 'abc', hasMore: true },
    });
  });

  it('refuses to serve a row carrying anything the disclosure rule leaves out', async () => {
    // A 500 rather than a leak. Types are erased at runtime, so the outbound parse is the only thing
    // standing between a widened `SELECT` and somebody's address on the wire (§2.3).
    const booted = boot({
      session: principal(['PROVIDER']),
      page: {
        items: [{ ...item(), latitude: 40.4168 } as unknown as JobFeedItem],
        page: { nextCursor: null, hasMore: false },
      },
    });
    app = booted.app;
    const response = await app.inject({ method: 'GET', url: URL });
    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.json())).not.toContain('40.4168');
  });

  it('answers an empty page for a provider nothing matches, never a 404', async () => {
    const booted = boot({
      session: principal(['PROVIDER']),
      page: { items: [], page: { nextCursor: null, hasMore: false } },
    });
    app = booted.app;
    const response = await app.inject({ method: 'GET', url: URL });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], page: { nextCursor: null, hasMore: false } });
  });
});
