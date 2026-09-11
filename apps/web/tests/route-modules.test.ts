// @vitest-environment node
//
// ADR-011 R1 and R2, enforced years before anyone tries to server-render this application.
//
// The environment is the whole point: `node`, with no DOM. A route module that cannot be *imported*
// without a browser is the single most common SSR migration failure, and it is invisible in an
// application that only ever loads in a browser. This suite fails on the day the mistake is made
// rather than on the day `W12-T14` tries to flip the switch.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src', import.meta.url));

/**
 * Statically analysable, so vite-node can transform every route module up front. A dynamic
 * specifier built from `readdirSync` would resolve at runtime and quietly find nothing.
 */
const modules = import.meta.glob('../src/routes/*.tsx');

/** ADR-011 R1: "a route module exports `loader`, `Component`, and where relevant `ErrorBoundary` and `meta`. Nothing else." */
const ALLOWED = new Set([
  'Component',
  'loader',
  'action',
  'ErrorBoundary',
  // `W12-T09`: what the router renders while a loader is in flight. R1 names `ErrorBoundary` and
  // `meta` as the "where relevant" exports and predates this one, but it is the same kind of thing —
  // a component the *router* calls, not application code the route is leaking. Without it React
  // Router warns and renders nothing during hydration, which is a blank page on a cold load.
  'HydrateFallback',
  'meta',
  'handle',
  'shouldRevalidate',
]);

describe('AC8 — every route module imports without a DOM', () => {
  it('finds route modules at all', () => {
    // Without this, an empty glob makes every assertion below vacuously true.
    expect(Object.keys(modules).length, 'no route modules found under src/routes').toBeGreaterThan(
      0,
    );
  });

  for (const [path, load] of Object.entries(modules)) {
    it(`imports ${basename(path)} in a node environment`, async () => {
      await expect(load()).resolves.toBeTruthy();
    });
  }
});

describe('AC9 — a route module exports a route and nothing else', () => {
  for (const [path, load] of Object.entries(modules)) {
    it(`${basename(path)} exports only the route contract`, async () => {
      const module = (await load()) as Record<string, unknown>;
      const exported = Object.keys(module);

      expect(exported, `${basename(path)} exports no Component`).toContain('Component');
      expect(
        exported.filter((name) => !ALLOWED.has(name)),
        `${basename(path)} exports something the router will never call — move it to src/shared`,
      ).toEqual([]);
    });
  }
});

describe('AC10 — the route table is assembled from route modules only', () => {
  it('imports every file in src/routes and has no pages directory left', () => {
    expect(existsSync(`${src}/pages`), 'src/pages still exists').toBe(false);

    const table = readFileSync(`${src}/app/routes.tsx`, 'utf8');
    const files = readdirSync(`${src}/routes`).filter((name) => name.endsWith('.tsx'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const stem = basename(file, '.tsx');
      expect(table, `routes.tsx does not import ${file}`).toContain(`routes/${stem}.js`);
    }
  });
});
