/**
 * `W12-T12` — the public provider profile.
 *
 * **A profile is a search result minus the search, plus the provider's own reach.** That sentence is
 * the whole design, and it is why this schema is *derived* from `SearchResultSchema` rather than
 * declared beside it: two strict objects listing the same ten public fields are two things that can
 * drift, and the day a public column is added the one nobody remembered becomes the bug. Derived,
 * an added field appears on both, and the privacy refinements — the coarse point, the absent
 * `userId`, the absent address lines — come along without being restated.
 *
 * Every field is a column that exists today (`apps/api/prisma/schema.prisma:123`), which is what
 * keeps this additive rather than an ADR. The things a profile page is *expected* to carry and does
 * not — a gallery, badges, individual reviews — have no models, and inventing fields for them here
 * is how a schema acquires a column nothing ever writes to. `W12-T12` §1 has the table.
 *
 * `W3-T07` (`agent-providers`) implements `GET /providers/:id` against this. Until then
 * `apps/web/mocks/` answers it, and validates itself against this file.
 */
import { z } from 'zod';
import { SearchResultSchema } from './search.js';

/**
 * The column's own `CHECK (> 0 AND <= 200000)`, restated on the wire.
 *
 * Metres, because `ST_DWithin` on geography takes metres — the same unit `distanceMetres` uses, so
 * a page comparing "they are 3 km away" against "they cover 15 km" is comparing two numbers rather
 * than two units.
 */
export const SERVICE_RADIUS_MAX_METRES = 200_000;

/**
 * What may stand in for `:id` — the uuid, and nothing else.
 *
 * Exported rather than inlined because it has **two** consumers that must agree: the endpoint, which
 * owes a 400 for a malformed id, and the storefront's loader, which uses it to *not send a request*
 * for one. Two copies of that check is how a page ends up round-tripping `/pro/undefined`.
 */
export const ProviderIdSchema = z.uuid();

/**
 * The public projection of one provider.
 *
 * `.omit()` on a `strictObject` preserves strictness in zod 4, so the fields that are *absent* stay
 * absent by construction: no `userId` (a public row that links to an account is a correlation handed
 * out for free), no `baseAddressId`, and no `line1`/`line2` — `W1-T05` §8 states the rule and a
 * strict object turns it into a test that fails on the handler that forgets.
 *
 * `distanceMetres` is omitted because **a profile has no centre**. Carrying it would mean either a
 * distance from nothing or a second required query parameter on a URL whose whole job is to survive
 * being pasted into WhatsApp.
 */
export const ProviderProfileSchema = SearchResultSchema.omit({ distanceMetres: true }).extend({
  /**
   * How far they travel. Null is "not set", and `schema.prisma:127` says such a provider is not
   * searchable at all — so on a profile it renders as "area not stated" and never as 0 km.
   */
  serviceRadiusMetres: z.number().int().positive().max(SERVICE_RADIUS_MAX_METRES).nullable(),
  /**
   * `createdAt`. On a marketplace with no reviews yet, "here since March" is one of the few honest
   * trust signals available (`R3`) and it costs a column that already exists.
   *
   * **This is the first datetime on the wire in this package**, so it sets the convention: an
   * ISO-8601 UTC instant as a string, formatted at the display layer. It is the only option that
   * survives a JSON round trip without a reviver, and the only one that does not put a timezone in
   * the database's mouth. `state-machine.ts` uses `z.date()` because it never crosses the wire.
   */
  memberSince: z.iso.datetime(),
});

export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;
