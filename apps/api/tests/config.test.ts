import { beforeAll, describe, expect, it } from 'vitest';
import { getConfig, loadConfig, loadSeedConfig } from '../src/config.js';

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
      // `W2-T10` §2.2: off unless an environment asks for it, which is the whole safety property.
      // This assertion is exhaustive on purpose — a new variable has to be added here, which is
      // where somebody notices that a flag weakening address ownership has grown a default.
      AUTH_TRUST_EMAIL_ON_SIGNUP: false,
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

/**
 * `W0-T30`, fixed after `W4-T01`'s first preview deploy failed on it.
 *
 * The seed entrypoint called `loadConfig()`, which validates the whole schema — so every deployed
 * seed run died on `BETTER_AUTH_SECRET: expected string, received undefined`, a variable a seeder
 * never reads. The deploy workflows give the step a database URL and a demo password, which is
 * exactly right; it was the parse that was wrong.
 */
describe('loadSeedConfig — the seeder asks for what it uses, and no more', () => {
  const DB = 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace';

  it('accepts what the deploy workflows actually set', () => {
    // This is the whole environment `deploy-staging.yml`'s seed step provides. If this test needs
    // more variables to pass, the deploy needs more too — and that is the bug, not the test.
    const config = loadSeedConfig({ DATABASE_URL: DB, SEED_DEMO_PASSWORD: 'a-staging-secret-1' });

    expect(config.DATABASE_URL).toBe(DB);
    expect(config.SEED_DEMO_PASSWORD).toBe('a-staging-secret-1');
  });

  it('does not demand an auth signing key', () => {
    // Handing the seed step BETTER_AUTH_SECRET to satisfy a parse would put a signing key in a
    // process with no business holding one.
    expect(() => loadSeedConfig({ DATABASE_URL: DB })).not.toThrow();
  });

  it('still refuses a missing or malformed database URL', () => {
    expect(() => loadSeedConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadSeedConfig({ DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('still refuses a demo password below the floor', () => {
    expect(() => loadSeedConfig({ DATABASE_URL: DB, SEED_DEMO_PASSWORD: 'short' })).toThrow(
      /SEED_DEMO_PASSWORD/,
    );
  });
});
