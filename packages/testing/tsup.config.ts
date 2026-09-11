import { defineConfig } from 'tsup';

/**
 * ESM only, and no `external` list: this package has no runtime dependencies at all. That is
 * deliberate — `FactoryClient` is a structural interface rather than `PrismaClient` (spec §4.3
 * Decision D), so nothing here needs the query engine, and `apps/web`'s browser test bundle stays
 * clean.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
