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
import { SearchResponseSchema } from '@marketplace/contracts';
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

const search = async (query: string) => {
  const response = await fetch(`http://api.test/search?${query}`);
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

describe('AC14..AC16 — the handler answers the contract', () => {
  it('AC14 — a search body satisfies SearchResponseSchema', async () => {
    const { status, body } = await search('where=28013');
    expect(status).toBe(200);
    const parsed = SearchResponseSchema.safeParse(body);
    expect(
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    ).toEqual([]);
  });

  it('AC15 — a rejected query is a 400 envelope, not a 200 with an empty list', async () => {
    const { status, body } = await search('what=FONTANERIA');
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('AC15 — a missing `where` is rejected the same way', async () => {
    const { status } = await search('what=fontaneria');
    expect(status).toBe(400);
  });

  it('AC16 — `what` filters, and the facet counts describe the returned set', async () => {
    const { body } = await search('where=28013&what=fontaneria');
    const page = SearchResponseSchema.parse(body);

    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(item.categories.map((c) => c.slug)).toContain('fontaneria');
    }

    const counted = page.facets.categories.find((facet) => facet.slug === 'fontaneria');
    expect(counted?.count).toBe(page.items.length);
    const kinds = page.facets.kinds.reduce((sum, facet) => sum + facet.count, 0);
    expect(kinds, 'the kind facet counts a different set than it returned').toBe(page.items.length);
  });

  it('AC16 — `mode=booking` excludes the quote-only provider', async () => {
    const all = SearchResponseSchema.parse((await search('where=28013')).body);
    const booking = SearchResponseSchema.parse((await search('where=28013&mode=booking')).body);

    expect(all.items.some((item) => item.hourlyRateCents === null)).toBe(true);
    expect(booking.items.every((item) => item.hourlyRateCents !== null)).toBe(true);
    expect(booking.items.length).toBeLessThan(all.items.length);
  });

  it('orders by distance, nearest first', async () => {
    const page = SearchResponseSchema.parse((await search('where=28013')).body);
    const distances = page.items.map((item) => item.distanceMetres);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('never returns an address line or an account id', async () => {
    const { body } = await search('where=28013');
    const serialised = JSON.stringify(body);
    for (const leak of ['line1', 'line2', 'userId', 'baseAddressId', 'Calle Mayor']) {
      expect(serialised, `a public search result carried ${leak}`).not.toContain(leak);
    }
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
});
