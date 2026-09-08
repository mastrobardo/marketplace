import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // The API is deployed as a container with its node_modules (W0-T07), so bundling dependencies
  // would only make stack traces worse.
  skipNodeModulesBundle: true,
});
