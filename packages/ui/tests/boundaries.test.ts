// @vitest-environment node
//
// ADR-012's two structural rules, as assertions. Neither is about how a component looks; both are
// about what the package is allowed to know and to ship.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src', import.meta.url));

function files(dir = src, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) files(child, found);
    else found.push(child);
  }
  return found;
}

const sources = files().filter((file) => ['.ts', '.tsx'].includes(extname(file)));

describe('AC15 — the design system knows nothing about the domain', () => {
  it('imports neither the contracts package nor an app', () => {
    expect(sources.length, 'no sources to check').toBeGreaterThan(0);

    const offenders = sources.filter((file) =>
      /from\s+'(@marketplace\/(contracts|testing|api|web)|.*apps\/)/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(
      offenders.map((file) => relative(src, file)),
      'a domain type in the design system makes agent-ui downstream of nine slices (ADR-012 §1)',
    ).toEqual([]);
  });
});

describe('AC16 — every primitive is reviewable', () => {
  it('gives each exported primitive a story file beside it', () => {
    const index = readFileSync(join(src, 'index.ts'), 'utf8');
    const exported = [...index.matchAll(/from\s+'\.\/primitives\/([A-Za-z]+)\.js'/g)].map(
      (match) => match[1] ?? '',
    );
    expect(exported.length, 'index.ts exports no primitive').toBeGreaterThan(0);

    const stories = new Set(
      readdirSync(join(src, 'primitives')).filter((name) => name.endsWith('.stories.tsx')),
    );
    for (const name of exported) {
      expect(stories, `${name} has no stories file`).toContain(`${name}.stories.tsx`);
    }
  });
});

describe('AC18 — colour lives in the token file and nowhere else', () => {
  const TOKENS = join(src, 'styles/tokens.css');
  const sheets = files().filter((file) => extname(file) === '.css');

  it('has component stylesheets, and none of them names a colour', () => {
    // `W12-T01` could only assert that the walker found `tokens.css`, because that was the only
    // stylesheet in the package. Now that component stylesheets exist, the guard is the assertion:
    // an empty list here would make the loop below pass forever.
    expect(
      sheets.filter((file) => file !== TOKENS).length,
      'no component stylesheets',
    ).toBeGreaterThan(0);

    for (const sheet of sheets.filter((file) => file !== TOKENS)) {
      const offending = readFileSync(sheet, 'utf8')
        .split('\n')
        .filter((line) => /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/.test(line));
      expect(offending, `${relative(src, sheet)} hardcodes a colour`).toEqual([]);
    }
  });

  /**
   * React Aria publishes this one itself, on the popover, so an overlay can match the width of the
   * trigger it belongs to. It is measured at run time and could not be a token. Allowing it by name
   * — rather than loosening the assertion — keeps the next foreign variable a failure.
   */
  const REACT_ARIA_PROVIDED = new Set(['--trigger-width']);

  it('reads only the tokens the design system publishes', () => {
    for (const sheet of sheets.filter((file) => file !== TOKENS)) {
      const used = [...readFileSync(sheet, 'utf8').matchAll(/var\((--[a-z0-9-]+)/g)].map(
        (match) => match[1] ?? '',
      );
      expect(
        used.filter((token) => !token.startsWith('--mp-') && !REACT_ARIA_PROVIDED.has(token)),
        `${relative(src, sheet)} reads a token the design system does not own`,
      ).toEqual([]);
    }
  });
});
