import { beforeAll, describe, expect, it } from 'vitest';
import { getConfig, loadConfig } from '../src/config.js';

/** The minimum an environment must supply for the API to boot. */
const VALID = {
  DATABASE_URL: 'postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace',
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
      DATABASE_URL: VALID.DATABASE_URL,
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
  // getConfig() reads the real environment, so give it the one required variable.
  beforeAll(() => {
    process.env['DATABASE_URL'] = VALID.DATABASE_URL;
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
