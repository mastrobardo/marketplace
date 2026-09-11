import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Replace the MSW entry point with a no-op in any production build.
 *
 * `src/main.tsx` already guards the import with `import.meta.env.DEV`, and that guard is not enough:
 * Rollup resolves a dynamic import while building the module graph, before the `false` branch is
 * minified away, so the chunk is emitted **and referenced** by the entry. Measured, not assumed —
 * `W12-T08` AC17 failed on exactly this, with 511 KB of MSW and the seeded provider catalogue in
 * `dist/assets/browser-*.js`.
 *
 * A guard that depends on a bundler's dead-code elimination is a hope. This is the graph edge not
 * existing: in a production build the module resolves to two empty exports, so there is nothing for
 * Rollup to follow and nothing for it to emit.
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

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'production' ? [stripMocks()] : [])],
  server: { host: '127.0.0.1', port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
}));
