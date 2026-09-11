import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { baseVitestConfig } from '@marketplace/config/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, one command. `pnpm test` runs both, so neither can be forgotten — the failure mode
 * `memory/repo/gotchas.md` records for the `database` job, where CI names its suites by hand and a
 * new file is silently skipped while the run stays green.
 *
 * - **unit** (jsdom): the behaviour assertions and the filesystem gates.
 * - **storybook** (a real Chromium): every story rendered, with its `play` function, through
 *   `@storybook/addon-vitest`. This is ADR-012 §5's load-bearing claim — writing a story *is*
 *   writing the component's test — and it needs a browser rather than a document without a layout.
 *   `W12-T04` attaches axe to this same project.
 *
 * A browser is a real prerequisite: `pnpm --filter @marketplace/ui exec playwright install chromium`
 * once, locally and in CI. That is deliberate. The alternative — a separate script CI has to
 * remember to call — is a suite that stops running the first time someone forgets.
 */
const storybookDir = fileURLToPath(new URL('.storybook', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          ...baseVitestConfig.test,
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['./tests/setup.ts'],
          include: ['tests/**/*.test.{ts,tsx}'],
        },
      },
      {
        plugins: [storybookTest({ configDir: storybookDir })],
        test: {
          ...baseVitestConfig.test,
          name: 'storybook',
          // No setup file: since Storybook 10.3 the addon applies `preview.tsx`'s annotations —
          // decorators, globals, parameters — to the browser project itself. A `setProjectAnnotations`
          // call here would be applied twice, and Storybook says so on every run.
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
