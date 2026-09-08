import { createEslintConfig } from '@marketplace/config/eslint';

export default [
  // Each workspace member lints itself with its own flat config; the root covers what is left.
  ...createEslintConfig({ ignores: ['apps/**', 'packages/**'] }),
  {
    // `scripts/` are operator CLIs — stdout is their interface, not a debugging leftover.
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
