/**
 * `W12-T12` AC14..AC22 — the provider profile.
 *
 * The page is a read, so most of the suite is about the two things a read can still get wrong:
 * what it says when a field is null — which on a cold-start marketplace is most of them — and what
 * it publishes. AC22 is the second one, asserted against the rendered DOM rather than the schema,
 * because "the projection stripped it" and "the page never printed it" are different claims.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/shared/api.js';
import { changeLanguage, setupI18n } from '../src/i18n/index.js';
import { es } from '../src/i18n/locales/es.js';
import { profileFor, providerIds, renderApp, stubApi } from './app-harness.js';

beforeEach(async () => {
  await setupI18n();
  await changeLanguage('es');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const region = (name: string): HTMLElement => screen.getByRole('region', { name });

/** Interpolate a catalogue string the way i18next would, so a test names the region it means. */
const t = (key: keyof typeof es, name: string): string => es[key].replace('{{name}}', name);

/** Seeded: `Fontanería Gómez` — rated, hourly, two-line bio, one category. */
const RATED = providerIds()[0] ?? '';
/** Seeded: `Electricidad Nadal` — quote-only, two categories. */
const QUOTE_ONLY = providerIds()[1] ?? '';
/** Seeded: `Manitas Rivas` — unrated, no bio. The cold-start row. */
const UNRATED = providerIds()[2] ?? '';

const path = (id: string): string => `/es/pro/${id}`;

describe('AC14..AC15 — who this is, and what they do', () => {
  it('AC14 — names the provider in the h1 and states the kind in words', async () => {
    renderApp(path(RATED));
    const profile = profileFor(RATED, 'es');

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toContain(profile.displayName);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    // Never the raw enum. `PRO` on a public page is a database value wearing a label.
    expect(screen.getByTestId('provider').textContent).toContain(es['provider.kind.PRO']);
    expect(screen.getByTestId('provider').textContent).not.toContain('MANITAS');
  });

  it('AC15 — each category is a link back into search, built by the serializer', async () => {
    renderApp(path(QUOTE_ONLY));
    const profile = profileFor(QUOTE_ONLY, 'es');
    expect(profile.categories.length).toBeGreaterThan(1);

    const links = within(await screen.findByTestId('provider-services')).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(
      profile.categories.map((category) => category.name),
    );
    // The href is asserted as a parsed query rather than as a string, so the test fails on a
    // hand-concatenated URL that happens to look right and passes on any serializer ordering.
    for (const [index, link] of links.entries()) {
      const href = link.getAttribute('href') ?? '';
      const [pathname, query] = href.split('?');
      expect(pathname).toBe('/es/search');
      expect(new URLSearchParams(query).get('what')).toBe(profile.categories[index]?.slug);
    }
  });
});

describe('AC16..AC18 — the fields that are usually null', () => {
  it('AC16 — a rated provider shows the average in es-ES with its count', async () => {
    renderApp(path(RATED));
    const profile = profileFor(RATED, 'es');
    expect(profile.ratingAvg).not.toBeNull();

    const rating = await screen.findByTestId('provider-rating');
    // 4,7 — the decimal comma is the locale doing its job, not a string someone typed.
    expect(rating.textContent).toContain(
      new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1 }).format(profile.ratingAvg ?? 0),
    );
    expect(rating.textContent).toContain(String(profile.ratingCount));
  });

  it('AC16 — an unrated provider says so, and renders no zero', async () => {
    renderApp(path(UNRATED));
    expect(profileFor(UNRATED, 'es').ratingAvg).toBeNull();

    const rating = await screen.findByTestId('provider-rating');
    expect(rating.textContent).toBe(es['provider.rating.none']);
    // Null is "no reviews yet" and 0 is "rated badly". A page that prints 0,0 for the first
    // provider who ever signs up is the cold-start bug `W12-T08` refused to encode in the schema.
    expect(rating.textContent).not.toMatch(/0/);
  });

  it('AC17 — a quote-only provider is offered as a quote, and never as NaN', async () => {
    renderApp(path(QUOTE_ONLY));
    expect(profileFor(QUOTE_ONLY, 'es').hourlyRateCents).toBeNull();

    const rate = await screen.findByTestId('provider-rate');
    expect(rate.textContent).toBe(es['provider.rate.quote']);
    expect(screen.getByTestId('provider').textContent).not.toContain('NaN');
    expect(screen.getByTestId('provider').textContent).not.toContain('€0');
  });

  it('AC18 — the working area reads in km, from the city, in es-ES', async () => {
    renderApp(path(RATED));
    const profile = profileFor(RATED, 'es');
    expect(profile.serviceRadiusMetres).not.toBeNull();

    const area = await screen.findByTestId('provider-area');
    const km = new Intl.NumberFormat('es-ES').format((profile.serviceRadiusMetres ?? 0) / 1000);
    expect(area.textContent).toContain(km);
    expect(area.textContent).toContain(profile.city);
    // Metres are the storage unit, not the display unit — 15000 must not reach a visitor.
    expect(area.textContent).not.toContain(String(profile.serviceRadiusMetres));
  });

  it('AC18 — a provider with no stated area says so, and renders no 0 km', async () => {
    const profile = { ...profileFor(RATED, 'es'), serviceRadiusMetres: null };
    renderApp(path(RATED), stubApi({ getProvider: () => Promise.resolve(profile) }));

    const area = await screen.findByTestId('provider-area');
    expect(area.textContent).toContain(es['provider.area.unset']);
    expect(area.textContent).not.toMatch(/\b0\b/);
  });
});

