import { defineConfig } from '@playwright/test';
import { VISUAL_CONFIG } from './visual/config.js';

/**
 * The nightly run — `W12-T16`, ADR-012 §6.
 *
 * Two spec files, one browser, one config:
 *
 * - `visual/stories.spec.ts` screenshots the pinned story list against committed baselines.
 * - `visual/routes.spec.ts` runs axe over the storefront's real routes, which `W12-T04`'s gate
 *   cannot reach because the shell is a composition rather than a story (`MEM-2026-09-11-20`).
 *
 * Deliberately **not** wired into `pnpm test`. ADR-012 §5 keeps the stories inside the existing
 * Vitest runner precisely so nobody has to remember a second command; this is the opposite case —
 * a nightly job with committed binary baselines that a pull request must not be gated on, because
 * every legitimate design change would turn a required check red.
 *
 * The values that make it a gate rather than a mood live in `visual/config.ts`, as data, so the
 * unit suite can assert them without booting a browser.
 */
export default defineConfig({
  testDir: './visual',
  // A screenshot that passes on the second attempt is a flake being hidden, and hidden flake is
  // what kills this kind of gate (spec §10 Q4).
  retries: VISUAL_CONFIG.retries,
  updateSnapshots: VISUAL_CONFIG.updateSnapshots,
  // One worker: parallel Chromium instances on a shared runner contend for CPU, and a slow layout
  // is a different layout. Determinism beats the two minutes.
  workers: 1,
  fullyParallel: false,
  reporter:
    process.env['CI'] === 'true'
      ? [
          ['github'],
          ['html', { open: 'never', outputFolder: './visual-report' }],
          // Machine-readable, because the issue the nightly files has to name the failing subjects
          // to be worth opening. `visual/report-cli.ts` reads this.
          ['json', { outputFile: './visual-results/report.json' }],
        ]
      : [['list']],
  outputDir: './visual-results',
  snapshotPathTemplate: './visual/baselines/{arg}{ext}',
  expect: { toHaveScreenshot: VISUAL_CONFIG.expect.toHaveScreenshot },
  use: {
    ...VISUAL_CONFIG.use,
    baseURL: process.env['WORKBENCH_URL'] ?? 'http://127.0.0.1:6007',
  },
  webServer: {
    command: 'node visual/serve.mjs storybook-static 6007',
    url: 'http://127.0.0.1:6007/index.json',
    reuseExistingServer: process.env['CI'] !== 'true',
    timeout: 60_000,
  },
});
