/**
 * A deliberate failure, so that the 500 page can be looked at — `W12-T16` spec §10 Q1, option A.
 *
 * The problem this solves is a good one to have: `W12-T09` shipped with the shell's loader treating
 * `GET /categories` as a precondition, the endpoint 404'd, and the entire deployed storefront became
 * the 500 page over one empty dropdown (`MEM-2026-09-11-21`). The fix — degrade to `[]` — was
 * correct and is why the storefront is deployable at all.
 *
 * It also removed the only way the 500 page was ever reached. So the one surface in the application
 * with **no** automated accessibility coverage of any kind is also the one surface with no URL, and
 * `W12-T16`'s route list could not include it.
 *
 * This module is the trigger, and it exists in a build **only** when `VITE_ENABLE_FAULT_ROUTES` is
 * set. Not behind an `import.meta.env` guard: `MEM-2026-09-11-14` records what that is worth —
 * Rollup resolves a dynamic import while building the module graph, before the dead branch is
 * minified away, which is how 511 KB of MSW and the whole seeded catalogue reached a CDN behind a
 * guard that read as sufficient. `vite.config.ts` replaces this file with a no-op at *resolve*
 * time, so in a normal build the edge does not exist and neither does the trigger.
 */
export function throwIfFaultRequested(request: Request): void {
  const requested = new URL(request.url).searchParams.get('__boom');
  if (requested !== '1') return;

  // Thrown as a `Response`, so React Router routes it to `ErrorBoundary` as a route error with a
  // real status — the same path a genuine loader failure takes. A thrown `Error` would also reach
  // the boundary, but `isRouteErrorResponse` would be false and the page would render the 500 for
  // a different reason than the one being tested.
  throw new Response('Deliberate fault — W12-T16 route coverage', { status: 500 });
}
