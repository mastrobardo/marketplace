import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigError, loadConfig } from '../src/config.js';
import { AUTH_PREFIX } from '../src/plugins/auth.js';

/**
 * `W2-T01` — the assertions that need neither a database nor a browser.
 *
 * Everything here is either configuration parsing or a claim about the source. The source
 * assertions exist because the rules they check are rules *this repository has already written
 * down and cannot currently enforce*: `config.ts` says a module reaching for `process.env` is a
 * review failure, and `ADR-005` asks for an exact pin. Both were true and unenforced before this
 * file.
 */

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts: string[]): string => readFileSync(join(apiRoot, ...parts), 'utf8');

const VALID = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
};

describe('W2-T01 §4.8 — configuration', () => {
  it('accepts a complete environment', () => {
    const config = loadConfig(VALID);
    expect(config.BETTER_AUTH_SECRET).toHaveLength(32);
    expect(config.BETTER_AUTH_URL).toBe('http://127.0.0.1:5173');
  });

  // AC19. The whole point of a required secret is that a deployment without one does not start.
  it('refuses to boot with no auth secret, and names it', () => {
    const { BETTER_AUTH_SECRET: _omitted, ...withoutSecret } = VALID;
    expect(() => loadConfig(withoutSecret)).toThrow(ConfigError);
    expect(() => loadConfig(withoutSecret)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('refuses a short secret, and says how short it may be', () => {
    const attempt = (): unknown => loadConfig({ ...VALID, BETTER_AUTH_SECRET: 'too-short' });
    expect(attempt).toThrow(ConfigError);
    expect(attempt).toThrow(/at least 32 characters/);
  });

  /**
   * There is no `.default(...)` on the secret and there must never be one. A default here is not a
   * convenience — it is a production deployment where every session token is forgeable by anyone
   * who has read the repository, and it fails *silently*, because everything works.
   */
  it('has no default for the secret — a source assertion, because the failure is silent', () => {
    const source = read('src', 'config.ts');
    const declaration = source.slice(
      source.indexOf('BETTER_AUTH_SECRET:'),
      source.indexOf('BETTER_AUTH_URL:'),
    );
    expect(declaration).not.toContain('.default(');
    expect(declaration).not.toContain('.optional(');
  });

  it('reports a missing secret and a missing database URL in one message', () => {
    // `loadConfig` promises "one boot, one message". An auth variable must not break that: fixing
    // five variables should take one deploy, not five.
    let message = '';
    try {
      loadConfig({ BETTER_AUTH_URL: 'http://x.test' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).toContain('DATABASE_URL');
  });

  it('defaults the mail transport to Mailpit, which the local stack already runs', () => {
    const config = loadConfig(VALID);
    expect(config.MAIL_SMTP_PORT).toBe(1025);
    expect(config.MAIL_SMTP_HOST).toBe('127.0.0.1');
  });
});

describe('W2-T01 — the rules the repo states and could not enforce', () => {
  /**
   * AC20. `config.ts`: "A module that reaches for `process.env.SOMETHING` directly is a review
   * failure." That has been a comment asking for vigilance. Here it is a test.
   */
  it('no auth module reads process.env directly', () => {
    for (const file of [
      ['src', 'auth', 'auth.ts'],
      ['src', 'auth', 'mail.ts'],
      ['src', 'plugins', 'auth.ts'],
    ] as const) {
      expect(read(...file), `${file.join('/')} reaches for the ambient environment`).not.toMatch(
        /process\.env/,
      );
    }
  });

  /**
   * AC22. `ADR-005`: "Pin the version exactly, treat an upgrade as a reviewed change rather than a
   * lockfile bump." A caret would let a minor release into the highest-blast-radius slice through
   * a routine `pnpm update`.
   */
  it('pins better-auth exactly', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    const pinned = pkg.dependencies['better-auth'];
    expect(pinned).toBeDefined();
    expect(pinned, 'better-auth must be pinned exactly — ADR-005').toMatch(/^\d+\.\d+\.\d+$/);
  });

  /**
   * AC14. Telemetry defaults to off in 1.7.4, so this asserts an *explicit* `false` rather than an
   * observed behaviour — a default is a thing that can change in a minor release, and `ADR-005`'s
   * premise is that nothing about a user leaves the connection string.
   */
  it('disables telemetry explicitly rather than relying on the default', () => {
    expect(read('src', 'auth', 'auth.ts')).toMatch(/telemetry:\s*\{\s*enabled:\s*false\s*\}/);
  });

  /**
   * `ADR-005` rule 4. The cookie cache trades immediate revocation for a saved query, and rule 3
   * chose database sessions specifically to buy immediate revocation. Turning the cache on would
   * undo rule 3 through an option rather than through a decision.
   */
  it('leaves the session cookie cache off', () => {
    expect(read('src', 'auth', 'auth.ts')).toMatch(/cookieCache:\s*\{\s*enabled:\s*false\s*\}/);
  });

  /**
   * `ADR-005` rule 1. `app_user.id` is `uuid DEFAULT gen_random_uuid()`, and every foreign key in
   * the schema is `UUID`. better-auth's default base62 id would be rejected by the column type.
   */
  it('leaves id generation to the database', () => {
    expect(read('src', 'auth', 'auth.ts')).toMatch(/generateId:\s*false/);
  });

  /**
   * A sign-up body carrying `roles: ["ADMIN"]` must not be a privilege escalation. `input: false`
   * is what stops better-auth accepting our own columns as request input; there is no route in
   * this ticket that may set them at all.
   */
  it('marks every one of our own columns as not-input', () => {
    const source = read('src', 'auth', 'auth.ts');
    const block = source.slice(
      source.indexOf('additionalFields:'),
      source.indexOf('session: {', source.indexOf('additionalFields:')),
    );
    for (const field of ['roles', 'status', 'locale', 'deletedAt']) {
      expect(block).toContain(field);
    }
    // Four fields, four refusals — derived from the block rather than counted by hand, so adding a
    // fifth field without `input: false` fails here (CI gates fail open when a list is manual).
    const declared = block.match(/^\s{8}\w+: \{/gm) ?? [];
    const refused = block.match(/input:\s*false/g) ?? [];
    expect(refused).toHaveLength(declared.length);
  });
});

describe('W2-T01 §4.4 — the carve-out is exactly one prefix', () => {
  it('names the prefix once, and the plugin is what serves it', () => {
    expect(AUTH_PREFIX).toBe('/api/auth');
    expect(read('src', 'plugins', 'auth.ts')).toContain('`${AUTH_PREFIX}/*`');
  });

  /**
   * §4.3 cost two. Past `reply.hijack()` Fastify's `setErrorHandler` never runs, so a throw from
   * better-auth's handler would otherwise vanish: no log, and a socket that hangs until it times
   * out. The `catch` is load-bearing and easy to delete as "unreachable".
   */
  it('catches and logs a throw from the handler, because the error handler cannot', () => {
    const source = read('src', 'plugins', 'auth.ts');
    expect(source).toContain('reply.hijack()');
    expect(source).toMatch(/catch\s*\(error\)/);
    expect(source).toMatch(/request\.log\.error/);
  });

  /**
   * §4.3 cost one. Fastify's parser would drain `request.raw` before better-auth reads it. The
   * parser must stay *inside* the plugin's scope: registering it globally would replace the
   * JSON parsing — and the `400` on a malformed body — for every other route in the API.
   */
  it('adds the pass-through body parser inside the plugin, not globally', () => {
    const plugin = read('src', 'plugins', 'auth.ts');
    expect(plugin).toContain('fastify.addContentTypeParser');
    // The *import*, not the string. The file's own prose explains why `fastify-plugin` is not
    // used, and a bare `toContain` matched that explanation — an assertion that reads the
    // commentary rather than the code.
    expect(plugin).not.toMatch(/^import .*'fastify-plugin'/m);

    const app = read('src', 'app.ts');
    expect(app).not.toContain('addContentTypeParser');
  });
});

describe('W2-T01 §4.7 — one origin in development too', () => {
  /**
   * AC24. `ADR-005` rule 5 chose a single origin so credentialed CORS is never needed. Without
   * this proxy the only environment where auth is *developed* is the one whose cookie behaviour
   * matches nothing that is deployed — and a cross-origin cookie failure is silent.
   */
  it('proxies /api to the API from the web dev server', () => {
    const config = readFileSync(join(apiRoot, '..', 'web', 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/proxy:\s*\{\s*'\/api'/);
    expect(config).toContain('127.0.0.1:3000');
  });

  /**
   * AC23. Mocking the auth endpoints would reproduce, on the one flow that cannot tolerate it, the
   * facade this ticket exists to start removing.
   *
   * **`W3-T01` made it structural.** The assertion used to read `apps/web/mocks/handlers.ts` and
   * check that no handler matched `/auth`. That file is gone, and so is the directory: the last
   * endpoint the storefront lacked — `GET /categories` — is real, and MSW went with it. There is
   * no longer a place to mock an auth route, which is the strongest form this criterion can take.
   */
  it('does not mock the auth endpoints in the web app', () => {
    expect(
      existsSync(join(apiRoot, '..', 'web', 'mocks')),
      'the web app has a mock layer again, and it could answer /api/auth',
    ).toBe(false);
  });
});

describe('W2-T10 §2.2 — trusting the address is opt-in, and off by default', () => {
  it('AC1 — defaults to false when nothing is set', () => {
    expect(loadConfig(VALID).AUTH_TRUST_EMAIL_ON_SIGNUP).toBe(false);
  });

  it('AC1 — reads the string a deploy actually sets', () => {
    expect(
      loadConfig({ ...VALID, AUTH_TRUST_EMAIL_ON_SIGNUP: 'true' }).AUTH_TRUST_EMAIL_ON_SIGNUP,
    ).toBe(true);
    expect(
      loadConfig({ ...VALID, AUTH_TRUST_EMAIL_ON_SIGNUP: 'false' }).AUTH_TRUST_EMAIL_ON_SIGNUP,
    ).toBe(false);
  });

  /**
   * The default is the whole safety property: a mechanism that weakens address ownership must be
   * something an environment *asks* for in a diff a reviewer can see, never something it inherits.
   * A source assertion because a `.default(true)` would be a one-word change with no visible
   * symptom — everything would keep working.
   */
  it('has no default of true — a source assertion, because the failure is silent', () => {
    const source = read('src', 'config.ts');
    const declaration = source.slice(
      source.indexOf('AUTH_TRUST_EMAIL_ON_SIGNUP:'),
      source.indexOf('AUTH_TRUST_EMAIL_ON_SIGNUP:') + 300,
    );
    expect(declaration).not.toContain('.default(true)');
  });

  /**
   * §2.1 — the trap this ticket was one line away from walking into. better-auth derives the
   * synthetic duplicate response from `requireEmailVerification`:
   *
   *     shouldReturnGenericDuplicateResponse = requireEmailVerification || autoSignIn === false
   *
   * so switching verification off to make accounts usable would silently delete the anti-enumeration
   * answer `W2-T01` §4.5 exists for. The flag above marks the user verified instead; this asserts
   * that nobody later takes the shortcut.
   */
  it('AC4 — keeps requireEmailVerification on, because it is what closes the enumeration oracle', () => {
    const source = read('src', 'auth', 'auth.ts');
    expect(source).toMatch(/requireEmailVerification:\s*true/);
  });
});
