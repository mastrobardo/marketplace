/**
 * `GET /search` and `GET /categories`, mocked — ADR-011 §4's "the storefront does not wait for them".
 *
 * The handlers answer from `catalogue.ts` (built from the `packages/testing` factories) and validate
 * their own output against `packages/contracts`. That second part is what makes these mocks worth
 * having: a handler that drifts from the contract fails `tests/mocks.test.ts` rather than teaching
 * five storefront tasks a shape the API will never send.
 *
 * `W3-T04` (`agent-discovery`) implements the real endpoint against the same schemas. When it lands,
 * this file is deleted, not migrated.
 */
import {
  CategoryListSchema,
  PAGE_LIMIT_DEFAULT,
  SearchQuerySchema,
  coarsenPoint,
  emptyPage,
  errorEnvelope,
  fetchLimit,
  keysetPredicate,
  pageOf,
  type CursorPosition,
  type SearchFacets,
  type SearchResponse,
  type SearchResult,
} from '@marketplace/contracts';
import { HttpResponse, http } from 'msw';
import { buildCatalogue, distanceMetres, locate, type CatalogueProvider } from './catalogue.js';

/**
 * The search radius, until a provider's own `serviceRadiusMetres` is what filters them (`W3-T04`).
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

export const handlers = [
  http.get('*/categories', ({ request }) => {
    const locale = request.headers.get('accept-language') ?? 'es';
    // Parsed on the way out, like the search handler: `W12-T09` declared this shape in
    // `packages/contracts`, so the mock is now checkable against it rather than being its only
    // definition. A drift here fails a test instead of reaching the header's search box.
    return HttpResponse.json(
      CategoryListSchema.parse({
        items: catalogue.categories
          .filter((category) => category.isActive)
          .sort((a, b) => a.position - b.position)
          .map((category) => ({
            slug: category.slug,
            name: locale.startsWith('en') ? category.nameEn : category.nameEs,
            requiresLicence: category.requiresLicence,
          })),
      }),
    );
  }),

  http.get('*/search', ({ request }) => {
    const url = new URL(request.url);
    const locale = request.headers.get('accept-language') ?? 'es';

    // The same parse the real endpoint performs. A mock that accepts what the API rejects is a mock
    // that teaches the storefront a lie, so this failure is a 400 envelope and not an empty list.
    const parsed = SearchQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return HttpResponse.json(
        errorEnvelope('VALIDATION_FAILED', 'The search query is not valid.', crypto.randomUUID(), {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        }),
        { status: 400 },
      );
    }

    const { what, where, mode, limit, cursor } = parsed.data;
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
      return HttpResponse.json({
        items: [...empty.items],
        page: empty.page,
        facets: facetsOf([], locale),
      } satisfies SearchResponse);
    }

    // `fetchLimit` + `pageOf` is the same over-fetch the API performs, so `hasMore` and
    // `nextCursor` cannot disagree here either.
    const page = pageOf(window.slice(0, fetchLimit(limit ?? PAGE_LIMIT_DEFAULT)), {
      limit: limit ?? PAGE_LIMIT_DEFAULT,
      sort: [
        { field: 'distanceMetres', direction: 'asc' },
        { field: 'id', direction: 'asc' },
      ],
    });

    return HttpResponse.json({
      items: [...page.items],
      page: page.page,
      facets: facetsOf([...page.items], locale),
    } satisfies SearchResponse);
  }),
];
