/**
 * `W12-T08` — the search contract.
 *
 * Two halves of ADR-011 §3 consequence 1 meet here and nowhere else: `packages/ui` produces the
 * *structure* of a search (declared keys, string values) and this package declares its *meaning*.
 * AC7 is the assertion that they compose; everything else is the meaning being strict about itself.
 */
import { describe, expect, it } from 'vitest';
import {
  CategoryListSchema,
  CategorySummarySchema,
  PAGE_LIMIT_DEFAULT,
  POINT_DECIMALS,
  SEARCH_DEFAULT_SORT,
  SEARCH_SORTABLE,
  SearchFacetsSchema,
  SearchPointSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  SearchResultSchema,
  coarsenPoint,
  fetchLimit,
  pageOf,
  type SearchResult,
} from '../src/index.js';

/** Puerta del Sol, the same point `packages/testing` seeds its addresses at. */
const SOL = { latitude: 40.416775, longitude: -3.70379 };

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Fontanería Gómez',
    kind: 'PRO',
    bio: null,
    categories: [{ slug: 'fontaneria', name: 'Fontanería' }],
    ratingAvg: 4.5,
    ratingCount: 12,
    hourlyRateCents: 3_500,
    distanceMetres: 1_200,
    city: 'Madrid',
    province: 'Madrid',
    point: coarsenPoint(SOL),
    ...overrides,
  };
}

const response = (items: SearchResult[]) => ({
  items,
  page: { nextCursor: null, hasMore: false },
  facets: {
    categories: [{ slug: 'fontaneria', name: 'Fontanería', count: items.length }],
    kinds: [{ kind: 'PRO' as const, count: items.length }],
  },
});

describe('AC1 — the module is exported from the seam', () => {
  it('exposes the query, the result, the response, the facets and the point helper', () => {
    expect(typeof SearchQuerySchema.parse).toBe('function');
    expect(typeof SearchResultSchema.parse).toBe('function');
    expect(typeof SearchResponseSchema.parse).toBe('function');
    expect(typeof SearchFacetsSchema.parse).toBe('function');
    expect(typeof coarsenPoint).toBe('function');
    expect(SEARCH_SORTABLE).toEqual(['distanceMetres']);
    expect(SEARCH_DEFAULT_SORT).toBe('distanceMetres');
  });
});

