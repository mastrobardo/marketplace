/**
 * The visual run's settings, as data — `W12-T16` AC8/AC10 and §10 Q4.
 *
 * Kept out of `playwright.config.ts` so that the settings which *are* the gate can be asserted by
 * the unit suite without booting Playwright. Every value here is load-bearing:
 *
 * - `updateSnapshots: 'none'` is spec §10 Q2's answer. Playwright's default writes a missing
 *   baseline and fails, which means the first run after a regression quietly adopts the regression
 *   as the new truth. A baseline is a reviewed artefact or it is nothing.
 * - `reducedMotion: 'reduce'` is why `EXCLUSIONS` is empty: the package's only `@keyframes` —
 *   `Button.module.css`'s spinner — is already `animation: none` under that media query, so the
 *   pending and loading stories become deterministic subjects rather than excluded ones.
 * - `retries: 0` because a screenshot that passes on the second attempt is a flake being hidden,
 *   and §10 Q4's whole argument is that hidden flake is what kills this gate.
 * - `maxDiffPixels` is an **absolute** count, and that is a correction rather than a preference.
 *   This started as `maxDiffPixelRatio: 0.001`, which reads as "a thousandth of the image" and is
 *   in fact a budget of 1,024 pixels on a 1280×800 shot. The AC19 red probe — one pixel of extra
 *   padding on `Card` — moves **511** pixels, so the gate passed a real regression while looking
 *   strict. Measured, not reasoned about: the probe is in the run record.
 *
 *   An absolute budget is the right shape anyway. Anti-aliasing noise does not scale with the
 *   viewport; it is a handful of pixels wherever it happens. A ratio silently buys more tolerance
 *   for bigger screenshots, which is backwards — a bigger screenshot has more to go wrong in.
 *
 *   The ceiling is asserted in a test. If the run is noisy the correct response is to shrink the
 *   pinned list, not to raise this until it goes green.
 */
export const VISUAL_CONFIG = {
  retries: 0,
  updateSnapshots: 'none',
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    // The storefront is ES-first, and React Aria's own strings follow the browser locale.
    locale: 'es-ES',
    // A story that renders a date must not move a pixel because the runner is in another timezone.
    timezoneId: 'Europe/Madrid',
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      // A blinking caret is a diff every other run.
      caret: 'hide',
      scale: 'css',
      maxDiffPixels: 60,
    },
  },
} as const;
