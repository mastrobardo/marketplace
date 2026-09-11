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

/** A role: what the value is *for*. The tier ADR-012 §3 lets any file in the package read. */
export const isSemantic = (token: string): boolean =>
  /^--mp-(?:color|space|radius|font|layout|border-width|focus-ring-width)\b/.test(token);

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
  /** Every token visited, in order, starting with the one asked for. */
  path: string[];
}

/**
 * Resolve a token to a literal for one combination, or throw naming the hop that broke. Throwing
 * rather than returning `undefined` is deliberate: a half-resolved token is how the old
 * string-matching gate passed on a palette that was missing a colour.
 */
export function resolve(
  declarations: Declaration[],
  token: string,
  combination: Combination,
  path: string[] = [],
): Resolution {
  if (path.includes(token)) {
    throw new UnresolvedToken(`${token} refers to itself (${path.join(' → ')})`);
  }
  const declaration = winner(declarations, token, combination);
  if (!declaration) {
    throw new UnresolvedToken(
      `${token} is not declared in ${label(combination)}` +
        (path.length > 0 ? ` (reached through ${path.join(' → ')})` : ''),
    );
  }
  const here = [...path, token];
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
    if (!reference) return { value: value.trim(), path: here };
    const [name = '', fallback] = splitTop(reference.args);
    let replacement: string;
    try {
      const resolved = resolve(declarations, name, combination, here);
      replacement = resolved.value;
      here.push(...resolved.path.slice(here.length));
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
