// @vitest-environment node
//
// The consumer side of `@marketplace/ui`. An exports map is only ever wrong from outside the
// package that declares it, so these assertions live here rather than in `packages/ui`.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const src = fileURLToPath(new URL('../src', import.meta.url));

describe('AC2 — the design system resolves from the app', () => {
  it('resolves the package entry point through its exports map', () => {
    expect(() => require.resolve('@marketplace/ui/package.json')).not.toThrow();
  });

  it('resolves the token stylesheet, and it is the real one', () => {
    const tokens = require.resolve('@marketplace/ui/tokens.css');
    expect(existsSync(tokens)).toBe(true);
    const css = readFileSync(tokens, 'utf8');
    expect(css).toContain('--mp-color-bg');
    expect(css).toContain('prefers-color-scheme: dark');
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
