// @vitest-environment node
//
// Reads files, so it needs a real `import.meta.url` — under jsdom that is an http URL and
// `fileURLToPath` rejects it. Same directive, same reason, as `boundaries.test.ts`.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved rather than path-joined: pnpm does not hoist, so `playwright` lives under this
// package's own `node_modules`, not the workspace root's. A relative walk up three directories
// works on npm and silently breaks here.
const resolve = createRequire(import.meta.url).resolve;
import { compareFingerprint, decide, type Fingerprint } from '../visual/environment.js';
import { VISUAL_CONFIG } from '../visual/config.js';

/**
 * `W12-T16` AC5–AC10 — the reference environment, and the two ways a run may not be in it.
 *
 * ADR-012 §6 states the rule in prose: baselines *"are generated **only** inside the CI container
 * image, and a local run does not update them."* A rule stated in prose is a convention; the
 * fingerprint makes it a check.
 *
 * The two directions are asserted separately on purpose. `MEM-2026-09-11-22`: a one-sided assertion
 * about a flag only tests one of its two states, and the untested one is the one that ships broken.
 * Here the untested state would be the dangerous one — CI silently *skipping* the comparison, which
 * `ci.yml`'s own comment already warns about: "GitHub counts a skipped required check as satisfied".
 */

const reference: Fingerprint = {
  image: 'mcr.microsoft.com/playwright',
  imageDigest: 'sha256:aaaa',
  playwright: '1.63.0',
  chromium: '145.0.7632.17',
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
};

describe('W12-T16 AC5 — a matching fingerprint runs the comparison', () => {
  it('reports no mismatches for an identical environment', () => {
    expect(compareFingerprint(reference, { ...reference })).toEqual([]);
  });

  it('decides to run', () => {
    expect(decide([], { ci: true })).toEqual({ action: 'run' });
    expect(decide([], { ci: false })).toEqual({ action: 'run' });
  });

  it.each([
    ['playwright', { playwright: '1.62.0' }],
    ['chromium', { chromium: '144.0.0.0' }],
    ['imageDigest', { imageDigest: 'sha256:bbbb' }],
    ['deviceScaleFactor', { deviceScaleFactor: 2 }],
  ])('notices a difference in %s', (field, override) => {
    const mismatches = compareFingerprint(reference, { ...reference, ...override });

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.field).toBe(field);
  });

  it('notices a viewport difference, comparing by value rather than by reference', () => {
    const mismatches = compareFingerprint(reference, {
      ...reference,
      viewport: { width: 1280, height: 801 },
    });

    expect(mismatches.map((m) => m.field)).toEqual(['viewport']);
  });
});

describe('W12-T16 AC6 — a mismatch in CI fails, and never skips', () => {
  it('fails', () => {
    const mismatches = compareFingerprint(reference, { ...reference, chromium: '144.0.0.0' });
    const decision = decide(mismatches, { ci: true });

    expect(decision.action).toBe('fail');
  });

  it('never returns skip in CI, whatever mismatched', () => {
    for (const override of [{ playwright: 'x' }, { chromium: 'y' }, { imageDigest: 'z' }]) {
      const mismatches = compareFingerprint(reference, { ...reference, ...override });
      expect(decide(mismatches, { ci: true }).action).not.toBe('skip');
    }
  });

  it('says what differed, so the log answers the question without a rerun', () => {
    const mismatches = compareFingerprint(reference, { ...reference, chromium: '144.0.0.0' });
    const decision = decide(mismatches, { ci: true });

    expect(decision.action === 'fail' && decision.reason).toContain('chromium');
    expect(decision.action === 'fail' && decision.reason).toContain('145.0.7632.17');
  });
});

describe('W12-T16 AC7 — a mismatch locally skips, loudly', () => {
  it('skips', () => {
    const mismatches = compareFingerprint(reference, { ...reference, chromium: '144.0.0.0' });

    expect(decide(mismatches, { ci: false }).action).toBe('skip');
  });

  it('prints the reference environment rather than only the delta', () => {
    const mismatches = compareFingerprint(reference, { ...reference, chromium: '144.0.0.0' });
    const decision = decide(mismatches, { ci: false }, reference);

    // A developer seeing this has one question — "what am I supposed to be?" — and the answer is
    // the image, not the field that happened to differ first.
    expect(decision.action === 'skip' && decision.reason).toContain('mcr.microsoft.com/playwright');
  });
});

describe('W12-T16 AC8 — a missing baseline fails and writes nothing', () => {
  it('pins updateSnapshots to "none"', () => {
    // Playwright's default is to *create* a missing snapshot and fail the run, which means the first
    // run after a regression blesses the regression as the new truth. Spec §10 Q2 chose to fail.
    expect(VISUAL_CONFIG.updateSnapshots).toBe('none');
  });

  it('is a real Playwright option and not a hopeful string', () => {
    // `playwright`'s `exports` map does not expose `./types/*`, so the package root is resolved
    // through the one subpath it does export and the file is read from beside it.
    const root = dirname(resolve('playwright/package.json'));
    const types = readFileSync(join(root, 'types', 'test.d.ts'), 'utf8');

    expect(types).toContain('updateSnapshots?: "all"|"changed"|"missing"|"none"');
  });
});

describe('W12-T16 AC10/Q4 — the flake mitigations are configuration, so assert the configuration', () => {
  it('forces reduced motion, which is what makes the pending stories deterministic', () => {
    // Button.module.css sets `animation: none` under prefers-reduced-motion. That is why
    // `EXCLUSIONS` is empty — see visual/pinned.ts.
    expect(VISUAL_CONFIG.use.reducedMotion).toBe('reduce');
  });

  it('disables animations at capture time as well', () => {
    expect(VISUAL_CONFIG.expect.toHaveScreenshot.animations).toBe('disabled');
  });

  it('allows a small non-zero pixel budget, and a small one', () => {
    const allowed = VISUAL_CONFIG.expect.toHaveScreenshot.maxDiffPixelRatio;

    expect(allowed).toBeGreaterThan(0);
    // Q4: if the run is flaky, the correct response is to shrink the pinned list, not to raise this
    // until it is green. A ceiling in a test is how that stays true under deadline pressure.
    expect(allowed).toBeLessThanOrEqual(0.002);
  });

  it('pins a fixed viewport and scale, because a baseline is only valid for one', () => {
    expect(VISUAL_CONFIG.use.viewport).toEqual({ width: 1280, height: 800 });
    expect(VISUAL_CONFIG.use.deviceScaleFactor).toBe(1);
  });

  it('retries nothing — a screenshot that passes on retry is a flake being hidden', () => {
    expect(VISUAL_CONFIG.retries).toBe(0);
  });
});

describe('W12-T16 — the committed fingerprint is the one the config describes', () => {
  it('agrees with the Playwright version this package resolves', () => {
    const committed = JSON.parse(
      readFileSync(fileURLToPath(new URL('../visual/fingerprint.json', import.meta.url)), 'utf8'),
    ) as Fingerprint;
    const installed = JSON.parse(readFileSync(resolve('playwright/package.json'), 'utf8')) as {
      version: string;
    };

    // The container image tag and the installed Playwright must be the same version, or the
    // browser in the image is not the browser the tests drive.
    expect(committed.playwright).toBe(installed.version);
    expect(committed.image).toContain('mcr.microsoft.com/playwright');
    expect(committed.viewport).toEqual(VISUAL_CONFIG.use.viewport);
  });
});
