import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { AppError, ERROR_CODES } from '@marketplace/contracts';
import { loadConfig } from '../src/config.js';

const ENV = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
  // Required since `W2-T01`, even though nothing in this file authenticates: `loadConfig` reports
  // every problem at once and refuses the whole environment, which is the behaviour AC19 wants.
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  LOG_LEVEL: 'debug',
  APP_VERSION: '1.2.3-test',
};

/** Collects every pino line the app emits, so logging is asserted rather than assumed. */
class LogSink extends Writable {
  readonly lines: string[] = [];

  override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
    this.lines.push(chunk.toString('utf8'));
    callback();
  }

  get text(): string {
    return this.lines.join('');
  }

  entries(): Array<Record<string, unknown>> {
    return this.lines
      .flatMap((line) => line.split('\n'))
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

interface Envelope {
  error: { code: string; message: string; requestId: string; details?: Record<string, unknown> };
}

let app: FastifyInstance;
let sink: LogSink;

beforeEach(async () => {
  sink = new LogSink();
  app = buildApp({ config: loadConfig(ENV), logDestination: sink });
  // Routes that only exist to be thrown from. `src/modules/**` is out of bounds for this agent,
  // and a skeleton has no domain route to borrow.
  app.get('/boom/app-error', () => {
    throw new AppError('FORBIDDEN', 'nope');
  });
  app.get('/boom/with-details', () => {
    // W1-T01 gave VALIDATION_FAILED a typed `details` shape. Nothing in the app emits one yet, so
    // this route is where it is exercised; `{ field: 'email' }` no longer compiles, by design.
    throw new AppError('VALIDATION_FAILED', 'bad', {
      issues: [{ path: 'email', message: 'must be an email' }],
    });
  });
  app.get('/boom/unmapped-status', () => {
    // A 4xx no code in the registry claims. Fastify produces statuses like this (418 stands in for
    // whatever the registry has not caught up with) and W1-T01 makes the fallback say so.
    const framework = Object.assign(new Error('teapot'), { statusCode: 418 });
    throw framework;
  });
  app.get('/boom/unexpected', () => {
    throw new Error('connection string postgres://user:pw@host/db refused');
  });
  app.get('/echo-headers', (request) => {
    // Both shapes a slice agent debugging an auth problem actually reaches for. They are protected
    // by different mechanisms: `headers` by pino's redact paths, `req` by Fastify's own
    // serialiser, which keeps only method/url/host/remoteAddress.
    request.log.info({ headers: request.headers }, 'inspecting headers');
    request.log.info({ req: { headers: request.headers } }, 'inspecting req');
    return { ok: true };
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('AC1/AC2 — health answers from process state alone', () => {
  it('returns ok, an uptime and a version', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      version: '1.2.3-test',
    });
  });

  it('depends on nothing: no outbound connection is opened to answer it', async () => {
    // The app was built with a DATABASE_URL pointing at a database that is not required to exist.
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});

describe('AC8/AC9/AC10 — every request is correlatable', () => {
  it('generates a uuid request id when the client supplies none', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('echoes a well-formed request id supplied by the client', async () => {
    const supplied = '11111111-2222-3333-4444-555555555555';
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': supplied },
    });
    expect(response.headers['x-request-id']).toBe(supplied);
  });

  it.each([
    ['over-long', 'a'.repeat(500)],
    ['newline-injecting', 'abc\ndef'],
    ['empty', ''],
  ])('refuses a %s request id and generates its own', async (_label, hostile) => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': hostile },
    });
    expect(response.headers['x-request-id']).not.toBe(hostile);
    expect(String(response.headers['x-request-id'])).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('AC11/AC12/AC13 — one error shape, one machine-readable code', () => {
  it('answers an unknown route with a NOT_FOUND envelope carrying its request id', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    const body = response.json<Envelope>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('maps an AppError to its registered status and code', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom/app-error' });
    expect(response.statusCode).toBe(403);
    expect(response.json<Envelope>().error.code).toBe('FORBIDDEN');
  });

  it('passes structured details through untouched', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom/with-details' });
    expect(response.statusCode).toBe(400);
    expect(response.json<Envelope>().error.details).toEqual({
      issues: [{ path: 'email', message: 'must be an email' }],
    });
  });
});

describe('W1-T01 AC7 — an unmapped 4xx falls back, and says that it did', () => {
  it('keeps the client’s status and answers in the envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom/unmapped-status' });
    expect(response.statusCode).toBe(418);
    expect(response.json<Envelope>().error.code).toBe('VALIDATION_FAILED');
  });

  it('warns, naming the status, rather than substituting the code silently', async () => {
    await app.inject({ method: 'GET', url: '/boom/unmapped-status' });
    const warned = sink.entries().filter((entry) => entry['level'] === 40);
    expect(warned.length, 'the fallback was not logged at warn level').toBeGreaterThan(0);
    expect(JSON.stringify(warned)).toContain('418');
  });

  it('does not warn when the status genuinely maps', async () => {
    // Otherwise the warning is noise and stops meaning anything. /boom/app-error is a FORBIDDEN,
    // which the registry does claim.
    await app.inject({ method: 'GET', url: '/boom/app-error' });
    expect(sink.entries().filter((entry) => entry['level'] === 40)).toEqual([]);
  });
});

