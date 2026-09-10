// @vitest-environment node
//
// Filesystem and compiler assertions, not DOM ones: under jsdom `import.meta.url` is an http URL
// and `fileURLToPath` rejects it.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupI18n, t } from '../src/i18n/index.js';
import { en } from '../src/i18n/locales/en.js';
import { es } from '../src/i18n/locales/es.js';

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
/**
 * The local binary rather than `npx tsc`, which re-resolves the package on every call.
 *
 * Touched by `W1-T06` (`agent-contracts`), outside its slice and deliberately: adding two more
 * fixture compilations to `packages/contracts` put enough load on turbo's parallel test tasks to
 * push this suite past the 5s default, and `MEM-2026-09-09-02` already records that a test which
 * shells out needs an explicit timeout in the options-object form. No behaviour changed.
 */
const tsc = fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url));

function typecheckFixture(name: string): { ok: boolean; output: string } {
  try {
    execFileSync(tsc, ['-p', `tests/fixtures/${name}/tsconfig.json`], {
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
  it('compiles a fixture that uses only real keys', { timeout: 120_000 }, () => {
    const result = typecheckFixture('valid');
    expect(result.ok, `the valid fixture did not compile:\n${result.output}`).toBe(true);
  });

  it('refuses a component that translates a key nobody defined', { timeout: 120_000 }, () => {
    const result = typecheckFixture('unknown-key');
    expect(result.ok, 'an unknown translation key compiled').toBe(false);
    expect(result.output).toContain('this.key.does.not.exist');
  });

  it(
    'refuses a catalogue that is missing a key the source of truth defines',
    { timeout: 120_000 },
    () => {
      const result = typecheckFixture('incomplete-catalogue');
      expect(result.ok, 'an incomplete catalogue compiled').toBe(false);
    },
  );
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
