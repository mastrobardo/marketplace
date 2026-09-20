/**
 * `W2-T09` — the account pages.
 *
 * Three of these assertions are about what the pages must **not** be able to say, and they are the
 * reason this suite is longer than five happy paths. `W2-T01` built an API that refuses to be an
 * oracle: a duplicate signup is a synthetic `200`, every sign-in refusal is byte-identical, and a
 * reset request answers the same for an address that exists and one that does not. A form that
 * reports what it can infer gives all of that back, and it gives it back silently — nothing fails,
 * the page is simply more helpful than it is allowed to be.
 *
 * The stub is the `ApiClient` seam, as in every other page suite (`app-harness.tsx`): a fake at the
 * boundary the application already has, not a fake server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { changeLanguage, setupI18n } from '../src/i18n/index.js';
import es from '../src/i18n/locales/es.json';
import en from '../src/i18n/locales/en.json';
import { ApiError } from '../src/shared/api.js';
import { renderApp, stubApi, STUB_USER, type SessionUser } from './app-harness.js';

beforeEach(async () => {
  await setupI18n();
  await changeLanguage('es');
});

afterEach(() => {
  cleanup();
});

const VERIFIED: SessionUser = STUB_USER;

/** Fill a labelled text field. Every auth field is a `TextInput`, so one helper covers all of them. */
async function fill(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  await user.type(screen.getByLabelText(new RegExp(`^${label}`)), value);
}

const submit = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await user.click(screen.getByRole('button', { name: label }));
};

describe('AC1..AC3 — the five routes exist, inside the shell, untranslated', () => {
  it.each([
    ['/es/signup', es['auth.signup.title']],
    ['/es/login', es['auth.login.title']],
    ['/es/verify-email', es['auth.verify.verified.title']],
    ['/es/reset-password', es['auth.reset.request.title']],
    ['/es/reset-password/set', es['auth.reset.set.title']],
  ])('AC1 — %s renders %s inside the shell', async (path, heading) => {
    renderApp(path);

    await screen.findByRole('banner');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
    expect(screen.getByRole('contentinfo')).toBeDefined();
  });

  it('AC1 — the English spellings are the same segments', async () => {
    renderApp('/en/signup');

    await screen.findByRole('banner');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en['auth.signup.title']);
  });
});

