/**
 * The token graph, resolved the way a browser would resolve it.
 *
 * `tokens.test.ts` used to assert on the *text* of `tokens.css`: a token was "defined for dark" if
 * its name appeared somewhere after the media query. That was enough for one flat file with one
 * theme. It is not enough for `W12-T05`, where a semantic token may be declared once with
 * `light-dark()`, overridden by a theme two files later, and read through three hops before it
 * reaches a colour — and where ADR-012 §3's word is *resolves*, not *is declared somewhere*.
 *
 * So this parses the stylesheets, picks the winning declaration for a given `theme × scheme`, and
 * follows `var()` and `light-dark()` to a literal. It is a model of the cascade, not the cascade:
 * it understands `:root`, `[data-theme]`, `[data-scheme]` and `prefers-color-scheme`, which is
 * every selector these four files contain, and it refuses anything else rather than guessing. The
 * runtime proof that the model is faithful is `Theme.stories.tsx`, which asks a real Chromium.
 */
import { readFileSync } from 'node:fs';

export type Scheme = 'light' | 'dark';
export type Theme = 'default' | 'contrast';

export interface Combination {
  theme: Theme;
  scheme: Scheme;
}

/** Every combination this design system ships, which is every combination it is tested in. */
export const COMBINATIONS: Combination[] = [
  { theme: 'default', scheme: 'light' },
  { theme: 'default', scheme: 'dark' },
  { theme: 'contrast', scheme: 'light' },
  { theme: 'contrast', scheme: 'dark' },
];

export const label = ({ theme, scheme }: Combination): string => `${theme}/${scheme}`;

export interface Declaration {
  token: string;
  value: string;
  selector: string;
  atRules: string[];
  /** Source order across all files, in the order `tokens.css` imports them. */
  order: number;
  file: string;
}

/** `--mp-palette-*`: a value with no meaning. Only a theme file may read one. */
export const isPrimitive = (token: string): boolean => token.startsWith('--mp-palette-');

/**
 * A role: what the value is *for*. The tier ADR-012 §3 lets any file in the package read.
 *
 * `elevation` joined the list in `W12-T18`. A shadow is a colour with extra steps — it resolves
 * through `--mp-palette-shadow-*`, so it has to be declared in a theme file, and a theme file may
 * only declare a primitive or a role. Left out of this list it would have classified as a
 * *component* token declared outside `components.css`, and AC5 would have failed it for reading a
 * palette entry — which is the one thing an elevation token has to do.
 */
export const isSemantic = (token: string): boolean =>
  /^--mp-(?:color|space|radius|font|layout|elevation|border-width|focus-ring-width)\b/.test(token);

/** A use: `--mp-button-bg`. Everything that is neither of the above. */
export const isComponent = (token: string): boolean => !isPrimitive(token) && !isSemantic(token);

/** `--mp-button-bg-primary` → `button`. The family a component token belongs to. */
export const family = (token: string): string => token.replace(/^--mp-/, '').split('-')[0] ?? '';

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Declarations in source order, with the selector and at-rules they sit under. A hand-rolled scan
 * rather than a CSS parser dependency: these files are custom properties inside `:root`, and a
 * parser that understood more would be a parser nobody could check.
 */
export function parse(files: { path: string; css: string }[]): Declaration[] {
  const declarations: Declaration[] = [];
  for (const { path, css } of files) {
    const stack: string[] = [];
    let buffer = '';
    for (const character of stripComments(css)) {
      if (character === '{') {
        stack.push(buffer.trim());
        buffer = '';
      } else if (character === '}') {
        stack.pop();
        buffer = '';
      } else if (character === ';') {
        const match = /^(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/.exec(buffer.trim());
        buffer = '';
        if (!match || stack.length === 0) continue;
        declarations.push({
          token: match[1] ?? '',
          value: (match[2] ?? '').trim(),
          selector: stack.filter((entry) => !entry.startsWith('@')).at(-1) ?? '',
          atRules: stack.filter((entry) => entry.startsWith('@')),
          order: declarations.length,
          file: path,
        });
      } else {
        buffer += character;
      }
    }
  }
  return declarations;
}

/** Every `--mp-…` a value reads, whether through `var()` or otherwise. */
export function references(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1] ?? '');
}

