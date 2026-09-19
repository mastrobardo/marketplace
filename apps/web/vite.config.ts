import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { apiProxyPlugin } from './vite/api-proxy.js';

/**
 * Replace the deliberate-fault trigger with a no-op.
 *
 * `W12-T16` needs a URL that reaches the 500 page, because `W12-T09` correctly made it unreachable
 * and left the one surface with no a11y coverage also with no way to visit it. The trigger must not
 * exist anywhere else: a query parameter that 500s the storefront is a denial-of-service primitive
 * if it survives into a real build.
 *
 * A resolve-time stub rather than a runtime guard, so the module graph has no edge to follow —
 * `stripMocks` used the same mechanism until `W3-T01` deleted the thing it stubbed. Rollup resolves
 * a dynamic import while building the graph, before the dead branch is minified away, so a guarded
 * `import()` alone still emits and references the chunk. Measured, not assumed. `mocks.test.ts` asserts both directions
 * of this one too: a flag with two meaningful outcomes gets a test per outcome, because the
 * untested one is the one that ships broken.
 */
function stripFaults(): Plugin {
  const STUB = '\0mp:fault-stub';
  return {
    name: 'mp-strip-faults',
    apply: 'build',
    enforce: 'pre',
    resolveId(source) {
      return source.includes('shared/fault') ? STUB : null;
    },
    load(id) {
      return id === STUB ? 'export function throwIfFaultRequested() {}\n' : null;
    },
  };
}

export default defineConfig(({ mode }) => {
  // Read through `loadEnv` rather than `process.env` so the flag resolves the same way here as it
  // does inside `main.tsx`: one source, so the plugin cannot strip a module the app still imports.
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  /**
   * Never on by default, and never inferred from the mode: the nightly sets it explicitly and
   * nothing else does. There is no deploy that legitimately wants this — it
   * exists so one Playwright navigation can render the 500 page.
   */
  const withFaults = env['VITE_ENABLE_FAULT_ROUTES'] === 'true';

  /**
   * `W0-T28`. Where a deployed `/api/*` request is forwarded to — the Fly app, named at build time
   * because `wrangler pages deploy` cannot hand a variable to the deployment it creates.
   *
   * Unset everywhere else, which is correct everywhere else: in development the dev server's proxy
   * below does the same job, and a build with no API to point at must not ship a worker that
   * forwards to nothing. `vite/api-proxy.ts` emits the file only when this has a value.
   */
  const apiOrigin = env['VITE_API_ORIGIN'];

  return {
    plugins: [
      react(),
      ...(withFaults ? [] : [stripFaults()]),
      apiProxyPlugin(apiOrigin),
    ],
    /**
     * `/api` reaches the API through the dev server, so the browser sees one origin — `W2-T01`
     * §4.7, and the local mirror of what `W0-T28` does in preview and production.
     *
     * `ADR-005` rule 5 put the session in a `SameSite=Lax` cookie and chose a single origin
     * precisely so that credentialed CORS is never needed. Configuring CORS for development only
     * would make the one environment where auth is *developed* the one environment whose cookie
     * behaviour matches nothing that is deployed — and cross-origin cookie failures are silent.
     *
     * `apps/web/src/shared/api.ts` already defaults `baseUrl()` to `/`, so nothing in the app
     * changes; this is the half of that default that has been missing while every page ran on MSW.
     */
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
    },
    build: { outDir: 'dist', sourcemap: true },
  };
});
