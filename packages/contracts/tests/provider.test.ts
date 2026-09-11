/**
 * `W12-T12` — the provider profile contract.
 *
 * The suite is mostly about what the schema *refuses*. A profile is the one public page that carries
 * a single named person's trade, rating and rough location at once, and every deny below is a field
 * that would have made it carry their doorstep or their account id as well.
 *
 * AC9 is the load-bearing one: this schema is derived from `SearchResultSchema`, and a derivation
 * that quietly changed its parent would be a `W12-T08` regression discovered by `W12-T11`'s page.
 */
import { describe, expect, it } from 'vitest';
import {
  ProviderProfileSchema,
  SERVICE_RADIUS_MAX_METRES,
  SearchResultSchema,
  coarsenPoint,
  type ProviderProfile,
} from '../src/index.js';

/** Puerta del Sol — the point `packages/testing` seeds its addresses at. */
const SOL = { latitude: 40.416775, longitude: -3.70379 };

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Fontanería Gómez',
    kind: 'PRO',
    bio: 'Veinte años arreglando lo que gotea.',
    categories: [{ slug: 'fontaneria', name: 'Fontanería' }],
    ratingAvg: 4.7,
    ratingCount: 31,
    hourlyRateCents: 4_200,
    city: 'Madrid',
    province: 'Madrid',
    point: coarsenPoint(SOL),
    serviceRadiusMetres: 15_000,
    memberSince: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Parse a row with an extra key without asking TypeScript to believe the key belongs. */
function parseWith(extra: Record<string, unknown>): ReturnType<typeof ProviderProfileSchema.safeParse> {
  return ProviderProfileSchema.safeParse({ ...profile(), ...extra });
}

describe('AC1 — a complete public row parses, and every field survives', () => {
  it('accepts the row and returns it unchanged', () => {
    const input = profile();
    const parsed = ProviderProfileSchema.parse(input);
    expect(parsed).toEqual(input);
  });

  it('is exported from the seam', () => {
    expect(typeof ProviderProfileSchema.parse).toBe('function');
  });
});

describe('AC2 — strictness survives the derivation, and the absent fields are the point', () => {
  it.each([
    ['userId', '00000000-0000-4000-8000-0000000000ff'],
    ['baseAddressId', '00000000-0000-4000-8000-0000000000fe'],
    ['line1', 'Calle Mayor 3, 2ºB'],
    ['line2', 'Portal izquierda'],
    ['email', 'gomez@example.com'],
  ])('refuses %s', (key, value) => {
    expect(parseWith({ [key]: value }).success).toBe(false);
  });
});

describe('AC3 — the published point is the block, not the doorstep', () => {
  it('refuses a coordinate at stored precision', () => {
    const parsed = parseWith({ point: SOL });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('decimal places');
  });

  it('accepts the coarsened one', () => {
    expect(ProviderProfileSchema.safeParse(profile({ point: coarsenPoint(SOL) })).success).toBe(
      true,
    );
  });
});

describe('AC4 — a profile has no centre', () => {
  it('refuses distanceMetres', () => {
    expect(parseWith({ distanceMetres: 1_200 }).success).toBe(false);
  });
});

describe('AC5 — unrated is null, and null is not zero', () => {
  it('accepts no reviews yet', () => {
    expect(
      ProviderProfileSchema.safeParse(profile({ ratingAvg: null, ratingCount: 0 })).success,
    ).toBe(true);
  });

  it('accepts a genuine zero average as a different row', () => {
    const zero = ProviderProfileSchema.parse(profile({ ratingAvg: 0, ratingCount: 4 }));
    const unrated = ProviderProfileSchema.parse(profile({ ratingAvg: null, ratingCount: 0 }));
    expect(zero.ratingAvg).toBe(0);
    expect(unrated.ratingAvg).toBeNull();
    expect(zero).not.toEqual(unrated);
  });
});

describe('AC6 — a quote-only provider has no hourly rate', () => {
  it('accepts a null rate', () => {
    expect(ProviderProfileSchema.safeParse(profile({ hourlyRateCents: null })).success).toBe(true);
  });

  it('refuses a float rate — cents are integers', () => {
    expect(parseWith({ hourlyRateCents: 42.5 }).success).toBe(false);
  });
});

describe('AC7 — the service radius restates the column CHECK', () => {
  it('accepts null, which is "not set"', () => {
    expect(ProviderProfileSchema.safeParse(profile({ serviceRadiusMetres: null })).success).toBe(
      true,
    );
  });

  it.each([0, -1, SERVICE_RADIUS_MAX_METRES + 1])('refuses %d', (metres) => {
    expect(
      ProviderProfileSchema.safeParse(profile({ serviceRadiusMetres: metres })).success,
    ).toBe(false);
  });

  it('accepts the maximum itself', () => {
    expect(
      ProviderProfileSchema.safeParse(profile({ serviceRadiusMetres: SERVICE_RADIUS_MAX_METRES }))
        .success,
    ).toBe(true);
  });
});

describe('AC8 — memberSince is an ISO-8601 instant, not a date and not a locale string', () => {
  it.each(['2026-03-01', '01/03/2026', 'March 2026', ''])('refuses %s', (value) => {
    expect(ProviderProfileSchema.safeParse(profile({ memberSince: value })).success).toBe(false);
  });

  it('accepts a UTC instant', () => {
    expect(
      ProviderProfileSchema.safeParse(profile({ memberSince: '2026-03-01T09:30:00.000Z' })).success,
    ).toBe(true);
  });
});

describe('AC9 — the derivation changed nothing upstream', () => {
  /** The shape `W12-T08` froze, written out so a change to either schema has to be deliberate. */
  const SEARCH_RESULT_KEYS = [
    'id',
    'displayName',
    'kind',
    'bio',
    'categories',
    'ratingAvg',
    'ratingCount',
    'hourlyRateCents',
    'distanceMetres',
    'city',
    'province',
    'point',
  ];

  it('leaves SearchResultSchema with exactly its frozen key set', () => {
    expect(Object.keys(SearchResultSchema.shape).sort()).toEqual([...SEARCH_RESULT_KEYS].sort());
  });

  it('is the same key set minus distanceMetres plus two', () => {
    expect(Object.keys(ProviderProfileSchema.shape).sort()).toEqual(
      [
        ...SEARCH_RESULT_KEYS.filter((key) => key !== 'distanceMetres'),
        'serviceRadiusMetres',
        'memberSince',
      ].sort(),
    );
  });
});
