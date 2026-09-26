/**
 * `W4-T07` — the job feed, which is the first list in this slice written *for* a stranger.
 *
 * `W4-T03` shipped the route a provider sends a quote to and `W4-T04` shipped the screen a client
 * chooses on, and between them nothing listed the jobs: every quote in this system was written by
 * somebody handed a uuid. This is the read that closes the loop — *the open jobs I could plausibly
 * do, all of them inside a distance I said I would travel.*
 *
 * **It labels; it does not gate.** The slice charter asked the feed to *"respect licence gating"* and
 * half of that line is amended here on two grounds the spec argues in full (§2.2): nothing in this
 * schema knows whether a provider holds a licence — `Certification` is `W8` and unbuilt — so a gate
 * would be gating on profile completeness while calling it compliance; and the operator decided on
 * 2026-09-26 that the label belongs in the response and the filter belongs in the view. Which is
 * `W4-T03`'s own settled rule seen from the other side: *"Nothing enforces, but stated clearly."*
 *
 * Frozen seam — changing a shape here costs an ADR (`agents/policies/contract-change.md`).
 * Spec: `docs/specs/S4/W4-T07-provider-job-feed.md`.
 */
import { z } from 'zod';

import { JobCategorySchema, JobLocationSchema, JobUrgencySchema } from './job.js';
import { listQuery, pageEnvelope } from './pagination.js';
import { QuoteCoverageSchema, QuoteStateSchema } from './quote.js';

/* ------------------------------------------------------------------------------------------- *
 * Coverage, read from the other end
 * ------------------------------------------------------------------------------------------- */

/**
 * What the job asks for, and whether **the provider reading the feed** lists it.
 *
 * An alias rather than a copy, and that is the decision rather than laziness: `QuoteCoverageSchema`
 * is *every category the job names, plus whether a provider lists it*, which is one fact about one
 * pair of tables. A quote answers it about the provider who wrote the quote; a feed row answers it
 * about the provider doing the reading. Declaring a second identical shape would give the same fact
 * two homes, and moving it out of `quote.ts` is a frozen-seam change that would buy nothing.
 *
 * It carries no `verified`, for `W4-T03`'s reason: nothing knows one, and a field that is always
 * null is the empty promise this repo keeps refusing. `requiresLicence` is the *category's* flag
 * (`W3-T01`, `BD-07`), so what a row says today is *the job needs a regulated trade and you do not
 * list it* — true now, and stronger without changing shape when `W8` can prove a licence.
 */
export const JobFeedCoverageSchema = QuoteCoverageSchema;
export type JobFeedCoverage = z.infer<typeof JobFeedCoverageSchema>;

/* ------------------------------------------------------------------------------------------- *
 * The caller's own quote
 * ------------------------------------------------------------------------------------------- */

/**
 * The reader's own quote on this job, when they have written one.
 *
 * **A job you have already quoted stays in the feed, marked**, which is the same answer coverage
 * gives: label, do not hide. Without this the feed would be a list where some rows' send-a-quote
 * action answers `409` from `quote_one_active_per_provider_idx`, and the provider would have no way
 * to find their way back to an offer they made yesterday.
 *
 * `status` is `QuoteStateSchema`, so it runs through `quoteStatusOf` on the way out and a lapsed
 * offer reads `EXPIRED` here exactly as it does on the client's screen — which is how a provider
 * learns that the slot is free and they may quote again (`MEM-2026-09-20-30`).
 *
 * No amount and no breakdown: the provider wrote those, `GET /api/me/quotes` already serves them,
 * and a feed row is a decision about whether to look, not the place to restate an offer.
 */
export const JobFeedMyQuoteSchema = z.strictObject({
  id: z.uuid(),
  status: QuoteStateSchema,
});

export type JobFeedMyQuote = z.infer<typeof JobFeedMyQuoteSchema>;

/* ------------------------------------------------------------------------------------------- *
 * The row
 * ------------------------------------------------------------------------------------------- */

/**
 * One job as a provider scanning the market sees it.
 *
 * **Deliberately not `JobSchema`.** That is the shape a job's *owner* reads, and this list is read by
 * strangers about somebody's home, so the difference is the point (spec §2.3):
 *
 *   - **no coordinates, coarsened or otherwise.** `W3-T05` coarsens a provider's published point
 *     because their base is *usually* their home; a job's address is the client's home with no
 *     "usually" about it, and a point plus a postal code is a house. There is no map on this screen.
 *   - **no `line1`/`line2`**, which is the address itself and is not needed until there is a booking.
 *   - **nothing about the client** — no id, no name, no contact detail. A feed is not an
 *     introduction (`W4-T08`), and nothing in the decision to quote needs one.
 *   - **nothing about the other quotes.** *"Can a provider see a competitor's price?"* is a
 *     permission question (`W4-T03`), and a count is the first inch of the same slope.
 *
 * **`location` and `publishedAt` are non-nullable here although both are nullable on `JobSchema`**,
 * and that is an invariant asserted rather than assumed: a job with no address cannot have matched a
 * radius, and a job that is `OPEN` was published — `publish()` writes the status and the timestamp in
 * one transaction. Parsing on the way out is what makes it a gate instead of a comment.
 */
