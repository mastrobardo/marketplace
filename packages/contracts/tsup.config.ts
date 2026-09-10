import { defineConfig } from 'tsup';

/**
 * ESM only. Both consumers are `"type": "module"` — the dual build `@marketplace/config` needs
 * exists because ESLint and Prettier may load a config from CJS, and nothing here is a tool config.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // zod is a real runtime dependency of every consumer; bundling a copy would give the API two zods
  // and make `instanceof z.ZodError` fail across the boundary.
  external: ['zod'],
});
