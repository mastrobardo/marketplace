/**
 * The search seam — `GET /search`'s request and response.
 *
 * ADR-011 §3 consequence 1: *the schema produces the query*. `packages/ui`'s `SearchBar` holds the
 * **structure** of a search — declared keys, string values, a pure `toSearchQuery` — and may not
 * import this package at all (`packages/ui/tests/boundaries.test.ts` AC15). This module holds the
 * **meaning**: which keys, which values, parsed. The application is where they meet, in one
 * expression — `SearchQuerySchema.parse(toSearchQuery(schema, values))`.
 *
 * That inversion is the point. The endpoint is defined by its real caller, before `W3-T04`
 * implements it, rather than reverse-engineered from a component's props a milestone later.
 *
 * Frozen seam — changing a shape here costs an ADR (`agents/policies/contract-change.md`).
 * Spec: `docs/specs/S10/W12-T08-search-contract.md`.
 */
import { z } from 'zod';
import { listQuery } from './pagination.js';
import { pageEnvelope } from './pagination.js';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The request
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `Category.slug` is the unique, stable, URL-safe column (`W1-T05`), and `?what=fontaneria` is the
 * URL ADR-011 §3 prints. Lowercase, digits, single hyphens, no leading or trailing hyphen — so
 * `fontanería` with its accent is a rejected request rather than a category that cannot exist.
 */
export const CATEGORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Urgency, as the storefront already renders it.
 *
 * Deliberately *not* imported from a Prisma enum, because there is not one: `W1-T05` shipped six
 * tables and `Job` is not among them. A search filter is a request, not a row. When `W4-T01` lands
 * `Job.urgency` these two lists must agree, and nothing mechanical will notice if they do not —
 * see the spec's Q3, which is the note that task will find.
 */
export const SearchUrgencySchema = z.enum(['urgente', 'hoy', 'semana', 'flexible']);
export type SearchUrgency = z.infer<typeof SearchUrgencySchema>;

/** Quote-only providers carry a null `hourlyRateCents`; `booking` is the filter that excludes them. */
export const SearchModeSchema = z.enum(['quote', 'booking']);
export type SearchMode = z.infer<typeof SearchModeSchema>;

/**
 * One sortable field, and it is not an oversight — see the spec's Q4.
 *
 * `ratingAvg` is the obvious second, and it is wrong: the column is `Decimal?`, `encodeCursor`
 * throws on a null sort value by design (`pagination.ts`), and the providers with a null rating are
 * the new ones. On a marketplace that has not launched, that is almost all of them. Offering the
 * sort would buy a 500 the first time a page ended on an unrated provider, or — with the throw
 * worked around — the silent disappearance of every unrated provider from the results.
 *
 * Spelled exactly as `SearchResultSchema` spells it, so `pageOf` reads a cursor off a row without a
 * synonym in between.
 */
export const SEARCH_SORTABLE = ['distanceMetres'] as const;
export const SEARCH_DEFAULT_SORT = 'distanceMetres';

/**
 * Composed with `listQuery` rather than declared flat, which buys three things `W1-T02` already
 * decided and this endpoint would otherwise re-decide badly: `limit`/`cursor`/`sort` parse
 * identically to the other eight list endpoints, a filter that shadowed a reserved key would be a
 * boot failure, and `strictObject` makes `?offset=40` a rejected request rather than an ignored
 * parameter that pages in a circle.
 */
