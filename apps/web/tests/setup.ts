/**
 * jsdom starts every file with a fresh document, but `document.documentElement.lang` is set by
 * i18next's language-change side effect and would otherwise leak between tests in the same file.
 *
 * Guarded: `setupFiles` runs for every suite, including the ones pinned to the node environment
 * (`tests/i18n.test.ts`, `tests/tokens.test.ts`), where there is no document.
 */
import { configure } from '@testing-library/dom';
import { beforeEach } from 'vitest';

/**
 * Testing Library's `findBy*` helpers wait **1000 ms** by default, and this suite runs close enough
 * to that on a loaded CI runner to tip over. Measured, not guessed — three runs across two
 * unrelated pull requests, none of which touched `apps/web`:
 *
 *   #263  results.test.tsx AC1  1323 ms
 *   #264  results.test.tsx AC1  1285 ms, then 1253 ms on the re-run
 *
 * Every one within ~300 ms of the default, and always the **first** test in its file — the one
 * paying for i18n setup, the first React render and the lazy route chunk. Raising the wait does not
 * make a slow page pass: a test that never renders still fails, five seconds later. What it removes
 * is a red check that says nothing about the change under review.
 *
 * `W3-T02`, on the operator's call — the suite belongs to `agent-ui`/`agent-qa`.
 */
configure({ asyncUtilTimeout: 5_000 });

beforeEach(() => {
  if (typeof document !== 'undefined') document.documentElement.lang = '';
});
