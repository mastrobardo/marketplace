// @vitest-environment node
//
// `W12-T08` AC13..AC18 — the storefront's mocks are the contract, and they do not ship.
//
// Two properties, and neither is about whether the handlers "work". The first is that the data came
// from `packages/testing` rather than from a second fixture set (ADR-011 §4, `W1-T09`). The second
// is that none of it reaches production, which is a claim about a build and is therefore checked
// against one.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ID_PREFIXES } from '@marketplace/testing';
import { CategorySummarySchema } from '@marketplace/contracts';
import { buildCatalogue } from './fixtures/catalogue.js';

const webRoot = fileURLToPath(new URL('..', import.meta.url));

/** `W3-T01` AC22/AC23: the mock world moved here, and the MSW server it fed is gone. */
const fixtures = join(webRoot, 'tests', 'fixtures');
const mocks = join(webRoot, 'mocks');

const exists = (path: string): boolean => existsSync(path);

/**
 * A file's source with its comments removed.
 *
 * The assertions below are about **code**, not about whether a word appears — and the files that
 * deleted MSW explain why they no longer start a worker, which a raw grep cannot tell from the
 * worker itself. `tests/cd-workflows.test.ts` strips `#` comments for the same reason.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');
}

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
 * are real, and a demo seeder now fills the database they read. `W3-T01` deletes the last one —
 * `GET /categories` is a real endpoint, so this directory has no handlers left.
 *
 * AC14–AC16 were `W12-T08`'s criteria *about the contract*, asserted through the handlers that
 * went. They are not dropped — they are re-homed on the real endpoints, and
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
 * And the category handler's own two, which `W3-T01` re-homes the same way:
 *
 *   a list the contract accepts     → apps/api/tests/categories.test.ts AC1
 *   answers in the language asked   → apps/api/tests/categories{,-live}.test.ts AC5–AC7
 */
