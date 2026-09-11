import { type RouteObject } from 'react-router';
import { Component as Root } from '../routes/root.js';
import { Component as Home } from '../routes/home.js';
import { Component as NotFound } from '../routes/not-found.js';

/**
 * The route table. A slice adds its routes as children of the layout route, so every page inherits
 * the shell — including the not-found page, which is the `path: '*'` child rather than a sibling.
 *
 * Every entry comes from a module in `src/routes/`, each of which exports the route contract and
 * nothing else (ADR-011 R1). The rename at the import is the whole seam: the modules are shaped for
 * `W12-T14`'s framework-mode switch, and this file stays a plain table until then.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    Component: Root,
    children: [
      { index: true, Component: Home },
      { path: '*', Component: NotFound },
    ],
  },
];
