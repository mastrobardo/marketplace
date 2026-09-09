import { createEslintConfig } from '@marketplace/config/eslint';

export default [
  ...createEslintConfig(),
  {
    // `prisma/` holds operator CLIs (`db:seed`, `db:reset`) — stdout is their interface, the same
    // exception the repo root makes for `scripts/`.
    files: ['prisma/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
