// @vitest-environment node
//
// Filesystem assertions about the route baselines, not DOM ones: under jsdom `import.meta.url` is
// an http URL and `fileURLToPath` rejects it — the same reason `tokens.test.ts` carries this line.
//
// Separate from `visual-coverage.test.ts` because the subjects are different in kind: that file
// derives Storybook ids from story modules and needs the jsdom project to import them. The
// reasoning is the same one, though, and it is the one this repo has had to learn four times — a
// curated list whose completeness nothing asserts is a list that silently stops covering things.
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { baselineName, ROUTES, shotRoutes } from '../visual/routes.js';

describe('W12-T20 AC5 — every shot route has a baseline, and every baseline a route', () => {
  /**
   * The same completeness rule the stories get, applied to the routes.
   *
   * `checkCoverage` is not reused: its subjects are Storybook ids derived from modules, and a route
   * is a path with a proof selector. What *is* reused is the reasoning — a curated list whose
   * completeness nothing asserts is a list that silently stops covering things, which
   * `memory/repo/gotchas.md` now records four times.
   */
  const baselines = fileURLToPath(new URL('../visual/baselines', import.meta.url));

  function routeBaselines(): string[] {
    return readdirSync(baselines)
      .filter((file) => file.startsWith('route-') && file.endsWith('.png'))
      .sort();
  }

  it('shoots at least one route', () => {
    expect(
      shotRoutes().length,
      'no route is shot — the assertions below would pass over nothing',
    ).toBeGreaterThan(0);
  });

  it('gives every route a unique baseline name', () => {
    const names = shotRoutes().map(baselineName);
    expect(new Set(names).size, `two routes slug to one filename: ${names.join(', ')}`).toBe(
      names.length,
    );
  });

  it('has a committed baseline for every shot route', () => {
    const expected = shotRoutes().map((route) => `${baselineName(route)}.png`);
    const present = new Set(routeBaselines());
    const missing = expected.filter((file) => !present.has(file));

    expect(
      missing,
      'a route is shot with no committed baseline — run `visual-baselines.yml` against this branch',
    ).toEqual([]);
  });

  it('keeps no baseline for a route that is gone', () => {
    const expected = new Set(shotRoutes().map((route) => `${baselineName(route)}.png`));
    const orphans = routeBaselines().filter((file) => !expected.has(file));

    expect(
      orphans,
      'a baseline names a route nothing shoots — it was renamed or removed, and the route that replaced it is watched by nobody',
    ).toEqual([]);
  });

  it('makes an unshot route say why', () => {
    const unreasoned = ROUTES.filter(
      (route) => route.noScreenshot !== undefined && route.noScreenshot.trim() === '',
    );
    expect(
      unreasoned.map((route) => route.path),
      'a route opts out of its screenshot with no reason — an excuse nobody wrote is not one',
    ).toEqual([]);
  });
});
