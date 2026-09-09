/**
 * The source of truth. Its keys define `TranslationKey`, so every other catalogue must satisfy
 * this shape exactly — a key added here is a compile error in `en/` until it is translated.
 *
 * Spain first (`TODO.md` §1): a feature is specified in Spanish, so it is written in Spanish, and
 * the untranslated language is the one that fails the build.
 *
 * Flat dotted keys on purpose. Nested catalogues read better and compare worse: `keyof` gives you
 * one level, and the parity test then has to walk a tree it could have compared as a set. The
 * namespace is the *file*, not a level of nesting — `nav.home` is still one key.
 *
 * **One namespace per line, sorted.** A slice adds `<slice>.ts` beside this file and one import
 * and one spread here. Sorted, those two lines land at different offsets for different slices, so
 * two branches adding namespaces in parallel merge without a human (`W0-T23`).
 */
import { app } from './app.js';
import { footer } from './footer.js';
import { home } from './home.js';
import { language } from './language.js';
import { nav } from './nav.js';
import { notFound } from './notFound.js';

export const es = {
  ...app,
  ...footer,
  ...home,
  ...language,
  ...nav,
  ...notFound,
} as const;

/** Every key the application may translate. An unknown key is a compile error, not a fallback. */
export type TranslationKey = keyof typeof es;

/** The shape every other catalogue must match: same keys, no more, no fewer. */
export type Translations = Record<TranslationKey, string>;
