/**
 * `W4-T04` §3.3 — the order a client compares in, and the one rule that survives every sort.
 *
 * Pure, and deliberately not a component test: *"sort by rating then price, the client can re-sort,
 * do not hide the cheapest"* is the slice's rule, and a rule asserted only through rendered DOM is
 * one that gets quietly lost the next time the markup changes.
 */
import { describe, expect, it } from 'vitest';
import { type Quote } from '@marketplace/contracts';

import { cheapestOf, rankQuotes } from '../src/features/quotes/ranking.js';

let seq = 0;

function quote(overrides: Partial<Quote> & { ratingAvg?: number | null } = {}): Quote {
  seq += 1;
  const { ratingAvg, ...rest } = overrides;
  return {
    id: `0000000${seq}-1111-4111-8111-111111111111`,
    jobId: '22222222-2222-4222-8222-222222222222',
    status: 'PENDING',
    amountCents: 100000,
    breakdown: null,
    validUntil: '2026-12-01T00:00:00.000Z',
    provider: {
      id: `9999000${seq}-1111-4111-8111-111111111111`,
      displayName: `Provider ${String(seq)}`,
      ratingAvg: ratingAvg === undefined ? 4 : ratingAvg,
      ratingCount: ratingAvg === null ? 0 : 10,
      hourlyRateCents: null,
    },
    coverage: [],
    createdAt: `2026-09-${String(10 + seq).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...rest,
  };
}

const names = (quotes: readonly Quote[]): string[] =>
  quotes.map((entry) => entry.provider.displayName);

describe('AC17 — recommended is rating, then price', () => {
  it('puts the better-rated provider first', () => {
    const weak = quote({ ratingAvg: 3.1 });
    const strong = quote({ ratingAvg: 4.8 });

    expect(names(rankQuotes([weak, strong], 'recommended'))).toEqual([
      strong.provider.displayName,
      weak.provider.displayName,
    ]);
  });

  it('breaks a tie on rating with the lower price', () => {
    const dear = quote({ ratingAvg: 4.5, amountCents: 900000 });
    const cheap = quote({ ratingAvg: 4.5, amountCents: 100000 });

    expect(names(rankQuotes([dear, cheap], 'recommended'))).toEqual([
      cheap.provider.displayName,
      dear.provider.displayName,
    ]);
  });

  it('sorts an unrated provider last — no reviews yet is not a bad rating', () => {
    const unrated = quote({ ratingAvg: null });
    const poor = quote({ ratingAvg: 1.2 });

    expect(names(rankQuotes([unrated, poor], 'recommended'))).toEqual([
      poor.provider.displayName,
      unrated.provider.displayName,
    ]);
  });
});

describe('AC17 — the client can re-sort', () => {
  it('sorts by price, cheapest first', () => {
    const dear = quote({ amountCents: 900000, ratingAvg: 5 });
    const cheap = quote({ amountCents: 100000, ratingAvg: 1 });

    expect(names(rankQuotes([dear, cheap], 'price'))).toEqual([
      cheap.provider.displayName,
      dear.provider.displayName,
    ]);
  });

  it('sorts by newest', () => {
    const older = quote({ createdAt: '2026-09-01T00:00:00.000Z' });
    const newer = quote({ createdAt: '2026-09-19T00:00:00.000Z' });

    expect(names(rankQuotes([older, newer], 'newest'))).toEqual([
      newer.provider.displayName,
      older.provider.displayName,
    ]);
  });

  it('is stable for two quotes that tie on everything the sort names', () => {
    const first = quote({ amountCents: 500, ratingAvg: 4 });
    const second = quote({ amountCents: 500, ratingAvg: 4 });

    expect(names(rankQuotes([first, second], 'price'))).toEqual(
      names(rankQuotes([first, second], 'price')),
    );
  });
});

describe('AC17 — an answered or lapsed quote is not an offer', () => {
  it('sinks everything that can no longer be taken up below everything that can', () => {
    const expired = quote({ status: 'EXPIRED', amountCents: 1, ratingAvg: 5 });
    const live = quote({ status: 'PENDING', amountCents: 900000, ratingAvg: 1 });

    // The expired one is cheaper *and* better rated, and it still sorts last: the screen is for
    // choosing, and a row you cannot choose belongs under the rows you can.
    expect(names(rankQuotes([expired, live], 'recommended'))).toEqual([
      live.provider.displayName,
      expired.provider.displayName,
    ]);
  });
});

describe('AC17 — the cheapest is never hidden', () => {
  it('finds the cheapest live offer whatever the sort says', () => {
    const dear = quote({ amountCents: 900000, ratingAvg: 5 });
    const cheap = quote({ amountCents: 100000, ratingAvg: 1 });
    const quotes = [dear, cheap];

    for (const sort of ['recommended', 'price', 'newest'] as const) {
      expect(cheapestOf(rankQuotes(quotes, sort))).toBe(cheap.id);
    }
  });

  it('does not call a withdrawn quote the cheapest — it is not an offer', () => {
    // Two live quotes, so there is a comparison to make, and a withdrawn one undercutting both.
    const withdrawn = quote({ status: 'WITHDRAWN', amountCents: 1 });
    const cheaper = quote({ status: 'PENDING', amountCents: 100000 });
    const dearer = quote({ status: 'PENDING', amountCents: 200000 });

    expect(cheapestOf([withdrawn, cheaper, dearer])).toBe(cheaper.id);
  });

  it('marks nothing when no offer is live', () => {
    expect(cheapestOf([quote({ status: 'REJECTED' })])).toBeNull();
  });

  it('marks nothing when there is only one quote — cheapest of one is not a comparison', () => {
    expect(cheapestOf([quote()])).toBeNull();
  });
});
