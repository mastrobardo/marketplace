/**
 * `W3-T02` — the provider's own profile: reading it back, and writing it.
 *
 * The route owns parsing, the status codes and the envelope; this owns the rows. Same split as
 * `repository.ts`, and the same reason — `tests/provider-write.test.ts` asserts the whole HTTP
 * boundary without a database, `tests/provider-write-live.test.ts` asserts the rows without an HTTP
 * server.
 *
 * Everything the write touches happens in **one transaction** (§3.8): profile, address and the
 * category set are three tables describing one thing, and a bad slug on the fourth of five
 * categories must leave nothing behind.
 *
 * Spec: `docs/specs/S3/W3-T02-provider-profile-write.md` §3.4–§3.8.
 */
import { type Prisma, type PrismaClient } from '@prisma/client';
import {
  type ProviderProfile,
  type ProviderProfileOwn,
  type ProviderProfileWrite,
} from '@marketplace/contracts';

import { PROVIDER_PUBLIC_SELECT, toPublicProfile } from './repository.js';

export interface ProviderOwnCriteria {
  readonly userId: string;
  readonly locale: 'es' | 'en';
}

/** `undefined` is "this user has no profile yet" — a state `PUT` resolves, so the route says 404. */
export type ProviderOwnRepository = (
  criteria: ProviderOwnCriteria,
) => Promise<ProviderProfileOwn | undefined>;

export interface ProviderWriteCommand {
  readonly userId: string;
  readonly locale: 'es' | 'en';
  readonly write: ProviderProfileWrite;
}

/**
 * Why a result rather than an exception: an unknown category slug is the *caller's* mistake and
 * owes a `400` naming the slug, while an exception here would arrive at the error handler
 * indistinguishable from a database fault. The repository reports; the route decides the status.
 */
export type ProviderWriteResult =
  | { readonly ok: true; readonly profile: ProviderProfile }
  | { readonly ok: false; readonly unknownSlugs: readonly string[] };

export type ProviderWriter = (command: ProviderWriteCommand) => Promise<ProviderWriteResult>;

/**
 * The owner's projection: the public row, plus the address they typed.
 *
 * `line1`, `line2` and `postalCode` appear here and nowhere else in the API. The one person
 * entitled to their own address lines is the person who has to correct them — and the coarse
 * `point` is deliberately absent, because carrying it beside the precise address would be two
 * answers to "where are they" (§3.4).
 */
const OWN_SELECT = {
  ...PROVIDER_PUBLIC_SELECT,
  baseAddress: {
    select: {
      label: true,
      line1: true,
      line2: true,
      city: true,
      province: true,
      postalCode: true,
      latitude: true,
      longitude: true,
    },
  },
} as const satisfies Prisma.ProviderProfileSelect;

type OwnRow = Prisma.ProviderProfileGetPayload<{ select: typeof OWN_SELECT }>;

function toOwnProfile(row: OwnRow, locale: 'es' | 'en'): ProviderProfileOwn {
  // The public mapper owns every field the two share, so they cannot drift; `point` is dropped and
  // the precise address put in its place.
  const { point: _coarse, ...shared } = toPublicProfile(row, locale);

  return {
    ...shared,
    baseAddress: {
      label: row.baseAddress.label,
      line1: row.baseAddress.line1,
      line2: row.baseAddress.line2,
      city: row.baseAddress.city,
      province: row.baseAddress.province,
      postalCode: row.baseAddress.postalCode,
      latitude: row.baseAddress.latitude.toNumber(),
      longitude: row.baseAddress.longitude.toNumber(),
    },
  };
}

export function createProviderOwnRepository(prisma: PrismaClient): ProviderOwnRepository {
  return async ({ userId, locale }) => {
    const row = await prisma.providerProfile.findUnique({
      where: { userId },
      select: OWN_SELECT,
    });

    return row === null ? undefined : toOwnProfile(row, locale);
  };
}

