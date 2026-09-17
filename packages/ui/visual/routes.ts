/**
 * The storefront's real routes — the subject list shared by the axe pass and the screenshots.
 *
 * `W12-T16` introduced this list inside `routes.spec.ts` for axe. `W12-T20` shoots the same routes,
 * and the two must not become two lists: a route that is checked for accessibility but not for
 * appearance is exactly the hole this ticket was written about — axe reads the accessibility tree,
 * and an unstyled page has a perfectly correct one.
 *
 * It lives in its own module rather than in the spec so that `tests/visual-coverage.test.ts` can
 * assert its baselines per pull request, without Playwright and without a browser.
 *
 * It is still hand-written, and that is a known limit rather than an oversight: the router is a
 * React module tree that cannot be enumerated outside a bundler today. `W12-T14` makes routes
 * modules a Worker can list, and deriving this from them is that ticket's to make — recorded in
 * the spec as §10 Q3 so the next reader does not take the list for a complete one.
 */

export interface VisualRoute {
  readonly path: string;
  readonly why: string;
  /** A selector that proves the intended page rendered, rather than a 200 with the wrong content. */
  readonly proof: string;
  /**
   * Why this route is not a stable screenshot subject. Present means axe runs and no shot is taken;
   * an exclusion with no reason is not one, and `visual-coverage.test.ts` says so.
   */
  readonly noScreenshot?: string;
}

export const ROUTES: readonly VisualRoute[] = [
  { path: '/es', why: 'the home page, ES — the primary locale', proof: 'main h1' },
  {
    path: '/en',
    why: 'the home page, EN — different text lengths, same landmarks',
    proof: 'main h1',
  },
  {
    path: '/es/become-a-pro',
    why: 'AuthWall composed into a page rather than a story',
    proof: 'main h1',
  },
  {
    path: '/es/legal/terms',
    why: 'the pending-content slot, and a route with its own boundary',
    proof: 'main',
  },
  {
    path: '/es/legal/nonsense',
    why: 'the route-level 404 — the header must survive it (MEM-2026-09-11-16)',
    proof: '[data-testid="not-found"]',
  },
  {
    path: '/nope',
    why: 'the shell-level 404 — an unknown :lang (MEM-2026-09-11-17)',
    proof: '[data-status="404"]',
  },
  {
    // W12-T09 correctly made the 500 unreachable: the categories request degrades rather than
    // throwing. So the one surface with no coverage of any kind also had no URL. Spec §10 Q1
    // option A adds a fault trigger that is stripped from any build without the flag — the same
    // resolve-time stripping W12-T08 uses for MSW, never an `import.meta.env` runtime guard.
    path: '/es?__boom=1',
    why: 'the 500 page — the only error surface with no coverage at all',
    proof: '[data-status="500"]',
  },
];

/**
 * `/es/legal/terms` → `route-es-legal-terms`.
 *
 * A baseline filename that says which route it is a picture of. Uniqueness is not assumed here —
 * `visual-coverage.test.ts` asserts it, because two routes slugging to one name would silently
 * leave one of them unwatched while the file count still looked right.
 */
export function baselineName(route: VisualRoute): string {
  const slug = route.path
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `route-${slug}`;
}

/** The routes that are shot, as opposed to the ones that are only walked by axe. */
export function shotRoutes(routes: readonly VisualRoute[] = ROUTES): readonly VisualRoute[] {
  return routes.filter((route) => route.noScreenshot === undefined);
}