const ATTRIBUTE = /\[data-(theme|scheme)=['"]([a-z]+)['"]\]/g;

/**
 * Does one of a rule's selectors select this combination? A theme applies to a subtree, not only to
 * the document — `[data-theme='contrast']` on a `div` themes what is inside it, which is what lets
 * one story show all four combinations at once.
 */
function selectorMatches(selector: string, { theme, scheme }: Combination): boolean {
  return selector.split(',').some((part) => {
    const trimmed = part.trim();
    const attributes = [...trimmed.matchAll(ATTRIBUTE)];
    // Anything this model does not understand is not silently treated as a match.
    const remainder = trimmed.replace(ATTRIBUTE, '').replace(':root', '').trim();
    if (remainder !== '') return false;
    if (attributes.length === 0 && !trimmed.includes(':root')) return false;
    return attributes.every(([, name, value]) =>
      name === 'theme' ? value === theme : value === scheme,
    );
  });
}

function atRulesMatch(atRules: string[], { scheme }: Combination): boolean {
  return atRules.every((rule) =>
    rule.includes('prefers-color-scheme: dark') ? scheme === 'dark' : false,
  );
}

/**
 * `:root` and `[data-theme='contrast']` are both (0,1,0) — so between them it is source order that
 * decides, and `tokens.css` imports the themes in the order they should win. Counted rather than
 * assumed, because getting this backwards would make the model disagree with the browser silently.
 */
const specificity = (selector: string): number =>
  Math.max(
    ...selector
      .split(',')
      .map((part) => (part.match(/\[/g) ?? []).length + (part.match(/:/g) ?? []).length),
  );

export function winner(
  declarations: Declaration[],
  token: string,
  combination: Combination,
): Declaration | undefined {
  return declarations
    .filter(
      (declaration) =>
        declaration.token === token &&
        atRulesMatch(declaration.atRules, combination) &&
        selectorMatches(declaration.selector, combination),
    )
    .sort((a, b) => specificity(a.selector) - specificity(b.selector) || a.order - b.order)
    .at(-1);
}

/** Split on commas at paren depth zero — `light-dark(var(a), var(b))` has one top-level comma. */
function splitTop(argument: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of argument) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += character;
  }
  parts.push(current.trim());
  return parts;
}

/** The first `name(…)` call in `value`, with the span it occupies. */
function call(value: string, name: string): { start: number; end: number; args: string } | null {
  const start = value.indexOf(`${name}(`);
  if (start === -1) return null;
  let depth = 0;
  for (let index = start + name.length; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    else if (value[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          start,
          end: index + 1,
          args: value.slice(start + name.length + 1, index),
        };
      }
    }
  }
  return null;
}

export class UnresolvedToken extends Error {}

export interface Resolution {
  /** The literal the chain ends at — `#fbfaf9`, `1rem`, `rgb(0 0 0 / 45%)`. */
  value: string;
  /**
   * Every token visited, in order, starting with the one asked for. A token read twice by one
   * value appears twice — that is a fact about the value, not a cycle.
   */
  path: string[];
}

/**
 * Resolve a token to a literal for one combination, or throw naming the hop that broke. Throwing
 * rather than returning `undefined` is deliberate: a half-resolved token is how the old
 * string-matching gate passed on a palette that was missing a colour.
 *
 * `ancestors` is the chain currently being resolved — *only* the tokens this one is nested inside —
 * and it is what the cycle check reads. It used to be the same array as the visited record, which
 * made a token used **twice in one value** indistinguishable from a cycle: the second occurrence
 * found the first already listed and threw "refers to itself". Nothing referenced the same token
 * twice until `W12-T18`'s elevation set put `--mp-palette-shadow-65` in both layers of one shadow,
 * so the bug had never been reachable. A sibling is not an ancestor.
 */
export function resolve(
  declarations: Declaration[],
  token: string,
  combination: Combination,
  ancestors: string[] = [],
): Resolution {
  if (ancestors.includes(token)) {
    throw new UnresolvedToken(`${token} refers to itself (${[...ancestors, token].join(' → ')})`);
  }
  const declaration = winner(declarations, token, combination);
  if (!declaration) {
    throw new UnresolvedToken(
      `${token} is not declared in ${label(combination)}` +
        (ancestors.length > 0 ? ` (reached through ${ancestors.join(' → ')})` : ''),
    );
  }
  const chain = [...ancestors, token];
  const visited: string[] = [token];
  let value = declaration.value;
  let guard = 0;
  for (;;) {
    if ((guard += 1) > 64) throw new UnresolvedToken(`${token} does not settle`);

    const scheme = call(value, 'light-dark');
    if (scheme) {
      const [lightValue = '', darkValue = ''] = splitTop(scheme.args);
      value =
        value.slice(0, scheme.start) +
        (combination.scheme === 'dark' ? darkValue : lightValue) +
        value.slice(scheme.end);
      continue;
    }

    const reference = call(value, 'var');
    if (!reference) return { value: value.trim(), path: visited };
    const [name = '', fallback] = splitTop(reference.args);
    let replacement: string;
    try {
      const resolved = resolve(declarations, name, combination, chain);
      replacement = resolved.value;
      visited.push(...resolved.path);
    } catch (error) {
      if (fallback === undefined) throw error;
      replacement = fallback;
    }
    value = value.slice(0, reference.start) + replacement + value.slice(reference.end);
  }
}

