import { type Translations } from '../../../src/i18n/locales/es/index.js';

// Every key from es/ except 'footer.rights' — which is exactly the mistake this must catch.
export const incomplete = {
  'app.name': 'Marketplace',
  'app.tagline': 'Renovations, home maintenance and emergencies',
  'nav.home': 'Home',
  'nav.skipToContent': 'Skip to content',
  'home.title': 'Find a professional you can trust',
  'home.intro': 'Renovations, home maintenance and emergency call-outs.',
  'notFound.title': 'Page not found',
  'notFound.body': 'The address you opened does not exist, or it has moved.',
  'notFound.back': 'Back to home',
  'language.label': 'Language',
  'language.es': 'Español',
  'language.en': 'English',
} satisfies Translations;
