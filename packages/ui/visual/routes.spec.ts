import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

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

interface Route {
  readonly path: string;
  readonly why: string;
  /** A selector that proves the intended page rendered, rather than a 200 with the wrong content. */
  readonly proof: string;
}

const ROUTES: readonly Route[] = [
  { path: '/es', why: 'the home page, ES — the primary locale', proof: 'main h1' },
  {
    path: '/en',
    why: 'the home page, EN — different text lengths, same landmarks',
    proof: 'main h1',
  },
  {
    path: '/es/become-a-pro',
    why: 'AuthWall composed into a page rather than a story',
    proof: 'main h1',
  },
  {
    path: '/es/legal/terms',
    why: 'the pending-content slot, and a route with its own boundary',
    proof: 'main',
  },
  {
    path: '/es/legal/nonsense',
    why: 'the route-level 404 — the header must survive it (MEM-2026-09-11-16)',
    proof: '[data-testid="not-found"]',
  },
  {
    path: '/nope',
    why: 'the shell-level 404 — an unknown :lang (MEM-2026-09-11-17)',
    proof: '[data-status="404"]',
  },
  {
    // W12-T09 correctly made the 500 unreachable: the categories request degrades rather than
    // throwing. So the one surface with no coverage of any kind also had no URL. Spec §10 Q1
    // option A adds a fault trigger that is stripped from any build without the flag — the same
    // resolve-time stripping W12-T08 uses for MSW, never an `import.meta.env` runtime guard.
    path: '/es?__boom=1',
    why: 'the 500 page — the only error surface with no coverage at all',
    proof: '[data-status="500"]',
  },
];

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
