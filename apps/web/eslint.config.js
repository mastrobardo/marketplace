import { createEslintConfig } from '@marketplace/config/eslint';
import { routeRulesPlugin } from './eslint/route-rules.js';

/**
 * The shared config, plus ADR-011's route rules over the two trees the ADR names.
 *
 * Layered here rather than added to `@marketplace/config` on purpose (MEM-2026-09-08-02 allows a
 * package its own override with a reason): these rules encode a decision about *this* application's
 * rendering, and there is one consumer. They move to the shared preset as an `agent-devops` change
 * when the back office (`W9`) becomes the second.
 *
 * `src/features/**` does not exist yet. Linting a path before it exists costs nothing and is the
 * point — the first slice agent to create it finds the rules already true.
 */
export default [
  ...createEslintConfig({ environment: 'browser' }),
  {
    files: ['src/routes/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}'],
    plugins: { mp: routeRulesPlugin },
    rules: {
      'mp/no-module-scope-browser-global': 'error',
      'mp/no-module-scope-mutable': 'error',
      'mp/no-fetch-in-component': 'error',
    },
  },
];
