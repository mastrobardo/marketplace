// @vitest-environment node
//
// The consumer side of `@marketplace/ui`. An exports map is only ever wrong from outside the
// package that declares it, so these assertions live here rather than in `packages/ui`.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const src = fileURLToPath(new URL('../src', import.meta.url));

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
