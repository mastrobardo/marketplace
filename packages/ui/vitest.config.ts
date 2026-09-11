import react from '@vitejs/plugin-react';
import { defineWorkspaceConfig } from '@marketplace/config/vitest';

/**
 * jsdom, because a component test that never renders is a type test. The two filesystem suites
 * (`tokens.test.ts`, `boundaries.test.ts`) pin themselves back to `node` with a docblock, the way
 * `apps/web` already does — under jsdom `import.meta.url` is an http URL and `fileURLToPath`
 * rejects it.
 *
 * `W12-T03` adds the browser project that runs the same stories in a real browser through
 * `@storybook/addon-vitest`. These jsdom tests are what make that a runner change rather than a
 * rewrite of forty stories.
 */
export default defineWorkspaceConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'] },
});
