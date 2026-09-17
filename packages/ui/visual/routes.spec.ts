import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { compareFingerprint, decide } from './environment.js';
import { actualFingerprint, isCI, referenceFingerprint } from './probe.js';
import { baselineName, ROUTES, shotRoutes } from './routes.js';

/**
 * Axe over the storefront's real routes — `W12-T16` AC11/AC12, and the older half of the ticket.
 *
 * `W12-T04` runs axe against every story and fails the build on a violation. It is the strongest
 * gate this package has and it covers *components*. The shell `W12-T09` built is not a component
 * and will not become one: making it a story means mounting the router and a `QueryClient` inside
 * Storybook. So the skip link, the landmark set, the header's compact search, the language switcher
 * and both error pages have had **no automated a11y coverage at all** — agreed with the operator on
 * 2026-09-11 and recorded as `MEM-2026-09-11-20`.
 *
 * `shell.test.tsx` AC11 and `home.test.tsx` AC10 check landmark presence and name-uniqueness by
 * hand, which is strictly weaker: `MEM-2026-09-11-35` is three `<section>` elements that were
 * invisible to the accessibility tree for an entire ticket, pixel-identical to correct markup,
 * passing every test, because an `aria-labelledby` id had been built from a translated string.
 *
 * The app is served by the workflow, not by this config — `WEB_BASE_URL` is the seam. That keeps
 * `packages/ui` from knowing how `apps/web` is built, which is ADR-012 §1's boundary and the reason
 * `boundaries.test.ts` exists.
 */

const base = process.env['WEB_BASE_URL'];

test.describe('W12-T16 AC11/AC12 — the real routes pass axe', () => {
  test.skip(base === undefined, 'WEB_BASE_URL is not set — the storefront is not being served.');

  for (const route of ROUTES) {
    test(`${route.path} — ${route.why}`, async ({ page }) => {
      const response = await page.goto(`${base}${route.path}`);

      // The SPA answers 200 for every path today, including real 404s — that is `W12-T14`'s debt,
      // measured in `MEM-2026-09-11-17`. So the assertion is on what rendered, not on the status.
      expect(response, `no response for ${route.path}`).not.toBeNull();
      await page.waitForSelector(route.proof, { state: 'visible', timeout: 15_000 });

      const results = await new AxeBuilder({ page })
        // The same ruleset `W12-T04` runs, so a violation means the same thing on a page as it does
        // on a story. Narrowing it here would make the two gates disagree about what "accessible"
        // means, which is worse than either standard alone.
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // An axe run that never injected would also report zero violations, and this whole suite
      // would be a confident green over nothing — the failure class `MEM-2026-09-11-29` names and
      // `W12-T04` proved its own gate against. `passes` is the rules that ran and were satisfied,
      // so a non-empty list is evidence the page was actually examined.
      expect(results.passes.length, `axe examined nothing on ${route.path}`).toBeGreaterThan(0);

      // The failure message has to be actionable without opening the run: rule id, the element, and
      // which route it was on.
      const readable = results.violations.map((v) => ({
        rule: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => n.target.join(' ')),
      }));

      expect(readable, `axe violations on ${route.path}`).toEqual([]);
    });
  }
});

test.describe('W12-T20 — the storefront looks the way it looked', () => {
  test.skip(base === undefined, 'WEB_BASE_URL is not set — the storefront is not being served.');

  /**
   * Why a page needs a picture when it already has axe.
   *
   * From `W12-T01` until `W2-T09`, `apps/web` imported the design system's tokens and never its
   * component stylesheet, so every React Aria control in the product rendered as a raw browser
   * widget. Seven page tickets shipped over it and five suites ran against it. The a11y tree was
   * correct throughout — roles, names and landmarks do not depend on CSS — so the axe pass above
   * was green on every one of these routes while the storefront looked unfinished.
   *
   * A screenshot is the only assertion in this repo that can see that class of defect, and the
   * routes are where it has to be made: the stories were never affected, because Storybook's
   * preview has always loaded the stylesheet.
   */
  test('the route list is not empty', () => {
    expect(
      shotRoutes().length,
      'no route is being shot — this suite proves nothing',
    ).toBeGreaterThan(0);
    // Two routes slugging to one filename would leave one of them silently unwatched.
    const names = shotRoutes().map(baselineName);
    expect(new Set(names).size, `two routes share a baseline name: ${names.join(', ')}`).toBe(
      names.length,
    );
  });

  for (const route of shotRoutes()) {
    test(`${baselineName(route)} — ${route.why}`, async ({ page }) => {
      const reference = referenceFingerprint();
      const mismatches = compareFingerprint(
        reference,
        actualFingerprint(page.context().browser()?.version() ?? ''),
      );
      const decision = decide(mismatches, { ci: isCI() }, reference);

      // Same rule as the stories: baselines are container artefacts. In CI the fingerprint test
      // has already failed the run; locally this is what stops a developer generating seven diffs
      // that are all font smoothing.
      if (decision.action === 'skip') test.skip(true, decision.reason);

      await page.goto(`${base}${route.path}`);
      await page.waitForSelector(route.proof, { state: 'visible', timeout: 15_000 });
      await page.waitForFunction(() => document.fonts.status === 'loaded');

      await expect(page.locator('body')).toHaveScreenshot(`${baselineName(route)}.png`, {
        fullPage: true,
      });
    });
  }
});
