/**
 * `W4-T03` — the quote routes at their HTTP boundary.
 *
 * No database. What is asserted here is the boundary's own work: which permission guards which
 * route, that a client and a provider reach *different* readers, and that a job which is not the
 * caller's is `404`. Rows, coverage and the unique index are `quote-live.test.ts`'s subject.
 *
 * Spec: `docs/specs/S4/W4-T03-quote-submission.md` §3, §5.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { AppError, type Quote } from '@marketplace/contracts';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildGuards, type Principal, type ResolveSession } from '../src/modules/auth/guard.js';
import { quoteRoutes } from '../src/modules/quotes/routes.js';
import { type QuoteRepository } from '../src/modules/quotes/repository.js';

const ENV = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  LOG_LEVEL: 'silent',
  APP_VERSION: '1.2.3-test',
};

const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const QUOTE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

interface Envelope {
  error: { code: string; message: string; requestId: string };
}

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: QUOTE_ID,
    jobId: JOB_ID,
    status: 'PENDING',
    amountCents: 250000,
    breakdown: null,
    validUntil: '2026-10-20T10:00:00.000Z',
    provider: {
      id: USER_ID,
      displayName: 'Fontanería Ruiz',
      ratingAvg: null,
      ratingCount: 0,
      hourlyRateCents: null,
    },
    coverage: [],
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

function principal(roles: Principal['roles']): Principal {
  return { userId: USER_ID, roles: [...roles], sessionId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' };
}

function boot(options: { session?: Principal | null; found?: Quote | null; withGuards?: boolean }) {
  const calls = { created: 0, listedForJob: 0, listedOwn: 0, withdrawn: 0 };
  const found = options.found === undefined ? quote() : options.found;
  const resolveSession: ResolveSession = () => Promise.resolve(options.session ?? null);

  const repository: QuoteRepository = {
    create: () => {
      calls.created += 1;
      return Promise.resolve(found);
    },
    listForJob: () => {
      calls.listedForJob += 1;
      return Promise.resolve(
        found === null ? null : { items: [found], page: { nextCursor: null, hasMore: false } },
      );
    },
    listOwn: () => {
      calls.listedOwn += 1;
      return Promise.resolve(found === null ? [] : [found]);
    },
    withdraw: () => {
      calls.withdrawn += 1;
      return Promise.resolve(found === null ? null : quote({ status: 'WITHDRAWN' }));
    },
    // `W4-T04`'s routes are asserted in `quote-decision.test.ts`; this boot only has to satisfy
    // the interface so the plugin registers.
    accept: () => Promise.resolve(found),
    reject: () => Promise.resolve(found),
  };

  const app = buildApp({ config: loadConfig(ENV) });
  app.register(
    quoteRoutes({
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

describe('AC10 — every route needs a principal', () => {
  for (const [method, url] of [
    ['POST', `/api/jobs/${JOB_ID}/quotes`],
    ['GET', `/api/jobs/${JOB_ID}/quotes`],
    ['GET', '/api/me/quotes'],
    ['POST', `/api/quotes/${QUOTE_ID}/withdraw`],
  ] as const) {
    it(`${method} ${url} refuses an anonymous caller`, async () => {
      const booted = boot({ session: null });
      app = booted.app;

      const response = await app.inject({ method, url, payload: {} });

      expect(response.statusCode).toBe(401);
      expect((response.json() as Envelope).error.code).toBe('UNAUTHENTICATED');
      expect(Object.values(booted.calls).reduce((a, b) => a + b, 0)).toBe(0);
    });
  }
});

describe('no guard means no route — W2-T03 §3.7', () => {
  it('registers nothing at all without guards', async () => {
    const booted = boot({ withGuards: false });
    app = booted.app;

    for (const [method, url] of [
      ['POST', `/api/jobs/${JOB_ID}/quotes`],
      ['GET', '/api/me/quotes'],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});

describe('AC12 — a client and a provider are different readers', () => {
  it('a CLIENT cannot write a quote', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${JOB_ID}/quotes`,
      payload: { amountCents: 100, validUntil: '2026-10-20T10:00:00.000Z' },
    });

    expect(response.statusCode).toBe(403);
    expect(booted.calls.created).toBe(0);
  });

  it('a PROVIDER cannot read the quotes on somebody s job', async () => {
    // The split exists so this is a permission question rather than a WHERE clause somewhere.
    const booted = boot({ session: principal(['PROVIDER']) });
    app = booted.app;

    const response = await app.inject({ method: 'GET', url: `/api/jobs/${JOB_ID}/quotes` });

    expect(response.statusCode).toBe(403);
    expect(booted.calls.listedForJob, 'a provider reached the client s reader').toBe(0);
  });

  it('a CLIENT cannot read /me/quotes, which is the provider s own list', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({ method: 'GET', url: '/api/me/quotes' });

    expect(response.statusCode).toBe(403);
    expect(booted.calls.listedOwn).toBe(0);
  });

  it('a caller who is both reaches both, because roles is a set', async () => {
    const booted = boot({ session: principal(['CLIENT', 'PROVIDER']) });
    app = booted.app;

    expect((await app.inject({ method: 'GET', url: '/api/me/quotes' })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/api/jobs/${JOB_ID}/quotes` })).statusCode,
    ).toBe(200);
  });
});

describe('AC1 — writing one', () => {
  it('answers 201 with the quote', async () => {
    const booted = boot({ session: principal(['PROVIDER']) });
    app = booted.app;

    const response = await app.inject({
      method: 'POST',
      url: `/api/jobs/${JOB_ID}/quotes`,
      payload: { amountCents: 250000, validUntil: '2026-10-20T10:00:00.000Z' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<Quote>().amountCents).toBe(250000);
  });

  it('refuses a body that is not a quote, without reaching the repository', async () => {
    const booted = boot({ session: principal(['PROVIDER']) });
    app = booted.app;

    for (const payload of [
      {},
      { amountCents: 100 },
      { amountCents: -1, validUntil: '2026-10-20T10:00:00.000Z' },
      { amountCents: 100, validUntil: 'next tuesday' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/jobs/${JOB_ID}/quotes`,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(booted.calls.created).toBe(0);
  });
});

describe('AC10 — a job or quote that is not yours is 404', () => {
  for (const [method, url, what] of [
    ['POST', `/api/jobs/${JOB_ID}/quotes`, 'job'],
    ['GET', `/api/jobs/${JOB_ID}/quotes`, 'job'],
    ['POST', `/api/quotes/${QUOTE_ID}/withdraw`, 'quote'],
  ] as const) {
    it(`${method} ${url} answers not-found for a null from the repository`, async () => {
      const booted = boot({ session: principal(['CLIENT', 'PROVIDER']), found: null });
      app = booted.app;

      const response = await app.inject({
        method,
        url,
        payload: { amountCents: 1, validUntil: '2026-10-20T10:00:00.000Z' },
      });

      expect(response.statusCode).toBe(404);
      expect((response.json() as Envelope).error.message).toMatch(new RegExp(what));
    });
  }

  it('answers the same for a malformed id, without saying it is malformed', async () => {
    const booted = boot({ session: principal(['PROVIDER']) });
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: '/api/quotes/nope/withdraw' });

    expect(response.statusCode).toBe(404);
    expect(booted.calls.withdrawn).toBe(0);
  });
});

describe('the repository decides, the boundary reports', () => {
  it('passes the one-active-quote conflict straight through as a 409', async () => {
    const booted = boot({ session: principal(['PROVIDER']) });
    booted.app.register(
      quoteRoutes({
        repository: {
          create: () =>
            Promise.reject(
              new AppError('CONFLICT', 'you already have an active quote on this job'),
            ),
          listForJob: () =>
            Promise.resolve({ items: [], page: { nextCursor: null, hasMore: false } }),
          listOwn: () => Promise.resolve([]),
          withdraw: () => Promise.resolve(quote()),
          accept: () => Promise.resolve(quote()),
          reject: () => Promise.resolve(quote()),
        },
        guards: buildGuards({ resolveSession: () => Promise.resolve(principal(['PROVIDER'])) }),
      }),
      { prefix: '/api/v2' },
    );
    app = booted.app;

    const response = await app.inject({
      method: 'POST',
      url: `/api/v2/jobs/${JOB_ID}/quotes`,
      payload: { amountCents: 1, validUntil: '2026-10-20T10:00:00.000Z' },
    });

    expect(response.statusCode).toBe(409);
    expect((response.json() as Envelope).error.message).toMatch(/already have an active quote/);
  });

  it('withdraws and reports the new state', async () => {
    const booted = boot({ session: principal(['PROVIDER']) });
    app = booted.app;

    const response = await app.inject({
      method: 'POST',
      url: `/api/quotes/${QUOTE_ID}/withdraw`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<Quote>().status).toBe('WITHDRAWN');
  });
});