describe('AC2..AC6 — the request is a W1-T02 list query, and it is strict', () => {
  it('AC2 — fills in the W1-T02 defaults and appends the tiebreaker', () => {
    const parsed = SearchQuerySchema.parse({ where: '28013' });
    expect(parsed.limit).toBe(PAGE_LIMIT_DEFAULT);
    expect(parsed.sort).toEqual([
      { field: 'distanceMetres', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ]);
    expect(parsed.where).toBe('28013');
  });

  it('AC3 — rejects a search with no centre', () => {
    const parsed = SearchQuerySchema.safeParse({ what: 'fontaneria' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path[0] === 'where')).toBe(true);
  });

  it('AC4 — `what` is a slug, not a name and not an id', () => {
    expect(SearchQuerySchema.safeParse({ where: '28013', what: 'fontaneria' }).success).toBe(true);
    expect(
      SearchQuerySchema.safeParse({ where: '28013', what: 'aire-acondicionado' }).success,
    ).toBe(true);
    for (const bad of ['FONTANERIA', 'aire acondicionado', 'fontanería', '-leading', 'trailing-']) {
      expect(SearchQuerySchema.safeParse({ where: '28013', what: bad }).success, bad).toBe(false);
    }
  });

  it('AC5 — `when` and `mode` are closed lists, and the issue names the key', () => {
    for (const when of ['urgente', 'hoy', 'semana', 'flexible']) {
      expect(SearchQuerySchema.safeParse({ where: '28013', when }).success, when).toBe(true);
    }
    for (const mode of ['quote', 'booking']) {
      expect(SearchQuerySchema.safeParse({ where: '28013', mode }).success, mode).toBe(true);
    }
    const bad = SearchQuerySchema.safeParse({ where: '28013', when: 'mañana' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(['when']);
  });

  it('AC6 — an undeclared parameter is a rejected request, not an ignored one', () => {
    expect(SearchQuerySchema.safeParse({ where: '28013', offset: '40' }).success).toBe(false);
  });
});

describe('AC7 — the UI half and the contract half compose', () => {
  // Exactly what `toSearchQuery` produces for ADR-011 §3's four-field declaration: every value a
  // string, absent rather than empty, keys in schema order. `packages/ui` cannot import this
  // package (AC15 there), so this is the only place the two shapes are ever checked against
  // each other — the seam ADR-011 §3 consequence 1 describes.
  const fromSearchBar: Record<string, string> = {
    what: 'fontaneria',
    where: '28013',
    when: 'semana',
    mode: 'quote',
  };

  it("parses the search bar's output unchanged", () => {
    const parsed = SearchQuerySchema.parse(fromSearchBar);
    expect(parsed.what).toBe('fontaneria');
    expect(parsed.where).toBe('28013');
    expect(parsed.when).toBe('semana');
    expect(parsed.mode).toBe('quote');
  });

  it('parses it again after a round trip through a query string', () => {
    const qs = new URLSearchParams(fromSearchBar).toString();
    const asObject = Object.fromEntries(new URLSearchParams(qs));
    expect(SearchQuerySchema.safeParse(asObject).success).toBe(true);
  });
});

describe("AC8 — the sortable name is the response's name", () => {
  it('round-trips a cursor over rows shaped like a SearchResult', () => {
    const rows = [result({ distanceMetres: 100 }), result({ distanceMetres: 200 })];
    const { sort } = SearchQuerySchema.parse({ where: '28013' });
    const page = pageOf(rows, { limit: fetchLimit(1) - 1, sort });
    expect(page.items).toHaveLength(1);
    expect(page.page.hasMore).toBe(true);
    expect(page.page.nextCursor).toBeTypeOf('string');
  });

  it('AC8b — refuses a rating sort: a nullable column is not keyset-sortable (Q4)', () => {
    expect(SearchQuerySchema.safeParse({ where: '28013', sort: 'ratingAvg' }).success).toBe(false);
  });
});

describe('AC9 — a public result never carries an address or an account', () => {
  it('rejects the four fields that would leak one', () => {
    for (const leak of ['line1', 'line2', 'userId', 'baseAddressId']) {
      const parsed = SearchResultSchema.safeParse({ ...result(), [leak]: 'anything' });
      expect(parsed.success, `${leak} was accepted into a public search result`).toBe(false);
    }
  });

  it('accepts the projection that carries none of them', () => {
    expect(SearchResultSchema.safeParse(result()).success).toBe(true);
  });
});

describe('AC10 — null means "not yet", and a rating is out of five', () => {
  it('accepts an unrated, quote-only provider', () => {
    const parsed = SearchResultSchema.safeParse(
      result({ ratingAvg: null, ratingCount: 0, hourlyRateCents: null }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects a rating outside 0..5 and a fractional cent', () => {
    expect(SearchResultSchema.safeParse(result({ ratingAvg: 5.5 })).success).toBe(false);
    expect(SearchResultSchema.safeParse(result({ ratingAvg: -1 })).success).toBe(false);
    expect(SearchResultSchema.safeParse(result({ hourlyRateCents: 35.5 })).success).toBe(false);
  });
});

describe('AC11 — extending the page envelope did not open it', () => {
  it('accepts items + page + facets and nothing else', () => {
    expect(SearchResponseSchema.safeParse(response([result()])).success).toBe(true);
    expect(
      SearchResponseSchema.safeParse({ ...response([result()]), total: 1 }).success,
      'a `total` was accepted; W1-T02 decision D removed it',
    ).toBe(false);
  });

  it('keeps the W1-T02 page shape by construction', () => {
    const parsed = SearchResponseSchema.safeParse({
      ...response([]),
      page: { nextCursor: null },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('AC12 — the map pin is coarsened in the contract, not by each caller', () => {
  it('rounds both components to POINT_DECIMALS places', () => {
    const point = coarsenPoint(SOL);
    expect(POINT_DECIMALS).toBe(3);
    for (const value of [point.latitude, point.longitude]) {
      const decimals = (String(value).split('.')[1] ?? '').length;
      expect(
        decimals,
        `${String(value)} carries more than ${String(POINT_DECIMALS)} decimals`,
      ).toBeLessThanOrEqual(POINT_DECIMALS);
    }
    expect(point.latitude).toBe(40.417);
    expect(point.longitude).toBe(-3.704);
  });

  it('rejects a result whose point was not coarsened', () => {
    expect(SearchResultSchema.safeParse(result({ point: SOL })).success).toBe(false);
  });

  /**
   * `coarsenPoint` must satisfy `SearchPointSchema` for **every** coordinate, not for the one this
   * file happens to use.
   *
   * The two assertions above passed throughout the period when the refinement rejected about 1.63%
   * of what the helper produced, because `SOL` coarsens to 40.417 / −3.704 and both are exactly
   * representable as doubles. `W3-T05` found it by parsing a real response. A fixed point cannot
   * express "for all", so this one samples instead — deterministically, so a failure is reproducible
   * rather than a flake somebody re-runs until it passes.
   */
  it('produces a point its own schema accepts, across Spain', () => {
    // A small LCG: no dependency, and the same thousand coordinates on every machine and every run.
    let seed = 20_260_917;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };

    const rejected: { latitude: number; longitude: number }[] = [];

    for (let index = 0; index < 1_000; index += 1) {
      // Spain's bounding box, the only market this product has.
      const stored = { latitude: 36 + next() * 8, longitude: -9 + next() * 13 };
      const point = coarsenPoint(stored);
      if (!SearchPointSchema.safeParse(point).success) rejected.push(point);
    }

    expect(
      rejected,
      `coarsenPoint produced ${String(rejected.length)} point(s) SearchPointSchema rejects, ` +
        `e.g. ${JSON.stringify(rejected[0] ?? null)}`,
    ).toEqual([]);
  });
});

describe('W12-T09 — the category list is declared, not implied by a mock', () => {
  const category = { slug: 'fontaneria', name: 'Fontanería', requiresLicence: false };

  it('accepts a locale-resolved category and rejects the unresolved pair', () => {
    expect(CategorySummarySchema.safeParse(category).success).toBe(true);
    expect(
      CategorySummarySchema.safeParse({
        slug: 'fontaneria',
        nameEs: 'Fontanería',
        nameEn: 'Plumbing',
      }).success,
      'the client was handed both names and asked to choose',
    ).toBe(false);
  });

  it('requires the licence flag rather than letting it default to false', () => {
    expect(
      CategorySummarySchema.safeParse({ slug: 'fontaneria', name: 'Fontanería' }).success,
    ).toBe(false);
  });

  it('holds the slug to the same pattern the search query uses', () => {
    expect(CategorySummarySchema.safeParse({ ...category, slug: 'FONTANERIA' }).success).toBe(
      false,
    );
  });

  it('wraps the tree in `items`, strictly', () => {
    expect(CategoryListSchema.safeParse({ items: [category] }).success).toBe(true);
    expect(CategoryListSchema.safeParse({ items: [category], page: {} }).success).toBe(false);
  });
});
