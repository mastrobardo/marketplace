/**
 * `GET /categories` — the category tree as the storefront consumes it.
 *
 * `W12-T08` mocked this endpoint before it had a declared shape, because the search contract was
 * the task and this was a supporting detail. `W12-T09` puts the header's compact search on it, so
 * the shape stops being an implementation detail of a mock and becomes something two tasks agree
 * on. Additive and pre-freeze: nothing else reads it yet.
 *
 * The endpoint itself belongs to `agent-providers` (`W3-T01`), and the seeded tree is still a human
 * decision — which trades legally require a licence in ES. This declares the wire shape, not the
 * content.
 *
 * Frozen seam — changing a shape here costs an ADR (`agents/policies/contract-change.md`).
 * Spec: `docs/specs/S10/W12-T09-public-shell.md`.
 */
import { z } from 'zod';
import { CATEGORY_SLUG } from './search.js';

/**
 * One category, already resolved to the request's locale.
 *
 * `name`, not `nameEs`/`nameEn`: the client never receives both and never picks. A browser that
 * chose the language is not the same thing as a user who did, and the endpoint owns that decision
 * because `W12-T14` will make it a per-request concern on a Worker.
 */
export const CategorySummarySchema = z.strictObject({
  slug: z.string().regex(CATEGORY_SLUG),
  name: z.string().min(1),
  /**
   * The legal flag, surfaced rather than hidden. `W1-T05` §5.5 keeps it explicit per node instead of
   * inherited, so that "which categories need a licence" is one query. A storefront that drops it
   * here cannot render the badge that makes `requiresLicence` mean anything to a visitor.
   */
  requiresLicence: z.boolean(),
});

export type CategorySummary = z.infer<typeof CategorySummarySchema>;

/**
 * Not `pageEnvelope`, deliberately. The category tree is a closed, curated list of tens of rows —
 * `W1-T02`'s paging exists for lists that grow without bound, and a cursor over a navigation menu
 * would be ceremony that every caller has to unwrap. `items` matches the envelope's spelling so the
 * two read alike, and the day this needs paging it is a versioned change, not a surprise.
 */
export const CategoryListSchema = z.strictObject({
  items: z.array(CategorySummarySchema),
});

export type CategoryList = z.infer<typeof CategoryListSchema>;
