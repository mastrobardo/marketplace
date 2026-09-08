// @vitest-environment node
//
// Filesystem and compiler assertions, not DOM ones: under jsdom `import.meta.url` is an http URL
// and `fileURLToPath` rejects it.
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

describe('AC14 — every design value is a namespaced token', () => {
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

describe('AC15 — dark mode is complete, not partial', () => {
  it('gives every colour token a dark counterpart', () => {
    const css = readFileSync(TOKENS, 'utf8');
    const light = declaredTokens(block(css, ':root')).filter((t) => t.startsWith('--mp-color-'));
    const dark = new Set(declaredTokens(css.slice(css.indexOf('prefers-color-scheme'))));
    expect(light.length, 'no colour tokens in the light theme').toBeGreaterThan(0);
    expect(light.filter((token) => !dark.has(token))).toEqual([]);
  });
});

describe('AC16 — colour lives in the token file and nowhere else', () => {
  it('has no raw colour literal in any component stylesheet', () => {
    const sheets = stylesheets().filter((file) => file !== TOKENS);
    expect(sheets.length, 'there are no component stylesheets to check').toBeGreaterThan(0);
    for (const sheet of sheets) {
      const offending = readFileSync(sheet, 'utf8')
        .split('\n')
        .filter((line) => /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/.test(line));
      expect(offending, `${relative(src, sheet)} hardcodes a colour`).toEqual([]);
    }
  });
});
