import type { ViteUserConfig } from 'vitest/config';

/**
 * Defaults every package inherits. A package overrides `test.environment` (`jsdom` for React)
 * and adds its own `setupFiles`; everything else should stay identical across the workspace so a
 * failure reproduces the same way in every slice.
 */
export const baseVitestConfig: ViteUserConfig = {
  test: {
    environment: 'node',
    globals: false,
    passWithNoTests: true,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['**/dist/**', '**/*.config.*', '**/*.d.ts'],
    },
  },
};

/** Merge the shared defaults with a package's own config. Shallow by design — one level is enough. */
export function defineWorkspaceConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  return {
    ...baseVitestConfig,
    ...overrides,
    test: { ...baseVitestConfig.test, ...overrides.test },
  };
}