describe('AC14/AC15 — an unexpected failure is logged, never leaked', () => {
  it('answers with a generic INTERNAL_ERROR that contains none of the original detail', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom/unexpected' });
    expect(response.statusCode).toBe(500);
    expect(response.json<Envelope>().error.code).toBe('INTERNAL_ERROR');
    expect(response.body).not.toContain('postgres://');
    expect(response.body).not.toContain('refused');
  });

  it('moves the detail to the log sink rather than destroying it', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom/unexpected' });
    const requestId = String(response.headers['x-request-id']);
    const logged = sink.entries().filter((entry) => entry['level'] === 50);
    expect(logged.length, 'nothing was logged at error level').toBeGreaterThan(0);
    expect(sink.text).toContain('postgres://user:pw@host/db refused');
    expect(sink.text).toContain(requestId);
  });
});

describe('AC16 — the error-code registry is well formed', () => {
  it('maps every SCREAMING_SNAKE code to a real HTTP error status', () => {
    const codes = Object.entries(ERROR_CODES);
    expect(codes.length).toBeGreaterThan(0);
    for (const [code, status] of codes) {
      expect(code, `${code} is not SCREAMING_SNAKE_CASE`).toMatch(/^[A-Z]+(?:_[A-Z]+)*$/);
      expect(Number.isInteger(status), `${code} has a non-integer status`).toBe(true);
      expect(status, `${code} is outside the error range`).toBeGreaterThanOrEqual(400);
      expect(status, `${code} is outside the error range`).toBeLessThan(600);
    }
  });
});

describe('AC17/AC18 — logs are structured, correlated and credential-free', () => {
  it('logs the method, url and request id of every request', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const requestId = String(response.headers['x-request-id']);
    const request = sink
      .entries()
      .find((entry) => JSON.stringify(entry).includes(requestId) && entry['req'] !== undefined);
    expect(request, 'no structured request line was logged').toBeDefined();
    expect(JSON.stringify(request)).toContain('/health');
    expect(JSON.stringify(request)).toContain('GET');
  });

  it('redacts credentials a slice agent logs by accident', async () => {
    await app.inject({
      method: 'GET',
      url: '/echo-headers',
      headers: { authorization: 'Bearer secret-token', cookie: 'session=secret-cookie' },
    });
    expect(sink.text).not.toContain('secret-token');
    expect(sink.text).not.toContain('secret-cookie');
    // Not merely absent — actively censored, so the redact paths are proven to match.
    const censored = sink.entries().find((entry) => entry['msg'] === 'inspecting headers');
    expect(censored, 'the headers line was not logged at all').toBeDefined();
    expect(JSON.stringify(censored)).toContain('[redacted]');
  });
});

/**
 * `W2-T01` §4.9 — a deployed API that cannot send mail says so at boot.
 *
 * `MAIL_SMTP_HOST` defaults to `127.0.0.1`: Mailpit locally, nothing at all on Fly. The failure is
 * otherwise invisible, because better-auth returns `200` from a sign-up whose verification email
 * threw — measured on the preview deploy, and pinned in `auth.test.ts`.
 */
