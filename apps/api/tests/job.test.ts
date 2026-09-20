/**
 * `W4-T01` — the job routes at their HTTP boundary.
 *
 * No database: the routes take an injected repository and the guard takes `W2-T03`'s
 * `ResolveSession` port. What is asserted here is the boundary's own work — who is refused and with
 * which code, that `/jobs/me` is not swallowed by `/jobs/:id`, and that a stranger's job is `404`
 * rather than `403`. Rows and the transition are `job-live.test.ts`'s subject.
 *
 * Spec: `docs/specs/S4/W4-T01-job-posting.md` §3, §5.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { AppError, type Job } from '@marketplace/contracts';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildGuards, type Principal, type ResolveSession } from '../src/modules/auth/guard.js';
import { jobRoutes } from '../src/modules/jobs/routes.js';
import { type JobRepository } from '../src/modules/jobs/repository.js';

const ENV = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  LOG_LEVEL: 'silent',
  APP_VERSION: '1.2.3-test',
};

const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

interface Envelope {
  error: { code: string; message: string; requestId: string };
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    status: 'DRAFT',
    title: null,
    description: null,
    categories: [],
    urgency: null,
    budget: { minCents: null, maxCents: null },
    location: null,
    publishedAt: null,
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-20T09:00:00.000Z',
    ...overrides,
  };
}

function principal(roles: Principal['roles']): Principal {
  return { userId: USER_ID, roles: [...roles], sessionId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' };
}

/** The app under test, wired the way `app.ts` wires it. */
function boot(options: {
  session?: Principal | null;
  /** `null` from the repository is *not yours or not there* — the boundary turns it into a 404. */
  found?: Job | null;
  /** Omitting the guard is the point of one test: no guard must mean no route. */
  withGuards?: boolean;
}) {
  const calls = { created: 0, listed: 0, read: 0, updated: 0, published: 0 };
  const found = options.found === undefined ? job() : options.found;

  const resolveSession: ResolveSession = () => Promise.resolve(options.session ?? null);

  const repository: JobRepository = {
    createDraft: () => {
      calls.created += 1;
      return Promise.resolve(job());
    },
    listOwn: () => {
      calls.listed += 1;
      return Promise.resolve([job()]);
    },
    findOwn: () => {
      calls.read += 1;
      return Promise.resolve(found);
    },
    update: () => {
      calls.updated += 1;
      return Promise.resolve(found);
    },
    publish: () => {
      calls.published += 1;
      if (found === null) return Promise.resolve(null);
      return Promise.resolve(job({ status: 'OPEN', publishedAt: '2026-09-20T09:05:00.000Z' }));
    },
  };

  const app = buildApp({ config: loadConfig(ENV) });
  app.register(
    jobRoutes({
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

describe('AC11 — every route needs a principal', () => {
  for (const [method, url] of [
    ['POST', '/api/jobs'],
    ['GET', '/api/jobs/me'],
    ['GET', `/api/jobs/${JOB_ID}`],
    ['PUT', `/api/jobs/${JOB_ID}`],
    ['POST', `/api/jobs/${JOB_ID}/publish`],
  ] as const) {
    it(`${method} ${url} refuses an anonymous caller`, async () => {
      const booted = boot({ session: null });
      app = booted.app;

      const response = await app.inject({ method, url, payload: {} });

      expect(response.statusCode).toBe(401);
      expect((response.json() as Envelope).error.code).toBe('UNAUTHENTICATED');
      expect(booted.calls.created + booted.calls.read + booted.calls.published).toBe(0);
    });
  }
});

describe('AC14 — a role that should not post a job cannot', () => {
  it('refuses a caller with no CLIENT role', async () => {
    // A provider normally *is* a client — roles is a set — so this is a caller with PROVIDER alone,
    // which is a shape the seeder does not produce but the permission must still refuse.
    const booted = boot({ session: principal(['PROVIDER']) });
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: '/api/jobs', payload: {} });

    expect(response.statusCode).toBe(403);
    expect((response.json() as Envelope).error.code).toBe('FORBIDDEN');
    expect(booted.calls.created).toBe(0);
  });

  it('allows a caller who is both, because posting a job is a client capacity', async () => {
    const booted = boot({ session: principal(['CLIENT', 'PROVIDER']) });
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: '/api/jobs', payload: {} });

    expect(response.statusCode).toBe(201);
    expect(booted.calls.created).toBe(1);
  });
});