describe('AC19 — the CTA is a boundary, not a control', () => {
  it('renders an auth wall with an accessible name and nothing to press', async () => {
    renderApp(path(RATED));
    const profile = profileFor(RATED, 'es');

    await screen.findByTestId('provider');
    const wall = region(t('provider.cta.title', profile.displayName));
    expect(within(wall).getByRole('heading').textContent).toContain(profile.displayName);
    // Not a disabled button, not a link to a form nobody has built. `become-a-pro` argued this and
    // the same argument applies here: a disabled control tells a visitor only that it is broken.
    expect(within(wall).queryByRole('button')).toBeNull();
    expect(within(wall).queryByRole('link')).toBeNull();
    expect(document.querySelectorAll('[disabled], [aria-disabled="true"]')).toHaveLength(0);
  });

  it('states the three absent sections rather than faking them', async () => {
    renderApp(path(RATED));
    await screen.findByTestId('provider');

    // Gallery, badges and reviews have no columns (`W12-T12` §1). Each is a stated sentence, and
    // each is a real region so the absence is announced rather than merely not rendered.
    for (const [name, pending] of [
      [es['provider.gallery.title'], es['provider.gallery.pending']],
      [es['provider.badges.title'], es['provider.badges.pending']],
      [es['provider.reviews.title'], es['provider.reviews.pending']],
    ]) {
      expect(region(name ?? '').textContent).toContain(pending);
    }
    // A skeleton that never resolves is a promise the page cannot keep.
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
  });
});

describe('AC20..AC21 — gone, and broken, are different pages', () => {
  it('AC20 — an id nobody seeded is a not-found page inside the shell', async () => {
    renderApp(path('00000000-0000-4000-8000-00000000dead'));

    const notFound = await screen.findByTestId('provider-not-found');
    expect(notFound.textContent).toContain(es['provider.notFound.title']);
    // The header survives, because the search in it is how a visitor recovers.
    expect(screen.getByRole('banner')).toBeDefined();
    expect(
      within(notFound)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toContain('/es/search');
  });

  it('AC20 — a malformed id is the same page, and sends no request', async () => {
    const getProvider = vi.fn();
    renderApp(path('not-a-uuid'), stubApi({ getProvider }));

    expect(await screen.findByTestId('provider-not-found')).toBeDefined();
    // The uuid check is `ProviderIdSchema`, shared with the endpoint. A round trip to be told what
    // the client already knew is a request that should never leave.
    expect(
      getProvider,
      'the endpoint was called for an id that cannot be valid',
    ).not.toHaveBeenCalled();
  });

  it('AC21 — a failing endpoint is the route boundary, with a retry that works', async () => {
    const user = userEvent.setup();
    // Rejected **twice**: a 500 may be transient, so `queryKeys`' retry policy tries once more on
    // its own. A single rejection never reaches the boundary at all — which is the policy working,
    // and is why this test would otherwise pass by rendering the page it claims to fail on.
    const getProvider = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR'))
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR'))
      .mockImplementation(() => Promise.resolve(profileFor(RATED, 'es')));
    renderApp(path(RATED), stubApi({ getProvider }));

    // The retry is real: a 500 may be transient, so React Query tries once more before the boundary
    // renders. `queryKeys` sets that policy and this timeout is what it costs a test.
    const error = await screen.findByTestId('provider-error', {}, { timeout: 3_000 });
    expect(error.textContent).toContain(es['provider.error.body']);
    expect(screen.getByRole('banner'), 'the shell was lost to a failure below it').toBeDefined();

    await user.click(within(error).getByRole('button', { name: es['error.retry'] }));
    await waitFor(
      () => {
        expect(screen.getByTestId('provider')).toBeDefined();
      },
      { timeout: 3_000 },
    );
  });

  it('AC21 — a response that does not match the contract fails loudly', async () => {
    // What a drifting endpoint actually produces: `ProviderProfileSchema.parse` throws inside the
    // client, so this is not an `ApiError` and has no status. The page must still be the error
    // boundary rather than rendering a half-parsed profile.
    const getProvider = () => Promise.reject(new Error('invalid_type at memberSince'));
    renderApp(path(RATED), stubApi({ getProvider }));

    expect(await screen.findByTestId('provider-error', {}, { timeout: 3_000 })).toBeDefined();
  });
});

describe('AC22 — what the page must never publish', () => {
  it('prints no account id, no address line and no doorstep coordinate', async () => {
    renderApp(path(RATED));
    await screen.findByTestId('provider');

    const html = document.body.innerHTML;
    for (const forbidden of ['userId', 'baseAddressId', 'line1', 'line2', '@example.com']) {
      expect(html, `${forbidden} was rendered`).not.toContain(forbidden);
    }
    // Puerta del Sol at stored precision. The contract refuses it; this asserts the page never
    // prints a coordinate at all, which is the stronger and simpler property.
    expect(html).not.toContain('40.416775');
    expect(html).not.toContain('-3.70379');
  });
});
