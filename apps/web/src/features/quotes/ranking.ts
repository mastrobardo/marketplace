/**
 * The order a client compares quotes in — `W4-T04` §3.3.
 *
 * **This is a presentation order, not the API's.** `GET /api/jobs/:id/quotes` pages by `createdAt`,
 * because a keyset cursor cannot carry a null and `ratingAvg` is nullable by design (spec §2.7).
 * The ranking that actually helps somebody choose is therefore applied here, over the whole set the
 * screen has loaded, and it is pure so that the slice's rule can be asserted without a DOM.
 *
 * The rule, from the slice charter: *sort by rating then price, the client can re-sort, **do not
 * hide the cheapest***.
 */
import { type Quote } from '@marketplace/contracts';

export type QuoteSort = 'recommended' | 'price' | 'newest';

export const QUOTE_SORTS: readonly QuoteSort[] = ['recommended', 'price', 'newest'];

/**
 * A quote somebody can still act on.
 *
 * `PENDING` and nothing else. An `EXPIRED` one has lapsed, a `WITHDRAWN` one was taken back, and an
 * `ACCEPTED` or `REJECTED` one has already been answered — none of them is an offer on the table,
 * which is what both functions below mean by "live".
 */
function isLive(quote: Quote): boolean {
  return quote.status === 'PENDING';
}

/**
 * Rating, descending, with **no reviews yet sorted last rather than as a zero**.
 *
 * `null` is the cold-start case the search contract refuses to treat as `0.00`, and a marketplace
 * that has not launched is mostly cold starts. Bottom of the list is the honest place for an
 * unknown: it is not a claim that they are bad, and it is not a claim that they are good.
 */
function byRating(a: Quote, b: Quote): number {
  const left = a.provider.ratingAvg;
  const right = b.provider.ratingAvg;
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

const byPrice = (a: Quote, b: Quote): number => a.amountCents - b.amountCents;

const byNewest = (a: Quote, b: Quote): number => b.createdAt.localeCompare(a.createdAt);

/** The id, last, so two quotes that tie on everything named still have one settled order. */
const byId = (a: Quote, b: Quote): number => a.id.localeCompare(b.id);

const COMPARATORS: Record<QuoteSort, ((a: Quote, b: Quote) => number)[]> = {
  recommended: [byRating, byPrice, byId],
  price: [byPrice, byRating, byId],
  newest: [byNewest, byId],
};

/**
 * The loaded quotes, in the order the client asked for — with everything they cannot act on last.
 *
 * The partition comes before the sort and outranks it: a lapsed quote that is cheaper *and* better
 * rated than every live one would otherwise lead the list, on a screen whose entire purpose is
 * choosing. A row you cannot choose belongs under the rows you can.
 */
export function rankQuotes(quotes: readonly Quote[], sort: QuoteSort): readonly Quote[] {
  const order = COMPARATORS[sort];
  const compare = (a: Quote, b: Quote): number => {
    if (isLive(a) !== isLive(b)) return isLive(a) ? -1 : 1;
    for (const comparator of order) {
      const verdict = comparator(a, b);
      if (verdict !== 0) return verdict;
    }
    return 0;
  };

  return [...quotes].sort(compare);
}

/**
 * The cheapest live offer, or `null` — the one thing that must stay visible under every sort.
 *
 * **Null when there is only one live quote**, because "cheapest" is a comparison and a badge on the
 * only option compares it with nothing. It would read as an endorsement, which is exactly what this
 * mark must not become.
 */
export function cheapestOf(quotes: readonly Quote[]): string | null {
  const live = quotes.filter(isLive);
  if (live.length < 2) return null;

  return live.reduce((cheapest, quote) =>
    quote.amountCents < cheapest.amountCents ? quote : cheapest,
  ).id;
}