describe('W3-T01 AC22 — MSW is gone from the storefront, whole', () => {
  it('leaves no mocks directory behind', () => {
    // Operator decision, 2026-09-18: *"I would delete MSW as a whole for now."* `GET /categories`
    // was the last endpoint that did not exist; `W3-T01` makes it real, and with it the reason the
    // storefront carried a second, parallel definition of its own API.
    for (const file of ['handlers.ts', 'browser.ts', 'catalogue.ts', 'search.ts', 'provider.ts']) {
      expect(exists(join(mocks, file)), `apps/web/mocks/${file} survives`).toBe(false);
    }
    expect(exists(mocks), 'apps/web/mocks/ survives the deletion of everything in it').toBe(false);
  });

  it('is not started by the entry point any more', () => {
    const main = code(join(webRoot, 'src', 'main.tsx'));
    expect(main, 'main.tsx still imports a worker that no longer exists').not.toMatch(/mocks\//);
    expect(main, 'main.tsx still calls startMocks').not.toContain('startMocks');
  });

  it('needs no build-time stub, because there is nothing to strip', () => {
    // `stripMocks` existed because `src/main.tsx`'s guarded dynamic import was not enough on its
    // own — Rollup resolved it while building the module graph and emitted 511 KB of MSW anyway.
    // With no import there is no graph edge, and the plugin is a stub for a module that is absent.
    const vite = code(join(webRoot, 'vite.config.ts'));
    expect(vite, 'vite.config.ts still stubs the MSW entry point').not.toContain('stripMocks');
    expect(vite, 'vite.config.ts still resolves mocks/browser').not.toMatch(/mocks\/browser/);
  });

  it('ships no vendored service worker, which the bundle greps cannot see', () => {
    /**
     * `public/` is copied verbatim into `dist/` — it is never part of the module graph, so neither
     * `stripMocks` nor the `setupWorker` grep below could ever have caught it. MSW's vendored
     * worker is 9.4 KB, contains neither the string `setupWorker` nor its own filename, and was
     * still being deployed after the handlers were deleted. Worse, the `msw` devDependency that
     * regenerates it is gone, so it was an orphan nobody could refresh. Found in review.
     */
    expect(exists(join(webRoot, 'public', 'mockServiceWorker.js')), 'the MSW worker ships').toBe(
      false,
    );
    const distWorker = join(webRoot, 'dist', 'mockServiceWorker.js');
    expect(exists(distWorker), 'a stale build still carries the worker; rebuild dist/').toBe(false);
  });

  it('leaves no VITE_ENABLE_MOCKS anywhere in the web app', () => {
    // The flag's whole job was to give a *deployed* storefront the endpoints it did not have. With
    // `W0-T28`'s one origin pointing preview at a real API, and `categories.taxonomy` deliberately
    // not `localOnly` (§8.4), a preview database holds the real tree — so preview needs no mock.
    for (const file of ['src/main.tsx', 'vite.config.ts', 'package.json']) {
      expect(code(join(webRoot, file)), `${file} still reads the flag`).not.toContain(
        'VITE_ENABLE_MOCKS',
      );
    }
  });
});

describe('W3-T01 AC23 — the mock world moved to tests/fixtures', () => {
  it('holds the three files the component harness stubs ApiClient from', () => {
    // They survive the deletion of their handlers with one caller left: `tests/app-harness.tsx`.
    // `W12-T11` split them out so the stub and the handler could not disagree, and the operator
    // reaffirmed on 2026-09-18 that they move rather than go.
    for (const file of ['catalogue.ts', 'search.ts', 'provider.ts']) {
      expect(exists(join(fixtures, file)), `tests/fixtures/${file} is missing`).toBe(true);
      expect(exists(join(mocks, file)), `mocks/${file} was copied rather than moved`).toBe(false);
    }
  });

  it('is imported from its new home by the harness, not by a path that no longer exists', () => {
    const harness = readFileSync(join(webRoot, 'tests', 'app-harness.tsx'), 'utf8');
    expect(harness, 'app-harness.tsx still reaches into mocks/').not.toMatch(/mocks\//);
    for (const file of ['catalogue', 'search', 'provider']) {
      expect(harness, `app-harness.tsx does not import ${file} from fixtures`).toMatch(
        new RegExp(`fixtures/${file}\\.js`),
      );
    }
  });

  it('still answers the frozen contract, which is why the fixture was worth keeping', () => {
    // The handler validated its own output against `packages/contracts`; that check moves onto the
    // fixture itself, so a drift fails here rather than teaching a component test a shape the API
    // will never send.
    const catalogue = buildCatalogue();
    expect(catalogue.categories.length).toBeGreaterThan(0);

    for (const category of catalogue.categories) {
      const parsed = CategorySummarySchema.safeParse({
        slug: category.slug,
        name: category.nameEs,
        requiresLicence: category.requiresLicence,
      });
      expect(
        parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        `${category.slug} drifted from CategorySummarySchema`,
      ).toEqual([]);
    }
  });

  it('keeps electricidad gated, so the licence badge stays exercised', () => {
    // §8.6: independent of what the real taxonomy says, this row is what keeps the storefront's
    // badge under test in the component suites.
    const electricidad = buildCatalogue().categories.find((c) => c.slug === 'electricidad');
    expect(electricidad?.requiresLicence).toBe(true);
  });
});

describe('AC17..AC18 — none of this ships, and all of it is typechecked', () => {
  it('AC23 — the moved fixtures are typechecked, and the lint fixtures still are not', () => {
    const tsconfig = JSON.parse(readFileSync(join(webRoot, 'tsconfig.json'), 'utf8')) as {
      include: string[];
      exclude: string[];
    };

    expect(tsconfig.include, 'tests/** is not typechecked').toContain('tests/**/*.ts');

    /**
     * `tests/fixtures` was excluded wholesale, because it held the three *deliberately broken*
     * i18n-lint fixture projects. The mock world lives in the same directory and must be
     * typechecked — `app-harness.tsx` imports it — so the exclude was narrowed to those three
     * subdirectories rather than the parent.
     *
     * **`W12-T21` deleted all three**, along with the compile-time key union they proved. The
     * catalogues are JSON now, so there is no `satisfies Translations` left to break on purpose,
     * and a fixture that compiles a broken catalogue has nothing to assert. What this test still
     * protects is the half that matters: `tests/fixtures` is in the program.
     */
    expect(tsconfig.exclude, 'tests/fixtures is still excluded wholesale').not.toContain(
      'tests/fixtures',
    );
    for (const gone of ['incomplete-catalogue', 'unknown-key', 'valid']) {
      expect(
        existsSync(join(fixtures, gone)),
        `tests/fixtures/${gone} is back — the i18n lint fixtures went with W12-T21`,
      ).toBe(false);
      expect(
        tsconfig.exclude,
        `tsconfig still excludes tests/fixtures/${gone}, which no longer exists`,
      ).not.toContain(`tests/fixtures/${gone}`);
    }
  });

  it('AC18 — the factories are a devDependency, and msw is no longer a dependency at all', () => {
    const manifest = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      msw?: unknown;
    };

    // The factories stay: `tests/fixtures/` builds the component harness's world from them.
    expect(manifest.devDependencies?.['@marketplace/testing']).toBeDefined();
    expect(manifest.dependencies?.['@marketplace/testing']).toBeUndefined();

    // msw goes with the handlers it served, including the `"msw": { … }` worker-directory block.
    expect(manifest.devDependencies?.['msw'], 'msw is still installed').toBeUndefined();
    expect(manifest.dependencies?.['msw'], 'msw is a runtime dependency').toBeUndefined();
    expect(manifest.msw, 'the msw worker-directory config survives').toBeUndefined();
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
   * `W12-T09`'s AC19 stood here: *with `VITE_ENABLE_MOCKS=true`, the worker and the seeded catalogue
   * **are** in the bundle*. It was the necessary other half of AC17 — AC17 alone passes just as
   * happily when the flag is broken and the mocks are never included, which is how `W12-T09`
   * reached a preview deploy with neither a real `GET /categories` nor a mocked one.
   *
   * **`W3-T01` retires it, because the absence it guarded against is now the intended state.**
   * There is no flag, no worker and no handler: the endpoint is real, `W0-T28` points preview at
   * it through one origin, and `categories.taxonomy` is deliberately not `localOnly` so a preview
   * database holds the real tree. A test asserting the mocks are bundled would now be asserting
   * that a deleted directory still ships.
   *
   * What replaces it is the same shape pointed the other way: the flag must be gone *everywhere*,
   * not merely unset — an env var still read by a build is a mock waiting to come back.
   */
  it('W3-T01 — no build carries msw, with or without the old flag', { timeout: 180_000 }, () => {
    for (const source of bundledSources({ VITE_ENABLE_MOCKS: 'true' })) {
      expect(source, 'a chunk bundles msw').not.toMatch(/setupWorker|mockServiceWorker\.js/);
      expect(source, 'a chunk contains a seeded provider').not.toContain('Fontanería Gómez');
    }
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
