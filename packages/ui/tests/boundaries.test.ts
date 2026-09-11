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

describe('AC16 — every component is reviewable', () => {
  /**
   * Widened by `W12-T07` (its AC12). The rule was written when `primitives/` was the only folder
   * this package exported from, and `patterns/` — ADR-012's second layer — would have arrived
   * outside it: a pattern with no story is a pattern with no axe assertion, which is precisely the
   * gate `W12-T04` set up.
   *
   * A capitalised filename is the component convention here, and it is what separates `SearchBar.tsx`
   * from the `schema.ts` and `query.ts` beside it — those are types and pure functions, and a story
   * for a function would be theatre.
   */
  it('gives each exported component a story file beside it', () => {
    const index = readFileSync(join(src, 'index.ts'), 'utf8');
    const exported = [...index.matchAll(/from\s+'\.\/((?:[a-z-]+\/)+[A-Za-z]+)\.js'/g)]
      .map((match) => match[1] ?? '')
      .filter((path) => /^[A-Z]/.test(path.slice(path.lastIndexOf('/') + 1)));
    expect(exported.length, 'index.ts exports no component').toBeGreaterThan(0);

    for (const path of exported) {
      const dir = join(src, path.slice(0, path.lastIndexOf('/')));
      const name = path.slice(path.lastIndexOf('/') + 1);
      const stories = new Set(readdirSync(dir).filter((entry) => entry.endsWith('.stories.tsx')));
      expect(stories, `${path} has no stories file`).toContain(`${name}.stories.tsx`);
    }
  });

  it('covers both layers, so neither gate is vacuous', () => {
    const index = readFileSync(join(src, 'index.ts'), 'utf8');
    for (const layer of ['primitives', 'patterns']) {
      expect(index, `index.ts exports nothing from ${layer}/`).toContain(`'./${layer}/`);
    }
  });
});

describe('AC18 — colour lives in the token layer and nowhere else', () => {
  // Everything under `src/styles` *is* the token layer — four files since `W12-T05`, of which the
  // two themes are the only ones allowed to write a colour. Which of them may is `tokens.test.ts`'s
  // question; this file's question is about the components, so it excludes the layer wholesale
  // rather than naming one file and silently exempting the rest.
  const TOKEN_LAYER = join(src, 'styles');
  const sheets = files()
    .filter((file) => extname(file) === '.css')
    .filter((file) => !file.startsWith(TOKEN_LAYER));

  it('has component stylesheets, and none of them names a colour', () => {
    // `W12-T01` could only assert that the walker found `tokens.css`, because that was the only
    // stylesheet in the package. Now that component stylesheets exist, the guard is the assertion:
    // an empty list here would make the loop below pass forever.
    expect(sheets.length, 'no component stylesheets').toBeGreaterThan(0);

    for (const sheet of sheets) {
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
    for (const sheet of sheets) {
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

describe('AC20 — a size and a shadow are tokens, for the same reason a colour is', () => {
  // Same exclusion as AC18 and for the same reason: `src/styles` *is* the token layer, and the
  // question here is about components.
  const TOKEN_LAYER = join(src, 'styles');
  const sheets = files()
    .filter((file) => extname(file) === '.css')
    .filter((file) => !file.startsWith(TOKEN_LAYER));

  /**
   * The value of `property` on this line, or null if it does not declare one.
   *
   * Read the value rather than pattern-match the absence of `var(`. The first version of this was
   * `${property}\\s*:\\s*(?!var\\()` and it reported every compliant line as a violation: `\\s*` is
   * free to match zero characters, so the lookahead was tested against " var(…)" — which does not
   * begin with `var(` — and passed. A negative lookahead behind a variable-width match asserts
   * almost nothing, and it fails in the direction that looks like a working gate.
   */
  const declaredValue = (line: string, property: string): string | null => {
    const match = new RegExp(`(?:^|[;{\\s])${property}\\s*:([^;}]*)`, 'i').exec(line);
    return match === null ? null : (match[1] ?? '').trim();
  };

  /** `font-size: 14px` yes; `font-size: var(…)` no; `box-shadow: none` no — absence has no token. */
  const isRaw = (line: string, property: string): boolean => {
    const value = declaredValue(line, property);
    return value !== null && value !== '' && value !== 'none' && !value.startsWith('var(');
  };

  it('detects a raw value, so the loops below are not vacuous', () => {
    // `W12-T18` landed this gate on a package that already passed it. A gate written against code
    // that never violated it has never been observed to fail, which is indistinguishable from a
    // gate that cannot fail — so the detector is exercised on violations, on legitimate values and
    // on near-misses before it is trusted with the real files.
    expect(sheets.length, 'no component stylesheets').toBeGreaterThan(0);
    expect(isRaw('  font-size: 14px;', 'font-size')).toBe(true);
    expect(isRaw('  font-size: var(--mp-font-size-sm);', 'font-size')).toBe(false);
    expect(isRaw('  box-shadow: 0 1px 2px rgb(0 0 0 / 10%);', 'box-shadow')).toBe(true);
    expect(isRaw('  box-shadow: var(--mp-card-shadow);', 'box-shadow')).toBe(false);
    expect(isRaw('  box-shadow: none;', 'box-shadow')).toBe(false);
    // Neither a longer property name nor a token whose *name* contains one may read as a match.
    expect(isRaw('  --mp-card-box-shadow-x: 1px;', 'box-shadow')).toBe(false);
    expect(isRaw('  -webkit-box-shadow: 0 1px 2px #000;', 'box-shadow')).toBe(false);
  });

  for (const property of ['font-size', 'box-shadow']) {
    it(`names no raw ${property} in a component stylesheet`, () => {
      for (const sheet of sheets) {
        const offending = readFileSync(sheet, 'utf8')
          .split('\n')
          .filter((line) => isRaw(line, property));
        expect(
          offending,
          `${relative(src, sheet)} writes a ${property} the design system cannot theme`,
        ).toEqual([]);
      }
    });
  }
});
