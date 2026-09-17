// @vitest-environment node
//
// The consumer side of `@marketplace/ui`. An exports map is only ever wrong from outside the
// package that declares it, so these assertions live here rather than in `packages/ui`.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const src = fileURLToPath(new URL('../src', import.meta.url));
const webRoot = fileURLToPath(new URL('..', import.meta.url));

describe('AC2 — the design system resolves from the app', () => {
  it('resolves the package entry point through its exports map', () => {
    expect(() => require.resolve('@marketplace/ui/package.json')).not.toThrow();
  });

  it('resolves the token stylesheet, and it is the real one', () => {
    // `W12-T05` split the one file into four layers, so the entry point declares nothing itself —
    // asserting on its text would now assert on a table of contents. Follow the imports instead,
    // which is also what a bundler does: a broken relative path here is an app with no colours,
    // and it fails silently because CSS does not throw.
    const tokens = require.resolve('@marketplace/ui/tokens.css');
    expect(existsSync(tokens)).toBe(true);

    const entry = readFileSync(tokens, 'utf8');
    const imported = [...entry.matchAll(/@import\s+'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(imported.length, 'the entry point imports no layer').toBeGreaterThan(0);

    const layers = imported.map((path) => {
      const resolved = join(dirname(tokens), path);
      expect(existsSync(resolved), `${path} is imported but not shipped`).toBe(true);
      return readFileSync(resolved, 'utf8');
    });

    expect(layers.join('\n')).toContain('--mp-color-bg');
    // Both schemes, in one declaration, chosen by `color-scheme` — the switch the app relies on.
    expect(layers.join('\n')).toContain('light-dark(');
    expect(entry).toContain('color-scheme: light dark');
  });
});

describe('AC3 — the tokens moved, and the app follows them', () => {
  it('no longer keeps a copy of the token file', () => {
    expect(existsSync(`${src}/styles/tokens.css`), 'apps/web still has its own tokens.css').toBe(
      false,
    );
  });

  it('imports the stylesheet from the package rather than from a path', () => {
    const main = readFileSync(`${src}/main.tsx`, 'utf8');
    expect(main).toContain('@marketplace/ui/tokens.css');
    expect(main).not.toMatch(/['"]\.\/styles\/tokens\.css['"]/);
  });
});

describe('W12-T20 — the app loads the component layer, not only the tokens', () => {
  /**
   * AC1. The tokens assertion above follows `@import`s because the token entry point is a table of
   * contents; this one does not, because `dist/ui.css` is a build output with everything inlined.
   * What it has to prove is that the export resolves to *component CSS* rather than to an empty
   * file a broken build left behind — a stylesheet that exists and says nothing would satisfy a
   * naive `existsSync` and leave the page exactly as unstyled as it is today.
   */
  it('AC1 — resolves the component stylesheet, and it carries real rules', () => {
    const styles = require.resolve('@marketplace/ui/styles.css');
    expect(existsSync(styles), '@marketplace/ui/styles.css does not exist').toBe(true);

    const css = readFileSync(styles, 'utf8');
    expect(css.length, 'the component stylesheet is empty').toBeGreaterThan(0);
    expect(css, 'the component stylesheet declares no class').toMatch(/\.[_a-zA-Z][\w-]*\s*[,{]/);
    expect(css, 'the component stylesheet reads no token — it is not the design system').toContain(
      'var(--mp-',
    );
  });

  /**
   * AC2. The bug this ticket fixes lived underneath the assertion in AC3 above: that test reads
   * `main.tsx`'s imports and is satisfied by the tokens line, which was always there. A component
   * layer that is never imported renders every React Aria control as a raw browser widget, and no
   * other suite in this repo can see it.
   */
  it('AC2 — the entry point imports both stylesheets', () => {
    const main = readFileSync(`${src}/main.tsx`, 'utf8');
    expect(main, 'the entry point does not import the tokens').toContain(
      '@marketplace/ui/tokens.css',
    );
    expect(
      main,
      'the entry point does not import @marketplace/ui/styles.css — every component renders unstyled',
    ).toContain('@marketplace/ui/styles.css');
  });

  /**
   * AC3 — the assertion that can see a cause nobody predicted.
   *
   * AC2 reads a line of source, which is the same shape of check that was green throughout the
   * defect. This one reads what Rollup emitted, and its subjects are **derived from the design
   * system's own output** rather than written down here: `memory/repo/gotchas.md` carries four
   * instances of a hand-written subject list failing open, and a list of component class names
   * would rot the first time a component was renamed.
   *
   * CSS Modules hashes survive minification verbatim, which is what makes them usable as needles —
   * but only as **selectors**. The first version of this test searched for the bare hash and found
   * 59 of 67 in a build with no component CSS at all: CSS Modules compile to a JS object mapping
   * each name to its hash, so `dist/index.js` carries every class name of every component the app
   * renders. The eight it did report missing were `Dialog` and `Popover`, which the storefront does
   * not use, so the gate was reporting tree-shaking rather than the defect it was written for.
   *
   * A leading `.` is the whole difference: it appears in a rule and never in a `className` string.
   * Both `.css` and `.js` are searched, so a stylesheet emitted as an asset and one injected by a
   * chunk both count — the claim is that it reached the browser, not how.
   */
  it('AC3 — a production build emits the component layer', { timeout: 180_000 }, () => {
    const css = readFileSync(require.resolve('@marketplace/ui/styles.css'), 'utf8');
    const needles = [...new Set([...css.matchAll(/\.(_[\w-]+)/g)].map((m) => `.${m[1] ?? ''}`))];

    // A derived list that derives nothing passes every assertion below it. This is the completeness
    // half, and it is the reason the gate is not decorative.
    expect(
      needles.length,
      'no CSS Module class names were derived from the component stylesheet — the needles are empty and this test proves nothing',
    ).toBeGreaterThan(20);

    execFileSync('pnpm', ['exec', 'vite', 'build'], { cwd: webRoot, stdio: 'pipe' });

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.(css|js)$/.test(entry) ? [path] : [];
      });

    const emitted = walk(join(webRoot, 'dist'));
    expect(emitted.length, 'the build emitted nothing to check').toBeGreaterThan(0);
    const bundle = emitted.map((path) => readFileSync(path, 'utf8')).join('\n');

    const missing = needles.filter((needle) => !bundle.includes(needle));
    expect(
      missing,
      `${missing.length} of ${needles.length} component rules never reached the build — the storefront ships unstyled controls`,
    ).toEqual([]);
  });
});
