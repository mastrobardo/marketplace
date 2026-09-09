// @vitest-environment node
//
// Filesystem and compiler assertions, not DOM ones: under jsdom `import.meta.url` is an http URL
// and `fileURLToPath` rejects it.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setupI18n, t } from '../src/i18n/index.js';
import { en } from '../src/i18n/locales/en/index.js';
import { es } from '../src/i18n/locales/es/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('AC7/AC8 — the catalogues agree, and say something', () => {
  it('has exactly the same keys in both languages', () => {
    const spanish = Object.keys(es).sort();
    const english = Object.keys(en).sort();
    expect(spanish.length, 'the Spanish catalogue is empty').toBeGreaterThan(0);
    expect(english).toEqual(spanish);
  });

  it('has a non-empty string for every key in both languages', () => {
    for (const [language, catalogue] of [
      ['es', es],
      ['en', en],
    ] as const) {
      for (const [key, value] of Object.entries(catalogue)) {
        expect(typeof value, `${language}.${key} is not a string`).toBe('string');
        expect((value as string).trim(), `${language}.${key} is empty`).not.toBe('');
      }
    }
  });
});

/**
 * "A missing translation key fails the build" is only true if it is compiled and observed. Each
 * fixture is a tiny package with its own tsconfig; the assertion is `tsc`'s exit code.
 */
function typecheckFixture(name: string): { ok: boolean; output: string } {
  try {
    execFileSync('npx', ['tsc', '-p', `tests/fixtures/${name}/tsconfig.json`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: '' };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('AC9/AC10/AC11 — a missing translation is a build failure', () => {
  it('compiles a fixture that uses only real keys', () => {
    const result = typecheckFixture('valid');
    expect(result.ok, `the valid fixture did not compile:\n${result.output}`).toBe(true);
  });

  it('refuses a component that translates a key nobody defined', () => {
    const result = typecheckFixture('unknown-key');
    expect(result.ok, 'an unknown translation key compiled').toBe(false);
    expect(result.output).toContain('this.key.does.not.exist');
  });

  it('refuses a catalogue that is missing a key the source of truth defines', () => {
    const result = typecheckFixture('incomplete-catalogue');
    expect(result.ok, 'an incomplete catalogue compiled').toBe(false);
  });

  // `W0-T23`: the per-namespace `Mirror` check has to enforce both directions, or the catalogues
  // drift apart without either one ever being *missing* a key.
  it('refuses a namespace that translates a key Spanish never defined', () => {
    const result = typecheckFixture('excess-key');
    expect(result.ok, 'a namespace with an invented key compiled').toBe(false);
    expect(result.output).toContain('nav.invented');
  });
});

describe('AC12 — an unknown key at runtime is loud, not silent', () => {
  it('throws rather than rendering the raw key', async () => {
    await setupI18n();
    // Cast: the whole point is a key the type system would have rejected, reaching t() the only
    // way it can in practice — built at runtime from data.
    const dynamicKey = 'nope.not.a.key' as Parameters<typeof t>[0];
    expect(() => t(dynamicKey)).toThrow(/nope\.not\.a\.key/);
  });
});

/**
 * `W0-T23`: the catalogues are split one file per namespace so that seven slice agents adding keys
 * in parallel touch seven different files. The barrel is the one shared file left, and it is
 * hand-written — so it needs a guard, or a namespace nobody registered is simply invisible.
 */
describe('AC4 — every namespace is registered, and the languages mirror each other', () => {
  const namespacesOnDisk = (language: 'es' | 'en'): string[] =>
    readdirSync(new URL(`../src/i18n/locales/${language}`, import.meta.url))
      .filter((file) => file.endsWith('.ts') && file !== 'index.ts')
      .map((file) => file.replace(/\.ts$/, ''))
      .sort();

  const namespacesInBarrel = (language: 'es' | 'en'): string[] => {
    const source = readFileSync(
      new URL(`../src/i18n/locales/${language}/index.ts`, import.meta.url),
      'utf8',
    );
    return [...source.matchAll(/^import \{ (\w+) \} from '\.\/[\w.]+\.js';$/gm)]
      .map((match) => match[1] as string)
      .sort();
  };

  it.each(['es', 'en'] as const)('registers every %s namespace file in its barrel', (language) => {
    const onDisk = namespacesOnDisk(language);
    expect(onDisk.length, `no namespace files under locales/${language}`).toBeGreaterThan(0);
    expect(
      namespacesInBarrel(language),
      `locales/${language}/index.ts does not import every namespace beside it`,
    ).toEqual(onDisk);
  });

  it('has the same namespaces in both languages', () => {
    expect(namespacesOnDisk('en')).toEqual(namespacesOnDisk('es'));
  });

  it('imports and spreads the same namespaces, sorted, one per line', () => {
    // Sorted, one per line, is what lets two branches adding different namespaces merge without
    // a human: they land at different offsets with unchanged context between them. An import with
    // no matching spread is the quieter bug — the namespace compiles and never reaches i18next.
    for (const language of ['es', 'en'] as const) {
      const imported = namespacesInBarrel(language);
      const source = readFileSync(
        new URL(`../src/i18n/locales/${language}/index.ts`, import.meta.url),
        'utf8',
      );
      const spread = [...source.matchAll(/^\s*\.\.\.(\w+),$/gm)].map((match) => match[1] as string);

      expect(imported, `locales/${language}/index.ts imports are not sorted`).toEqual(
        [...imported].sort(),
      );
      expect(
        spread,
        `locales/${language}/index.ts spreads a different set than it imports`,
      ).toEqual(imported);
    }
  });
});
