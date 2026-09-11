// @vitest-environment node
//
// Filesystem and compiler assertions, not DOM ones: under jsdom `import.meta.url` is an http URL
// and `fileURLToPath` rejects it.
//
// Moved here from `apps/web/tests/tokens.test.ts` by `W12-T01`, with the token file it guards. The
// app keeps the half of the old AC16 that is about its own stylesheets. `W12-T05` split the one
// file into four layers and added a second theme; from here the assertions are made against the
// *resolved* graph (`token-graph.ts`) rather than against the text of a file, because "the name
// appears after the media query" stopped being evidence the moment there was more than one theme.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMBINATIONS,
  contrastRatio,
  family,
  isComponent,
  isPrimitive,
  isSemantic,
  label,
  parse,
  read,
  references,
  resolve,
} from './token-graph.js';

const src = fileURLToPath(new URL('../src', import.meta.url));
const styles = join(src, 'styles');
const TOKENS = join(styles, 'tokens.css');

/** The four layers, in the order `tokens.css` imports them — which is the cascade order. */
const LAYERS = [
  join(styles, 'scale.css'),
  join(styles, 'themes/default.css'),
  join(styles, 'themes/contrast.css'),
  join(styles, 'components.css'),
];

const THEME_FILES = LAYERS.filter((file) => file.includes(`themes${'/'}`));

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

const graph = parse([TOKENS, ...LAYERS].map(read));
const declared = [...new Set(graph.map((declaration) => declaration.token))];

describe('AC4 — every design value is a namespaced token', () => {
  it('namespaces every custom property and covers the token families', () => {
    expect(declared.length, 'no tokens are declared').toBeGreaterThan(0);
    for (const token of declared) {
      expect(token, `${token} is not namespaced`).toMatch(/^--mp-/);
    }
    for (const family_ of ['palette', 'color', 'space', 'radius', 'font']) {
      expect(
        declared.some((token) => token.startsWith(`--mp-${family_}-`)),
        `no --mp-${family_}-* token exists`,
      ).toBe(true);
    }
  });
});

describe('AC1 — the entry point still is one, and it is only imports', () => {
  it('imports the four layers in cascade order and declares no token itself', () => {
    const css = readFileSync(TOKENS, 'utf8');
    const imports = [...css.matchAll(/@import\s+'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(imports).toEqual([
      './scale.css',
      './themes/default.css',
      './themes/contrast.css',
      './components.css',
    ]);
    expect(declaredTokens(css), 'the entry point declares a token of its own').toEqual([]);
  });

  it('is the file the package exports, so a consumer keeps its one import', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { exports: Record<string, string> };
    expect(manifest.exports['./tokens.css']).toBe('./src/styles/tokens.css');
  });
});

