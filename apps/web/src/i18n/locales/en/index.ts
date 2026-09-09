/**
 * `satisfies` on each namespace file is the enforcement mechanism (see `../mirror.ts`): a key
 * missing there is a compile error naming it, and a key Spanish never defined is an
 * excess-property error. That is what "a missing translation fails the build" means in this repo.
 *
 * `satisfies Translations` here catches the remaining case the per-namespace check cannot see: a
 * whole namespace that exists in `es/` and was never imported.
 */
import { app } from './app.js';
import { footer } from './footer.js';
import { home } from './home.js';
import { language } from './language.js';
import { nav } from './nav.js';
import { notFound } from './notFound.js';
import type { Translations } from '../es/index.js';

export const en = {
  ...app,
  ...footer,
  ...home,
  ...language,
  ...nav,
  ...notFound,
} satisfies Translations;
