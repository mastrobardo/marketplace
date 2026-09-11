import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Replace the MSW entry point with a no-op.
 *
 * `src/main.tsx` already guards the import, and that guard is not enough on its own: Rollup resolves
 * a dynamic import while building the module graph, before the dead branch is minified away, so the
 * chunk is emitted **and referenced** by the entry. Measured, not assumed — `W12-T08` AC17 failed on
 * exactly this, with 511 KB of MSW and the seeded provider catalogue in `dist/assets/browser-*.js`.
 *
 * A guard that depends on a bundler's dead-code elimination is a hope. This is the graph edge not
 * existing: the module resolves to two empty exports, so there is nothing to follow and nothing to
 * emit.
 */
function stripMocks(): Plugin {
  const STUB = '\0mp:mocks-stub';
  return {
    name: 'mp-strip-mocks',
    apply: 'build',
    enforce: 'pre',
    resolveId(source) {
      return source.includes('mocks/browser') ? STUB : null;
    },
    load(id) {
      return id === STUB
        ? 'export const worker = undefined;\nexport async function startMocks() {}\n'
        : null;
    },
  };
}

export default defineConfig(({ mode }) => {
  // Read through `loadEnv` rather than `process.env` so the flag resolves the same way here as it
  // does inside `main.tsx`: one source, so the plugin cannot strip a module the app still imports.
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  /**
   * A preview or staging deploy keeps its mocks, because ADR-011 §4's "the storefront does not wait
   * for them" is only true if the deployed storefront actually has them. The production release
   * never sets this, so `W1-T09`'s factories cannot reach a real user.
   */
  const withMocks = env['VITE_ENABLE_MOCKS'] === 'true';

  return {
    plugins: [react(), ...(mode === 'production' && !withMocks ? [stripMocks()] : [])],
    server: { host: '127.0.0.1', port: 5173 },
    build: { outDir: 'dist', sourcemap: true },
  };
});
