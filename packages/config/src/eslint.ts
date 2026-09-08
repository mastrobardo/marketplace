import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export interface EslintConfigOptions {
  /** Extra ignore globs on top of the repo-wide ones. */
  ignores?: string[];
  /** Globals to expose. `node` suits services and tooling, `browser` suits `apps/web`. */
  environment?: 'node' | 'browser';
}

const REPO_IGNORES = ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'];

/**
 * The shared flat config. Rules here are syntactic only — no `projectService`, so linting stays
 * fast enough for the ~10 minute PR budget in `agents/roles/agent-devops.md`. A package that wants
 * type-aware rules layers them on top of this array itself.
 */
export function createEslintConfig(
  options: EslintConfigOptions = {},
): ReturnType<typeof tseslint.config> {
  const { ignores = [], environment = 'node' } = options;

  return tseslint.config(
    { ignores: [...REPO_IGNORES, ...ignores] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: environment === 'browser' ? globals.browser : globals.node,
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        // TODO.md §2 rule 4: money is integer cents. Floats are how reconciliation breaks.
        'no-restricted-syntax': [
          'error',
          {
            selector: 'TSTypeAnnotation > TSNumberKeyword[parent.parent.key.name=/[Aa]mount$/]',
            message:
              'Money is integer cents — use a Money type from packages/contracts, not number.',
          },
        ],
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'no-console': ['error', { allow: ['warn', 'error'] }],
      },
    },
    // Last, so it wins: turn off everything Prettier owns.
    prettier,
  );
}
