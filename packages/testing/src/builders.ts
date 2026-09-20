/**
 * Pure builders — one per model in `apps/api/prisma/schema.prisma`.
 *
 * Each returns a complete, valid row. Nothing is validated on the way out (spec §4.2): a builder
 * must be able to produce a deliberately invalid row, because half the tests that matter are the
 * ones asserting that a constraint fires.
 */
import { nextAt, nextId, nextOrdinal } from './sequence.js';

export type UserRole = 'CLIENT' | 'PROVIDER' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
export type ProviderKind = 'MANITAS' | 'PRO';
export type Locale = 'ES' | 'EN';
export type ActorType = 'USER' | 'SYSTEM';

export interface UserInput {
  id: string;
  email: string;
  roles: UserRole[];
  status: UserStatus;
  locale: Locale;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientProfileInput {
  id: string;
  userId: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Two of these are nullable, and the nullability is the interesting part (`MEM-2026-09-17-10`).
 *
 * `schema.prisma` makes `service_radius_metres` and `hourly_rate_cents` optional, and each null is
 * a distinct state the discovery and provider slices are built on: a null radius means
 * *unsearchable* (neither zero nor infinite), and a null rate is what `mode=booking` filters on.
 * Typed non-nullable, these factories could not build either row — `W3-T05` and `W3-T07` both
 * reached past them to Prisma before this was widened.
 *
 * **`baseAddressId` is no longer among them.** `W3-T02`'s migration made the column `NOT NULL`, so
 * a profile without one is not a state a test can set up — it is a row the database refuses.
 */
export interface ProviderProfileInput {
  id: string;
  userId: string;
  kind: ProviderKind;
  displayName: string;
  baseAddressId: string;
  serviceRadiusMetres: number | null;
  hourlyRateCents: number | null;
  ratingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddressInput {
  id: string;
  userId: string;
  line1: string;
  city: string;
  province: string;
  postalCode: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryInput {
  id: string;
  slug: string;
  nameEs: string;
  nameEn: string;
  requiresLicence: boolean;
  position: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderCategoryInput {
  providerProfileId: string;
  categoryId: string;
  createdAt: Date;
}

/**
 * A job — `W4-T01`.
 *
 * Nearly every field is nullable in the schema **on purpose**: a `DRAFT` requires nothing but an
 * owner, because the operator's rule is that a user completes a minimal flow with missing
 * parameters (`MEM-2026-09-20-4`). The builder honours that — its default is the emptiest job the
 * product allows, not a fully-populated one — so a test that needs a field says so, and a test of
 * the minimal path gets the minimal path without opting out of anything.
 */
export interface JobInput {
  id: string;
  clientId: string;
  status: 'DRAFT' | 'OPEN' | 'CANCELLED';
  title: string | null;
  description: string | null;
  urgency: 'urgente' | 'hoy' | 'semana' | 'flexible' | null;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  addressId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A job's link to one of its trades. Composite key, like `ProviderCategory`. */
export interface JobCategoryInput {
  jobId: string;
  categoryId: string;
  createdAt: Date;
}

/**
 * A quote — `W4-T03`.
 *
 * **Named `QuoteRowInput`, breaking this file's `<Model>Input` convention on purpose:**
 * `@marketplace/contracts` already exports a `QuoteInput`, which is the *wire* shape a provider
 * submits, and the two packages are routinely imported into the same test file. Two different
 * `QuoteInput`s a single import line apart is a trap worth one inconsistent name.
 *
 * `amountCents` has a value because a quote without a price is not a quote — unlike `Job`, where
 * every optional column is deliberately null (see `buildJob`).
 */
export interface QuoteRowInput {
  id: string;
  jobId: string;
  providerId: string;
  status: 'PENDING' | 'WITHDRAWN';
  amountCents: number;
  breakdown: string | null;
  validUntil: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** `example.test` is reserved by RFC 6761 — it can never resolve, so no test can post to it. */
const EMAIL_DOMAIN = 'example.test';

/** Puerta del Sol. A real, geocodable point in the only market the platform launches in. */
const MADRID = { latitude: 40.416775, longitude: -3.70379 } as const;

export function buildUser(overrides: Partial<UserInput> = {}): UserInput {
  const n = nextOrdinal('User.email');
  const at = nextAt();
  return {
    id: nextId('User'),
    // Unique per call: the schema's unique index is on `lower(email)`, so a shared default would
    // collide on the second row of every test that makes two users.
    email: `user-${String(n)}@${EMAIL_DOMAIN}`,
    roles: ['CLIENT'],
    status: 'ACTIVE',
    locale: 'ES',
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

export function buildClientProfile(
  overrides: Partial<ClientProfileInput> = {},
): ClientProfileInput {
  const n = nextOrdinal('ClientProfile.name');
  const at = nextAt();
  return {
    id: nextId('ClientProfile'),
    userId: nextId('User'),
    displayName: `Cliente ${String(n)}`,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

export function buildProviderProfile(
  overrides: Partial<ProviderProfileInput> = {},
): ProviderProfileInput {
  const n = nextOrdinal('ProviderProfile.name');
  const at = nextAt();
  return {
    id: nextId('ProviderProfile'),
    userId: nextId('User'),
    // MANITAS is the default because it is the unlicensed kind: a test that forgets to say which
    // it wants gets the one that may *not* be surfaced for `requiresLicence` categories, so a
    // missing licence check fails the test rather than passing it.
    kind: 'MANITAS',
    displayName: `Proveedor ${String(n)}`,
    // A dangling id, like `userId` above: this builder is pure, and `createProviderProfile`
    // replaces it with a real `address` row belonging to the same user. Required since `W3-T02` —
    // a provider with no base address is a row the database refuses, not a state to default to.
    baseAddressId: nextId('Address'),
    // CHECK (service_radius_metres > 0 AND <= 200000); CHECK (hourly_rate_cents >= 0). Both
    // default to a set value: the *defaults* describe an ordinary bookable provider, and a test
    // that wants "not set" or "quote-only" passes null explicitly.
    serviceRadiusMetres: 15_000,
    hourlyRateCents: 3_500,
    ratingCount: 0,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

export function buildAddress(overrides: Partial<AddressInput> = {}): AddressInput {
  const n = nextOrdinal('Address.line1');
  const at = nextAt();
  return {
    id: nextId('Address'),
    userId: nextId('User'),
    line1: `Calle Mayor ${String(n)}`,
    city: 'Madrid',
    province: 'Madrid',
    // CHECK (postal_code ~ '^[0-9]{5}$') — five digits, ES only.
    postalCode: '28001',
    countryCode: 'ES',
    ...MADRID,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

export function buildCategory(overrides: Partial<CategoryInput> = {}): CategoryInput {
  const n = nextOrdinal('Category.slug');
  const at = nextAt();
  return {
    id: nextId('Category'),
    // Unique index on slug, so this must move with the sequence.
    slug: `categoria-${String(n)}`,
    nameEs: `Categoría ${String(n)}`,
    nameEn: `Category ${String(n)}`,
    // False by default: a category that requires a licence is the exceptional, compliance-bearing
    // case and a test that needs one should have to say so.
    requiresLicence: false,
    position: n,
    isActive: true,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

export interface AuditRecordInput {
  id: string;
  /// The machine's name — `booking`, `job`. Text, not an enum, per the schema.
  entity: string;
  entityId: string;
  action: string;
  fromState: string;
  toState: string;
  actorType: ActorType;
  /// Nullable by design: the schema keeps no foreign key, so that GDPR erasure can hard-delete a
  /// user without erasing the ledger of what they did.
  actorId: string | null;
  metadata: Record<string, unknown> | null;
  at: Date;
}

/**
 * The emptiest job the schema permits: a `DRAFT` with an owner and nothing else.
 *
 * Deliberately not a "realistic" job. `W4-T01`'s whole design is that this row is legal, so a
 * builder that quietly filled in a title and a description would make the minimal path the one
 * case no fixture ever exercises.
 */
export function buildJob(overrides: Partial<JobInput> = {}): JobInput {
  const createdAt = nextAt();
  return {
    id: nextId('Job'),
    clientId: nextId('User'),
    status: 'DRAFT',
    title: null,
    description: null,
    urgency: null,
    budgetMinCents: null,
    budgetMaxCents: null,
    addressId: null,
    publishedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

/**
 * `validUntil` is thirty days after the fixture clock rather than a fixed date, so a quote built by
 * a factory is *valid* by default. `quoteStatusOf` reads an expired one as `EXPIRED`, and a builder
 * whose default silently produced expired quotes would make every test of the ordinary path
 * assert the exception instead.
 */
export function buildQuote(overrides: Partial<QuoteRowInput> = {}): QuoteRowInput {
  const createdAt = nextAt();
  return {
    id: nextId('Quote'),
    jobId: nextId('Job'),
    providerId: nextId('ProviderProfile'),
    status: 'PENDING',
    amountCents: 250000,
    breakdown: null,
    validUntil: new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

export function buildJobCategory(overrides: Partial<JobCategoryInput> = {}): JobCategoryInput {
  return {
    jobId: nextId('Job'),
    categoryId: nextId('Category'),
    createdAt: nextAt(),
    ...overrides,
  };
}

export function buildProviderCategory(
  overrides: Partial<ProviderCategoryInput> = {},
): ProviderCategoryInput {
  return {
    providerProfileId: nextId('ProviderProfile'),
    categoryId: nextId('Category'),
    createdAt: nextAt(),
    ...overrides,
  };
}

/**
 * A row of the state-machine ledger.
 *
 * The default is the shape most tests want: a booking that moved on, recorded by the system. The
 * `entity`/`action`/`fromState`/`toState` quartet is free text in the schema on purpose (`W1-T05`
 * §8.2) — an enum there would list every state of every slice — so a test that cares about a
 * specific machine overrides all four and gets a row that machine would recognise.
 *
 * `at` comes from the sequence rather than from a column default: the schema deliberately has no
 * default, so that there is one source of truth for when a transition happened.
 */
export function buildAuditRecord(overrides: Partial<AuditRecordInput> = {}): AuditRecordInput {
  return {
    id: nextId('AuditRecord'),
    entity: 'booking',
    // The subject's id, and deliberately *not* from `nextId('AuditRecord')` — that would read as
    // "audit record #2" in a failure message when it means "the booking this is about". There is no
    // `Booking` table yet (`W1-T05` shipped six tables and it is not among them), so the default is
    // a placeholder on its own sequence, with a zero prefix that says "not a seeded entity". A test
    // with a real subject passes its id.
    entityId: `00000000-0000-4000-8000-${nextOrdinal('AuditRecord.entity').toString(16).padStart(12, '0')}`,
    action: 'PAYMENT_CAPTURED',
    fromState: 'PENDING',
    toState: 'PAID',
    // SYSTEM, not USER: the ledger's commonest author is the state machine itself, and a test that
    // cares who acted should have to say so.
    actorType: 'SYSTEM',
    actorId: null,
    metadata: null,
    at: nextAt(),
    ...overrides,
  };
}