/** Field-for-field, so that saving an unchanged form writes no row at all (§3.5). */
function sameAddress(
  stored: OwnRow['baseAddress'],
  sent: ProviderProfileWrite['baseAddress'],
): boolean {
  return (
    stored.label === sent.label &&
    stored.line1 === sent.line1 &&
    stored.line2 === sent.line2 &&
    stored.city === sent.city &&
    stored.province === sent.province &&
    stored.postalCode === sent.postalCode &&
    stored.latitude.toNumber() === sent.latitude &&
    stored.longitude.toNumber() === sent.longitude
  );
}

export function createProviderWriter(prisma: PrismaClient): ProviderWriter {
  return async ({ userId, locale, write }) =>
    prisma.$transaction(async (tx): Promise<ProviderWriteResult> => {
      // Slugs first: the cheapest refusal, and the one that must write nothing. `isActive` is part
      // of the predicate rather than a second check — a retired category is not a category a
      // provider may join, and answering "unknown" for it is the truthful answer to the only
      // question the client can act on.
      const wanted = [...new Set(write.categories)];
      const found = await tx.category.findMany({
        where: { slug: { in: wanted }, isActive: true },
        select: { id: true, slug: true },
      });

      if (found.length !== wanted.length) {
        const known = new Set(found.map((category) => category.slug));
        return { ok: false, unknownSlugs: wanted.filter((slug) => !known.has(slug)) };
      }

      const existing = await tx.providerProfile.findUnique({
        where: { userId },
        select: {
          id: true,
          baseAddressId: true,
          baseAddress: { select: OWN_SELECT.baseAddress.select },
        },
      });

      /**
       * A changed address is a **new row**, not an `UPDATE` (§3.5). The row may be somebody's home:
       * the same user can be a client whose `client_profile.default_address_id` points at it, and
       * moving an operating centre to a city square must not rewrite where they live. The old row
       * is left alone — deleting user data on an edit is `W2-T08`'s decision, not a side effect.
       */
      const baseAddressId =
        existing !== null && sameAddress(existing.baseAddress, write.baseAddress)
          ? existing.baseAddressId
          : (
              await tx.address.create({
                data: {
                  userId,
                  label: write.baseAddress.label,
                  line1: write.baseAddress.line1,
                  line2: write.baseAddress.line2,
                  city: write.baseAddress.city,
                  province: write.baseAddress.province,
                  postalCode: write.baseAddress.postalCode,
                  latitude: write.baseAddress.latitude,
                  longitude: write.baseAddress.longitude,
                },
                select: { id: true },
              })
            ).id;

      const profile = await tx.providerProfile.upsert({
        where: { userId },
        create: {
          userId,
          kind: write.kind,
          displayName: write.displayName,
          bio: write.bio,
          baseAddressId,
          serviceRadiusMetres: write.serviceRadiusMetres,
          hourlyRateCents: write.hourlyRateCents,
        },
        update: {
          kind: write.kind,
          displayName: write.displayName,
          bio: write.bio,
          baseAddressId,
          serviceRadiusMetres: write.serviceRadiusMetres,
          hourlyRateCents: write.hourlyRateCents,
        },
        select: { id: true },
      });

      // The set is replaced, not merged (§3.7). `provider_category` is keyed by its pair and has no
      // `id` column (`MEM-2026-09-18-1`), so this is a delete and a create rather than an upsert.
      await tx.providerCategory.deleteMany({ where: { providerProfileId: profile.id } });
      await tx.providerCategory.createMany({
        data: found.map((category) => ({
          providerProfileId: profile.id,
          categoryId: category.id,
        })),
      });

      // Read back through the *public* projection: what a save answers is what a visitor will see,
      // and reading it rather than assembling it means the answer went through the same `select`
      // whose omissions are the privacy rule.
      const row = await tx.providerProfile.findUniqueOrThrow({
        where: { id: profile.id },
        select: PROVIDER_PUBLIC_SELECT,
      });

      return { ok: true, profile: toPublicProfile(row, locale) };
    });
}
