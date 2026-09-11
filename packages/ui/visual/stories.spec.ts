import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareFingerprint, decide } from './environment.js';
import { actualFingerprint, isCI, referenceFingerprint } from './probe.js';
import { diffIdsAgainstIndex } from './index-check.js';
import { EXCLUSIONS, PINNED, type PinnedEntry } from './pinned.js';
import { type StoryGlobals } from './coverage.js';
import { type StorybookIndex } from './index-check.js';

/**
 * The pinned story list, shot and compared — `W12-T16` AC8/AC9/AC10.
 *
 * The subjects come from `storybook-static/index.json`, which is the set the browser can actually
 * render. `tests/visual-coverage.test.ts` derives the same set from the story modules so that it
 * can gate a pull request without a Storybook build; the two derivations are compared here, where
 * the index is already built and the check costs nothing (§4.1).
 */

const DEFAULT_MATRIX: StoryGlobals[] = [{ theme: 'default', scheme: 'light', locale: 'es-ES' }];

function globalsParam(globals: StoryGlobals): string {
  const pairs = [`theme:${globals.theme}`, `scheme:${globals.scheme}`];
  if (globals.locale !== undefined) pairs.push(`locale:${globals.locale}`);
  return pairs.join(';');
}

/** `<id>` or `<id>--theme-scheme-locale` — a baseline filename that says what it is a baseline of. */
function subjectName(entry: PinnedEntry, globals: StoryGlobals): string {
  const isDefault =
    globals.theme === 'default' && globals.scheme === 'light' && globals.locale === 'es-ES';
  return isDefault
    ? entry.id
    : `${entry.id}__${globals.theme}-${globals.scheme}-${globals.locale ?? 'es-ES'}`;
}

function index(): StorybookIndex {
  // Read from the built workbench rather than fetched over HTTP: if the build is missing, the right
  // failure is "you did not build the workbench", not a 404 halfway through a screenshot run.
  const path = fileURLToPath(new URL('../storybook-static/index.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as StorybookIndex;
}

test.describe('W12-T16 — the reference environment', () => {
  test('this run is in it, or it says which it is in', async ({ browser }) => {
    const reference = referenceFingerprint();
    const mismatches = compareFingerprint(reference, actualFingerprint(browser.version()));
    const decision = decide(mismatches, { ci: isCI() }, reference);

    if (decision.action === 'fail') throw new Error(decision.reason);
    if (decision.action === 'skip') test.skip(true, decision.reason);

    expect(mismatches).toEqual([]);
  });
});

test.describe('W12-T16 — the enumerations agree', () => {
  test('the pinned list and Storybook’s index describe the same set of stories', async () => {
    // `tests/visual-coverage.test.ts` asserts, per pull request, that the pinned list equals the
    // set derived from the story modules. This asserts that the pinned list equals what Storybook
    // actually built. The two together are §4.1's guarantee — derivation == pinned == index — and
    // each half is checked where it is free.
    const listed = [...PINNED.map((entry) => entry.id), ...EXCLUSIONS.map((entry) => entry.id)];
    const diff = diffIdsAgainstIndex(listed, index());

    expect(
      diff.missingFromDerivation,
      'Storybook built stories the pinned list has never heard of',
    ).toEqual([]);
    expect(diff.missingFromIndex, 'the pinned list names stories Storybook did not build').toEqual(
      [],
    );
  });
});

test.describe('W12-T16 — the pinned stories look the way they looked', () => {
  // Guard rather than assume: a `PINNED` that silently emptied would make every assertion below
  // vacuous and the suite would report a confident green over nothing.
  test('the pinned list is not empty', () => {
    expect(PINNED.length).toBeGreaterThan(0);
    expect(PINNED.length + EXCLUSIONS.length).toBeGreaterThan(50);
  });

  for (const entry of PINNED) {
    for (const globals of entry.matrix ?? DEFAULT_MATRIX) {
      const name = subjectName(entry, globals);

      test(name, async ({ page }) => {
        const reference = referenceFingerprint();
        const mismatches = compareFingerprint(
          reference,
          actualFingerprint(page.context().browser()?.version() ?? ''),
        );
        const decision = decide(mismatches, { ci: isCI() }, reference);

        // In CI the fingerprint test above has already failed the run; here the skip is what keeps
        // a local invocation from producing 74 diffs that are all font smoothing.
        if (decision.action === 'skip') test.skip(true, decision.reason);

        await page.goto(
          `/iframe.html?id=${encodeURIComponent(entry.id)}` +
            `&viewMode=story&globals=${encodeURIComponent(globalsParam(globals))}`,
        );

        // Storybook signals a rendered story on the root element. Waiting for it rather than for a
        // timeout is the difference between a stable baseline and a race that fails every tenth run.
        await page.waitForSelector('#storybook-root', { state: 'attached' });
        await page.waitForFunction(() => document.fonts.status === 'loaded');
        await expect(page.locator('body')).toHaveScreenshot(`${name}.png`, { fullPage: true });
      });
    }
  }
});
