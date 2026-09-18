// @vitest-environment node
//
// `W12-T08` AC13..AC18 — the storefront's mocks are the contract, and they do not ship.
//
// Two properties, and neither is about whether the handlers "work". The first is that the data came
// from `packages/testing` rather than from a second fixture set (ADR-011 §4, `W1-T09`). The second
// is that none of it reaches production, which is a claim about a build and is therefore checked
// against one.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ID_PREFIXES } from '@marketplace/testing';
import { CategoryListSchema } from '@marketplace/contracts';
import { setupServer } from 'msw/node';
import { buildCatalogue } from '../mocks/catalogue.js';
import { handlers } from '../mocks/handlers.js';

const webRoot = fileURLToPath(new URL('..', import.meta.url));

const server = setupServer(...handlers);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const categories = async (locale = 'es') => {
  const response = await fetch('http://api.test/categories', {
    headers: { 'accept-language': locale },
  });
  return { status: response.status, body: (await response.json()) as unknown };
};

describe('AC13 — every row came from a factory', () => {
  it('carries the per-entity id prefix a hand-written row could not forge', () => {
    const catalogue = buildCatalogue();

    expect(catalogue.categories.length).toBeGreaterThan(0);
    expect(catalogue.providers.length).toBeGreaterThan(0);

    for (const category of catalogue.categories) {
      expect(category.id, `${category.slug} did not come from buildCategory`).toMatch(
        new RegExp(`^${ID_PREFIXES.Category}-`),
      );
    }
    for (const provider of catalogue.providers) {
      expect(
        provider.profile.id,
        `${provider.profile.displayName} did not come from buildProviderProfile`,
      ).toMatch(new RegExp(`^${ID_PREFIXES.ProviderProfile}-`));
      expect(provider.address.id).toMatch(new RegExp(`^${ID_PREFIXES.Address}-`));
    }
  });

  it('rebuilds identically, so a dev server boots the same world twice', () => {
    const first = buildCatalogue();
    const second = buildCatalogue();
    expect(second.providers.map((p) => p.profile.id)).toEqual(
      first.providers.map((p) => p.profile.id),
    );
  });
});

/**
 * `W3-T10` deleted the search and provider handlers: `GET /api/search` and `GET /api/providers/:id`
 * are real, and a demo seeder now fills the database they read. What is left of `handlers.ts` is
 * `GET /categories`, which `W3-T01` owns and which `BD-07` blocks.
 *
 * AC14–AC16 were `W12-T08`'s criteria *about the contract*, asserted through the handler that went.
 * They are not dropped — they are re-homed on the real endpoints, and
 * `docs/specs/S3/W3-T10-demo-provider-seeder.md` §3.1 is the mapping:
 *
 *   AC14  a search body satisfies SearchResponseSchema  → apps/api/tests/seed-live.test.ts
 *   AC15  a rejected query is a 400 envelope            → apps/api/tests/search.test.ts
 *   AC16  `what` filters, facets count the matched set  → apps/api/tests/search-live.test.ts
 *   AC16  `mode=booking` excludes the quote-only one    → apps/api/tests/{search,seed}-live.test.ts
 *
 * `W12-T12`'s AC10–AC13, asserted through the provider handler, go the same way:
 *
 *   AC10  a seeded id parses as the contract, no leaks   → apps/api/tests/provider{,-live}.test.ts
 *   AC11  every search result id resolves, so no 404     → apps/api/tests/seed-live.test.ts
 *   AC12  an unseeded uuid is a NOT_FOUND envelope       → apps/api/tests/provider{,-live}.test.ts
 *   AC13  a malformed id is VALIDATION_FAILED, not 404   → apps/api/tests/provider.test.ts
 *
 * AC11 is the one that was worth having — it checks that the two endpoints agree with each other,
 * which is the failure that reaches a visitor as a working list of links to nothing. It is now
 * asserted over the seeded world, where the two endpoints are the real ones.
 */
describe('the one handler left answers the contract', () => {
  it('serves a category list the contract accepts', async () => {
    const { status, body } = await categories();
    expect(status).toBe(200);

    const parsed = CategoryListSchema.safeParse(body);
    expect(
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    ).toEqual([]);
  });

  it('answers in the language the request asked for', async () => {
    const es = CategoryListSchema.parse((await categories('es')).body);
    const en = CategoryListSchema.parse((await categories('en')).body);

    expect(es.items.map((item) => item.slug)).toEqual(en.items.map((item) => item.slug));
    expect(es.items.map((item) => item.name)).not.toEqual(en.items.map((item) => item.name));
  });

  it('is the only handler, now that search and providers are real', async () => {
    // `onUnhandledRequest: 'error'` in this file's server: a request no handler claims throws
    // rather than falling through, so this asserts the deletion rather than trusting it.
    expect(handlers).toHaveLength(1);
    await expect(fetch('http://api.test/search?where=28013')).rejects.toThrow();
  });
});