describe('AC2 — a palette value is a theme file’s business and nobody else’s', () => {
  it('references --mp-palette-* from theme files only', () => {
    const offenders = stylesheets()
      .filter((sheet) => !THEME_FILES.includes(sheet))
      .filter((sheet) => /var\(\s*--mp-palette-/.test(readFileSync(sheet, 'utf8')));
    expect(
      offenders.map((sheet) => relative(src, sheet)),
      'a component pinned to one theme is a component that cannot be themed (ADR-012 §3)',
    ).toEqual([]);
  });

  it('declares --mp-palette-* from theme files only', () => {
    const offenders = graph.filter(
      (declaration) => isPrimitive(declaration.token) && !THEME_FILES.includes(declaration.file),
    );
    expect(
      offenders.map((declaration) => `${relative(src, declaration.file)}: ${declaration.token}`),
    ).toEqual([]);
  });

  it('has no raw colour literal outside a theme file', () => {
    const sheets = stylesheets();
    // The walker proves itself before it proves anything else: an unproven walker would let this
    // suite pass by finding nothing at all, which is how a gate reports success for the rest of
    // its life (`memory/repo/gotchas.md`, the `database` job).
    expect(sheets, 'the stylesheet walker did not find tokens.css').toContain(TOKENS);
    expect(sheets, 'the stylesheet walker did not find the layers').toEqual(
      expect.arrayContaining(LAYERS),
    );

    for (const sheet of sheets.filter((file) => !THEME_FILES.includes(file))) {
      const offending = readFileSync(sheet, 'utf8')
        .split('\n')
        .filter((line) => /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/.test(line));
      expect(offending, `${relative(src, sheet)} hardcodes a colour`).toEqual([]);
    }
  });
});

describe('AC3 — a semantic token resolves in every theme, or it is not a token', () => {
  const semantic = declared.filter(isSemantic);

  it('declares semantic tokens at all', () => {
    expect(semantic.length).toBeGreaterThan(10);
    expect(semantic.filter((token) => token.startsWith('--mp-color-')).length).toBeGreaterThan(8);
  });

  for (const combination of COMBINATIONS) {
    it(`resolves every semantic token in ${label(combination)}`, () => {
      const unresolved = semantic.filter((token) => {
        try {
          resolve(graph, token, combination);
          return false;
        } catch {
          return true;
        }
      });
      expect(
        unresolved,
        `a half-converted palette is how text ends up black on near-black in the theme nobody looked at`,
      ).toEqual([]);
    });
  }

  it('gives every colour the same set of names in every theme', () => {
    const perTheme = new Map<string, string[]>();
    for (const declaration of graph.filter((entry) => THEME_FILES.includes(entry.file))) {
      if (!declaration.token.startsWith('--mp-color-')) continue;
      const theme = declaration.file.includes('contrast') ? 'contrast' : 'default';
      perTheme.set(theme, [...(perTheme.get(theme) ?? []), declaration.token]);
    }
    const [base, second] = [perTheme.get('default') ?? [], perTheme.get('contrast') ?? []];
    expect(base.length, 'the default theme declares no colour').toBeGreaterThan(0);
    expect([...new Set(second)].sort(), 'the two themes name different colours').toEqual(
      [...new Set(base)].sort(),
    );
  });
});

describe('AC4 — every reference names a token that exists', () => {
  // Theme files are excluded, and deliberately: a theme's palette references resolve only inside
  // that theme, which is what a theme *is*. That they resolve there is AC3's job — every semantic
  // token in every combination, and every one of those chains runs through a palette entry.
  //
  // Non-`--mp-` properties are excluded too. `--trigger-width` in `Combobox.module.css` is set on
  // the element by React Aria at runtime; it is not ours to declare and not ours to check.
  const referenced = new Map<string, string>();
  for (const sheet of stylesheets().filter((file) => !THEME_FILES.includes(file))) {
    for (const token of references(readFileSync(sheet, 'utf8'))) {
      if (token.startsWith('--mp-') && !referenced.has(token)) {
        referenced.set(token, relative(src, sheet));
      }
    }
  }

  for (const combination of COMBINATIONS) {
    it(`resolves every var(--mp-…) in the package in ${label(combination)}`, () => {
      const broken = [...referenced].filter(([token]) => {
        try {
          resolve(graph, token, combination);
          return false;
        } catch {
          return true;
        }
      });
      expect(broken.map(([token, sheet]) => `${sheet}: ${token}`)).toEqual([]);
    });
  }
});

describe('AC5 — a component token reads a role, never a value', () => {
  it('references only semantic tokens and its own family', () => {
    const offenders: string[] = [];
    for (const declaration of graph.filter((entry) => isComponent(entry.token))) {
      for (const reference of references(declaration.value)) {
        if (isSemantic(reference)) continue;
        if (isComponent(reference) && family(reference) === family(declaration.token)) continue;
        offenders.push(`${declaration.token} → ${reference}`);
      }
    }
    expect(offenders, 'ADR-012 §3: component tokens read the semantic layer').toEqual([]);
  });

  it('keeps the three layers in separate files', () => {
    const components = join(styles, 'components.css');
    const wrongLayer = graph
      .filter((entry) => entry.file === components && !isComponent(entry.token))
      .map((entry) => entry.token);
    expect(wrongLayer, 'components.css declares something that is not a component token').toEqual(
      [],
    );
  });
});

describe('AC6 — every theme is readable, measured rather than assumed', () => {
  const PAIRS: [string, string, number][] = [
    ['--mp-color-text', '--mp-color-bg', 4.5],
    ['--mp-color-text', '--mp-color-surface', 4.5],
    ['--mp-color-text-muted', '--mp-color-bg', 4.5],
    ['--mp-color-accent-contrast', '--mp-color-accent', 4.5],
    ['--mp-color-accent', '--mp-color-bg', 3],
    ['--mp-color-focus', '--mp-color-bg', 3],
  ];

  for (const combination of COMBINATIONS) {
    it(`meets WCAG AA in ${label(combination)}`, () => {
      const failures = PAIRS.map(([foreground, background, minimum]) => {
        const ratio = contrastRatio(
          resolve(graph, foreground, combination).value,
          resolve(graph, background, combination).value,
        );
        return ratio >= minimum
          ? null
          : `${foreground} on ${background}: ${ratio}:1, needs ${minimum}:1`;
      }).filter((failure) => failure !== null);
      expect(failures).toEqual([]);
    });
  }
});

describe('AC7/AC8 — a scheme can be chosen, and a preference is answered', () => {
  const css = readFileSync(TOKENS, 'utf8');

  it('lets the page override the media query in both directions', () => {
    expect(css).toContain('color-scheme: light dark');
    // Unanchored on purpose: a scheme applies to a subtree, so a container can carry one. Anchored
    // to `:root` it would reach the document and nothing else, and the four-up story would be four
    // copies of whatever the document happened to be set to.
    expect(css).toMatch(/(?<!:root)\[data-scheme=['"]light['"]\]\s*\{\s*color-scheme:\s*light/);
    expect(css).toMatch(/(?<!:root)\[data-scheme=['"]dark['"]\]\s*\{\s*color-scheme:\s*dark/);
  });

  it('resolves the light palette under data-scheme="light" and the dark one under dark', () => {
    const light = resolve(graph, '--mp-color-bg', { theme: 'default', scheme: 'light' }).value;
    const dark = resolve(graph, '--mp-color-bg', { theme: 'default', scheme: 'dark' }).value;
    expect(light).not.toBe(dark);
  });

  it('thickens borders and focus rings for prefers-contrast: more', () => {
    const stepped = parse([read(join(styles, 'scale.css'))]).filter((declaration) =>
      declaration.atRules.some((rule) => rule.includes('prefers-contrast: more')),
    );
    expect(
      stepped.map((declaration) => declaration.token).sort(),
      'the preference is answered structurally, without swapping a theme behind the page’s back',
    ).toEqual(['--mp-border-width', '--mp-focus-ring-width']);
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
    // `src/styles` is shipped because `./tokens.css` is served from source, not from the build —
    // and since `W12-T05` that directory has the four layers and the themes under it.
    expect(manifest.files).toContain('src/styles');
    expect(manifest.scripts['build']).toBeTruthy();
  });
});
