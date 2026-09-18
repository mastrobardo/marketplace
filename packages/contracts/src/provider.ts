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
import { CATEGORY_SLUG, ProviderKindSchema, SearchResultSchema } from './search.js';

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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// `W3-T02` — the write side
//
// Additive: `ProviderProfileSchema` and `ProviderIdSchema` above are untouched, so every consumer
// of the read seam keeps compiling (`agents/policies/contract-change.md` — an amendment, not a
// version). Proposed by `agent-providers` in `docs/specs/S3/W3-T02-provider-profile-write.md` §8.3
// and written here by `agent-contracts`, in the same pull request as the endpoint, with the
// operator's approval of 2026-09-18.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * How many trades one provider may claim.
 *
 * A bound on the join `W3-T05` runs across every result, **not** a product rule about how many
 * things a person may do. If it ever refuses somebody real, raise it — and say so, rather than
 * treating this number as a decision anybody made about the market.
 */
export const PROVIDER_CATEGORY_MAX = 20;

/**
 * The base address, as the provider types it.
 *
 * **The coordinates are precise here**, and that is the difference between this schema and
 * `SearchPointSchema`: coarsening is an *outbound* privacy rule (`W1-T05` §8), applied when a point
 * is published. Refusing stored precision on the way in would refuse what a geocoder actually
 * returns and leave the database with a rounded centre for everybody's radius.
 *
 * `countryCode` is deliberately absent. The column defaults to `ES`, the postal-code CHECK is
 * ES-only, and the market decision is locked — a field whose only legal value is a constant is a
 * field that eventually carries a lie.
 */
export const ProviderAddressWriteSchema = z.strictObject({
  /** "Casa", "Taller". User copy, so no enum — and optional, because a centre needs no name. */
  label: z.string().trim().min(1).max(60).nullable(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().min(1).max(200).nullable(),
  city: z.string().trim().min(1).max(100),
  province: z.string().trim().min(1).max(100),
  /** `CHECK (postal_code ~ '^[0-9]{5}$')` on the column, restated on the wire. */
  postalCode: z.string().regex(/^[0-9]{5}$/, 'must be five digits'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type ProviderAddressWrite = z.infer<typeof ProviderAddressWriteSchema>;

/**
 * `PUT /api/providers/me` — the profile as it should be afterwards.
 *
 * A whole document rather than a patch, because a partial update of a **set** has no agreed
 * meaning: `{"categories":["gas"]}` is either "add gas" or "only gas", and every client guesses
 * differently (spec §3.3).
 *
 * Two nullabilities that are not the same as the read schema's, and both are deliberate.
 * `hourlyRateCents: null` is **quote-only** — a rate, not a missing field, and what
 * `mode=booking` filters on. `serviceRadiusMetres` is **required**: null means "not set" and this
 * is the act of setting it, so a null here would be a provider asking to be unsearchable by
 * accident.
 *
 * `kind` is self-declared and buys nothing on its own: a category with `requiresLicence` surfaces
 * only a provider with an approved `Certification` (`W3-T08`), which reads a verified document
 * rather than this field.
 */
export const ProviderProfileWriteSchema = z.strictObject({
  displayName: z.string().trim().min(2).max(120),
  kind: ProviderKindSchema,
  bio: z.string().trim().max(2_000).nullable(),
  categories: z.array(z.string().regex(CATEGORY_SLUG)).min(1).max(PROVIDER_CATEGORY_MAX),
  serviceRadiusMetres: z.number().int().positive().max(SERVICE_RADIUS_MAX_METRES),
  hourlyRateCents: z.number().int().min(0).nullable(),
  baseAddress: ProviderAddressWriteSchema,
});

export type ProviderProfileWrite = z.infer<typeof ProviderProfileWriteSchema>;

/**
 * `GET /api/providers/me` — what the owner sees of their own profile.
 *
 * The public projection plus the address they typed, because the one person entitled to their own
 * `line1` is the person who has to be able to correct it. Everything else is `ProviderProfileSchema`
 * unchanged, so the two cannot drift.
 *
 * `point` is **dropped** rather than carried alongside: one precise address and one coarsened copy
 * of it in the same document is two answers to "where are they", and the next reader picks the
 * wrong one.
 */
export const ProviderProfileOwnSchema = ProviderProfileSchema.omit({ point: true }).extend({
  baseAddress: ProviderAddressWriteSchema,
});

export type ProviderProfileOwn = z.infer<typeof ProviderProfileOwnSchema>;
