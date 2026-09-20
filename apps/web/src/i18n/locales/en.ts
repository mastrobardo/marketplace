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
  'pro.pending':
    'Start by creating your account. Signing up as a professional comes after that, and is not open yet.',

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
  'provider.notFound.body':
    'They may have taken their profile down, or the link may be an old one.',
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

  'nav.login': 'Log in',
  'nav.signup': 'Sign up',
  'nav.logout': 'Log out',
  'nav.account': 'Your account',

  'account.title': 'Your account',
  'account.email.label': 'Email address',
  'account.signOut': 'Log out',
  'account.plan.title': 'Your plan',
  'account.plan.body':
    'Every account is free right now. When paid plans exist, this is where they are managed.',

  'auth.signup.title': 'Create your account',
  'auth.signup.intro': 'An account lets you request quotes and talk to professionals. It is free.',
  'auth.signup.submit': 'Create account',
  'auth.signup.haveAccount': 'Got an account? Log in',

  'auth.login.title': 'Log in to your account',
  'auth.login.submit': 'Log in',
  'auth.login.noAccount': 'No account yet? Create one',
  'auth.login.refused': 'We could not log you in with those details. Check them and try again.',
  'auth.login.forgot': 'Forgotten your password?',

  'auth.field.name.label': 'Name',
  'auth.field.email.label': 'Email address',
  'auth.field.password.label': 'Password',
  'auth.field.password.hint': 'At least 8 characters.',
  'auth.field.newPassword.label': 'New password',
  'auth.field.confirmPassword.label': 'Repeat the password',

  'auth.error.name.required': 'Enter your name.',
  'auth.error.email.invalid': 'Enter a valid email address.',
  'auth.error.password.required': 'Enter your password.',
  'auth.error.password.tooShort': 'The password must be at least 8 characters.',
  'auth.error.password.tooLong': 'The password cannot be longer than 128 characters.',
  'auth.error.password.mismatch': 'The two passwords do not match.',
  'auth.error.failed': 'We could not complete that. Please try again.',
  'auth.pending': 'Sending…',
  'auth.error.unreachable': 'We could not reach the service. Please try again in a moment.',

  'auth.inbox.title': 'Check your email',
  'auth.inbox.body': 'We sent a link to {{email}}. Open it to confirm your address.',
  'auth.inbox.spam': 'If it has not arrived in a few minutes, look in your spam folder.',
  'auth.inbox.resend': 'Send another link',
  'auth.inbox.resent': 'We sent another link.',
  'auth.inbox.resendFailed':
    'We could not send the message. Sending email is not switched on in this environment yet.',

  'auth.verify.verified.title': 'Your address is confirmed',
  'auth.verify.verified.body': 'Your account is ready to use.',
  'auth.verify.verified.continue': 'Go to the home page',
  'auth.verify.expired.title': 'This link has expired',
  'auth.verify.expired.body':
    'Links last an hour and work once. Enter your address and we will send another.',

  'auth.reset.request.title': 'Reset your password',
  'auth.reset.request.intro':
    'Enter your address and we will send you a link to choose a new password.',
  'auth.reset.request.submit': 'Send the link',
  'auth.reset.request.sent.title': 'Check your email',
  'auth.reset.request.sent.body':
    'If {{email}} has an account, there is a link there to change the password.',

  'auth.reset.set.title': 'Choose a new password',
  'auth.reset.set.submit': 'Save the password',
  'auth.reset.set.done.title': 'Password changed',
  'auth.reset.set.done.body': 'You can log in with the new one.',
  'auth.reset.set.done.login': 'Log in',
  'auth.reset.set.invalid.title': 'This link has expired',
  'auth.reset.set.invalid.body':
    'Links last an hour and work once. Ask for another to change the password.',
  'auth.reset.set.invalid.again': 'Ask for another link',

  // ── `W4-T04` — my jobs, and comparing the quotes on one ───────────────────────────────────
  'jobs.title': 'My jobs',
  'jobs.empty.title': 'You have not posted a job yet',
  'jobs.empty.body': 'Once you post one, professionals will be able to send you their quotes.',
  'jobs.status.DRAFT': 'Draft',
  'jobs.status.OPEN': 'Open',
  'jobs.status.CANCELLED': 'Cancelled',
  'jobs.untitled': 'Untitled job',
  'jobs.quotes.link': 'See quotes',

  'job.back': 'Back to my jobs',
  'job.quotes.title': 'Quotes',
  'job.quotes.count_one': '{{count}} quote',
  'job.quotes.count_other': '{{count}} quotes',
  'job.quotes.empty.title': 'No quotes yet',
  'job.quotes.empty.body':
    'Professionals in the categories you chose will see your job and can send you a quote.',
  'job.quotes.more': 'See more quotes',
  'job.quotes.sort.label': 'Sort by',
  'job.quotes.sort.recommended': 'Recommended',
  'job.quotes.sort.price': 'Price',
  'job.quotes.sort.newest': 'Newest',
  'job.quotes.cheapest': 'Lowest price',
  'job.quotes.unrated': 'No reviews yet',
  'job.quotes.rating': '{{rating}} out of 5 ({{count}})',
  'job.quotes.validUntil': 'Valid until {{date}}',
  'job.quotes.coverage.title': 'What the job asks for',
  'job.quotes.coverage.listed': 'lists this on their profile',
  'job.quotes.coverage.notListed': 'does not list this on their profile',
  'job.quotes.coverage.licence': 'regulated trade',
  'job.quotes.status.ACCEPTED': 'Accepted',
  'job.quotes.status.REJECTED': 'Rejected',
  'job.quotes.status.WITHDRAWN': 'Withdrawn by the professional',
  'job.quotes.status.EXPIRED': 'Expired',
  'job.quotes.accept': 'Accept',
  'job.quotes.reject': 'Reject',
  'job.quotes.confirm.title': 'Accept this quote?',
  'job.quotes.confirm.body':
    'You are about to accept {{provider}}\u2019s quote for {{amount}}. Nothing is charged yet, but for now you will not be able to undo it.',
  'job.quotes.confirm.accept': 'Yes, accept',
  'job.quotes.confirm.cancel': 'Cancel',
  'job.quotes.accepted.notice':
    'You accepted {{provider}}\u2019s quote. The others stay pending until the job is awarded.',
  'job.quotes.error': 'We could not save your answer. Please try again.',

  'footer.rights': 'All rights reserved',
} satisfies Translations;