export const read = (path: string): { path: string; css: string } => ({
  path,
  css: readFileSync(path, 'utf8'),
});

/* ------------------------------------------------------------------ colour */

/** `#rgb`, `#rrggbb` → channels. Anything else is not a colour this gate can measure. */
export function channels(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) return null;
  const digits = hex[1] ?? '';
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

const channelLuminance = (channel: number): number => {
  const ratio = channel / 255;
  return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.1 relative luminance, and the ratio built from it. */
export function contrastRatio(foreground: string, background: string): number {
  const front = channels(foreground);
  const back = channels(background);
  if (!front || !back)
    throw new UnresolvedToken(`${foreground} on ${background} is not measurable`);
  const luminance = (rgb: [number, number, number]): number =>
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2]);
  const [lighter, darker] = [luminance(front), luminance(back)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/* --------------------------------------------------- composed colour pairs */

/**
 * The pairs of tokens a component actually renders one on top of the other, derived from the
 * component-token graph rather than written down.
 *
 * `W12-T18` AC6 replaced a six-entry literal list, which had the failure mode every hand-written
 * gate has: `--mp-color-text-muted` on `--mp-color-surface` was not among the six, and it is what
 * every `Card` description renders in. A gate that names its subjects by hand only ever checks the
 * ones somebody remembered.
 *
 * The honest limit (spec §10 Q2): only a stylesheet knows which surface a foreground lands on.
 * `--mp-card-description-fg` and `--mp-card-bg` are a pair because `Card.module.css` uses them
 * together. So the derivation works **per component family** and pairs by *variant*:
 *
 *   --mp-button-fg-primary        variant "primary"       → --mp-button-bg-primary
 *   --mp-listbox-option-focus-fg  variant "option-focus"  → --mp-listbox-option-focus-bg
 *   --mp-card-description-fg      variant "description"   → no match, so the family's own
 *                                                           background and its hover state
 *
 * A foreground with an exact variant match is paired with *that* background and nothing else.
 * Without that rule `--mp-listbox-option-focus-fg` would also be measured against
 * `--mp-listbox-bg` — white on white, a failure for a composition that never happens. Over-measuring
 * is the safe direction only while the extra pairs are real.
 */
const STATE_VARIANTS = new Set(['hover', 'active', 'selected', 'focus']);

/** `--mp-button-fg-primary` → `primary`; `--mp-card-bg` → ``. The variant, with the role removed. */
function variant(token: string, roles: readonly string[]): string | null {
  const parts = token
    .replace(/^--mp-/, '')
    .split('-')
    .slice(1);
  const at = parts.findIndex((part) => roles.includes(part));
  if (at === -1) return null;
  return [...parts.slice(0, at), ...parts.slice(at + 1)].join('-');
}

export interface Pair {
  foreground: string;
  background: string;
}

export function composedPairs(declarations: Declaration[]): Pair[] {
  const components = [...new Set(declarations.map((entry) => entry.token))].filter(isComponent);

  const foregrounds = new Map<string, string>();
  const backgrounds = new Map<string, string>();
  for (const token of components) {
    const asForeground = variant(token, ['fg', 'color']);
    if (asForeground !== null) foregrounds.set(token, asForeground);
    const asBackground = variant(token, ['bg']);
    if (asBackground !== null) backgrounds.set(token, asBackground);
  }

  const pairs: Pair[] = [];
  for (const [foreground, key] of foregrounds) {
    const sameFamily = [...backgrounds].filter(
      ([background]) => family(background) === family(foreground),
    );
    const exact = sameFamily.filter(([, backgroundKey]) => backgroundKey === key);
    const chosen =
      exact.length > 0
        ? exact
        : sameFamily.filter(
            ([, backgroundKey]) => backgroundKey === '' || STATE_VARIANTS.has(backgroundKey),
          );
    for (const [background] of chosen) pairs.push({ foreground, background });
  }
  return pairs.sort(
    (a, b) => a.foreground.localeCompare(b.foreground) || a.background.localeCompare(b.background),
  );
}
