// @vitest-environment node
//
// Filesystem and compiler assertions, not DOM ones: under jsdom `import.meta.url` is an http URL
// and `fileURLToPath` rejects it.
//
// Moved here from `apps/web/tests/tokens.test.ts` by `W12-T01`, with the token file it guards.
// The app keeps the half of the old AC16 that is about its own stylesheets.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src', import.meta.url));
const TOKENS = join(src, 'styles/tokens.css');

function stylesheets(dir = src, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) stylesheets(child, found);
    else if (extname(entry.name) === '.css') found.push(child);
  }
  return found;
}

/** Custom properties declared in a block, e.g. `--mp-color-surface: #fff;`. */
function declaredTokens(css: string): string[] {
  return [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? '');
}

function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('AC4 — every design value is a namespaced token', () => {
  it('namespaces every custom property and covers the four token families', () => {
    const tokens = declaredTokens(readFileSync(TOKENS, 'utf8'));
    expect(tokens.length, 'no tokens are declared').toBeGreaterThan(0);
    for (const token of tokens) {
      expect(token, `${token} is not namespaced`).toMatch(/^--mp-/);
    }
    for (const family of ['color', 'space', 'radius', 'font']) {
      expect(
        tokens.some((token) => token.startsWith(`--mp-${family}-`)),
        `no --mp-${family}-* token exists`,
      ).toBe(true);
    }
  });
});

describe('AC5 — dark mode is complete, not partial', () => {
  it('gives every colour token a dark counterpart', () => {
    const css = readFileSync(TOKENS, 'utf8');
    const light = declaredTokens(block(css, ':root')).filter((t) => t.startsWith('--mp-color-'));
    const dark = new Set(declaredTokens(css.slice(css.indexOf('prefers-color-scheme'))));
    expect(light.length, 'no colour tokens in the light theme').toBeGreaterThan(0);
    expect(light.filter((token) => !dark.has(token))).toEqual([]);
  });
});

describe('AC6 — colour lives in the token file and nowhere else', () => {
  it('has no raw colour literal in any component stylesheet', () => {
    const sheets = stylesheets();
    // The walker proves itself before it proves anything else. Today `tokens.css` is the only
    // stylesheet in this package, so an unproven walker would let this suite pass by finding
    // nothing at all — which is how a gate reports success for the rest of its life.
    expect(sheets, 'the stylesheet walker did not find tokens.css').toContain(TOKENS);

    for (const sheet of sheets.filter((file) => file !== TOKENS)) {
      const offending = readFileSync(sheet, 'utf8')
        .split('\n')
        .filter((line) => /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/.test(line));
      expect(offending, `${relative(src, sheet)} hardcodes a colour`).toEqual([]);
    }
  });
});

describe('AC1 — the package promises a built entry point', () => {
  interface Manifest {
    exports: Record<string, { import: { types: string; default: string } } | string>;
    files: string[];
    scripts: Record<string, string>;
  }

  it('points its exports map at dist and ships it', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as Manifest;

    const entry = manifest.exports['.'];
    expect(typeof entry, 'the package root is not exported').toBe('object');
    expect((entry as { import: { default: string } }).import.default).toBe('./dist/index.js');
    expect((entry as { import: { types: string } }).import.types).toBe('./dist/index.d.ts');
    expect(manifest.files).toContain('dist');
    // `src/styles` is shipped because `./tokens.css` is served from source, not from the build.
    expect(manifest.files).toContain('src/styles');
    expect(manifest.scripts['build']).toBeTruthy();
  });
});
