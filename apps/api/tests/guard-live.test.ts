/**
 * `W2-T03` — the session adapter, against a real database and a real better-auth.
 *
 * `guard.test.ts` asserts what the guard does with an answer; this file asserts how the answer is
 * obtained: a signed cookie resolved to a session, and a liveness read whose `where` clause is what
 * makes a suspended, blocked or deleted user resolve to nothing at all (§3.3 — the operator's rule
 * of 2026-09-18).
 *
 * `STACK_LIVE=1` and a `DATABASE_URL`, the same gate `auth.test.ts` uses. The local port is 5433:
 *   STACK_LIVE=1 DATABASE_URL="postgres://marketplace:marketplace_local@127.0.0.1:5433/marketplace" \
 *     pnpm --filter @marketplace/api exec vitest run guard-live
 *
 * Spec: `docs/specs/S2/W2-T03-route-guards.md` §3.3, §7 AC8–AC10, AC16.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type PrismaClient, type UserRole } from '@prisma/client';

import { buildApp } from '../src/app.js';
import { buildAuth } from '../src/auth/auth.js';
import { type Mailer } from '../src/auth/mail.js';
import { loadConfig } from '../src/config.js';
import { getPrismaClient } from '../src/db/client.js';
import {
  buildGuards,
  buildSessionResolver,
  principalOf,
  type ResolveSession,
} from '../src/modules/auth/guard.js';

const live = process.env['STACK_LIVE'] === '1';
const describeLive = live ? describe : describe.skip;

const PASSWORD = 'correct horse battery staple';

let app: FastifyInstance;
let prisma: PrismaClient;
let resolveSession: ResolveSession;

/** Mail is never read here; better-auth only has to be able to call something. */
const silentMailer: Mailer = {
  async sendVerification() {},
  async sendPasswordReset() {},
};

let counter = 0;
const freshEmail = (): string => `guard-${Date.now()}-${counter++}@example.test`;

/**
 * A verified user with the roles given, and a live session cookie for them.
 *
 * `AUTH_TRUST_EMAIL_ON_SIGNUP` is not assumed: the row is verified directly, because this file is
 * about the guard and not about how an address gets trusted. `roles` is `input: false` on
 * better-auth's side (`auth.ts:101`), so it is set through Prisma — the same reason
 * `auth-demo-users` does.
 */
async function signedIn(roles: UserRole[]): Promise<{ id: string; cookie: string }> {
  const email = freshEmail();
  const signUp = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: JSON.stringify({ email, password: PASSWORD, name: 'Guard Test' }),
    headers: { 'content-type': 'application/json' },
  });
  expect(signUp.statusCode, `sign-up failed: ${signUp.body}`).toBeLessThan(400);

  const user = await prisma.user.update({
    where: { email },
    data: { roles, emailVerified: true },
  });

  const signIn = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    payload: JSON.stringify({ email, password: PASSWORD }),
    headers: { 'content-type': 'application/json' },
  });
  expect(signIn.statusCode, `sign-in failed: ${signIn.body}`).toBeLessThan(400);

  const cookie = ([] as string[])
    .concat(signIn.headers['set-cookie'] ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  expect(cookie, 'sign-in set no cookie').not.toBe('');

  return { id: user.id, cookie };
}

beforeAll(async () => {
  if (!live) return;
  const config = loadConfig({
    ...process.env,
    BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
    BETTER_AUTH_URL: 'http://127.0.0.1:5173',
    LOG_LEVEL: 'silent',
  });
  prisma = getPrismaClient(config, { fresh: true });
  const auth = buildAuth({ config, prisma, mailer: silentMailer });
  resolveSession = buildSessionResolver({ auth, prisma });

  app = buildApp({ config, auth });
  const guards = buildGuards({ resolveSession });
  app.get('/api/probe/session', { preHandler: guards.requireSession }, (request) =>
    principalOf(request),
  );
  app.get(
    '/api/probe/update-own',
    { preHandler: guards.requirePermission('provider-profile:update-own') },
    (request) => principalOf(request),
  );
  await app.ready();
});

afterAll(async () => {
  if (!live) return;
  await app.close();
  await prisma.$disconnect();
});

describeLive('W2-T03 §3.3 — a real cookie, resolved', () => {
  it('AC10: a [CLIENT, PROVIDER] user passes a PROVIDER-only permission — roles are a set', async () => {
    const { id, cookie } = await signedIn(['CLIENT', 'PROVIDER']);

    const response = await app.inject({
      method: 'GET',
      url: '/api/probe/update-own',
      headers: { cookie },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ userId: id, roles: ['CLIENT', 'PROVIDER'] });
  });

  it('carries the session id, so an audit trail can name the session and not just the user', async () => {
    const { cookie } = await signedIn(['PROVIDER']);

    const response = await app.inject({
      method: 'GET',
      url: '/api/probe/session',
      headers: { cookie },
    });
    const body = JSON.parse(response.body) as { sessionId: string };

    const session = await prisma.session.findUnique({ where: { id: body.sessionId } });
    expect(session, 'the principal named a session that does not exist').not.toBeNull();
  });
});

describeLive('W2-T03 §3.3 — suspended, blocked or deleted returns no data', () => {
  it('AC8: refuses a live cookie once the user is SUSPENDED, without deleting the session', async () => {
    const { id, cookie } = await signedIn(['PROVIDER']);

    const before = await app.inject({
      method: 'GET',
      url: '/api/probe/update-own',
      headers: { cookie },
    });
    expect(before.statusCode).toBe(200);

    await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });

    const after = await app.inject({
      method: 'GET',
      url: '/api/probe/update-own',
      headers: { cookie },
    });
    const body = JSON.parse(after.body) as { error: { code: string } };

    expect(after.statusCode).toBe(401);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    // Not 403, and no reason on the wire: a distinct answer would be a state oracle on every
    // route. The session row is still there — deleting it is `W2-T02`'s, and `auth.test.ts:320`
    // still pins better-auth's own `get-session` answering this cookie.
    expect(await prisma.session.count({ where: { userId: id } })).toBeGreaterThan(0);
  });

  it('AC9: refuses a live cookie once the user is soft-deleted', async () => {
    const { id, cookie } = await signedIn(['PROVIDER']);
    await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });

    const response = await app.inject({
      method: 'GET',
      url: '/api/probe/session',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(401);
  });

  it('AC16: the resolver itself returns null — not an object carrying a reason', async () => {
    const { id, cookie } = await signedIn(['PROVIDER']);
    expect(await resolveSession({ cookie })).not.toBeNull();

    await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });

    // Identical to the unknown-session case: no state crosses this boundary, not even `deletedAt`.
    expect(await resolveSession({ cookie })).toBeNull();
    expect(await resolveSession({ cookie: 'better-auth.session_token=nobody' })).toBeNull();
    expect(await resolveSession({})).toBeNull();
  });
});
