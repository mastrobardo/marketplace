/**
 * The mock worker — started in development, absent from production.
 *
 * This directory is a sibling of `src/`, not a child, and that is structural rather than stylistic:
 * `packages/testing/tests/factories.test.ts` walks every `.ts`/`.tsx` under `apps/web/src` and fails
 * on the string `@marketplace/testing`. The factories are a `devDependency`, a production module
 * importing them is exactly what `W1-T09` built that gate for, and `handlers.ts` imports them by
 * design. So the handlers cannot live under `src` — and should not, because they must not ship.
 *
 * `src/main.tsx` reaches this file through a dynamic import guarded by `import.meta.env.DEV`, which
 * Vite replaces with the literal `false` in a production build — so Rollup drops the branch and the
 * import with it. `tests/mocks.test.ts` AC17 asserts that against the real build output rather than
 * trusting it, because "tree-shaken, surely" is how a test-data package reaches production.
 */
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers.js';

export const worker = setupWorker(...handlers);

export async function startMocks(): Promise<void> {
  await worker.start({
    // A request no handler claims is the real thing going out, not a silent 404 — `GET /categories`
    // becoming real (`W3-T01`) should just start working, without a code change here.
    onUnhandledRequest: 'bypass',
    quiet: true,
  });
}