describe('AC17..AC18 — none of this ships, and all of it is typechecked', () => {
  it('AC18 — the mocks are inside the tsconfig include', () => {
    const tsconfig = JSON.parse(readFileSync(join(webRoot, 'tsconfig.json'), 'utf8')) as {
      include: string[];
    };
    expect(tsconfig.include, 'mocks/** is not typechecked').toContain('mocks/**/*.ts');
  });

  it('AC18 — msw and the factories are devDependencies, never runtime ones', () => {
    const manifest = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const testOnly of ['msw', '@marketplace/testing']) {
      expect(
        manifest.devDependencies?.[testOnly],
        `${testOnly} is not a devDependency`,
      ).toBeDefined();
      expect(
        manifest.dependencies?.[testOnly],
        `${testOnly} is a runtime dependency`,
      ).toBeUndefined();
    }
  });

  /** Every emitted JS chunk, by path — what "its own chunk" is a claim about. */
  function bundledChunks(env: NodeJS.ProcessEnv = {}): { path: string; source: string }[] {
    execFileSync('pnpm', ['exec', 'vite', 'build'], {
      cwd: webRoot,
      stdio: 'pipe',
      env: { ...process.env, ...env },
    });

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return walk(path);
        return entry.endsWith('.js') ? [path] : [];
      });

    const files = walk(join(webRoot, 'dist'));
    expect(files.length, 'the build produced no JavaScript').toBeGreaterThan(0);
    return files.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
  }

  /** Every text asset a build emitted, which is what the two assertions below are actually about. */
  function bundledSources(env: NodeJS.ProcessEnv = {}): string[] {
    execFileSync('pnpm', ['exec', 'vite', 'build'], {
      cwd: webRoot,
      stdio: 'pipe',
      env: { ...process.env, ...env },
    });

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.(js|css|html)$/.test(entry) ? [path] : [];
      });

    const files = walk(join(webRoot, 'dist'));
    expect(files.length, 'the build produced nothing to check').toBeGreaterThan(0);
    return files.map((file) => readFileSync(file, 'utf8'));
  }

  // The two slow tests in this file, and they earn their seconds: every cheaper version asserts that
  // the *source* looks right, which is not the claim. The claim is about what Rollup emitted.
  it('AC17 — a production build contains no factory data and no msw', { timeout: 180_000 }, () => {
    for (const source of bundledSources()) {
      // A seeded id prefix is the tell: it appears in no real data and in every factory row.
      expect(source, 'a chunk contains factory-seeded ids').not.toContain(
        `${ID_PREFIXES.ProviderProfile}-0000-4000`,
      );
      expect(source, 'a chunk contains a seeded provider').not.toContain('Fontanería Gómez');
      expect(source, 'a chunk bundles msw').not.toMatch(/setupWorker|mockServiceWorker\.js/);
    }
  });

  /**
   * `W12-T11` AC14 — the map is deferred, asserted against what Rollup emitted.
   *
   * This is the only check that can see it. A refactor that turns `lazy(() => import(…))` into a
   * static import still **works**: every behavioural test passes, the page renders, and the map has
   * quietly moved into the initial bundle — which is the exact cost `R9` exists to avoid and which
   * ADR-011 §6 calls "the budget's main threat". Same shape as AC17/AC19 above: assert the output,
   * not the source.
   */
  it('AC14 — the map is its own chunk, absent from the entry', { timeout: 180_000 }, () => {
    const chunks = bundledChunks();
    const marker = 'results.map.pending';

    const carrying = chunks.filter((chunk) => chunk.source.includes(marker));
    expect(carrying.length, 'no chunk contains the map module').toBeGreaterThan(0);

    // The entry is the largest chunk Vite emits for an SPA; naming it by hash would be a test that
    // breaks on every build. The claim is the important part: whatever the entry is, the *module*
    // is not alone in it — there is a separate chunk that carries it.
    const entry = chunks.reduce((largest, chunk) =>
      chunk.source.length > largest.source.length ? chunk : largest,
    );
    expect(
      carrying.some((chunk) => chunk.path !== entry.path),
      'the map module is only in the entry chunk — the dynamic import was flattened',
    ).toBe(true);
  });

  /**
   * The other half, and the reason it exists: AC17 alone passes just as happily when the flag is
   * broken and the mocks are *never* included. That is how `W12-T09` reached a preview deploy with
   * neither a real `GET /categories` nor a mocked one — an absence nobody was asserting.
   */
  it('AC19 — VITE_ENABLE_MOCKS=true keeps them in the bundle', { timeout: 180_000 }, () => {
    const sources = bundledSources({ VITE_ENABLE_MOCKS: 'true' });
    expect(
      sources.some((source) => /setupWorker/.test(source)),
      'the preview build has no MSW worker, so a deployed storefront has no endpoints',
    ).toBe(true);
    expect(
      sources.some((source) => source.includes('Fontanería Gómez')),
      'the handlers are bundled but the seeded catalogue is not',
    ).toBe(true);
  });

  /**
   * `W12-T16` §10 Q1 — the deliberate-fault trigger, asserted in both directions.
   *
   * The 500 page had no URL: `W12-T09` correctly made the shell's loader degrade rather than throw
   * (`MEM-2026-09-11-21`), which left the one surface with no a11y coverage also with no way to
   * reach it. `shared/fault.ts` gives it one, stripped at resolve time.
   *
   * The absence assertion is the important one and it is not sufficient on its own — the same trap
   * as AC17 vs AC19. A query parameter that 500s the storefront on demand must not survive into a
   * real build; a trigger that never works means the nightly silently stops covering the 500 page.
   */
  it('W12-T16 — a normal build has no fault trigger', { timeout: 180_000 }, () => {
    for (const source of bundledSources()) {
      expect(source, 'a chunk carries the deliberate-fault trigger').not.toContain('__boom');
    }
  });

  it('W12-T16 — VITE_ENABLE_FAULT_ROUTES=true keeps it', { timeout: 180_000 }, () => {
    const sources = bundledSources({ VITE_ENABLE_FAULT_ROUTES: 'true' });
    expect(
      sources.some((source) => source.includes('__boom')),
      'the nightly build has no fault trigger, so the 500 page is uncovered again',
    ).toBe(true);
  });
});
