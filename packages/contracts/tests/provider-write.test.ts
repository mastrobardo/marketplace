/**
 * `W3-T02` — the provider profile **write** contract.
 *
 * The read schema (`provider.test.ts`) is mostly about what a public row must not carry. This one is
 * about what a provider may *send*: full-precision coordinates, the address lines the public
 * projection refuses, and the fields whose nullability means something specific — `hourlyRateCents`
 * null is quote-only, `serviceRadiusMetres` null is not permitted at all, because this is the act of
 * setting it.
 *
 * Spec: `docs/specs/S3/W3-T02-provider-profile-write.md` §8.3.
 */
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_CATEGORY_MAX,
  ProviderAddressWriteSchema,
  ProviderProfileOwnSchema,
  ProviderProfileWriteSchema,
  SERVICE_RADIUS_MAX_METRES,
  type ProviderProfileWrite,
} from '../src/index.js';

/** Puerta del Sol at stored precision — what a geocoder hands the browser. */
const SOL = { latitude: 40.416775, longitude: -3.70379 };

function address(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Taller',
    line1: 'Calle Mayor 1',
    line2: null,
    city: 'Madrid',
    province: 'Madrid',
    postalCode: '28013',
    ...SOL,
    ...overrides,
  };
}

function write(overrides: Partial<ProviderProfileWrite> = {}): ProviderProfileWrite {
  return {
    displayName: 'Fontanería Gómez',
    kind: 'PRO',
    bio: 'Veinte años arreglando lo que gotea.',
    categories: ['fontaneria'],
    serviceRadiusMetres: 15_000,
    hourlyRateCents: 4_200,
    baseAddress: address(),
    ...overrides,
  } as ProviderProfileWrite;
}

describe('AC12/AC13 — what a provider may send', () => {
  it('accepts a complete profile', () => {
    expect(ProviderProfileWriteSchema.parse(write())).toEqual(write());
  });

  it('accepts a null rate — quote-only is a rate, not a missing field', () => {
    expect(ProviderProfileWriteSchema.safeParse(write({ hourlyRateCents: null })).success).toBe(
      true,
    );
  });

  it('accepts a null bio and a null address label', () => {
    const parsed = ProviderProfileWriteSchema.safeParse(
      write({ bio: null, baseAddress: address({ label: null }) }),
    );
    expect(parsed.success).toBe(true);
  });

  it('is exported from the seam', () => {
    expect(ProviderProfileWriteSchema).toBeDefined();
    expect(ProviderAddressWriteSchema).toBeDefined();
    expect(ProviderProfileOwnSchema).toBeDefined();
  });
});

describe('AC14 — the point a provider sends is precise, and the one a visitor sees is not', () => {
  it('accepts a coordinate at stored precision — coarsening is an outbound rule', () => {
    const parsed = ProviderAddressWriteSchema.safeParse(address());
    expect(parsed.success, 'the inbound address refused a real geocoder result').toBe(true);
  });

  it('refuses a coordinate outside the world', () => {
    expect(ProviderAddressWriteSchema.safeParse(address({ latitude: 91 })).success).toBe(false);
    expect(ProviderAddressWriteSchema.safeParse(address({ longitude: -181 })).success).toBe(false);
  });
});

describe('AC12 — the refusals', () => {
  it('refuses an empty category list — a provider with none is unsearchable', () => {
    expect(ProviderProfileWriteSchema.safeParse(write({ categories: [] })).success).toBe(false);
  });

  it(`refuses more than ${String(PROVIDER_CATEGORY_MAX)} categories`, () => {
    const many = Array.from({ length: PROVIDER_CATEGORY_MAX + 1 }, (_, i) => `trade-${String(i)}`);
    expect(ProviderProfileWriteSchema.safeParse(write({ categories: many })).success).toBe(false);
  });

  it('refuses a slug that is not a slug', () => {
    expect(
      ProviderProfileWriteSchema.safeParse(write({ categories: ['Fontanería'] })).success,
    ).toBe(false);
  });

  it('refuses a radius of zero and one above the column CHECK', () => {
    expect(ProviderProfileWriteSchema.safeParse(write({ serviceRadiusMetres: 0 })).success).toBe(
      false,
    );
    expect(
      ProviderProfileWriteSchema.safeParse({
        ...write(),
        serviceRadiusMetres: SERVICE_RADIUS_MAX_METRES + 1,
      }).success,
    ).toBe(false);
  });

  it('refuses a null radius — null is "not set", and this is the act of setting it', () => {
    expect(
      ProviderProfileWriteSchema.safeParse({ ...write(), serviceRadiusMetres: null }).success,
    ).toBe(false);
  });

  it('refuses a negative or fractional rate — cents are integers', () => {
    expect(ProviderProfileWriteSchema.safeParse(write({ hourlyRateCents: -1 })).success).toBe(
      false,
    );
    expect(ProviderProfileWriteSchema.safeParse(write({ hourlyRateCents: 42.5 })).success).toBe(
      false,
    );
  });

  it('refuses a postal code that is not five digits — the column CHECK, restated', () => {
    expect(ProviderAddressWriteSchema.safeParse(address({ postalCode: '2801' })).success).toBe(
      false,
    );
    expect(ProviderAddressWriteSchema.safeParse(address({ postalCode: '28O13' })).success).toBe(
      false,
    );
  });

  it('refuses a missing address entirely', () => {
    const { baseAddress: _omitted, ...rest } = write();
    expect(ProviderProfileWriteSchema.safeParse(rest).success).toBe(false);
  });

  it('refuses an unknown key rather than ignoring it', () => {
    // The failure mode this prevents: a client "saves" a field the server never stored.
    expect(ProviderProfileWriteSchema.safeParse({ ...write(), ratingAvg: 5 }).success).toBe(false);
    expect(
      ProviderAddressWriteSchema.safeParse(address({ countryCode: 'FR' })).success,
      'countryCode is not on the wire — the only legal value is a constant',
    ).toBe(false);
  });
});

describe("AC15 — the owner's projection carries what they typed, and only one point", () => {
  it('carries the address lines the public projection refuses', () => {
    const own = {
      id: '00000000-0000-4000-8000-000000000001',
      displayName: 'Fontanería Gómez',
      kind: 'PRO' as const,
      bio: null,
      categories: [{ slug: 'fontaneria', name: 'Fontanería' }],
      ratingAvg: null,
      ratingCount: 0,
      hourlyRateCents: 4_200,
      city: 'Madrid',
      province: 'Madrid',
      serviceRadiusMetres: 15_000,
      memberSince: '2026-03-01T00:00:00.000Z',
      baseAddress: address(),
    };

    expect(ProviderProfileOwnSchema.safeParse(own).success).toBe(true);
  });

  it('refuses a coarse `point` beside the precise address — one source of truth', () => {
    const own = {
      id: '00000000-0000-4000-8000-000000000001',
      displayName: 'Fontanería Gómez',
      kind: 'PRO' as const,
      bio: null,
      categories: [{ slug: 'fontaneria', name: 'Fontanería' }],
      ratingAvg: null,
      ratingCount: 0,
      hourlyRateCents: 4_200,
      city: 'Madrid',
      province: 'Madrid',
      serviceRadiusMetres: 15_000,
      memberSince: '2026-03-01T00:00:00.000Z',
      baseAddress: address(),
      point: { latitude: 40.417, longitude: -3.704 },
    };

    expect(ProviderProfileOwnSchema.safeParse(own).success).toBe(false);
  });
});
