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

export interface ProviderProfileInput {
  id: string;
  userId: string;
  kind: ProviderKind;
  displayName: string;
  serviceRadiusMetres: number;
  hourlyRateCents: number;
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
    // CHECK (service_radius_metres > 0 AND <= 200000); CHECK (hourly_rate_cents >= 0).
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
