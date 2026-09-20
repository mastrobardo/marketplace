// @vitest-environment node
//
// Data assertions, not DOM ones.
//
// **These are now the only thing standing between a missing translation and a user.** Until
// `W12-T21` the catalogues were TypeScript, their keys defined a `TranslationKey` union, and a key
// missing from `en` was a compile error proven by three fixtures that shelled out to `tsc`. The
// catalogues are JSON now, because a catalogue a translation service will own cannot live in the
// source tree (operator, 2026-09-20) — and a key union derived from the snapshot in this repo would
// stop being true the first time the data arrived over HTTP.
//
// So the fixtures went with the mechanism they tested, and these two assertions carry the weight.
// They are better suited to it than what they replaced: they run against the real catalogues, and
// they will still run when those catalogues are fetched rather than imported.
import { describe, expect, it } from 'vitest';
import { setupI18n, t } from '../src/i18n/index.js';
import en from '../src/i18n/locales/en.json';
import es from '../src/i18n/locales/es.json';

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

describe('AC12 — an unknown key at runtime is loud, not silent', () => {
  it('throws rather than rendering the raw key', async () => {
    await setupI18n();
    // Cast: the whole point is a key the type system would have rejected, reaching t() the only
    // way it can in practice — built at runtime from data.
    const dynamicKey = 'nope.not.a.key' as Parameters<typeof t>[0];
    expect(() => t(dynamicKey)).toThrow(/nope\.not\.a\.key/);
  });
});
