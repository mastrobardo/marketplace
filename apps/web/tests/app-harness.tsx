import { render, type RenderResult } from '@testing-library/react';
import {
  ProviderIdSchema,
  SearchQuerySchema,
  type CategorySummary,
  type ProviderProfile,
  type SearchResponse,
} from '@marketplace/contracts';
import { type SearchQuery } from '@marketplace/ui';
import { App } from '../src/app/App.js';
import { ApiError, type ApiClient } from '../src/shared/api.js';
import { type SessionUser } from '../src/shared/session.js';
import { buildCatalogue } from '../../../apps/web/mocks/catalogue.js';
import { searchCatalogue } from '../../../apps/web/mocks/search.js';
import { profileFromCatalogue, seededProviderIds } from '../../../apps/web/mocks/provider.js';

/**
 * Render the real `App` at a path, with the API stubbed.
 *
 * The categories come from `buildCatalogue()` — the same `packages/testing` factories the MSW
 * handlers use — rather than from a list written here. `W12-T08` spent a whole task establishing
 * that there is one source of test data; a component test that invents four plausible categories is
 * how the second one starts.
 */
export function categoriesFor(locale: string): CategorySummary[] {
  return buildCatalogue()
    .categories.filter((category) => category.isActive)
    .sort((a, b) => a.position - b.position)
    .map((category) => ({
      slug: category.slug,
      name: locale.startsWith('en') ? category.nameEn : category.nameEs,
      requiresLicence: category.requiresLicence,
    }));
}

/**
 * The search a stub performs is **the MSW handler's own**, not a reimplementation of it.
 *
 * A stub that decided for itself which providers match, in what order, with what facet counts,
 * would be a second definition of the mock's behaviour — and a component test that disagrees with
 * the dev server teaches the page something the dev server does not do. `W12-T08` established one
 * source of test *data*; `W12-T11` extracted `mocks/search.ts` so there is one source of the logic
 * over it too.
 */
export function searchFor(
  query: Parameters<typeof searchCatalogue>[0],
  locale: string,
): SearchResponse {
  return searchCatalogue(query, locale);
}

/** The seeded ids, so a test links to a provider that exists rather than to a uuid it invented. */
export function providerIds(): string[] {
  return seededProviderIds();
}

/** The profile the MSW handler would return, for a test that needs to know what it is asserting. */
export function profileFor(id: string, locale: string): ProviderProfile {
  const profile = profileFromCatalogue(id, locale);
  if (profile === undefined) throw new Error(`No seeded provider "${id}"`);
  return profile;
}

export type { SessionUser };

/** The user a stubbed sign-in returns. Tests that care about the session override `getSession`. */
export const STUB_USER: SessionUser = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ana Pérez',
  email: 'ana@example.com',
  emailVerified: true,
};

/**
 * The auth defaults: a signed-out visitor whose every write succeeds.
 *
 * Signed out is the state nearly every page test wants — it is what the storefront looks like to
 * somebody arriving — and a test that cares about the other one overrides `getSession`. The writes
 * resolve because their *failures* are the interesting cases, and a failure a test did not ask for
 * is a failure it will not explain.
 */
export function stubApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getCategories: (locale) => Promise.resolve(categoriesFor(locale)),
    // Parses first, exactly as the MSW handler does — the stub is not allowed to accept a query
    // the endpoint would reject, or the page learns a behaviour the dev server does not have.
    search: (query: SearchQuery, locale: string) =>
      Promise.resolve(searchCatalogue(SearchQuerySchema.parse(query), locale)),
    // Rejects exactly as the handler answers — a 404 for an id nobody seeded, and a refusal for one
    // that is not a uuid at all. A stub that resolved `undefined` would let the page's not-found
    // path pass without ever being the path the endpoint actually drives.
    getProvider: (id: string, locale: string) => {
      if (!ProviderIdSchema.safeParse(id).success) {
        return Promise.reject(new ApiError(400, 'VALIDATION_FAILED'));
      }
      const profile = profileFromCatalogue(id, locale);
      return profile === undefined
        ? Promise.reject(new ApiError(404, 'NOT_FOUND'))
        : Promise.resolve(profile);
    },
    getSession: () => Promise.resolve(null),
    signUp: () => Promise.resolve(),
    signIn: () => Promise.resolve(STUB_USER),
    signOut: () => Promise.resolve(),
    resendVerification: () => Promise.resolve(),
    requestPasswordReset: () => Promise.resolve(),
    resetPassword: () => Promise.resolve(),
    ...overrides,
  };
}

export function renderApp(path: string, api: ApiClient = stubApi()): RenderResult {
  return render(<App initialEntries={[path]} api={api} />);
}
