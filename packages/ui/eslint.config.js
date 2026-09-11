import globals from 'globals';
import { createEslintConfig } from '@marketplace/config/eslint';

export default [
  ...createEslintConfig({
    environment: 'browser',
    // `storybook-static/` is build output. It is gitignored, but ESLint does not read `.gitignore`,
    // so the first person to run `build:storybook` before `lint` gets twenty thousand errors from
    // bundled vendor code. Found exactly that way while building `W12-T16`.
    ignores: ['storybook-static/**', 'visual-results/**', 'visual-report/**'],
  }),
  {
    // The visual runner is Node, not a browser: it reads the filesystem, resolves packages and
    // serves files. The package is `browser` because everything else in it renders.
    files: ['visual/**/*.{ts,mjs}', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
];