describe('W2-T01 §4.9 — mail that cannot be delivered is announced at startup', () => {
  function warningsFrom(env: Record<string, string>): string[] {
    const sink = new LogSink();
    buildApp({ config: loadConfig({ ...ENV, ...env }), logDestination: sink });
    return sink.lines
      .map((line) => JSON.parse(line) as { level: number; msg: string })
      .filter((entry) => entry.level >= 40)
      .map((entry) => entry.msg);
  }

  it('warns when a deployed environment points mail at this machine', () => {
    const warnings = warningsFrom({ NODE_ENV: 'production' });
    expect(warnings.join('\n')).toMatch(/MAIL_SMTP_HOST points at this machine/);
  });

  it('names OPS-14, so the warning says when it stops being true', () => {
    expect(warningsFrom({ NODE_ENV: 'production' }).join('\n')).toContain('OPS-14');
  });

  for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '::1']) {
    it(`recognises ${host} as this machine`, () => {
      const warnings = warningsFrom({ NODE_ENV: 'production', MAIL_SMTP_HOST: host });
      expect(warnings.join('\n')).toMatch(/MAIL_SMTP_HOST/);
    });
  }

  it('says nothing when a real host is configured', () => {
    const warnings = warningsFrom({ NODE_ENV: 'production', MAIL_SMTP_HOST: 'smtp.example.com' });
    expect(warnings.join('\n')).not.toMatch(/MAIL_SMTP_HOST/);
  });

  it('says nothing in development, where 127.0.0.1 is Mailpit and correct', () => {
    const warnings = warningsFrom({ NODE_ENV: 'development' });
    expect(warnings.join('\n')).not.toMatch(/MAIL_SMTP_HOST/);
  });
});

/**
 * `W2-T10` §2.2. Trusting an address nobody checked is a real cost, taken deliberately and only
 * because `OPS-14` does not exist yet — so every environment that takes it says so at boot, the
 * same way `MAIL_SMTP_HOST` does, and for the same reason: the failure is otherwise invisible.
 */
describe('W2-T10 §2.2 — a trusted sign-up is announced at startup', () => {
  function warningsFrom(env: Record<string, string>): string[] {
    const sink = new LogSink();
    buildApp({ config: loadConfig({ ...ENV, ...env }), logDestination: sink });
    return sink.lines
      .map((line) => JSON.parse(line) as { level: number; msg: string })
      .filter((entry) => entry.level >= 40)
      .map((entry) => entry.msg);
  }

  it('AC6 — warns when a deployed environment trusts the address', () => {
    const warnings = warningsFrom({ NODE_ENV: 'production', AUTH_TRUST_EMAIL_ON_SIGNUP: 'true' });
    expect(warnings.join('\n')).toMatch(/AUTH_TRUST_EMAIL_ON_SIGNUP/);
  });

  it('names OPS-14 on *that* line, so the warning says when it stops being true', () => {
    // The line, not the joined output: `MAIL_SMTP_HOST`'s warning also names OPS-14 and fires in
    // the same environment, so asserting over everything would pass without this warning existing.
    const warnings = warningsFrom({ NODE_ENV: 'production', AUTH_TRUST_EMAIL_ON_SIGNUP: 'true' });
    const line = warnings.find((message) => message.includes('AUTH_TRUST_EMAIL_ON_SIGNUP'));
    expect(line, 'no warning mentions the flag').toBeDefined();
    expect(line).toContain('OPS-14');
  });

  it('says nothing when it is off', () => {
    const warnings = warningsFrom({ NODE_ENV: 'production', AUTH_TRUST_EMAIL_ON_SIGNUP: 'false' });
    expect(warnings.join('\n')).not.toMatch(/AUTH_TRUST_EMAIL_ON_SIGNUP/);
  });

  it('says nothing in development, where it is the intended local setting', () => {
    const warnings = warningsFrom({ NODE_ENV: 'development', AUTH_TRUST_EMAIL_ON_SIGNUP: 'true' });
    expect(warnings.join('\n')).not.toMatch(/AUTH_TRUST_EMAIL_ON_SIGNUP/);
  });
});

