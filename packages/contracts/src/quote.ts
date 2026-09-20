/**
 * `W4-T03` — a *presupuesto*, and the question `W4-T01` refused to prejudge.
 *
 * **One quote covers the whole job.** Not a category, not a part of one. The operator settled it on
 * 2026-09-20: *"1 quote for everything. Usually, a plumber knows an electirician wich works with
 * him already […] It would be also too chaotic for a user accepting X presupuestos."* A client who
 * wants a bathroom should not have to become a general contractor to get one.
 *
 * The second half of that instruction shapes this file as much as the first: *"It is up to the
 * professional to decide to apply or not."* Nothing here checks whether a provider covers the job's
 * trades. What it does instead is **say plainly what the job needs and what the provider lists**,
 * and leave the choice with the client — *"Nothing enforces, but stated clearly."*
 *
 * Frozen seam — changing a shape here costs an ADR (`agents/policies/contract-change.md`).
 * Spec: `docs/specs/S4/W4-T03-quote-submission.md`.
 */
import { z } from 'zod';

import { JobCategorySchema, type JobStatus } from './job.js';
import { listQuery, pageEnvelope } from './pagination.js';
import { defineMachine, type GuardResult } from './state-machine.js';

/* ------------------------------------------------------------------------------------------- *
 * States
 * ------------------------------------------------------------------------------------------- */

/**
 * Four states in the row, and a fifth that is never written.
 *
 * `ACCEPTED` and `REJECTED` arrive here with `W4-T04`'s routes, which is the rule `W4-T02` §2.1 set
 * and `W4-T03` followed: a state is declared by the ticket that can **produce** it, never by the one
 * that can see it coming.
 *
 * **`EXPIRED` is still not here, and for the same reason it never was.** It is not a state anything
 * moves a quote into; it is what `validUntil` already says (see `quoteStatusOf`). A status column
 * that only becomes true when a sweep runs is a column that is wrong between the sweeps, and there
 * is still no scheduler in this codebase to run one.
 */
export const QuoteStatusSchema = z.enum(['PENDING', 'WITHDRAWN', 'ACCEPTED', 'REJECTED']);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

/** What a reader sees, which includes the one the database never stores. */
export const QuoteStateSchema = z.enum(['PENDING', 'WITHDRAWN', 'ACCEPTED', 'REJECTED', 'EXPIRED']);
export type QuoteState = z.infer<typeof QuoteStateSchema>;

/** `W4-T05` adds `AWARD`, and takes `ACCEPTED` out of `terminal` in the same change (spec §2.6). */
export const QuoteEventSchema = z.enum(['WITHDRAW', 'ACCEPT', 'REJECT']);
export type QuoteEvent = z.infer<typeof QuoteEventSchema>;

/**
 * What a guard here needs loaded before it can decide.
 *
 * The machine was context-free until `ACCEPT` arrived. It cannot stay that way, because expiry is
 * arithmetic (`quoteStatusOf`) rather than a stored status: a lapsed quote still **stores**
 * `PENDING`, so a machine reading only the column would accept an offer that expired last week.
 *
 * Guards are pure and synchronous (`W1-T07` Decision D), so the repository loads both instants and
 * passes them in rather than letting the guard reach for a clock or a row.
 */
export interface QuoteContext {
  readonly validUntil: Date;
  readonly now: Date;
}

/**
 * `entity: 'quote'`, so `SELECT * FROM audit_record WHERE entity = 'quote'` is every quote that
 * ever moved — the same guarantee `jobMachine` gives for jobs.
 */
export const quoteMachine = defineMachine<QuoteStatus, QuoteEvent, QuoteContext>({
  name: 'quote',
  initial: 'PENDING',
  states: ['PENDING', 'WITHDRAWN', 'ACCEPTED', 'REJECTED'],
  /**
   * Withdrawing is final: the provider submits a *new* quote rather than reinstating an old one,
   * which is also what makes the partial unique index in `0012` safe (`W4-T03` spec §2.4).
   *
   * **`ACCEPTED` is terminal today and this is a declared debt, not an oversight.** Nothing can move
   * a quote out of it because `W4-T05` — the award — does not exist, and inventing a reversal for an
   * award that cannot happen is the empty promise this repo keeps refusing (`MEM-2026-09-20-29`).
   * `W4-T01` made `OPEN` terminal on the same reasoning and it became a lie the moment a state came
   * after it (`MEM-2026-09-20-11`), so the rule for paying this one is written down in advance:
   * **`ACCEPTED` leaves this list in the same change that gives it an exit.**
   */
  terminal: ['WITHDRAWN', 'ACCEPTED', 'REJECTED'],
  transitions: [
    { from: 'PENDING', on: 'WITHDRAW', to: 'WITHDRAWN' },
    {
      from: 'PENDING',
      on: 'ACCEPT',
      to: 'ACCEPTED',
      /**
       * An offer past its own validity date cannot be taken up. The rule lives here, next to the
       * states, rather than as an `if` in the repository — `MEM-2026-09-20-13` applied to a guard.
       */
      guard: (context) =>
        context.validUntil.getTime() > context.now.getTime() || {
          reason: 'this quote has expired and can no longer be accepted',
          code: 'CONFLICT',
        },
    },
    /**
     * **`REJECT` carries no expiry guard, deliberately.** Rejecting a lapsed offer is a client
     * tidying their own screen; refusing it would leave a row nobody can ever clear.
     */
    { from: 'PENDING', on: 'REJECT', to: 'REJECTED' },
  ],
});

