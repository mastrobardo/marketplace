/**
 * `W3-T07` — one provider, by id.
 *
 * The route owns parsing, the status codes and the envelope; this owns the data. The split is
 * `W3-T05`'s and it buys the same two things: `tests/provider.test.ts` asserts the whole HTTP
 * boundary — the prefix, 400-before-404, the locale, the outbound parse — without a database, and
 * `tests/provider-live.test.ts` asserts the projection against real columns without an HTTP server.
 *
 * **Prisma's typed client, not raw SQL**, and the difference from `modules/search/` is deliberate
 * (§2.2). Search is one hand-written statement because it has to be: `ST_DWithin` against a
 * generated `geography` column Prisma cannot read, facets and a keyset page that must not become
 * four round trips over a radius scan. This is one row by primary key, and no PostGIS is involved —
 * the profile needs `latitude`/`longitude`, which are ordinary columns. The cost is two or three
 * statements instead of one; what it buys is compile-time column safety on a projection whose
 * *omissions* are load-bearing.
 *
 * Spec: `docs/specs/S3/W3-T07-provider-profile-api.md` §2.2, §2.5, §2.6.
 */
import { type Prisma, type PrismaClient } from '@prisma/client';
import { coarsenPoint, type ProviderProfile } from '@marketplace/contracts';

export interface ProviderCriteria {
  readonly id: string;
  readonly locale: 'es' | 'en';
}

/**
 * `undefined` is "nothing to serve" — no such row, **or** a row with no base address (§2.4). Only
 * an HTTP handler has a status code to answer with, so the repository does not invent one.
 */
export type ProviderRepository = (
  criteria: ProviderCriteria,
) => Promise<ProviderProfile | undefined>;

export function createProviderRepository(prisma: PrismaClient): ProviderRepository {
  return async ({ id, locale }: ProviderCriteria): Promise<ProviderProfile | undefined> => {
    const row = await prisma.providerProfile.findUnique({
      where: { id },
      select: PROVIDER_PUBLIC_SELECT,
    });

    if (row === null) return undefined;

    // `W3-T07` §2.4 had a second branch here: a row with no base address could not be serialised —
    // `city`, `province` and `point` are non-null in the contract — so it answered 404 for a
    // provider who existed. `W3-T02`'s migration made `base_address_id` NOT NULL, so the state is
    // gone and with it the branch; what remains of the assertion is `core-schema.test.ts`, where a
    // column constraint is the right place for it.
    return toPublicProfile(row, locale);
  };
}

/**
 * `select`, never `include`: what is *not* named here is the projection. `userId`,
 * `baseAddressId` and the address's `line1`/`line2` are absent by construction, and a column added
 * to the table tomorrow does not appear on the wire by default (`MEM-2026-09-17-13`).
 *
 * Exported because `W3-T02`'s writer answers with the same projection — a save tells you what a
 * visitor will see — and two copies of this list is how one of them quietly grows a column.
 */
export const PROVIDER_PUBLIC_SELECT = {
  id: true,
  displayName: true,
  kind: true,
  bio: true,
  ratingAvg: true,
  ratingCount: true,
  hourlyRateCents: true,
  serviceRadiusMetres: true,
  createdAt: true,
  baseAddress: { select: { city: true, province: true, latitude: true, longitude: true } },
  categories: {
    where: { category: { isActive: true } },
    orderBy: [{ category: { position: 'asc' } }, { category: { slug: 'asc' } }],
    select: { category: { select: { slug: true, nameEs: true, nameEn: true } } },
  },
} as const satisfies Prisma.ProviderProfileSelect;

export type ProviderPublicRow = Prisma.ProviderProfileGetPayload<{
  select: typeof PROVIDER_PUBLIC_SELECT;
}>;

/** The row as the wire sees it. Every conversion this needs is a column that cannot cross as-is. */
export function toPublicProfile(row: ProviderPublicRow, locale: 'es' | 'en'): ProviderProfile {
  return {
    id: row.id,
    displayName: row.displayName,
    kind: row.kind,
    bio: row.bio,
    categories: row.categories.map(({ category }) => ({
      slug: category.slug,
      name: locale === 'en' ? category.nameEn : category.nameEs,
    })),
    // `Decimal(3,2)`, which serialises to JSON as an object rather than a number and would fail
    // the contract's `z.number()`. Null is "no reviews yet", which is not 0.00.
    ratingAvg: row.ratingAvg === null ? null : row.ratingAvg.toNumber(),
    ratingCount: row.ratingCount,
    hourlyRateCents: row.hourlyRateCents,
    city: row.baseAddress.city,
    province: row.baseAddress.province,
    serviceRadiusMetres: row.serviceRadiusMetres,
    // The wire convention `W12-T12` Q2 set: an ISO-8601 UTC instant, formatted at the display
    // layer.
    memberSince: row.createdAt.toISOString(),
    // Never the stored coordinate. `Decimal(9,6)` here too, so both cross as numbers.
    point: coarsenPoint({
      latitude: row.baseAddress.latitude.toNumber(),
      longitude: row.baseAddress.longitude.toNumber(),
    }),
  };
}
