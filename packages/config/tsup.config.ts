import { defineConfig } from 'tsup';

/**
 * Presets are authored in TypeScript and shipped as dual ESM/CJS with declarations, so a consumer
 * gets the same config whether it loads `eslint.config.js` (ESM) or a CJS tool requires it.
 * The tsconfig presets are plain JSON and are published as-is — `extends` cannot read a bundle.
 */
export default defineConfig({
  entry: ['src/eslint.ts', 'src/prettier.ts', 'src/vitest.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // Peers and lint plugins stay external: bundling ESLint into a config would be absurd.
  external: ['eslint', 'prettier', 'typescript', 'vitest', 'vitest/config'],
});