/**
 * What a reader sees, which is the stored status unless arithmetic overrides it.
 *
 * **A decision by a person outranks the calendar.** A quote that was withdrawn, accepted or rejected
 * says so whatever the date does afterwards: the validity window governs whether an offer may still
 * be taken up, and once somebody has answered it the window has done its work. A quote accepted on
 * Monday and read on Friday reads `ACCEPTED`, not `EXPIRED`.
 *
 * Only `PENDING` — the state where nobody has answered — can turn out to be expired.
 */
export function quoteStatusOf(status: QuoteStatus, validUntil: Date, now: Date): QuoteState {
  if (status !== 'PENDING') return status;
  return validUntil.getTime() <= now.getTime() ? 'EXPIRED' : 'PENDING';
}

/* ------------------------------------------------------------------------------------------- *
 * Who may quote
 * ------------------------------------------------------------------------------------------- */

/**
 * Which job states accept a quote — the slice's own rule (*"quotes on a closed job return
 * `409 JOB_CLOSED`"*) expressed where the states are.
 *
 * `Record<JobStatus, boolean>` rather than `job.status === 'OPEN'`, per `MEM-2026-09-20-13`: when
 * `AWARDED` arrives this **fails the build** until somebody decides whether a quote may still be
 * submitted, instead of refusing it correctly by accident because `AWARDED` is not `OPEN`.
 */
const QUOTABLE_IN: Record<JobStatus, boolean> = {
  /** Nobody can see it but its owner, so there is nothing to quote on. */
  DRAFT: false,
  /** The only state whose whole purpose is being found and answered. */
  OPEN: true,
  /** Over. */
  CANCELLED: false,
};

export function canQuoteOn(status: JobStatus): GuardResult {
  return (
    QUOTABLE_IN[status] || {
      reason: `this job is ${status} and is not accepting quotes`,
      code: 'CONFLICT',
    }
  );
}

/**
 * Which job states let their owner answer a quote — `W4-T04` §2.9.
 *
 * A second `Record<JobStatus, boolean>` rather than a reuse of `QUOTABLE_IN`, because they answer
 * different questions and will stop agreeing at the first state that comes after `OPEN`: an
 * `AWARDED` job plainly accepts no new quotes, while whether its owner may still accept a *different*
 * one is a real question `W4-T05` has to answer. Two rules that happen to match today are not one
 * rule, and collapsing them would hide the decision rather than surface it.
 */
const DECIDABLE_IN: Record<JobStatus, boolean> = {
  /** A draft has no quotes on it at all — nothing may quote one. */
  DRAFT: false,
  /** The only state whose purpose is being answered. */
  OPEN: true,
  /** Over. The quotes stay as history and nobody answers them. */
  CANCELLED: false,
};

export function canDecideOn(status: JobStatus): GuardResult {
  return (
    DECIDABLE_IN[status] || {
      reason: `this job is ${status}; its quotes can no longer be answered`,
      code: 'CONFLICT',
    }
  );
}

/* ------------------------------------------------------------------------------------------- *
 * Coverage — stated clearly, enforcing nothing
 * ------------------------------------------------------------------------------------------- */

/**
 * One of the job's categories, and whether the quoting provider lists it.
 *
 * **There is no `verified` field, and its absence is the design.** Nothing in this schema knows
 * whether a provider is verified for a trade — `requiresLicence` marks the *category* (`W3-T01`,
 * `BD-07`), and provider-side verification is `W8-T01`/`W8-T02`, which do not exist. A nullable
 * `verified` that is always null would be the empty promise `W4-T01` refused for photos.
 *
 * What this says today is true: *the job needs `electricidad`, that trade is licensed, and this
 * provider does not list it.* `W8` makes the sentence stronger without changing its shape.
 */
