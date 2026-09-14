import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { type PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app.js';
import { buildAuth } from '../src/auth/auth.js';
import { type Mailer } from '../src/auth/mail.js';
import { loadConfig } from '../src/config.js';
import { getPrismaClient } from '../src/db/client.js';

/**
 * `W2-T01` end to end, against a real database.
 *
 * `STACK_LIVE=1` and a `DATABASE_URL`, the same gate `db.test.ts` and `local-stack.test.ts` use —
 * the CI `database` job sets both. Without them this file skips, loudly enough to be visible in the
 * reporter rather than silently reporting a pass it did not earn.
 *
 * The mailer is a **stub**, not Mailpit. The link is the assertion — its presence, its
 * single-useness, and the account it verifies — and none of that is made truer by a round trip
 * through SMTP. Mailpit's job is letting a human read the message during development; a test that
 * polls it buys network flake and nothing else. `mail.ts` keeps its own message-shape assertions.
 */

const live = process.env['STACK_LIVE'] === '1';
const describeLive = live ? describe : describe.skip;

/** Captures what better-auth asked us to send, in order. */
interface Sent {
  kind: 'verification' | 'reset';
  to: string;
  url: string;
}

let app: FastifyInstance;
let prisma: PrismaClient;
let authConfig: ReturnType<typeof loadConfig>;
let sent: Sent[] = [];

const PASSWORD = 'correct horse battery staple';

function stubMailer(): Mailer {
  return {
    async sendVerification({ to, url }) {
      sent.push({ kind: 'verification', to, url });
    },
    async sendPasswordReset({ to, url }) {
      sent.push({ kind: 'reset', to, url });
    },
  };
}

/** A fresh address per test, so one test's user can never satisfy another's assertion. */
let counter = 0;
const freshEmail = (prefix = 'user'): string => `${prefix}-${Date.now()}-${counter++}@example.test`;

interface Res {
  status: number;
  body: string;
  json: () => unknown;
  cookies: string[];
}

async function post(
  url: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<Res> {
  const response = await app.inject({
    method: 'POST',
    url,
    payload: JSON.stringify(payload),
    headers: { 'content-type': 'application/json', ...headers },
  });
  return {
    status: response.statusCode,
    body: response.body,
    json: () => JSON.parse(response.body) as unknown,
    // `headers['set-cookie']` is an **array** when more than one was set — which is exactly what
    // §4.3 is about: how *many* headers reach the socket, not what a folded single value says.
    cookies: ([] as string[]).concat(response.headers['set-cookie'] ?? []),
  };
}

async function get(url: string, headers: Record<string, string> = {}): Promise<Res> {
  const response = await app.inject({ method: 'GET', url, headers });
  return {
    status: response.statusCode,
    body: response.body,
    json: () => JSON.parse(response.body) as unknown,
    cookies: ([] as string[]).concat(response.headers['set-cookie'] ?? []),
  };
}

/** Sign up, follow the verification link, and return the user's id. */
async function signUpVerified(email: string): Promise<string> {
  const before = sent.length;
  const signUp = await post('/api/auth/sign-up/email', { email, password: PASSWORD, name: 'Test' });
  expect(signUp.status, `sign-up failed: ${signUp.body}`).toBeLessThan(400);

  const message = sent.slice(before).find((m) => m.kind === 'verification');
  expect(message, 'no verification email was sent').toBeDefined();

  // The link is a GET with the token in the query string, exactly as a mail client would open it.
  const verify = await get(new URL(message!.url).pathname + new URL(message!.url).search);
  expect(verify.status, `verification failed: ${verify.body}`).toBeLessThan(400);

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  expect(user, 'no user row after verification').not.toBeNull();
  return user!.id;
}

beforeAll(async () => {
  if (!live) return;
  const config = loadConfig({
    ...process.env,
    BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
    BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  });
  authConfig = config;
  prisma = getPrismaClient(config, { fresh: true });
  app = buildApp({ config, auth: buildAuth({ config, prisma, mailer: stubMailer() }) });
  await app.ready();
});

afterAll(async () => {
  if (!live) return;
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  sent = [];
});

describeLive('W2-T01 — sign-up and verification', () => {
  it('creates an app_user row and a credential account, and no password column to write to', async () => {
    // AC10.
    const email = freshEmail();
    const id = await signUpVerified(email);

    const accounts = await prisma.account.findMany({ where: { userId: id } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.providerId).toBe('credential');
    expect(accounts[0]?.password, 'the hash belongs in `account`, not on `app_user`').toBeTruthy();

    // AC5 — read the row back, rather than reading the config that claims the mapping.
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM app_user WHERE id = $1::uuid`,
      id,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('gives the user a database-generated uuid, not a base62 string', async () => {
    // AC6. `generateId: false` — every foreign key in the schema is UUID.
    const id = await signUpVerified(freshEmail());
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('defaults roles to [CLIENT] and status to ACTIVE from the database', async () => {
    // AC9. `additionalFields` are `input: false`, so these come from the column defaults.
    const id = await signUpVerified(freshEmail());
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.roles).toEqual(['CLIENT']);
    expect(user.status).toBe('ACTIVE');
    expect(user.locale).toBe('ES');
  });

  it('keeps email_verified and email_verified_at in step', async () => {
    // ADR-005 calls the pair "the one place this decision costs us a redundant column". A
    // redundant column is only a cost while it agrees.
    const id = await signUpVerified(freshEmail());
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.emailVerified).toBe(true);
    expect(user.emailVerifiedAt, 'the boolean flipped without the audit fact').not.toBeNull();
  });

  it('sends a verification email carrying a usable link', async () => {
    // AC11.
    const email = freshEmail();
    await post('/api/auth/sign-up/email', { email, password: PASSWORD, name: 'Test' });
    const message = sent.find((m) => m.kind === 'verification');
    expect(message?.to).toBe(email.toLowerCase());
    expect(() => new URL(message!.url)).not.toThrow();
  });

  it('refuses a sign-in until the address is verified', async () => {
    // §4.6 — the operator's decision, and the one refusal that is deliberately *distinguishable*:
    // the address is already known to whoever owns it, and "check your inbox" is not an oracle.
    const email = freshEmail();
    await post('/api/auth/sign-up/email', { email, password: PASSWORD, name: 'Test' });

    const attempt = await post('/api/auth/sign-in/email', { email, password: PASSWORD });
    expect(attempt.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.session.count({ where: { user: { email: email.toLowerCase() } } })).toBe(0);
  });
});

describeLive('W2-T01 §4.2 — email case cannot fork an account', () => {
  it('signs in with a different case than the one used to sign up', async () => {
    // AC7. Written when the diagnosis was that better-auth would *not* normalise. It does
    // (sign-up.mjs:165, sign-in.mjs:315) — and this assertion is about behaviour, so it survived
    // being wrong about the mechanism.
    const email = freshEmail('Mixed.Case');
    const id = await signUpVerified(email);

    const signIn = await post('/api/auth/sign-in/email', {
      email: email.toLowerCase(),
      password: PASSWORD,
    });
    expect(signIn.status, signIn.body).toBeLessThan(400);

    const sessions = await prisma.session.findMany({ where: { userId: id } });
    expect(sessions.length, 'signed in as a different account').toBeGreaterThan(0);
  });

  it('refuses a second sign-up that differs only in case', async () => {
    // AC8.
    const email = freshEmail('Dup.Case');
    await signUpVerified(email);

    await post('/api/auth/sign-up/email', {
      email: email.toUpperCase(),
      password: PASSWORD,
      name: 'Impostor',
    });

    const count = await prisma.user.count({ where: { email: email.toLowerCase() } });
    expect(count, 'case forked the user table').toBe(1);
  });

  it('stores the address lowercased, and the database refuses anything else', async () => {
    // AC3b. The CHECK is what makes §4.2's plain unique index equivalent to the functional one it
    // replaced — and it moves the guarantee out of a library version and into the schema.
    const email = freshEmail('Stored.Case');
    const id = await signUpVerified(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.email).toBe(email.toLowerCase());

    await expect(
      prisma.user.create({ data: { email: 'NotLowercase@example.test' } }),
      'the database accepted a mixed-case address',
    ).rejects.toThrow();
  });
});

describeLive('W2-T01 §4.5 — the two refusals better-auth cannot make', () => {
  it('lets an active, verified user sign in', async () => {
    // AC17 first, on purpose. Without it the two refusals below could both be passing because the
    // whole sign-in path is broken.
    const email = freshEmail();
    await signUpVerified(email);
    const signIn = await post('/api/auth/sign-in/email', { email, password: PASSWORD });
    expect(signIn.status, signIn.body).toBeLessThan(400);
  });

  /**
   * Asserts that no *new* session appears, not that the user has none.
   *
   * The first version of these two tests asserted `count === 0` and failed — because
   * `autoSignInAfterVerification` had already created a session when the verification link was
   * followed, before the account was soft-deleted or suspended. The count was right and the
   * property was wrong: what this ticket owns is that a refused sign-in creates nothing.
   *
   * That the *existing* session survives is a real gap, and it has its own test below.
   */
  async function refusalCreatesNoSession(
    email: string,
    id: string,
  ): Promise<{ refused: Res; wrongPassword: Res }> {
    const before = await prisma.session.count({ where: { userId: id } });

    const refused = await post('/api/auth/sign-in/email', { email, password: PASSWORD });
    const wrongPassword = await post('/api/auth/sign-in/email', {
      email: freshEmail(),
      password: 'not the password',
    });

    expect(await prisma.session.count({ where: { userId: id } })).toBe(before);
    return { refused, wrongPassword };
  }

  it('refuses a soft-deleted user, indistinguishably from a wrong password', async () => {
    // AC15.
    const email = freshEmail();
    const id = await signUpVerified(email);
    await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });

    const { refused, wrongPassword } = await refusalCreatesNoSession(email, id);
    expect(refused.status).toBe(wrongPassword.status);
    expect(refused.body, 'a soft-deleted account is distinguishable — an enumeration oracle').toBe(
      wrongPassword.body,
    );
  });

  it('refuses a SUSPENDED user, indistinguishably from a wrong password', async () => {
    // AC16. Operator decision, 2026-09-12 — spec §10 Q1.
    const email = freshEmail();
    const id = await signUpVerified(email);
    await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });

    const { refused, wrongPassword } = await refusalCreatesNoSession(email, id);
    expect(refused.status).toBe(wrongPassword.status);
    expect(refused.body).toBe(wrongPassword.body);
  });

  /**
   * **A known gap, asserted so it is visible — spec §10 Q7.**
   *
   * `ADR-005` rule 3 chose database sessions over access tokens so that revocation means *now*,
   * and names `UserStatus.SUSPENDED` as the reason. This ticket's guard runs on session
   * **creation**, so it stops a suspended user signing in *again* — and does nothing about the
   * cookie they are already holding.
   *
   * Nothing can reach this state today: no route suspends a user (`W9`), so it takes a direct
   * database write, which is what this test does. `W2-T02` owns "revoke as a delete", and this
   * assertion is where it will fail when that lands — deliberately written to describe what
   * happens rather than what should, so the gap cannot be mistaken for coverage.
   */
  it('does NOT revoke a live session when a user is suspended — W2-T02 owns this', async () => {
    const email = freshEmail();
    const id = await signUpVerified(email);
    const signIn = await post('/api/auth/sign-in/email', { email, password: PASSWORD });
    const cookie = signIn.cookies.map((c) => c.split(';')[0]).join('; ');

    await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });

    const session = await get('/api/auth/get-session', { cookie });
    const body = session.body === '' ? null : (JSON.parse(session.body) as unknown);
    expect(
      body,
      'a suspended user’s live session was rejected — if this now passes, W2-T02 landed and this ' +
        'test should become the opposite assertion',
    ).not.toBeNull();
  });
});

describeLive('W2-T01 — password reset', () => {
  it('works once, and the second use is refused', async () => {
    // AC13. Single use is enforced by the row's absence, not by a flag somebody has to check.
    const email = freshEmail();
    const id = await signUpVerified(email);

    await post('/api/auth/request-password-reset', { email, redirectTo: '/' });
    const link = sent.find((m) => m.kind === 'reset');
    expect(link, 'no reset email was sent').toBeDefined();

    // The link redirects to the app with the token; the token is what the set-password call takes.
    const token =
      new URL(link!.url).searchParams.get('token') ?? new URL(link!.url).pathname.split('/').pop();
    expect(token).toBeTruthy();

    const first = await post('/api/auth/reset-password', {
      newPassword: 'a brand new password',
      token,
    });
    expect(first.status, first.body).toBeLessThan(400);

    const second = await post('/api/auth/reset-password', {
      newPassword: 'a third password',
      token,
    });
    expect(second.status, 'a reset link worked twice').toBeGreaterThanOrEqual(400);

    // And the new password is the one that works.
    const signIn = await post('/api/auth/sign-in/email', {
      email,
      password: 'a brand new password',
    });
    expect(signIn.status, signIn.body).toBeLessThan(400);
    expect(await prisma.session.count({ where: { userId: id } })).toBeGreaterThan(0);
  });

  it('answers a reset for an unknown address with success, and sends nothing', async () => {
    // AC21. The alternative tells an attacker which addresses are registered.
    const response = await post('/api/auth/request-password-reset', {
      email: freshEmail('nobody'),
      redirectTo: '/',
    });
    expect(response.status).toBeLessThan(400);
    expect(sent.filter((m) => m.kind === 'reset')).toHaveLength(0);
  });
});

describeLive('W2-T01 §4.3 — the bridge', () => {
  it('keeps multiple Set-Cookie headers separate', async () => {
    // AC18. The bug §4.3 exists to avoid folds repeats into one comma-joined value, which is not a
    // legal transformation for this header. Asserted on `raw.headers`, so a parsed single value
    // cannot hide it.
    const email = freshEmail();
    await signUpVerified(email);
    const signIn = await post('/api/auth/sign-in/email', { email, password: PASSWORD });

    expect(signIn.cookies.length).toBeGreaterThan(0);
    for (const cookie of signIn.cookies) {
      // A folded pair reads `a=1; Path=/, b=2; Path=/` — one string carrying two cookie names.
      expect(cookie.split(',').filter((part) => part.includes('=')).length).toBeLessThanOrEqual(1);
    }
  });

  it('reads the request body — the pass-through parser did not drain it', async () => {
    // §4.3 cost one. If Fastify's JSON parser consumed `request.raw` first, better-auth would see
    // an empty body and fail *validation* rather than credentials — a confusing symptom worth
    // pinning, because the fix (an encapsulated parser) looks like boilerplate and invites removal.
    const signIn = await post('/api/auth/sign-in/email', {
      email: freshEmail('nobody'),
      password: 'whatever',
    });
    expect(signIn.status).toBe(401);
  });
});

describeLive('W2-T01 §10 Q3 — a sign-up whose email cannot be sent', () => {
  /**
   * **Pins what happens, not what should.**
   *
   * The spec's first draft claimed a failed send rolls the sign-up back, and called that the
   * honest behaviour available today. It was a guess stated as a fact. Measured against the
   * deployed preview — where the Fly app has no mail server — better-auth returns `200`, writes
   * the row, and swallows the error.
   *
   * The consequence is the trap the wrong claim said we were avoiding: the account cannot sign in
   * (`403 EMAIL_NOT_VERIFIED`), cannot be re-registered (the duplicate response is deliberately
   * synthetic, so as not to leak which addresses exist), and cannot ask for another link.
   *
   * `OPS-14` is the fix. This test exists so the gap is a recorded fact with a failing assertion
   * waiting for it, rather than something rediscovered on a support ticket.
   */
  it('still creates the account, and strands it', async () => {
    const email = freshEmail('no-mail');
    const failing = buildAuth({
      config: authConfig,
      prisma,
      mailer: {
        sendVerification: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1025')),
        sendPasswordReset: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1025')),
      },
    });
    const isolated = buildApp({ config: authConfig, auth: failing });
    await isolated.ready();

    try {
      const signUp = await isolated.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        payload: JSON.stringify({ email, password: PASSWORD, name: 'Stranded' }),
        headers: { 'content-type': 'application/json' },
      });

      // Not a rollback: the request succeeds and the row is there.
      expect(signUp.statusCode).toBeLessThan(400);
      expect(await prisma.user.count({ where: { email } })).toBe(1);

      // And the account is stuck — unverified, so sign-in refuses.
      const signIn = await isolated.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        payload: JSON.stringify({ email, password: PASSWORD }),
        headers: { 'content-type': 'application/json' },
      });
      expect(signIn.statusCode).toBeGreaterThanOrEqual(400);
      expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);
    } finally {
      await isolated.close();
    }
  });
});

describeLive('W2-T01 §4.4 — the carve-out is exactly one prefix', () => {
  it('answers a 404 outside /api/auth in W1-T01’s envelope', async () => {
    // AC12.
    const response = await get('/definitely-not-a-route');
    expect(response.status).toBe(404);
    const body = response.json() as { error?: { code?: string; requestId?: string } };
    expect(body.error?.code).toBe('NOT_FOUND');
    expect(body.error?.requestId, 'the envelope lost its request id').toBeTruthy();
  });

  it('leaves /health alone', async () => {
    const response = await get('/health');
    expect(response.status).toBe(200);
  });

  it('does not answer /api/auth in the envelope — the documented exception', async () => {
    const response = await post('/api/auth/sign-in/email', {
      email: freshEmail('nobody'),
      password: 'whatever',
    });
    const body = response.json() as { error?: unknown; code?: unknown; message?: unknown };
    // better-auth's own shape: a flat `code`/`message`, not our nested `error` object. Pinned so
    // that the carve-out stays a decision rather than becoming an accident nobody reviewed.
    expect(body.error).toBeUndefined();
    expect(body.message ?? body.code).toBeTruthy();
  });
});
