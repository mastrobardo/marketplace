// @vitest-environment node
//
// What is left of this suite after `W12-T01`: the token file and its namespacing, dark-parity and
// layering gates moved to `packages/ui` with `tokens.css` itself. This half stays with the app,
// because the app keeps its own stylesheets — the shell in `styles/app.css` — and they are subject
// to the same rule: a value the design system does not name is not a value this app may write.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src', import.meta.url));

function stylesheets(dir = src, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) stylesheets(child, found);
    else if (extname(entry.name) === '.css') found.push(child);
  }
  return found;
}

describe('AC7 — the app writes no colour of its own', () => {
  it('has no raw colour literal in any stylesheet under src', () => {
    const sheets = stylesheets();
    expect(sheets.length, 'there are no stylesheets to check').toBeGreaterThan(0);
    for (const sheet of sheets) {
      const offending = readFileSync(sheet, 'utf8')
        .split('\n')
        .filter((line) => /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/.test(line));
      expect(offending, `${relative(src, sheet)} hardcodes a colour`).toEqual([]);
    }
  });
});