describe('AC4..AC7 — signup', () => {
  it('AC4 — posts once, with a callbackURL pointing at this language’s verify page', async () => {
    const user = userEvent.setup();
    const signUp = vi.fn().mockResolvedValue(undefined);
    renderApp('/es/signup', stubApi({ signUp }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.name.label'], 'Ana Pérez');
    await fill(user, es['auth.field.email.label'], 'ana@example.com');
    await fill(user, es['auth.field.password.label'], 'una-contraseña-larga');
    await submit(user, es['auth.signup.submit']);

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(signUp).toHaveBeenCalledWith({
      name: 'Ana Pérez',
      email: 'ana@example.com',
      password: 'una-contraseña-larga',
      callbackURL: '/es/verify-email',
    });
  });

  it('AC5 — every reason a sign-up cannot sign you in renders the same panel', async () => {
    /**
     * **Changed by `W2-T10`, and the property it protects is unchanged.**
     *
     * `W2-T09` asserted that a duplicate address rendered the same panel as a new account, because
     * both ended there. Now a sign-up chains a sign-in (`W2-T10` §2.3), so a *usable* account goes
     * to the home page and only the ones that cannot sign in render the panel — an unverified new
     * account (`403`) and a duplicate whose password is not the account's (`401`).
     *
     * Those two are what must stay indistinguishable: they are the pair that would otherwise
     * answer "does this address already have an account". Asserted on the rendered text, with the
     * address masked, because that is what a person and an attacker both actually see.
     */
    const rendered: string[] = [];

    for (const [email, error] of [
      ['nueva@example.com', new ApiError(403, 'EMAIL_NOT_VERIFIED')],
      ['ya-registrada@example.com', new ApiError(401, 'INVALID_EMAIL_OR_PASSWORD')],
    ] as const) {
      const user = userEvent.setup();
      renderApp('/es/signup', stubApi({ signIn: () => Promise.reject(error) }));
      await screen.findByRole('banner');

      await fill(user, es['auth.field.name.label'], 'Ana Pérez');
      await fill(user, es['auth.field.email.label'], email);
      await fill(user, es['auth.field.password.label'], 'una-contraseña-larga');
      await submit(user, es['auth.signup.submit']);

      const panel = await screen.findByTestId('inbox-panel');
      rendered.push(panel.textContent?.replace(email, '<address>') ?? '');
      cleanup();
    }

    expect(rendered[0]).toBe(rendered[1]);
  });

  it('AC6 — no catalogue can say an address is already registered', () => {
    // Read from the catalogues rather than from the rendered page: a component-level assertion is
    // one edit away from being true of a component nobody renders, and the copy is what leaks.
    const forbidden = [
      /ya (está|existe|registrad)/i,
      /en uso/i,
      /already (registered|taken|exists|in use)/i,
      /account exists/i,
    ];

    for (const [language, catalogue] of [
      ['es', es],
      ['en', en],
    ] as const) {
      for (const [key, value] of Object.entries(catalogue)) {
        if (!key.startsWith('auth.')) continue;
        for (const pattern of forbidden) {
          expect(pattern.test(value), `${language}.${key} leaks enumeration: "${value}"`).toBe(
            false,
          );
        }
      }
    }
  });

  it('AC7 — invalid input never reaches the network', async () => {
    const user = userEvent.setup();
    const signUp = vi.fn().mockResolvedValue(undefined);
    renderApp('/es/signup', stubApi({ signUp }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.name.label'], ' ');
    await fill(user, es['auth.field.email.label'], 'no-es-un-correo');
    await fill(user, es['auth.field.password.label'], 'corta');
    await submit(user, es['auth.signup.submit']);

    await screen.findByText(es['auth.error.email.invalid']);
    expect(screen.getByText(es['auth.error.password.tooShort'])).toBeDefined();
    expect(screen.getByText(es['auth.error.name.required'])).toBeDefined();
    expect(signUp).not.toHaveBeenCalled();
  });
});

describe('AC8..AC10 — login', () => {
  it('AC8 — four different refusals produce one identical rendering', async () => {
    const rendered: string[] = [];

    for (const _refusal of ['wrong password', 'unknown address', 'suspended', 'deleted']) {
      const user = userEvent.setup();
      // Every one of them is this, byte for byte — that is `W2-T01` §4.5, and it is why the page
      // cannot tell them apart even if someone later wants it to.
      const signIn = vi.fn().mockRejectedValue(new ApiError(401, 'INVALID_EMAIL_OR_PASSWORD'));
      renderApp('/es/login', stubApi({ signIn }));
      await screen.findByRole('banner');

      await fill(user, es['auth.field.email.label'], 'ana@example.com');
      await fill(user, es['auth.field.password.label'], 'una-contraseña-larga');
      await submit(user, es['auth.login.submit']);

      const alert = await screen.findByRole('alert');
      rendered.push(alert.textContent ?? '');
      cleanup();
    }

    expect(new Set(rendered).size).toBe(1);
    expect(rendered[0]).toBe(es['auth.login.refused']);
  });

  it('AC9 — an unverified address gets the inbox panel, not the refusal', async () => {
    const user = userEvent.setup();
    const signIn = vi.fn().mockRejectedValue(new ApiError(403, 'EMAIL_NOT_VERIFIED'));
    renderApp('/es/login', stubApi({ signIn }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.email.label'], 'ana@example.com');
    await fill(user, es['auth.field.password.label'], 'una-contraseña-larga');
    await submit(user, es['auth.login.submit']);

    const panel = await screen.findByTestId('inbox-panel');
    expect(within(panel).getByRole('button', { name: es['auth.inbox.resend'] })).toBeDefined();
    expect(screen.queryByText(es['auth.login.refused'])).toBeNull();
  });

  it('AC10 — a successful sign-in lands on the home page, signed in', async () => {
    const user = userEvent.setup();
    // `getSession` answers "signed out" *forever* here, deliberately. The header can only end up
    // showing a name if the action seeded the cache from the sign-in response — a stub that started
    // returning the user after sign-in would let either implementation pass.
    const getSession = vi.fn().mockResolvedValue(null);
    const signIn = vi.fn().mockResolvedValue(VERIFIED);
    renderApp('/es/login', stubApi({ getSession, signIn }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.email.label'], 'ana@example.com');
    await fill(user, es['auth.field.password.label'], 'una-contraseña-larga');
    await submit(user, es['auth.login.submit']);

    await screen.findByText(es['home.title']);
    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    expect(within(nav).getByText(VERIFIED.name)).toBeDefined();
  });

  it('AC27 — signing in is one API call', async () => {
    // Operator, 2026-09-14: *"the whole login flow should be 1 api call"*. It was three — the
    // shell's session read on page load, the sign-in, and a second session read after the redirect
    // because the action invalidated. The third is the one this assertion removes: the sign-in
    // response already carries the user, so asking again asks for what we were just told.
    const user = userEvent.setup();
    const getSession = vi.fn().mockResolvedValue(null);
    const signIn = vi.fn().mockResolvedValue(VERIFIED);
    renderApp('/es/login', stubApi({ getSession, signIn }));
    await screen.findByRole('banner');

    // The one the page load costs, before anything is typed. Every page pays it: it is the header
    // knowing who you are before it paints.
    expect(getSession).toHaveBeenCalledTimes(1);

    await fill(user, es['auth.field.email.label'], 'ana@example.com');
    await fill(user, es['auth.field.password.label'], 'una-contraseña-larga');
    await submit(user, es['auth.login.submit']);
    await screen.findByText(es['home.title']);

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(
      getSession,
      'the session was re-read after a response that already carried it',
    ).toHaveBeenCalledTimes(1);
  });
});

describe('AC11..AC13 — verification', () => {
  it('AC11 — landing with no error is the verified state', async () => {
    renderApp('/es/verify-email');

    await screen.findByRole('banner');
    expect(screen.getByTestId('verify-verified')).toBeDefined();
    expect(screen.queryByTestId('verify-expired')).toBeNull();
  });

  it.each(['TOKEN_EXPIRED', 'INVALID_TOKEN', 'USER_NOT_FOUND'])(
    'AC12 — ?error=%s is the expired state and never the verified one',
    async (code) => {
      renderApp(`/es/verify-email?error=${code}`);

      await screen.findByRole('banner');
      expect(screen.getByTestId('verify-expired')).toBeDefined();
      expect(screen.queryByTestId('verify-verified')).toBeNull();
    },
  );

  it('AC13 — a resend that works says so', async () => {
    const user = userEvent.setup();
    const resendVerification = vi.fn().mockResolvedValue(undefined);
    renderApp('/es/verify-email?error=TOKEN_EXPIRED', stubApi({ resendVerification }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.email.label'], 'ana@example.com');
    await submit(user, es['auth.inbox.resend']);

    await screen.findByText(es['auth.inbox.resent']);
    expect(resendVerification).toHaveBeenCalledWith({
      email: 'ana@example.com',
      callbackURL: '/es/verify-email',
    });
  });

  it('AC13 — a resend that fails says *that*, and never the success line', async () => {
    // `ECONNREFUSED 127.0.0.1:1025` in every deployed environment until `OPS-14`. The account is
    // already stranded; telling the user to check an inbox that will stay empty makes it theirs.
    const user = userEvent.setup();
    const resendVerification = vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL'));
    renderApp('/es/verify-email?error=TOKEN_EXPIRED', stubApi({ resendVerification }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.email.label'], 'ana@example.com');
    await submit(user, es['auth.inbox.resend']);

    await screen.findByText(es['auth.inbox.resendFailed']);
    expect(screen.queryByText(es['auth.inbox.resent'])).toBeNull();
  });
});

describe('AC14..AC16 — password reset', () => {
  it('AC14 — the request names where the link should land, and answers the same either way', async () => {
    const rendered: string[] = [];
    const requestPasswordReset = vi.fn().mockResolvedValue(undefined);

    for (const email of ['existe@example.com', 'no-existe@example.com']) {
      const user = userEvent.setup();
      renderApp('/es/reset-password', stubApi({ requestPasswordReset }));
      await screen.findByRole('banner');

      await fill(user, es['auth.field.email.label'], email);
      await submit(user, es['auth.reset.request.submit']);

      const panel = await screen.findByTestId('reset-sent');
      rendered.push(panel.textContent?.replace(email, '<address>') ?? '');
      cleanup();
    }

    expect(rendered[0]).toBe(rendered[1]);
    expect(requestPasswordReset).toHaveBeenLastCalledWith({
      email: 'no-existe@example.com',
      redirectTo: '/es/reset-password/set',
    });
  });

  it('AC15 — the token from the query is what gets posted', async () => {
    const user = userEvent.setup();
    const resetPassword = vi.fn().mockResolvedValue(undefined);
    renderApp('/es/reset-password/set?token=abc123', stubApi({ resetPassword }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.newPassword.label'], 'otra-contraseña-larga');
    await fill(user, es['auth.field.confirmPassword.label'], 'otra-contraseña-larga');
    await submit(user, es['auth.reset.set.submit']);

    await screen.findByTestId('reset-done');
    expect(resetPassword).toHaveBeenCalledWith({
      token: 'abc123',
      newPassword: 'otra-contraseña-larga',
    });
  });

  it('AC15 — an invalid token renders a way out instead of a form that cannot work', async () => {
    renderApp('/es/reset-password/set?error=INVALID_TOKEN');

    await screen.findByRole('banner');
    expect(screen.getByTestId('reset-invalid')).toBeDefined();
    expect(
      screen.queryByLabelText(new RegExp(`^${es['auth.field.newPassword.label']}`)),
    ).toBeNull();
  });

  it('AC16 — two passwords that disagree make no request', async () => {
    const user = userEvent.setup();
    const resetPassword = vi.fn().mockResolvedValue(undefined);
    renderApp('/es/reset-password/set?token=abc123', stubApi({ resetPassword }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.newPassword.label'], 'otra-contraseña-larga');
    await fill(user, es['auth.field.confirmPassword.label'], 'otra-contraseña-distinta');
    await submit(user, es['auth.reset.set.submit']);

    await screen.findByText(es['auth.error.password.mismatch']);
    expect(resetPassword).not.toHaveBeenCalled();
  });
});

describe('AC17..AC21 — the entry points', () => {
  it('AC17 — signed out, the header offers both doors', async () => {
    renderApp('/es');
    await screen.findByRole('banner');

    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    expect(within(nav).getByRole('link', { name: es['nav.login'] }).getAttribute('href')).toBe(
      '/es/login',
    );
    expect(within(nav).getByRole('link', { name: es['nav.signup'] }).getAttribute('href')).toBe(
      '/es/signup',
    );
  });

  it('AC17 — signed in, it shows who you are, from the loader', async () => {
    const getSession = vi.fn().mockResolvedValue(VERIFIED);
    renderApp('/es', stubApi({ getSession }));
    await screen.findByRole('banner');

    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    await within(nav).findByText(VERIFIED.name);
    expect(within(nav).queryByRole('link', { name: es['nav.login'] })).toBeNull();
    // Once, by the loader. A component fetching on mount would make this two.
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('AC18 — signing out calls the API, once, and the header goes back', async () => {
    const user = userEvent.setup();
    // Same shape as AC27: `getSession` keeps insisting the user is signed in, so the header can
    // only go back to the two links if the action seeded `null` from a successful sign-out.
    const getSession = vi.fn().mockResolvedValue(VERIFIED);
    const signOut = vi.fn().mockResolvedValue(undefined);
    // From the account page: `W2-T10` moved the control off the header, and the header is still
    // what this asserts about — it has to go back to offering the two doors.
    renderApp('/es/account', stubApi({ getSession, signOut }));
    await screen.findByRole('banner');
    await screen.findByText(VERIFIED.email);

    await submit(user, es['account.signOut']);

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    await within(nav).findByRole('link', { name: es['nav.login'] });
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('AC28 — a sign-out that fails asks rather than asserting', async () => {
    // The asymmetry worth keeping: a call that *failed* has told us nothing, so seeding either
    // answer would be the client inventing one. Here the re-read is the correct second request.
    const user = userEvent.setup();
    const getSession = vi.fn().mockResolvedValue(VERIFIED);
    const signOut = vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL'));
    renderApp('/es/account', stubApi({ getSession, signOut }));
    await screen.findByRole('banner');
    await screen.findByText(VERIFIED.email);

    await submit(user, es['account.signOut']);

    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    // Signing out navigates to the home page — the form posts to the layout route, and staying on
    // a page whose loader requires a session would only bounce to the login form. So the assertion
    // is the header: the sign-out failed, so the person is still signed in, and it still says so.
    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    expect(await within(nav).findByRole('link', { name: VERIFIED.name })).toBeDefined();
  });

  it('AC19 — a session lookup that fails is signed out, not a broken site', async () => {
    // The `W12-T09` lesson, applied to a second endpoint: the shell may not hard-depend on a call
    // that can fail. "We could not reach the API" must not read as "you have been logged out", and
    // it must certainly not replace the storefront with the 500 page.
    const getSession = vi.fn().mockRejectedValue(new ApiError(undefined, 'Network Error'));
    renderApp('/es', stubApi({ getSession }));
    await screen.findByRole('banner');

    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    expect(within(nav).getByRole('link', { name: es['nav.login'] })).toBeDefined();
    expect(screen.queryByTestId('error-page')).toBeNull();
  });

  it('AC21 — become-a-pro’s wall leads to signup', async () => {
    renderApp('/es/become-a-pro');
    await screen.findByRole('banner');

    const wall = screen.getByRole('region', { name: es['pro.title'] });
    expect(
      within(wall).getByRole('link', { name: es['auth.signup.title'] }).getAttribute('href'),
    ).toBe('/es/signup');
  });
});

describe('AC26 — a password is never anywhere it can be read later', () => {
  it('keeps it out of the URL after a submit', async () => {
    const user = userEvent.setup();
    renderApp('/es/login', stubApi({ signIn: () => Promise.resolve(VERIFIED) }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.email.label'], 'ana@example.com');
    await fill(user, es['auth.field.password.label'], 'una-contraseña-larga');
    await submit(user, es['auth.login.submit']);

    await waitFor(() => expect(window.location.search).not.toContain('contraseña'));
    expect(window.location.href).not.toContain('una-contrase');
  });
});

/* ------------------------------------------------------------------------------------------- *
 * `W2-T10` — sign-up that signs you in, and the header a signed-in visitor sees
 * ------------------------------------------------------------------------------------------- */

describe('AC8..AC10 — sign-up chains a sign-in, so the page needs to know nothing', () => {
  it('AC8 — a usable account lands on the home page, signed in', async () => {
    // What `AUTH_TRUST_EMAIL_ON_SIGNUP` produces on the server: the account is verified the moment
    // it is created, so the sign-in the action chains succeeds. The page has no flag and no branch
    // for it — it asks, and the answer decides.
    const user = userEvent.setup();
    const signUp = vi.fn().mockResolvedValue(undefined);
    const signIn = vi.fn().mockResolvedValue(VERIFIED);
    renderApp('/es/signup', stubApi({ signUp, signIn, getSession: () => Promise.resolve(null) }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.name.label'], 'Ana Pérez');
    await fill(user, es['auth.field.email.label'], 'ana@example.com');
    await fill(user, es['auth.field.password.label'], 'una-contraseña-larga');
    await submit(user, es['auth.signup.submit']);

    await screen.findByText(es['home.title']);
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith({
      email: 'ana@example.com',
      password: 'una-contraseña-larga',
    });
    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    expect(within(nav).getByText(VERIFIED.name)).toBeDefined();
  });

  it('AC9 — an account that still needs verifying gets the inbox panel', async () => {
    const user = userEvent.setup();
    const signIn = vi.fn().mockRejectedValue(new ApiError(403, 'EMAIL_NOT_VERIFIED'));
    renderApp('/es/signup', stubApi({ signIn }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.name.label'], 'Ana Pérez');
    await fill(user, es['auth.field.email.label'], 'ana@example.com');
    await fill(user, es['auth.field.password.label'], 'una-contraseña-larga');
    await submit(user, es['auth.signup.submit']);

    const panel = await screen.findByTestId('inbox-panel');
    expect(within(panel).getByRole('button', { name: es['auth.inbox.resend'] })).toBeDefined();
  });

  it('AC10 — a duplicate address whose password is wrong gets the same panel, not an error', async () => {
    // The uniform outcome matters: a page that showed something different here would be answering
    // "does this address already have an account" — which is the question `W2-T01` §4.5 refuses.
    const user = userEvent.setup();
    const signIn = vi.fn().mockRejectedValue(new ApiError(401, 'INVALID_EMAIL_OR_PASSWORD'));
    renderApp('/es/signup', stubApi({ signIn }));
    await screen.findByRole('banner');

    await fill(user, es['auth.field.name.label'], 'Ana Pérez');
    await fill(user, es['auth.field.email.label'], 'ya-registrada@example.com');
    await fill(user, es['auth.field.password.label'], 'una-contraseña-larga');
    await submit(user, es['auth.signup.submit']);

    expect(await screen.findByTestId('inbox-panel')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AC11..AC13 — the header stops offering what you already have', () => {
  it('AC11/AC12 — signed in: the name links to the account page, and neither door is offered', async () => {
    renderApp('/es', stubApi({ getSession: () => Promise.resolve(VERIFIED) }));
    await screen.findByRole('banner');

    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    const account = await within(nav).findByRole('link', { name: VERIFIED.name });
    expect(account.getAttribute('href')).toBe('/es/account');
    expect(within(nav).queryByRole('link', { name: es['nav.login'] })).toBeNull();
    expect(within(nav).queryByRole('link', { name: es['nav.signup'] })).toBeNull();
    // Sign-out moved to the account page: rarely used, reached deliberately.
    expect(within(nav).queryByRole('button', { name: es['nav.logout'] })).toBeNull();
  });

  it('AC13 — signed out: both doors, and no account link', async () => {
    renderApp('/es');
    await screen.findByRole('banner');

    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    expect(within(nav).getByRole('link', { name: es['nav.login'] })).toBeDefined();
    expect(within(nav).getByRole('link', { name: es['nav.signup'] })).toBeDefined();
    expect(within(nav).queryByRole('link', { name: es['nav.account'] })).toBeNull();
  });
});

describe('AC14..AC17 — the account page', () => {
  it('AC14 — shows who you are, from the session the shell already loaded', async () => {
    const getSession = vi.fn().mockResolvedValue(VERIFIED);
    renderApp('/es/account', stubApi({ getSession }));
    await screen.findByRole('banner');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(VERIFIED.name);
    expect(screen.getByText(VERIFIED.email)).toBeDefined();
    // The shell loaded it; the page reads it. A second request here would be R3 broken on a page
    // whose whole content is already in the cache.
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('AC15 — signing out from it returns the header to the signed-out state', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockResolvedValue(undefined);
    renderApp('/es/account', stubApi({ getSession: () => Promise.resolve(VERIFIED), signOut }));
    await screen.findByRole('banner');

    await submit(user, es['account.signOut']);

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    await within(nav).findByRole('link', { name: es['nav.login'] });
  });

  it('AC16 — signed out, it sends you to the login page', async () => {
    renderApp('/es/account');

    await screen.findByRole('banner');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es['auth.login.title']);
  });

  it('AC17 — the plan section is a boundary, not a control', async () => {
    // `BD-16`/`BD-03` are undecided and `W5-T07`/`W5-T08` are both `[B]`: there is no tier in the
    // schema, no price, and nothing an "upgrade" button could do. A sentence is the honest control.
    renderApp('/es/account', stubApi({ getSession: () => Promise.resolve(VERIFIED) }));
    await screen.findByRole('banner');

    const plan = screen.getByRole('region', { name: es['account.plan.title'] });
    expect(within(plan).queryByRole('button')).toBeNull();
    expect(within(plan).queryByRole('link')).toBeNull();
  });
});
