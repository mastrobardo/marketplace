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

/**
 * Replace the deliberate-fault trigger with a no-op.
 *
 * `W12-T16` needs a URL that reaches the 500 page, because `W12-T09` correctly made it unreachable
 * and left the one surface with no a11y coverage also with no way to visit it. The trigger must not
 * exist anywhere else: a query parameter that 500s the storefront is a denial-of-service primitive
 * if it survives into a real build.
 *
 * Same mechanism as `stripMocks`, and for the same reason — a resolve-time stub rather than a
 * runtime guard, so the module graph has no edge to follow. `mocks.test.ts` asserts both directions
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
   * A preview or staging deploy keeps its mocks, because ADR-011 §4's "the storefront does not wait
   * for them" is only true if the deployed storefront actually has them. The production release
   * never sets this, so `W1-T09`'s factories cannot reach a real user.
   */
  const withMocks = env['VITE_ENABLE_MOCKS'] === 'true';

  /**
   * Never on by default, and never inferred from the mode: the nightly sets it explicitly and
   * nothing else does. Unlike the mocks flag there is no deploy that legitimately wants this — it
   * exists so one Playwright navigation can render the 500 page.
   */
  const withFaults = env['VITE_ENABLE_FAULT_ROUTES'] === 'true';

  return {
    plugins: [
      react(),
      ...(mode === 'production' && !withMocks ? [stripMocks()] : []),
      ...(withFaults ? [] : [stripFaults()]),
    ],
    server: { host: '127.0.0.1', port: 5173 },
    build: { outDir: 'dist', sourcemap: true },
  };
});