export const SearchQuerySchema = listQuery({
  sortable: SEARCH_SORTABLE,
  defaultSort: SEARCH_DEFAULT_SORT,
  filters: {
    what: z.string().regex(CATEGORY_SLUG).optional(),
    // Free text until `GET /places/suggest` exists (`W3-T06`). Required, because a radius search
    // with no centre is not a search — it is `SELECT * FROM provider_profile`.
    where: z.string().min(1).max(120),
    when: SearchUrgencySchema.optional(),
    mode: SearchModeSchema.optional(),
  },
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The map pin
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Three decimals is roughly 110 m at this latitude: the right block, not the right doorstep.
 *
 * A provider's base address is usually their home (`schema.prisma:129`), and `W12-T11` needs a pin.
 * Returning the stored coordinate would honour the letter of the `line1` rule while publishing the
 * doorstep. The spec's Q2 escalates the number itself — it is a product question wearing an
 * engineering costume — and this constant is the one line that changes when it is answered.
 */
export const POINT_DECIMALS = 3;

const FACTOR = 10 ** POINT_DECIMALS;

/** Whether a coordinate has already been through `coarsenPoint`. */
function isCoarse(value: number): boolean {
  return Math.round(value * FACTOR) === value * FACTOR;
}

const CoordinateSchema = (max: number) =>
  z
    .number()
    .min(-max)
    .max(max)
    .refine(isCoarse, `must be rounded to ${String(POINT_DECIMALS)} decimal places`);

/**
 * The coarsened point. The refinement is what makes §4.5 a rule rather than a convention: a handler
 * that forwards the stored coordinate fails its own response schema, in a test, rather than
 * shipping a privacy incident that nobody notices because it looks like a working map.
 */
export const SearchPointSchema = z.strictObject({
  latitude: CoordinateSchema(90),
  longitude: CoordinateSchema(180),
});

export type SearchPoint = z.infer<typeof SearchPointSchema>;

/**
 * Round a stored coordinate to the published precision. In the contract rather than at each call
 * site, because a rule every implementer must remember is a rule one of them forgets.
 */
export function coarsenPoint(point: { latitude: number; longitude: number }): SearchPoint {
  return {
    latitude: Number(point.latitude.toFixed(POINT_DECIMALS)),
    longitude: Number(point.longitude.toFixed(POINT_DECIMALS)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The response
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** `name` is resolved to the request's locale by the endpoint; the client never sees the pair. */
export const SearchCategorySchema = z.strictObject({
  slug: z.string().regex(CATEGORY_SLUG),
  name: z.string().min(1),
});

export const ProviderKindSchema = z.enum(['MANITAS', 'PRO']);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

/**
 * The public projection of a provider. Every field is a column that exists today, which is what
 * makes this contract additive rather than an ADR.
 *
 * `strictObject` is doing security work here, not tidiness: the fields that are *absent* are the
 * point. No `userId` (a public row that links to an account is a correlation handed out for free),
 * no `baseAddressId`, and above all no `line1`/`line2` — `W1-T05` §8 states it as a rule, and a
 * strict object turns it into a test that fails on the handler that forgets.
 */
export const SearchResultSchema = z.strictObject({
  id: z.uuid(),
  displayName: z.string().min(1),
  kind: ProviderKindSchema,
  bio: z.string().nullable(),
  categories: z.array(SearchCategorySchema),
  // Null is "no reviews yet", which is not 0.00 (`schema.prisma:136`). A 0 here would rank a brand
  // new provider below a bad one, which is the wrong answer on a marketplace with no supply yet.
  ratingAvg: z.number().min(0).max(5).nullable(),
  ratingCount: z.number().int().nonnegative(),
  // Integer cents (`W1-T06`), never a float. Null = quote-only.
  hourlyRateCents: z.number().int().nonnegative().nullable(),
  // Metres, because `ST_DWithin` on geography takes metres.
  distanceMetres: z.number().int().nonnegative(),
  city: z.string().min(1),
  province: z.string().min(1),
  point: SearchPointSchema,
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Two counts, because two are what a rail can render without a second query — and they are counts
 * *within the matched set*, which the search has already scanned.
 *
 * No `total`. `W1-T02` decision D removed it from the page envelope because a count over a radius
 * query costs the query, and a facet total is that same count wearing a hat.
 */
export const SearchFacetsSchema = z.strictObject({
  categories: z.array(
    z.strictObject({
      slug: z.string().regex(CATEGORY_SLUG),
      name: z.string().min(1),
      count: z.number().int().nonnegative(),
    }),
  ),
  kinds: z.array(
    z.strictObject({ kind: ProviderKindSchema, count: z.number().int().nonnegative() }),
  ),
});

export type SearchFacets = z.infer<typeof SearchFacetsSchema>;

/**
 * Built **on** `pageEnvelope` rather than beside it, so `items` and `page` are the frozen `W1-T02`
 * shape by construction and a change to `PageInfoSchema` reaches search without anyone editing this
 * file. `.extend` on a `strictObject` preserves strictness, so the envelope stays closed.
 */
export const SearchResponseSchema = pageEnvelope(SearchResultSchema).extend({
  facets: SearchFacetsSchema,
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;
