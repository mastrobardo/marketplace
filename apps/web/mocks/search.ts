/**
 * The search the mock endpoint performs — extracted from `handlers.ts` by `W12-T11`.
 *
 * It moved because a second caller appeared: `apps/web/tests/app-harness.tsx` stubs `ApiClient` for
 * component tests, and a stub that reimplements "which providers match, in what order, with what
 * facet counts" is a second definition of the mock's behaviour. `W12-T08` spent a whole task
 * establishing that there is one source of *test data*; this is the same argument one level up, for
 * the logic over it. A component test that disagrees with the MSW handler teaches the page a
 * behaviour the dev server does not have.
 *
 * `W3-T05` implements the real endpoint against the same schemas. When it lands, this file is
 * deleted, not migrated.
 */
import {
  PAGE_LIMIT_DEFAULT,
  coarsenPoint,
  emptyPage,
  fetchLimit,
  keysetPredicate,
  pageOf,
  type CursorPosition,
  type SearchFacets,
  type SearchQuery,
  type SearchResponse,
  type SearchResult,
} from '@marketplace/contracts';
import { buildCatalogue, distanceMetres, locate, type CatalogueProvider } from './catalogue.js';

/**
 * The search radius, until a provider's own `serviceRadiusMetres` is what filters them (`W3-T05`).
 * 40 km puts Alcalá outside a Madrid-centre search, which is what makes the seeded far provider
 * worth seeding.
 */
const RADIUS_METRES = 40_000;

/** One world per page load, so two requests in a session agree with each other. */
const catalogue = buildCatalogue();

const nameOf = (slug: string, locale: string): string => {
  const category = catalogue.categories.find((entry) => entry.slug === slug);
  if (category === undefined) return slug;
  return locale.startsWith('en') ? category.nameEn : category.nameEs;
};

/** The public projection — §4.3, and the exclusion list is the part that matters. */
function toResult(
  provider: CatalogueProvider,
  centre: { latitude: number; longitude: number },
  locale: string,
): SearchResult {
  return {
    id: provider.profile.id,
    displayName: provider.profile.displayName,
    kind: provider.profile.kind,
    bio: null,
    categories: provider.categorySlugs.map((slug) => ({ slug, name: nameOf(slug, locale) })),
    ratingAvg: provider.ratingAvg,
    ratingCount: provider.profile.ratingCount,
    hourlyRateCents: provider.hourlyRateCents,
    distanceMetres: distanceMetres(centre, provider.address),
    city: provider.address.city,
    province: provider.address.province,
    // Never the stored coordinate. §4.5: a provider's base is usually their home, and the contract
    // refuses a point that has not been through here.
    point: coarsenPoint(provider.address),
  };
}

function facetsOf(results: SearchResult[], locale: string): SearchFacets {
  const categories = new Map<string, number>();
  const kinds = new Map<SearchResult['kind'], number>();

  for (const result of results) {
    for (const category of result.categories) {
      categories.set(category.slug, (categories.get(category.slug) ?? 0) + 1);
    }
    kinds.set(result.kind, (kinds.get(result.kind) ?? 0) + 1);
  }

  // Counts within the matched set — §4.3. Not a count over the whole catalogue, which is the
  // facet bug that makes a rail offer a filter that returns nothing.
  return {
    categories: [...categories].map(([slug, count]) => ({
      slug,
      name: nameOf(slug, locale),
      count,
    })),
    kinds: [...kinds].map(([kind, count]) => ({ kind, count })),
  };
}

/** The cursor's position, applied the way `W1-T02` says a keyset page is applied. */
function after(results: SearchResult[], position: CursorPosition | undefined): SearchResult[] {
  if (position === undefined) return results;
  const predicate = keysetPredicate(
    [
      { field: 'distanceMetres', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ],
    position,
  );
  return results.filter((result) =>
    predicate.or.some((conjunction) =>
      conjunction.and.every((clause) => {
        const value = clause.field === 'id' ? result.id : result.distanceMetres;
        if (clause.op === 'eq') return value === clause.value;
        if (clause.op === 'gt') return value > clause.value;
        return value < clause.value;
      }),
    ),
  );
}

/**
 * Run a parsed query against the seeded world.
 *
 * Takes an already-parsed `SearchQuery` — parsing is the caller's, because the HTTP handler has to
 * answer a 400 envelope for a bad query and a typed client never has one.
 */
export function searchCatalogue(query: SearchQuery, locale: string): SearchResponse {
  const { what, where, mode, limit, cursor } = query;
  const centre = locate(where);

  const matched = catalogue.providers
    .filter((provider) => what === undefined || provider.categorySlugs.includes(what))
    // `booking` needs a rate to book against; a quote-only provider has none.
    .filter((provider) => mode !== 'booking' || provider.hourlyRateCents !== null)
    .map((provider) => toResult(provider, centre, locale))
    .filter((result) => result.distanceMetres <= RADIUS_METRES)
    .sort((a, b) => a.distanceMetres - b.distanceMetres || a.id.localeCompare(b.id));

  const window = after(matched, cursor);
  if (window.length === 0) {
    const empty = emptyPage<SearchResult>();
    return { items: [...empty.items], page: empty.page, facets: facetsOf([], locale) };
  }

  // `fetchLimit` + `pageOf` is the same over-fetch the API performs, so `hasMore` and `nextCursor`
  // cannot disagree here either.
  const page = pageOf(window.slice(0, fetchLimit(limit ?? PAGE_LIMIT_DEFAULT)), {
    limit: limit ?? PAGE_LIMIT_DEFAULT,
    sort: [
      { field: 'distanceMetres', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ],
  });

  return { items: [...page.items], page: page.page, facets: facetsOf([...page.items], locale) };
}
