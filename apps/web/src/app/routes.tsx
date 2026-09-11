import { Navigate, type RouteObject } from 'react-router';
import {
  Component as Root,
  ErrorBoundary,
  HydrateFallback,
  loader as rootLoader,
} from '../routes/root.js';
import { Component as Home, loader as homeLoader } from '../routes/home.js';
import { Component as BecomeAPro } from '../routes/become-a-pro.js';
import {
  Component as Legal,
  ErrorBoundary as LegalErrorBoundary,
  loader as legalLoader,
} from '../routes/legal.js';
import { Component as NotFound } from '../routes/not-found.js';
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
    ErrorBoundary,
    HydrateFallback,
    children: [
      { index: true, Component: Home, loader: homeLoader },
      // Not `/es/hazte-profesional`: the language is the only translated segment (Amendment 1).
      { path: 'become-a-pro', Component: BecomeAPro },
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
