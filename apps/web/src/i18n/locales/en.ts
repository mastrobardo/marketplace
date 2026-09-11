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

  'home.categories.title': 'All services',
  'home.categories.intro':
    'Every service is a search already started — pick one and tell us where.',

  'home.how.title': 'How it works',
  'home.how.search.title': 'Tell us what you need',
  'home.how.search.body': 'Pick the service, your area, and when you need it.',
  'home.how.compare.title': 'Compare professionals',
  'home.how.compare.body': 'Look at profiles, ratings and quotes before you decide.',
  'home.how.hire.title': 'Hire with confidence',
  'home.how.hire.body': 'Book directly or accept a quote, and pay through the platform.',

  'home.trust.title': 'Why hire here',
  'home.trust.verified.title': 'Verified professionals',
  'home.trust.verified.body':
    'We check identity and, where the trade requires it, a licence that is still valid.',
  'home.trust.reviews.title': 'Reviews from real jobs',
  'home.trust.reviews.body':
    'Only people who hired can review, and every review is published next to the job behind it.',
  'home.trust.payment.title': 'Protected payment',
  'home.trust.payment.body':
    'The money is released to the professional once the work is done, not before.',

  'home.pro.title': 'Are you a professional?',
  'home.pro.body':
    'Get requests from clients in your area, choose the jobs you take, and get paid through the platform.',
  'home.pro.cta': 'Work with us',

  'pro.title': 'Work with us',
  'pro.intro':
    'Set up your profile, get requests from your area, and choose the jobs you take. No sign-up fee.',
  'pro.benefits.title': 'How we work with professionals',
  'pro.benefits.leads.title': 'Requests from your area',
  'pro.benefits.leads.body': 'You only hear about jobs inside the radius you set.',
  'pro.benefits.control.title': 'You decide',
  'pro.benefits.control.body': 'Take what fits and turn down the rest, with no penalty.',
  'pro.benefits.payment.title': 'Payment guaranteed',
  'pro.benefits.payment.body': 'The client pays through the platform before you start the work.',
  'pro.pending': 'Registration for professionals is not open yet.',

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
  'search.hero.label': 'Search for professionals near you',
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

  'search.filters.label': 'Filter results',

  'results.title': 'Professionals near you',
  'results.showing': 'Showing {{count}} professionals',
  'results.facets.title': 'Filters',
  'results.facets.kinds': 'Type of professional',
  'results.next': 'Next',
  'results.more': 'More results',
  'results.quoteOnly': 'Quote only',
  'results.perHour': '{{rate}} / h',
  'results.unrated': 'No reviews yet',
  'results.rating': '{{average}} ({{count}})',
  'results.kind.PRO': 'Professional',
  'results.kind.MANITAS': 'Handyperson',
  'results.needWhere.title': 'Where do you need the work done?',
  'results.needWhere.body':
    'Tell us your postcode or your city and we will show you the professionals who work in your area.',
  'results.empty.title': 'We found no professionals',
  'results.empty.body': 'Try widening the area or removing a filter.',
  'results.empty.filters': 'You searched for:',
  'results.empty.clear': 'Clear the filters',
  'results.error.body': 'We could not load the results. Please try again in a moment.',
  'results.map.title': 'Map',
  'results.map.pending': 'The map is not available yet.',
  'results.filter.what': 'Service',
  'results.filter.where': 'Where',
  'results.filter.when': 'When',
  'results.filter.mode': 'How',

  'provider.kind.PRO': 'Professional',
  'provider.kind.MANITAS': 'Handyperson',
  'provider.about.title': 'About {{name}}',
  'provider.about.pending': 'They have not written a description yet.',
  'provider.services.title': 'Services',
  'provider.rating.summary': '{{average}} out of 5 ({{count}} reviews)',
  'provider.rating.none': 'No reviews yet',
  'provider.rate.hourly': '{{rate}} / h',
  'provider.rate.quote': 'Quote only',
  'provider.area.title': 'Working area',
  'provider.area.radius': 'Works up to {{distance}} km from {{city}}',
  'provider.area.unset': 'They have not stated their working area yet.',
  'provider.memberSince': 'On the platform since {{date}}',
  'provider.gallery.title': 'Past work',
  'provider.gallery.pending': 'Photos of past work are not available yet.',
  'provider.badges.title': 'Credentials',
  'provider.badges.pending': 'Credentials and licences are not available yet.',
  'provider.reviews.title': 'Reviews',
  'provider.reviews.pending': 'Customer reviews cannot be read here yet.',
  'provider.cta.title': 'Contact {{name}}',
  'provider.cta.body':
    'Client accounts are not open yet, so there is no way to get in touch from here for now.',
  'provider.notFound.title': 'This professional is no longer listed',
  'provider.notFound.body': 'They may have taken their profile down, or the link may be an old one.',
  'provider.notFound.search': 'Search for professionals',
  'provider.error.body': 'We could not load this profile. Please try again in a moment.',

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
