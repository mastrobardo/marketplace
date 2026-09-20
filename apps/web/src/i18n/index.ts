import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';

/**
 * **Translations are data, not code** — operator, 2026-09-20: *"translations should go on jsons.
 * Which, in a future, might come from some online service. Having them in the code is a nogo."*
 *
 * These were `es.ts`/`en.ts`, two `as const` objects whose keys defined a `TranslationKey` union, so
 * a typo at a call site and a key missing from `en` were both compile errors. That mechanism still
 * works over a JSON module — `keyof typeof es` yields the same literal union under
 * `moduleResolution: Bundler` — and it was **deliberately not kept**.
 *
 * The reason is the premise behind the move: if the catalogue is going to be owned by a translation
 * service, its keys are not knowable at compile time, and a union derived from the snapshot checked
 * into this repo is true only until the first fetch. Deriving types from it would re-couple
 * translations to the code in the change meant to free them.
 *
 * **What guards this instead already existed** and does not depend on where the catalogue came from:
 * `tests/i18n.test.ts` asserts the two files have identical key sets and no empty values, and
 * `missingKeyHandler` below throws on an unknown key rather than rendering it. Those run against
 * real data, which is the only thing that will still be true when the data arrives over HTTP.
 */

/**
 * A translation key. `string`, and the alias is kept so call sites still read as intentional —
 * `features/auth/schema.ts` maps validation failures to keys and means something by it.
 */
export type TranslationKey = string;

/** Spain first. The order matters: the first entry is the default and the fallback. */
export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

const NAMESPACE = 'translation';

/**
 * Build the i18next instance.
 *
 * `keySeparator: false` and `nsSeparator: false` because our keys **contain dots**
 * (`nav.home` is one key, not `home` inside `nav`). Left at their defaults, i18next would read
 * `nav.home` as a path into a nested object, find nothing, and fall back to rendering the key —
 * exactly the failure this task exists to prevent.
 */
export async function setupI18n(): Promise<I18n> {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources: {
        es: { [NAMESPACE]: es },
        en: { [NAMESPACE]: en },
      },
      lng: LOCALES[0],
      fallbackLng: LOCALES[0],
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false }, // React escapes for us.
      saveMissing: true,
      // A key the compiler could not check — one built at runtime from data — must not reach a
      // user as raw text. Failing loudly in development is the only way that gets fixed.
      missingKeyHandler: (_languages, _ns, key) => {
        throw new Error(`Missing translation key: ${key}`);
      },
    });
  }
  applyDocumentLanguage(i18next.language);
  return i18next;
}

function applyDocumentLanguage(language: string): void {
  // Guarded so the module is usable outside a browser — tests, and any future SSR.
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

/** Switch language. An unknown locale is ignored rather than blanking the UI. */
export async function changeLanguage(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  await i18next.changeLanguage(locale);
  applyDocumentLanguage(locale);
}

/** Translate outside a component. Inside one, use `useTranslation()`. */
export function t(key: TranslationKey): string {
  return i18next.t(key);
}

export { i18next };
