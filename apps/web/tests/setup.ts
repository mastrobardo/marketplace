/**
 * jsdom starts every file with a fresh document, but `document.documentElement.lang` is set by
 * i18next's language-change side effect and would otherwise leak between tests in the same file.
 *
 * Guarded: `setupFiles` runs for every suite, including the ones pinned to the node environment
 * (`tests/i18n.test.ts`, `tests/tokens.test.ts`), where there is no document.
 */
import { beforeEach } from 'vitest';

beforeEach(() => {
  if (typeof document !== 'undefined') document.documentElement.lang = '';
});
