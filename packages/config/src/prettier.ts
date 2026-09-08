import type { Config } from 'prettier';

/**
 * The single formatting authority for the repo. ESLint never reformats — see `./eslint.ts`,
 * which layers `eslint-config-prettier` last so the two cannot disagree.
 */
const prettierConfig: Config = {
  singleQuote: true,
  semi: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  endOfLine: 'lf',
};

export default prettierConfig;
