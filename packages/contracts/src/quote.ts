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
import { defineMachine, type GuardResult } from './state-machine.js';

/* ------------------------------------------------------------------------------------------- *
 * States
 * ------------------------------------------------------------------------------------------- */

/**
 * Two states in the row, and a third that is never written.
 *
 * `ACCEPTED` and `REJECTED` belong to `W4-T04`, which is what can produce them — the rule
 * `W4-T02` §2.1 set and this file follows.
 *
 * **`EXPIRED` is not here on purpose.** It is not a state anything moves a quote into; it is what
 * `validUntil` already says (see `quoteStatusOf`). A status column that only becomes true when a
 * sweep runs is a column that is wrong between the sweeps, and there is no scheduler in this
 * codebase to run one.
 */
export const QuoteStatusSchema = z.enum(['PENDING', 'WITHDRAWN']);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

/** What a reader sees, which includes the one the database never stores. */
export const QuoteStateSchema = z.enum(['PENDING', 'WITHDRAWN', 'EXPIRED']);
export type QuoteState = z.infer<typeof QuoteStateSchema>;

/** `W4-T04` adds `ACCEPT` and `REJECT` with the states they lead to. */
export const QuoteEventSchema = z.enum(['WITHDRAW']);
export type QuoteEvent = z.infer<typeof QuoteEventSchema>;

/**
 * `entity: 'quote'`, so `SELECT * FROM audit_record WHERE entity = 'quote'` is every quote that
 * ever moved — the same guarantee `jobMachine` gives for jobs.
 */
export const quoteMachine = defineMachine<QuoteStatus, QuoteEvent, void>({
  name: 'quote',
  initial: 'PENDING',
  states: ['PENDING', 'WITHDRAWN'],
  /**
   * Withdrawing is final: the provider submits a *new* quote rather than reinstating an old one,
   * which is also what makes the partial unique index in `0012` safe (spec §2.4).
   */
  terminal: ['WITHDRAWN'],
  transitions: [{ from: 'PENDING', on: 'WITHDRAW', to: 'WITHDRAWN' }],
});

/**
 * What a reader sees, which is the stored status unless arithmetic overrides it.
 *
 * A withdrawn quote stays withdrawn whatever the date says — it was ended by a person, and that is
 * the more specific fact. Only a `PENDING` one can turn out to be expired.
 */
export function quoteStatusOf(status: QuoteStatus, validUntil: Date, now: Date): QuoteState {
  if (status === 'WITHDRAWN') return 'WITHDRAWN';
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
