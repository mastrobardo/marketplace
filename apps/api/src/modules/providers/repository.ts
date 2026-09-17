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
import { type PrismaClient } from '@prisma/client';
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
      // `select`, never `include`: what is *not* named here is the projection. `userId`,
      // `baseAddressId` and the address's `line1`/`line2` are absent by construction, and a
      // column added to the table tomorrow does not appear on the wire by default.
      select: {
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
      },
    });

    if (row === null) return undefined;

    // A provider with no base address cannot be serialised — `city`, `province` and `point` are
    // non-null in the contract — and is already unsearchable (`schema.prisma:213`). So it is
    // "nothing to serve" rather than a 500. §2.4 has the product rule that removes this branch.
    if (row.baseAddress === null) return undefined;

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
  };
}
