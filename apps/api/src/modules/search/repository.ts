/**
 * `W3-T05` — the search, as one statement.
 *
 * The route owns parsing, the centre and the envelope; this owns the data. The split is what lets
 * `tests/search.test.ts` assert the whole HTTP boundary — the prefix, the 400s, the locale, the
 * outbound parse — without a database, and lets `tests/search-live.test.ts` assert the geography
 * without an HTTP server.
 *
 * Spec: `docs/specs/S5/W3-T05-geo-search.md` §2.3–§2.6.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  coarsenPoint,
  fetchLimit,
  type CursorPosition,
  type SearchFacets,
  type SearchMode,
  type SearchResult,
  type SortSpec,
} from '@marketplace/contracts';
import { type Place } from './places.js';

/** What the route has already decided by the time the data layer is asked for anything. */
export interface SearchCriteria {
  /** Resolved from `where` by `resolvePlace`; the repository never sees the free text. */
  readonly centre: Place;
  readonly what?: string | undefined;
  readonly mode?: SearchMode | undefined;
  /** The page size. The repository over-fetches `fetchLimit(limit)` so `pageOf` can see one more. */
  readonly limit: number;
  readonly sort: SortSpec<'distanceMetres'>;
  readonly cursor?: CursorPosition | undefined;
  readonly locale: 'es' | 'en';
}

export interface SearchRows {
  /** Up to `fetchLimit(limit)` rows, in sort order. Paging is the caller's to finish. */
  readonly rows: readonly SearchResult[];
  /** Counted over the whole matched set, not over `rows` — §2.6. */
  readonly facets: SearchFacets;
}

export type SearchRepository = (criteria: SearchCriteria) => Promise<SearchRows>;

/** The shape the statement's `items` column carries, before the projection is applied in JS. */
interface RawRow {
  readonly id: string;
  readonly displayName: string;
  readonly kind: 'MANITAS' | 'PRO';
  readonly bio: string | null;
  readonly ratingAvg: number | null;
  readonly ratingCount: number;
  readonly hourlyRateCents: number | null;
  readonly distanceMetres: number;
  readonly city: string;
  readonly province: string;
  /** Read to build the coarse pin, and deliberately not carried any further than this file. */
  readonly latitude: number;
  readonly longitude: number;
  readonly categories: readonly { readonly slug: string; readonly name: string }[];
}

interface RawAnswer {
  readonly items: readonly RawRow[] | null;
  readonly facetCategories:
    readonly { readonly slug: string; readonly name: string; readonly count: number }[] | null;
  readonly facetKinds:
    readonly { readonly kind: 'MANITAS' | 'PRO'; readonly count: number }[] | null;
}

/**
 * The keyset predicate, in SQL.
 *
 * It compares the **rounded** distance, because that is the number that went into the cursor
 * (§2.5). Comparing the unrounded value here would let a row at the boundary be served twice or
 * skipped — a bug that only appears on the second page, and only sometimes.
 */
function keyset(sort: SortSpec<'distanceMetres'>, cursor: CursorPosition | undefined): Prisma.Sql {
  if (cursor === undefined) return Prisma.empty;

  const distance = Number(cursor.v[0]);
  const after = sort[0]?.direction === 'desc' ? Prisma.sql`<` : Prisma.sql`>`;

  return Prisma.sql`
    AND (
      m."distanceMetres" ${after} ${distance}
      OR (m."distanceMetres" = ${distance} AND m.id > ${cursor.id})
    )`;
}

/**
 * The provider's own reach is the filter — "who will travel to me", not "who is near me" (§2.3).
 *
 * `location` is a generated `geography` column that Prisma cannot read or write
 * (`schema.prisma:251`), so raw SQL is the only access path here, not a shortcut. The GiST index
 * `address_location_gist` serves the `ST_DWithin` bounding-box stage.
 */
