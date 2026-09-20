/**
 * `W4-T04` — accept and reject at their HTTP boundary.
 *
 * No database. What is asserted here is the boundary's own work: that **one** permission guards both
 * decisions and it is a `CLIENT`'s, that a provider cannot answer a quote even when it is their own,
 * and that the quotes list now speaks the page envelope.
 *
 * Spec: `docs/specs/S4/W4-T04-quote-comparison.md` §3.1, §5.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { emptyPage, type Page, type Quote } from '@marketplace/contracts';

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

function page(items: readonly Quote[]): Page<Quote> {
  return { items, page: { nextCursor: null, hasMore: false } };
}

function boot(options: { session?: Principal | null; found?: Quote | null }) {
  const calls = { accepted: 0, rejected: 0 };
  const found = options.found === undefined ? quote() : options.found;
  const resolveSession: ResolveSession = () => Promise.resolve(options.session ?? null);

  const repository: QuoteRepository = {
    create: () => Promise.resolve(found),
    listForJob: () => Promise.resolve(found === null ? null : page([found])),
    listOwn: () => Promise.resolve([]),
    withdraw: () => Promise.resolve(found),
    accept: () => {
      calls.accepted += 1;
      return Promise.resolve(found === null ? null : quote({ status: 'ACCEPTED' }));
    },
    reject: () => {
      calls.rejected += 1;
      return Promise.resolve(found === null ? null : quote({ status: 'REJECTED' }));
    },
  };

  const app = buildApp({ config: loadConfig(ENV) });
  app.register(quoteRoutes({ repository, guards: buildGuards({ resolveSession }) }), {
    prefix: '/api',
  });

  return { app, calls };
}

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe('AC1/AC2 — the client decides', () => {
  it('accepts, and reports the new state', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: `/api/quotes/${QUOTE_ID}/accept` });

    expect(response.statusCode).toBe(200);
    expect(response.json<Quote>().status).toBe('ACCEPTED');
    expect(booted.calls.accepted).toBe(1);
  });

  it('rejects, and reports the new state', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: `/api/quotes/${QUOTE_ID}/reject` });

    expect(response.statusCode).toBe(200);
    expect(response.json<Quote>().status).toBe('REJECTED');
  });
});

describe('AC12 — a provider cannot answer a quote, including their own', () => {
  for (const decision of ['accept', 'reject'] as const) {
    it(`refuses ${decision} to a PROVIDER`, async () => {
      const booted = boot({ session: principal(['PROVIDER']) });
      app = booted.app;

      const response = await app.inject({
        method: 'POST',
        url: `/api/quotes/${QUOTE_ID}/${decision}`,
      });

      expect(response.statusCode).toBe(403);
      expect(booted.calls[decision === 'accept' ? 'accepted' : 'rejected']).toBe(0);
    });
  }
});

describe('AC13 — every decision needs a principal', () => {
  for (const decision of ['accept', 'reject'] as const) {
    it(`refuses ${decision} to an anonymous caller`, async () => {
      const booted = boot({ session: null });
      app = booted.app;

      const response = await app.inject({
        method: 'POST',
        url: `/api/quotes/${QUOTE_ID}/${decision}`,
      });

      expect(response.statusCode).toBe(401);
      expect((response.json() as Envelope).error.code).toBe('UNAUTHENTICATED');
    });
  }
});

describe('AC11 — somebody else s quote is not found, not forbidden', () => {
  it('answers 404 when the repository says the quote is not the caller s', async () => {
    const booted = boot({ session: principal(['CLIENT']), found: null });
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: `/api/quotes/${QUOTE_ID}/accept` });

    expect(response.statusCode).toBe(404);
    expect((response.json() as Envelope).error.code).toBe('NOT_FOUND');
  });

  it('answers 404 for a malformed id without telling the caller it was malformed', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: '/api/quotes/not-a-uuid/accept' });

    expect(response.statusCode).toBe(404);
    expect((response.json() as Envelope).error.message).not.toMatch(/uuid/i);
  });
});

describe('AC16 — the quotes list speaks the page envelope', () => {
  it('returns items and a page', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({ method: 'GET', url: `/api/jobs/${JOB_ID}/quotes` });

    expect(response.statusCode).toBe(200);
    expect(response.json<Page<Quote>>().page).toEqual({ nextCursor: null, hasMore: false });
  });

  it('refuses a limit above the maximum rather than quietly clamping it', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({
      method: 'GET',
      url: `/api/jobs/${JOB_ID}/quotes?limit=101`,
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as Envelope).error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses an unknown query parameter rather than paging in a circle', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({
      method: 'GET',
      url: `/api/jobs/${JOB_ID}/quotes?offset=40`,
    });

    expect(response.statusCode).toBe(400);
  });

  it('answers an empty page for a job with no quotes, never a 404', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    booted.app.close();
    const empty = boot({ session: principal(['CLIENT']) });
    app = empty.app;

    const response = await app.inject({ method: 'GET', url: `/api/jobs/${JOB_ID}/quotes` });

    expect(response.statusCode).toBe(200);
    expect(emptyPage<Quote>().page).toEqual({ nextCursor: null, hasMore: false });
  });
});
