import { type Translations } from './es.js';

/**
 * `satisfies Translations` is the whole enforcement mechanism: a key missing here is a compile
 * error naming it, and a key that exists here but not in `es.ts` is an excess-property error.
 * That is what "a missing translation fails the build" means in this repo.
 */
export const en = {
  'app.name': 'Marketplace',
  'app.tagline': 'Renovations, home maintenance and emergencies',

  'nav.home': 'Home',
  'nav.skipToContent': 'Skip to content',

  'home.title': 'Find a professional you can trust',
  'home.intro':
    'Renovations, home maintenance and emergency call-outs, with verified professionals near you.',

  'notFound.title': 'Page not found',
  'notFound.body': 'The address you opened does not exist, or it has moved.',
  'notFound.back': 'Back to home',

  'language.label': 'Language',
  'language.es': 'Español',
  'language.en': 'English',

  'footer.rights': 'All rights reserved',
} satisfies Translations;
