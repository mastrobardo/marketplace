/**
 * The profile the mock endpoint answers with — `W12-T12`, and the sibling of `search.ts`.
 *
 * Separate from `search.ts` for the same reason `search.ts` is separate from `handlers.ts`: two
 * callers. The MSW handler serves the dev server and `apps/web/tests/app-harness.tsx` stubs
 * `ApiClient` for component tests, and a stub that decides for itself what a profile looks like is a
 * second definition of the endpoint.
 *
 * **The projection is the interesting part.** It maps a seeded row to `ProviderProfileSchema`, and
 * what it leaves out — `userId`, the address lines, the stored coordinate — is the privacy rule
 * `W1-T05` §8 states and this file could quietly break. It cannot: the schema is strict and the
 * point is refined, so a forgotten exclusion fails `tests/mocks.test.ts` rather than shipping.
 *
 * **`W3-T07` landed and this file outlived it**, which is not what the line here used to promise.
 * `GET /api/providers/:id` is real, and nothing seeds a provider — `auth-demo-users` is the only
 * seeder — so deleting this today would point `pnpm dev` at a correct endpoint over an empty table,
 * and take `tests/mocks.test.ts`'s contract criteria with it. `W3-T10` owns the retirement, behind a
 * demo seeder, on exactly the terms `W3-T05` settled for its own search handler. (Spelled in
 * prose because the wildcard the handler matches on would close this comment.)
 */
import { coarsenPoint, type ProviderProfile } from '@marketplace/contracts';
import { buildCatalogue, type CatalogueProvider } from './catalogue.js';

/** One world per page load, so two requests in a session agree with each other. */
const catalogue = buildCatalogue();

const nameOf = (slug: string, locale: string): string => {
  const category = catalogue.categories.find((entry) => entry.slug === slug);
  if (category === undefined) return slug;
  return locale.startsWith('en') ? category.nameEn : category.nameEs;
};

/** The public projection — `W12-T12` §4.3. The exclusion list is the part that matters. */
export function toProfile(provider: CatalogueProvider, locale: string): ProviderProfile {
  return {
    id: provider.profile.id,
    displayName: provider.profile.displayName,
    kind: provider.profile.kind,
    bio: provider.bio,
    categories: provider.categorySlugs.map((slug) => ({ slug, name: nameOf(slug, locale) })),
    ratingAvg: provider.ratingAvg,
    ratingCount: provider.profile.ratingCount,
    hourlyRateCents: provider.hourlyRateCents,
    city: provider.address.city,
    province: provider.address.province,
    serviceRadiusMetres: provider.profile.serviceRadiusMetres,
    memberSince: provider.profile.createdAt.toISOString(),
    // Never the stored coordinate — the same rule `search.ts` follows, and a stronger case for it:
    // a results map is many pins at a zoom the list chose, a profile is one named person.
    point: coarsenPoint(provider.address),
  };
}

/**
 * Look one up. `undefined` is "no such provider", which the caller turns into a 404 — only an HTTP
 * handler has a status code to answer with, and a typed client never has an unparsed id.
 */
export function profileFromCatalogue(id: string, locale: string): ProviderProfile | undefined {
  const provider = catalogue.providers.find((entry) => entry.profile.id === id);
  return provider === undefined ? undefined : toProfile(provider, locale);
}

/** Every seeded id, so a test can assert that no result row links to a 404. */
export function seededProviderIds(): string[] {
  return catalogue.providers.map((provider) => provider.profile.id);
}
