/**
 * The order a provider reads the market in, and the switches they read it with — `W4-T07` §3.3.
 *
 * **These are presentation rules, not the API's.** `GET /api/me/job-feed` pages by `publishedAt` and
 * declares no filters at all, by the operator's decision (spec §2.6): *"in the view will be the
 * client to be able to filter"*. So this module is where the product rules of the feed live, and it
 * is pure so that they can be asserted without a DOM — the same split `features/quotes/ranking.ts`
 * made for the comparison screen.
 *
 * What it costs is written down rather than hidden: the screen loads a bounded prefix of the feed, so
 * a filter here is a filter over that prefix. `filterFeed` cannot know about a job on page six, and
 * the screen says when it stopped reading.
 */
import { type JobCategory, type JobFeedItem } from '@marketplace/contracts';

export type FeedSort = 'newest' | 'nearest';

/**
 * Two orders, and no "best match".
 *
 * ADR-014 says the queue is never for sale, and a relevance score is where that stops being true —
 * so the only orders offered are two facts: when it was posted, and how far it is.
 */
export const FEED_SORTS: readonly FeedSort[] = ['newest', 'nearest'];

export interface FeedFilters {
  /** A category slug, or `all`. A job matches on **any** of its trades. */
  readonly trade: string;
  /** Hide jobs asking for a regulated trade this provider does not list. */
  readonly hideLicenceGaps: boolean;
  /** Hide jobs this provider has already quoted. */
  readonly hideQuoted: boolean;
}

/** Everything shown. The state the screen opens in, because a feed should not start filtered. */
export const NO_FILTERS: FeedFilters = { trade: 'all', hideLicenceGaps: false, hideQuoted: false };

/**
 * Does this job ask for a **regulated** trade the provider does not list?
 *
 * The narrowest true sentence the schema supports, and deliberately narrow (spec §2.2). Quoting
 * outside your listed trades is allowed — `W4-T03`: *"It is up to the professional to decide to apply
 * or not"* — so an ordinary trade the provider does not list is not a gap worth hiding. A **regulated**
 * one is, because that is the case where the professional may have a legal reason to pass.
 *
 * It makes no claim about verification: nothing in this system knows whether anybody holds a licence
 * (`W8` is unbuilt), so this says *the job needs a regulated trade and you do not list it* and stops.
 */
export function hasLicenceGap(item: JobFeedItem): boolean {
  return item.coverage.some((entry) => entry.requiresLicence && !entry.listedByProvider);
}

/** Has the provider reading this feed already answered this job? */
function isQuoted(item: JobFeedItem): boolean {
  return item.myQuote !== null;
}

/**
 * The trades present in the loaded set, once each, in slug order.
 *
 * **Slug order rather than taxonomy order**, and the reason is that the feed item does not carry
 * `position`: the taxonomy's own order is a column `GET /api/categories` serves and this endpoint does
 * not. Alphabetical by slug is arbitrary and *stable*, which is the property a `<select>` needs; an
 * order that depended on which job happened to arrive first would reshuffle the control on every
 * refresh.
 */
export function tradesIn(items: readonly JobFeedItem[]): readonly JobCategory[] {
  const bySlug = new Map<string, JobCategory>();
  for (const item of items) {
    for (const category of item.categories) bySlug.set(category.slug, category);
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * The loaded feed, in the order asked for.
 *
 * A copy, never a sort in place: the loader's array is what React Query is holding, and sorting it
 * would mutate a cache entry other renders read.
 */
export function sortFeed(items: readonly JobFeedItem[], sort: FeedSort): readonly JobFeedItem[] {
  if (sort === 'newest') return [...items];
  return [...items].sort(
    // The id last, so two jobs the same distance away still have one settled order.
    (a, b) => a.distanceMetres - b.distanceMetres || a.id.localeCompare(b.id),
  );
}

/**
 * The loaded feed, with what the provider asked to hide removed.
 *
 * The switches **combine**: three predicates, all of which must hold. Written as a chain of `&&`
 * rather than as a sequence of `filter`s so that "the last one wins" is not a state this function can
 * be in.
 */
export function filterFeed(
  items: readonly JobFeedItem[],
  filters: FeedFilters,
): readonly JobFeedItem[] {
  return items.filter(
    (item) =>
      (filters.trade === 'all' ||
        item.categories.some((category) => category.slug === filters.trade)) &&
      (!filters.hideLicenceGaps || !hasLicenceGap(item)) &&
      (!filters.hideQuoted || !isQuoted(item)),
  );
}
