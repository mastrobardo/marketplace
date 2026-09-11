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

  'nav.search': 'Search',
  'nav.primary': 'Primary',
  'nav.legal': 'Legal',

  'search.submit': 'Search',
  'search.expand': 'Open the search box',
  'search.label': 'Search for professionals',
  'search.what.label': 'Service',
  'search.what.placeholder': 'What do you need?',
  'search.what.empty': 'No matching services',
  'search.where.label': 'Where',
  'search.where.placeholder': 'Postcode or city',
  'search.where.empty': 'Type your postcode',
  'search.where.required': 'Tell us where you need the work done',
  'search.when.label': 'When',
  'search.when.placeholder': 'Any time',
  'search.when.urgente': "It's an emergency",
  'search.when.hoy': 'Today',
  'search.when.semana': 'This week',
  'search.when.flexible': 'No rush',
  'search.mode.label': 'How',
  'search.mode.placeholder': 'Either way',
  'search.mode.quote': 'Request a quote',
  'search.mode.booking': 'Book directly',

  'legal.terms.title': 'Terms and conditions',
  'legal.privacy.title': 'Privacy policy',
  'legal.cookies.title': 'Cookie policy',
  'legal.pending':
    'This document is not published yet. It is being drafted by a lawyer and will be published before launch.',

  'error.title': 'Something went wrong',
  'error.body': 'We could not load this page. Please try again in a moment.',
  'error.retry': 'Try again',

  'footer.rights': 'All rights reserved',
} satisfies Translations;