describe('no guard means no route — W2-T03 §3.7', () => {
  it('registers nothing at all without guards', async () => {
    const booted = boot({ withGuards: false });
    app = booted.app;

    for (const [method, url] of [
      ['POST', '/api/jobs'],
      ['GET', '/api/jobs/me'],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      // Not 401, not 500 — the route does not exist. A guard that degrades to "no guard" is the
      // outage that looks like a successful deploy.
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});

describe('AC1 — an empty body is a valid draft', () => {
  it('creates one and answers 201', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: '/api/jobs', payload: {} });

    expect(response.statusCode).toBe(201);
    expect(response.json<Job>().status).toBe('DRAFT');
  });

  it('tolerates no body at all', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: '/api/jobs' });

    expect(response.statusCode).toBe(201);
  });

  it('still refuses a body that is nonsense', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { title: '', categorySlugs: 'fontaneria' },
    });

    expect(response.statusCode).toBe(400);
    expect(booted.calls.created, 'a bad body reached the repository').toBe(0);
  });
});

describe('/jobs/me is not swallowed by /jobs/:id', () => {
  it('lists rather than reading a job called "me"', async () => {
    // `W3-T02` found this the hard way: a shared path space answers `/me` as a malformed uuid when
    // the routes are registered in the wrong order.
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({ method: 'GET', url: '/api/jobs/me' });

    expect(response.statusCode).toBe(200);
    expect(booted.calls.listed).toBe(1);
    expect(booted.calls.read, '/jobs/me was read as an id').toBe(0);
  });
});

describe('AC11 — a stranger job is 404, never 403', () => {
  for (const [method, url] of [
    ['GET', `/api/jobs/${JOB_ID}`],
    ['PUT', `/api/jobs/${JOB_ID}`],
    ['POST', `/api/jobs/${JOB_ID}/publish`],
  ] as const) {
    it(`${method} answers not-found`, async () => {
      const booted = boot({ session: principal(['CLIENT']), found: null });
      app = booted.app;

      const response = await app.inject({ method, url, payload: {} });

      // The existence of somebody else's draft is not information this API gives away, so there is
      // no 403 to tell it apart from a job that never existed.
      expect(response.statusCode).toBe(404);
      expect((response.json() as Envelope).error.code).toBe('NOT_FOUND');
    });
  }

  it('answers the same for a malformed id, without saying it is malformed', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({ method: 'GET', url: '/api/jobs/not-a-uuid' });

    expect(response.statusCode).toBe(404);
    expect(booted.calls.read, 'a malformed id reached the repository').toBe(0);
  });
});

describe('the repository decides, the boundary reports', () => {
  it('passes a CONFLICT from the publish guard straight through', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    booted.app.register(
      jobRoutes({
        repository: {
          createDraft: () => Promise.resolve(job()),
          listOwn: () => Promise.resolve([]),
          findOwn: () => Promise.resolve(job()),
          update: () => Promise.resolve(job()),
          publish: () => Promise.reject(new AppError('CONFLICT', 'needs a category')),
        },
        guards: buildGuards({ resolveSession: () => Promise.resolve(principal(['CLIENT'])) }),
      }),
      { prefix: '/api/v2' },
    );
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: `/api/v2/jobs/${JOB_ID}/publish` });

    expect(response.statusCode).toBe(409);
    expect((response.json() as Envelope).error.message).toMatch(/category/);
  });

  it('answers 200 with the published job', async () => {
    const booted = boot({ session: principal(['CLIENT']) });
    app = booted.app;

    const response = await app.inject({ method: 'POST', url: `/api/jobs/${JOB_ID}/publish` });

    expect(response.statusCode).toBe(200);
    expect(response.json<Job>().status).toBe('OPEN');
  });
});