export const QuoteCoverageSchema = JobCategorySchema.extend({
  /** Whether the provider has this category on their profile. **Not** a permission to quote. */
  listedByProvider: z.boolean(),
});

export type QuoteCoverage = z.infer<typeof QuoteCoverageSchema>;

/**
 * The provider, as the client weighing quotes sees them.
 *
 * Deliberately **not** `SearchResultSchema`: that shape carries `point` and `distanceMetres`, and a
 * quote list is not a place to disclose where anybody is. The fields here are the ones the operator
 * named as the basis for the decision — *"given my rates and past jobs recorded is up to the client
 * to pick me or not"* — restricted to the ones that exist as columns today.
 */
export const QuoteProviderSchema = z.strictObject({
  id: z.uuid(),
  displayName: z.string().min(1),
  /** Null is "no reviews yet", which is not 0.00 — the rule `search.ts` states at the column. */
  ratingAvg: z.number().min(0).max(5).nullable(),
  ratingCount: z.number().int().nonnegative(),
  /** Integer cents. Null = quote-only, which is most of the people writing these. */
  hourlyRateCents: z.number().int().nonnegative().nullable(),
});

export type QuoteProvider = z.infer<typeof QuoteProviderSchema>;

/* ------------------------------------------------------------------------------------------- *
 * Wire shapes
 * ------------------------------------------------------------------------------------------- */

/**
 * Writing a quote. A total and a date, and nothing else is demanded.
 *
 * `amountCents` is **information, not an instruction** (ADR-013 §4.1): the job's price never passes
 * through this platform, so nothing charges this figure and nothing reconciles against it.
 *
 * `breakdown` is prose rather than line items, for `W4-T01`'s reason — a professional who wants to
 * itemise can, without the schema demanding it of everyone who does not.
 */
export const QuoteInputSchema = z.object({
  amountCents: z.int().nonnegative(),
  validUntil: z.iso.datetime(),
  breakdown: z.string().trim().min(1).max(5000).optional(),
});

export type QuoteInput = z.infer<typeof QuoteInputSchema>;

/** A quote as either side reads it. */
export const QuoteSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  status: QuoteStateSchema,
  amountCents: z.int().nonnegative(),
  breakdown: z.string().nullable(),
  validUntil: z.iso.datetime(),
  provider: QuoteProviderSchema,
  /** Every category the **job** names, not every category the provider claims. Spec §2.3. */
  coverage: z.array(QuoteCoverageSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Quote = z.infer<typeof QuoteSchema>;

/* ------------------------------------------------------------------------------------------- *
 * Reading the quotes on one job — `W4-T04` §2.7
 * ------------------------------------------------------------------------------------------- */

/**
 * **One sortable field, and the absent one is the whole decision.**
 *
 * The screen ranks by *rating, then price* (the slice rule), and that ranking deliberately is **not**
 * the paging order. `search.ts` already refused `ratingAvg` as a sort field and the reasoning
 * transfers intact: the column is `Decimal?`, `encodeCursor` throws on a null sort value by design,
 * and a null rating means *no reviews yet* rather than zero — so a keyset over it either 500s on the
 * page that ends on an unrated provider, or, worked around, silently drops every unrated provider
 * from the list. It is a joined column too, so the order would live in a table the tiebreaker does
 * not.
 *
 * So the order that **pages** is stable, non-null and single-table, and the order that **decides** is
 * applied by the screen over the whole set it has loaded. That is honest about what each one is.
 */
export const QUOTE_SORTABLE = ['createdAt'] as const;
export const QUOTE_DEFAULT_SORT = '-createdAt';

/**
 * `GET /api/jobs/:id/quotes`, which shipped in `W4-T03` uncapped and uncursored on the assumption a
 * job attracts a handful of quotes.
 *
 * It was the right assumption and the wrong shape: the quotes on your job are written by **other
 * people**, in numbers you do not control, which is exactly the list that should not have been
 * unbounded. (Your own jobs and your own quotes are written by you, which is why `/me/jobs` and
 * `/me/quotes` keep their plain cap — spec §2.7.)
 */
export const QuoteListQuerySchema = listQuery({
  sortable: QUOTE_SORTABLE,
  defaultSort: QUOTE_DEFAULT_SORT,
});

export type QuoteListQuery = z.infer<typeof QuoteListQuerySchema>;

/** `{ items, page }` — the envelope every other list in this repo returns. */
export const QuotePageSchema = pageEnvelope(QuoteSchema);
export type QuotePage = z.infer<typeof QuotePageSchema>;
