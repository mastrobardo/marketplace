import { beforeAll, describe, expect, it } from 'vitest';
import { getConfig, loadConfig } from '../src/config.js';

/**
 * The minimum an environment must supply for the API to boot.
 *
 * Three variables since `W2-T01`, not one: better-auth signs session tokens and verification links
 * with `BETTER_AUTH_SECRET`, and a *defaulted* auth secret in production is the whole security
 * model gone, silently. `auth-config.test.ts` owns the assertions about those two; this fixture
 * just has to satisfy them, the same way a real deployment does.
 */
const VALID = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-chars',
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
};

describe('AC3/AC4/AC6 — a bad environment stops the process, loudly', () => {
  it('names the missing required variable', () => {
    expect(() => loadConfig({})).toThrowError(/DATABASE_URL/);
  });

  it('names every bad variable at once, not just the first', () => {
    let message = '';
    try {
      loadConfig({ PORT: 'not-a-port' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/PORT/);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ ...VALID, PORT: '70000' })).toThrowError(/PORT/);
  });

  it('rejects a database url that is not a url', () => {
    expect(() => loadConfig({ DATABASE_URL: 'not a url' })).toThrowError(/DATABASE_URL/);
  });
});

describe('AC5 — optional variables have defaults a developer can rely on', () => {
  it('defaults host, port, log level, environment and version', () => {
    expect(loadConfig({ ...VALID })).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
      APP_VERSION: '0.0.0-dev',
      // Mailpit's, which the local stack already runs (`W2-T01` §4.8).
      MAIL_SMTP_HOST: '127.0.0.1',
      MAIL_SMTP_PORT: 1025,
      MAIL_FROM: 'no-reply@marketplace.local',
      ...VALID,
    });
  });

  it('takes supplied values over the defaults', () => {
    const config = loadConfig({
      ...VALID,
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
    });
    expect(config.NODE_ENV).toBe('production');
    expect(config.PORT).toBe(8080);
    expect(config.LOG_LEVEL).toBe('warn');
  });
});

describe('AC7 — configuration is a value, read once', () => {
  // getConfig() reads the real environment, so give it every required variable — three since
  // `W2-T01`, and `loadConfig` refuses the whole environment if any is missing.
  beforeAll(() => {
    Object.assign(process.env, VALID);
  });

  it('is pure: same input, equal output, and the environment is untouched', () => {
    const env = { ...VALID };
    expect(loadConfig(env)).toEqual(loadConfig(env));
    expect(env).toEqual(VALID);
  });

  it('reads the process environment exactly once', () => {
    expect(getConfig()).toBe(getConfig());
  });
});
