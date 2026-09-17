import { Navigate, type RouteObject } from 'react-router';
import {
  Component as Root,
  ErrorBoundary,
  HydrateFallback,
  action as rootAction,
  loader as rootLoader,
} from '../routes/root.js';
import { Component as Home, loader as homeLoader } from '../routes/home.js';
import { Component as BecomeAPro } from '../routes/become-a-pro.js';
import {
  Component as Search,
  ErrorBoundary as SearchErrorBoundary,
  loader as searchLoader,
} from '../routes/search.js';
import {
  Component as Provider,
  ErrorBoundary as ProviderErrorBoundary,
  loader as providerLoader,
} from '../routes/provider.js';
import {
  Component as Legal,
  ErrorBoundary as LegalErrorBoundary,
  loader as legalLoader,
} from '../routes/legal.js';
import { Component as NotFound } from '../routes/not-found.js';
import { Component as Account, loader as accountLoader } from '../routes/account.js';
import { Component as SignUp, action as signUpAction } from '../routes/signup.js';
import { Component as Login, action as loginAction } from '../routes/login.js';
import { Component as VerifyEmail, action as verifyEmailAction } from '../routes/verify-email.js';
import {
  Component as ResetPassword,
  action as resetPasswordAction,
} from '../routes/reset-password.js';
import {
  Component as ResetPasswordSet,
  action as resetPasswordSetAction,
} from '../routes/reset-password-set.js';
import { LOCALES } from '../i18n/index.js';

/**
 * The route table. A slice adds its routes as children of the `/:lang` layout route, so every page
 * inherits the shell — including the not-found page, which is the `path: '*'` child rather than a
 * sibling.
 *
 * **The language is a path segment; the rest of the path is not translated.** `/es/search`, never
 * `/es/buscar`. The operator's decision, 2026-09-11, and it reverses what ADR-011 §2's page
 * inventory showed — the ADR carries the amendment. A localised segment buys a little Spanish
 * keyword relevance in the URL and costs every route two spellings, two redirects and a lookup
 * table; with SEO deferred until there is something in production, it buys nothing at all.
 *
 * Every entry comes from a module in `src/routes/`, each exporting the route contract and nothing
 * else (ADR-011 R1). The rename at the import is the whole seam: the modules are shaped for
 * `W12-T14`'s framework-mode switch, and this file stays a plain table until then.
 */
export const routes: RouteObject[] = [
  // A bare `/` is a visitor who has not said which language they read. ES is the default and the
  // fallback (`TODO.md` §1, Spain first), so it is a redirect rather than a third rendering of home.
  { path: '/', element: <Navigate to={`/${LOCALES[0]}`} replace /> },
  {
    path: '/:lang',
    Component: Root,
    loader: rootLoader,
    // A layout route with an action: the sign-out control lives in the header, so it posts to the
    // route that renders the header rather than to whichever page happens to be underneath.
    action: rootAction,
    ErrorBoundary,
    HydrateFallback,
    children: [
      { index: true, Component: Home, loader: homeLoader },
      // Not `/es/hazte-profesional`: the language is the only translated segment (Amendment 1).
      { path: 'become-a-pro', Component: BecomeAPro },
      // Its own boundary, not the shell's: a failed search must keep the filter rail, which is the
      // only way a visitor can fix the query that failed.
      {
        path: 'search',
        Component: Search,
        loader: searchLoader,
        ErrorBoundary: SearchErrorBoundary,
      },
      // Its own boundary too, and for a second reason beyond the shell rule: a profile has two
      // failure modes — gone, and broken — and only one of them is an error.
      {
        path: 'pro/:id',
        Component: Provider,
        loader: providerLoader,
        ErrorBoundary: ProviderErrorBoundary,
      },
      // `W2-T09` — the account pages. Untranslated segments, like every other route (Amendment 1):
      // `/es/signup`, never `/es/registro`.
      { path: 'signup', Component: SignUp, action: signUpAction },
      // `W2-T10`: where the header's name goes. Its loader is the one guard in the storefront —
      // no session, no page, so it redirects to the login form rather than rendering an empty one.
      { path: 'account', Component: Account, loader: accountLoader },
      { path: 'login', Component: Login, action: loginAction },
      // Where better-auth's emailed link redirects back to, with `?error=<CODE>` when the token is
      // no longer good.
      { path: 'verify-email', Component: VerifyEmail, action: verifyEmailAction },
      { path: 'reset-password', Component: ResetPassword, action: resetPasswordAction },
      // Two segments rather than a `:token` param: better-auth's own callback consumes the token
      // and hands it back as a query parameter, so there is nothing in the path to name.
      { path: 'reset-password/set', Component: ResetPasswordSet, action: resetPasswordSetAction },
      {
        path: 'legal/:doc',
        Component: Legal,
        loader: legalLoader,
        ErrorBoundary: LegalErrorBoundary,
      },
      { path: '*', Component: NotFound },
    ],
  },
  // No trailing catch-all: `/:lang` already matches any first segment, and its loader throws a 404
  // for one that is not a language. A `path: '*'` here would be unreachable, which is worse than
  // absent — an unreachable route reads as handled.
];