export function createSearchRepository(prisma: PrismaClient): SearchRepository {
  return async (criteria: SearchCriteria): Promise<SearchRows> => {
    const { centre, what, mode, limit, sort, cursor, locale } = criteria;

    const name = locale === 'en' ? Prisma.sql`c.name_en` : Prisma.sql`c.name_es`;
    const order = sort[0]?.direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;

    const byCategory =
      what === undefined
        ? Prisma.empty
        : Prisma.sql`
            AND EXISTS (
              SELECT 1
              FROM provider_category pc
              JOIN category c ON c.id = pc.category_id
              WHERE pc.provider_profile_id = pp.id AND c.slug = ${what} AND c.is_active
            )`;

    // `booking` needs a rate to book against; a quote-only provider has none.
    const byMode =
      mode === 'booking' ? Prisma.sql`AND pp.hourly_rate_cents IS NOT NULL` : Prisma.empty;

    const answers = await prisma.$queryRaw<RawAnswer[]>(Prisma.sql`
      WITH centre AS (
        SELECT ST_SetSRID(ST_MakePoint(${centre.longitude}, ${centre.latitude}), 4326)::geography AS g
      ),
      matched AS (
        SELECT
          pp.id::text                                   AS id,
          pp.display_name                               AS "displayName",
          pp.kind::text                                 AS kind,
          pp.bio                                        AS bio,
          pp.rating_avg                                 AS "ratingAvg",
          pp.rating_count                               AS "ratingCount",
          pp.hourly_rate_cents                          AS "hourlyRateCents",
          a.city                                        AS city,
          a.province                                    AS province,
          a.latitude                                    AS latitude,
          a.longitude                                   AS longitude,
          ROUND(ST_Distance(a.location, centre.g))::int AS "distanceMetres"
        FROM provider_profile pp
        JOIN address a ON a.id = pp.base_address_id
        CROSS JOIN centre
        WHERE pp.service_radius_metres IS NOT NULL
          AND ST_DWithin(a.location, centre.g, pp.service_radius_metres)
          ${byCategory}
          ${byMode}
      ),
      paged AS (
        SELECT m.*
        FROM matched m
        WHERE TRUE ${keyset(sort, cursor)}
        ORDER BY m."distanceMetres" ${order}, m.id ASC
        LIMIT ${fetchLimit(limit)}
      ),
      page_rows AS (
        SELECT
          p.*,
          COALESCE(cats.categories, '[]'::json) AS categories
        FROM paged p
        LEFT JOIN LATERAL (
          SELECT json_agg(
                   json_build_object('slug', c.slug, 'name', ${name})
                   ORDER BY c.position, c.slug
                 ) AS categories
          FROM provider_category pc
          JOIN category c ON c.id = pc.category_id
          WHERE pc.provider_profile_id = p.id::uuid AND c.is_active
        ) cats ON TRUE
      ),
      facet_categories AS (
        SELECT c.slug AS slug, ${name} AS name, COUNT(*)::int AS count
        FROM matched m
        JOIN provider_category pc ON pc.provider_profile_id = m.id::uuid
        JOIN category c ON c.id = pc.category_id
        WHERE c.is_active
        GROUP BY c.slug, ${name}
      ),
      facet_kinds AS (
        SELECT m.kind AS kind, COUNT(*)::int AS count
        FROM matched m
        GROUP BY m.kind
      )
      SELECT
        (
          SELECT json_agg(
                   json_build_object(
                     'id', pr.id,
                     'displayName', pr."displayName",
                     'kind', pr.kind,
                     'bio', pr.bio,
                     'ratingAvg', pr."ratingAvg",
                     'ratingCount', pr."ratingCount",
                     'hourlyRateCents', pr."hourlyRateCents",
                     'distanceMetres', pr."distanceMetres",
                     'city', pr.city,
                     'province', pr.province,
                     'latitude', pr.latitude,
                     'longitude', pr.longitude,
                     'categories', pr.categories
                   )
                   ORDER BY pr."distanceMetres" ${order}, pr.id ASC
                 )
          FROM page_rows pr
        ) AS items,
        (
          SELECT json_agg(
                   json_build_object('slug', fc.slug, 'name', fc.name, 'count', fc.count)
                   ORDER BY fc.count DESC, fc.slug ASC
                 )
          FROM facet_categories fc
        ) AS "facetCategories",
        (
          SELECT json_agg(json_build_object('kind', fk.kind, 'count', fk.count) ORDER BY fk.kind)
          FROM facet_kinds fk
        ) AS "facetKinds"
    `);

    const answer = answers[0];

    return {
      // The projection, written out rather than spread: the fields that are absent — `userId`,
      // `baseAddressId`, `line1`, `line2` — are the ones doing the work (§2.7), and a `row_to_json`
      // here would make "absent" depend on what the SELECT happened to name.
      rows: (answer?.items ?? []).map((row): SearchResult => ({
        id: row.id,
        displayName: row.displayName,
        kind: row.kind,
        bio: row.bio,
        categories: row.categories.map((category) => ({
          slug: category.slug,
          name: category.name,
        })),
        ratingAvg: row.ratingAvg === null ? null : Number(row.ratingAvg),
        ratingCount: row.ratingCount,
        hourlyRateCents: row.hourlyRateCents,
        distanceMetres: row.distanceMetres,
        city: row.city,
        province: row.province,
        // Never the stored coordinate. A provider's base is usually their home.
        point: coarsenPoint({ latitude: Number(row.latitude), longitude: Number(row.longitude) }),
      })),
      facets: {
        categories: (answer?.facetCategories ?? []).map((facet) => ({
          slug: facet.slug,
          name: facet.name,
          count: facet.count,
        })),
        kinds: (answer?.facetKinds ?? []).map((facet) => ({
          kind: facet.kind,
          count: facet.count,
        })),
      },
    };
  };
}