export const JobFeedItemSchema = z.strictObject({
  id: z.uuid(),
  /** Whatever the client typed, which may be nothing at all — `W4-T01` demands no title. */
  title: z.string().nullable(),
  description: z.string().nullable(),
  /** Every trade the job asks for, in taxonomy order. */
  categories: z.array(JobCategorySchema),
  urgency: JobUrgencySchema.nullable(),
  budget: z.object({ minCents: z.int().nullable(), maxCents: z.int().nullable() }),
  /** City, province and postal code. Never a point — see the note above. */
  location: JobLocationSchema,
  /**
   * How far the work is from the provider's own base, in metres, rounded.
   *
   * Rounded in SQL rather than here, for the reason `search.ts` states: the number that goes into a
   * cursor and the number a caller compares must be the same one. It is not a sort key
   * (`JOB_FEED_SORTABLE`) — everything in this list is already inside a distance the provider chose.
   */
  distanceMetres: z.int().nonnegative(),
  /** What the job needs, and which of it this provider lists. Labels, not permissions. */
  coverage: z.array(JobFeedCoverageSchema),
  /** The reader's own quote, or `null`. */
  myQuote: JobFeedMyQuoteSchema.nullable(),
  /** When it entered the feed, which is the order the feed pages in. */
  publishedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export type JobFeedItem = z.infer<typeof JobFeedItemSchema>;

/* ------------------------------------------------------------------------------------------- *
 * Reading it — spec §2.4, §2.5, §2.6
 * ------------------------------------------------------------------------------------------- */

/**
 * **One sortable field, and `publishedAt` rather than `createdAt` is the whole decision.**
 *
 * A draft created in June and published this morning is *new to a provider* and old to the table.
 * Paging a feed by `createdAt` would bury today's job under six weeks of nothing, which is a wrong
 * list rather than a differently sorted one — so `job_status_created_idx` does not serve this query
 * and `0015` adds a partial index that does.
 *
 * That index's predicate is `WHERE status = 'OPEN'`, and it is the same predicate that makes this
 * key **safe**: `published_at` is nullable on the model, `encodeCursor` throws on a null sort value
 * by design, and `OPEN` is exactly the condition under which the column is guaranteed set. The
 * index's `WHERE` and the cursor's safety are one fact.
 *
 * **`distanceMetres` is deliberately absent, and not for `ratingAvg`'s reason.** It is a non-null
 * integer computed in the statement and `search.ts` pages on exactly that, so a keyset over it would
 * work. It is absent because everything in the feed is already inside a distance the provider chose
 * to travel, so *nearest first* sorts a set whose members are all acceptable — what a provider asks
 * of a feed is *what is new*. Nearest-first is therefore applied by the screen over the set it has
 * loaded, the same split `W4-T04` made between `QUOTE_SORTABLE` and `rankQuotes`.
 */
export const JOB_FEED_SORTABLE = ['publishedAt'] as const;
export const JOB_FEED_DEFAULT_SORT = '-publishedAt';

/**
 * `GET /api/me/job-feed`.
 *
 * **No filters, by the operator's decision** (2026-09-26): *"in the view will be the client to be
 * able to filter."* So there is exactly one place a filter exists and it is the screen the person is
 * looking at. The cost is named in the spec rather than hidden: a filter over a loaded prefix is a
 * filter over a prefix, the screen stops at a hundred rows and says so, and the day a feed genuinely
 * overflows the filters that matter become query parameters over the whole matched set.
 *
 * Paged from the first commit, because this is `W4-T04`'s rule at its strongest: *a list written by
 * other people is the one that must be bounded* — and the open jobs within 15 km of Madrid centre are
 * not a handful the way the quotes on one job are.
 */
export const JobFeedQuerySchema = listQuery({
  sortable: JOB_FEED_SORTABLE,
  defaultSort: JOB_FEED_DEFAULT_SORT,
});

export type JobFeedQuery = z.infer<typeof JobFeedQuerySchema>;

/** `{ items, page }` — the envelope every other list in this repo returns. */
export const JobFeedPageSchema = pageEnvelope(JobFeedItemSchema);
export type JobFeedPage = z.infer<typeof JobFeedPageSchema>;
