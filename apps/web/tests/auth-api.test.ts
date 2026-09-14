// @vitest-environment node
//
// `W2-T09` — the seam between the pages and `W2-T01`'s API.
//
// The page suite stubs `ApiClient`; this one is the other half — what that interface actually sends,
// asserted against the routes better-auth 1.7.4 serves. Read out of the installed package rather
// than recalled: `sign-up/email`, `sign-in/email`, `send-verification-email`,
// `request-password-reset` and `reset-password` are its spellings, and a typo in any of them is a
// 404 the stubbed page tests would never see.
import { describe, expect, it, vi } from 'vitest';
import { type AxiosInstance } from 'axios';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiError, createApiClient } from '../src/shared/api.js';

const src = fileURLToPath(new URL('../src', import.meta.url));
const mocks = fileURLToPath(new URL('../mocks', import.meta.url));

interface Recorded {
  method: 'get' | 'post';
  url: string;
  body?: unknown;
}

function recordingHttp(responses: Record<string, unknown> = {}) {
  const calls: Recorded[] = [];
  const answer = (url: string): { data: unknown } => ({ data: responses[url] ?? { status: true } });

  const http = {
    get: vi.fn((url: string) => {
      calls.push({ method: 'get', url });
      return Promise.resolve(answer(url));
    }),
    post: vi.fn((url: string, body: unknown) => {
      calls.push({ method: 'post', url, body });
      return Promise.resolve(answer(url));
    }),
  };

  return { calls, http: http as unknown as AxiosInstance };
}

/** An axios rejection, shaped the way `axios.isAxiosError` recognises one. */
function axiosError(status: number | undefined) {
  return Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    ...(status === undefined ? {} : { response: { status } }),
  });
}

describe('the auth calls go where better-auth listens', () => {
  it('signs up with the fields the endpoint declares', async () => {
    const { calls, http } = recordingHttp();

    await createApiClient(http).signUp({
      name: 'Ana Pérez',
      email: 'ana@example.com',
      password: 'una-contraseña-larga',
      callbackURL: '/es/verify-email',
    });

    expect(calls).toEqual([
      {
        method: 'post',
        url: 'api/auth/sign-up/email',
        body: {
          name: 'Ana Pérez',
          email: 'ana@example.com',
          password: 'una-contraseña-larga',
          callbackURL: '/es/verify-email',
        },
      },
    ]);
  });

  it('AC5 — discards the body, so a duplicate signup cannot be told from a new account', async () => {
    // This is the synthetic `200` from `W2-T01` §4.5: a user object with `roles: null` and no row
    // written. It reaches the client and stops here. A method that returned it would put the
    // enumeration oracle one `if` away from the screen.
    const { http } = recordingHttp({
      'api/auth/sign-up/email': {
        user: { id: 'synthetic', email: 'ana@example.com', roles: null },
        token: null,
      },
    });

    const result = await createApiClient(http).signUp({
      name: 'Ana Pérez',
      email: 'ana@example.com',
      password: 'una-contraseña-larga',
      callbackURL: '/es/verify-email',
    });

    expect(result).toBeUndefined();
  });

  it('signs in, out, and reads the session', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ana Pérez',
      email: 'ana@example.com',
      emailVerified: true,
    };
    const { calls, http } = recordingHttp({
      'api/auth/sign-in/email': { redirect: false, token: 'opaque', user },
      'api/auth/get-session': { user },
    });
    const api = createApiClient(http);

    const signedIn = await api.signIn({
      email: 'ana@example.com',
      password: 'una-contraseña-larga',
    });
    const session = await api.getSession();
    await api.signOut();

    // The sign-in response carries the user, which is what lets the login action seed the session
    // cache instead of asking `get-session` for something the server just said.
    expect(signedIn.name).toBe('Ana Pérez');

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'post api/auth/sign-in/email',
      'get api/auth/get-session',
      'post api/auth/sign-out',
    ]);
    expect(session?.name).toBe('Ana Pérez');
  });

  it('reads a signed-out session as null rather than as a failure', async () => {
    // better-auth answers `200` with a `null` body when there is no cookie. A client that threw
    // here would make "signed out" an error state, and the shell would render the 500 page to
    // every first-time visitor.
    const { http } = recordingHttp({ 'api/auth/get-session': null });

    expect(await createApiClient(http).getSession()).toBeNull();
  });

  it('resends verification and drives the reset pair', async () => {
    const { calls, http } = recordingHttp();
    const api = createApiClient(http);

    await api.resendVerification({ email: 'ana@example.com', callbackURL: '/es/verify-email' });
    await api.requestPasswordReset({
      email: 'ana@example.com',
      redirectTo: '/es/reset-password/set',
    });
    await api.resetPassword({ token: 'abc123', newPassword: 'otra-contraseña-larga' });

    expect(calls).toEqual([
      {
        method: 'post',
        url: 'api/auth/send-verification-email',
        body: { email: 'ana@example.com', callbackURL: '/es/verify-email' },
      },
      {
        method: 'post',
        url: 'api/auth/request-password-reset',
        body: { email: 'ana@example.com', redirectTo: '/es/reset-password/set' },
      },
      {
        method: 'post',
        url: 'api/auth/reset-password',
        body: { token: 'abc123', newPassword: 'otra-contraseña-larga' },
      },
    ]);
  });

  it.each([
    [401, 401],
    [403, 403],
    [500, 500],
    [undefined, undefined],
  ])('turns a %s into an ApiError the routes can branch on', async (status, expected) => {
    const http = {
      post: vi.fn(() => Promise.reject(axiosError(status))),
    } as unknown as AxiosInstance;

    await expect(
      createApiClient(http).signIn({ email: 'ana@example.com', password: 'x' }),
    ).rejects.toMatchObject({ name: 'ApiError', status: expected });
    await expect(
      createApiClient(http).signIn({ email: 'ana@example.com', password: 'x' }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('AC22/AC23 — the rules that outlive these pages', () => {
  /** Every source file, derived. A hand-written list is the gate this repo has seen fail three times. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it('finds files to check at all', () => {
    expect(sourceFiles(src).length).toBeGreaterThan(10);
  });

  it('AC22 — no write goes through useMutation; every submit is a router action', () => {
    // A *use*, not a mention: the rule is written down in `features/auth/form.tsx`, and a gate that
    // fails on the sentence explaining it is a gate that gets deleted rather than obeyed. Both
    // spellings of a use are checked — the call, and the import that would let it be renamed.
    const offenders = sourceFiles(src).filter((file) => {
      const source = readFileSync(file, 'utf8');
      const imported = /import\s*\{[^}]*\buseMutation\b[^}]*\}\s*from/.test(source);
      return imported || /\buseMutation\s*[(<]/.test(source);
    });

    expect(
      offenders,
      'a mutation in a component is the write-side of the fetch-on-mount rule R3 forbids, and it is what W12-T14 would have to unpick',
    ).toEqual([]);
  });

  it('AC22 — every auth page exports an action', () => {
    const pages = [
      'routes/signup.tsx',
      'routes/login.tsx',
      'routes/verify-email.tsx',
      'routes/reset-password.tsx',
      'routes/reset-password-set.tsx',
      'routes/root.tsx',
    ];

    for (const page of pages) {
      expect(readFileSync(`${src}/${page}`, 'utf8'), `${page} has no action`).toMatch(
        /export (async function|const) action/,
      );
    }
  });

  it('AC23 — the storefront mocks no auth route', () => {
    for (const file of sourceFiles(mocks)) {
      expect(readFileSync(file, 'utf8'), `${file} mocks /api/auth`).not.toContain('api/auth');
    }
  });
});
