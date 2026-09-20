/**
 * `W4-T01` — what a job is on the wire, and the two states it can be in before anyone quotes.
 *
 * The shape is governed by one instruction (spec §1.1): *"The fields reqiured are minimal, as more
 * info could be asked / posted later […] I dont want to policy the users."* So almost every field
 * here is optional, and the one that is not — the category set — is required at **publish**, not at
 * creation, and is enforced by a machine guard rather than by a schema.
 *
 * That split is the whole design. A schema that required a category would make a draft impossible;
 * a machine that did not would make an `OPEN` job that reaches nobody.
 *
 * `W4-T02` adds the way out. A job that nobody is going to do is `CANCELLED`, which is what finally
 * gives `OPEN` an exit — and the edit rule moves here from the repository, where nothing tied it to
 * the states it is about (`MEM-2026-09-20-11`).
 *
 * Frozen seam — changing a shape here costs an ADR (`agents/policies/contract-change.md`).
 * Specs: `docs/specs/S4/W4-T01-job-posting.md`, `docs/specs/S4/W4-T02-job-state-machine.md`.
 */
import { z } from 'zod';

import { SearchUrgencySchema } from './search.js';
import { defineMachine, type GuardResult } from './state-machine.js';

/* ------------------------------------------------------------------------------------------- *
 * States
 * ------------------------------------------------------------------------------------------- */

/**
 * Three states, and the three still missing each belong to the ticket that can *produce* them.
 *
 * The rule `W4-T01` set and this one follows: a value here that no route can reach is the empty
 * promise `permissions.ts` refuses when it declines to hold a row for a route that does not exist.
 * `ALTER TYPE … ADD VALUE` is a cheap migration; a machine that lies about what it supports is not.
 *
 * So `AWARDED` waits for something to award — an accepted quote (`W4-T03`) reaching an award
 * (`W4-T05`) — and `IN_PROGRESS` / `COMPLETED` wait for a `Booking`, because they are facts about
 * an engagement rather than about a posting, and completion is what triggers capture (`W5-T04`).
 * `W4-T02` §6.1 carries the table, and the question `W4-T05` inherits with it.
 *
 * `CANCELLED` needs none of that. A client who changed their mind is reachable today.
 */
export const JobStatusSchema = z.enum(['DRAFT', 'OPEN', 'CANCELLED']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** `AWARD` and everything after it arrive with the states they lead to — see `JobStatusSchema`. */
export const JobEventSchema = z.enum(['PUBLISH', 'CANCEL']);
export type JobEvent = z.infer<typeof JobEventSchema>;

/**
 * Urgency reuses `SearchUrgencySchema` rather than declaring a parallel vocabulary.
 *
 * `W3-T01` §3.1 settled this: *urgencia* is `EmergencyRequest` and this field, and explicitly **not**
 * a category. A client searching `hoy` and posting a job `hoy` should mean the same thing, and two
 * enums with the same four members drift the moment one of them gains a fifth.
 *
 * An urgent job is still an ordinary job. `EmergencyRequest` is `W7`'s model, with its own broadcast
 * and first-accept-wins flow.
 */
export const JobUrgencySchema = SearchUrgencySchema;
export type JobUrgency = z.infer<typeof JobUrgencySchema>;

/* ------------------------------------------------------------------------------------------- *
 * The machine
 * ------------------------------------------------------------------------------------------- */

/**
 * What this machine's guards need to decide, loaded by the caller before it asks.
 *
 * Guards are synchronous and pure by the state machine's own contract — *"a guard that could query
 * is a guard that decides differently depending on when it runs"* — so the count arrives here
 * already known.
 *
 * One shape for the whole machine, because `defineMachine` is generic over a single context type.
 * `CANCEL` has no guard and does not read `categoryCount`, but its caller still loads it rather
 * than passing a `0` that is not true: a context that lies is a context somebody will later guard on.
 */
export interface JobContext {
  readonly categoryCount: number;
}

/**
 * The one rule that stands between a draft and a published job.
 *
 * Not "the form is complete". `OPEN` means *providers can find this*, and `W4-T07` matches on
 * category — so a job with none reaches nobody and the client experiences that as silence. Every
 * other field stays optional, description included (spec §2.3).
 */
export function hasAnyCategory(context: JobContext): GuardResult {
  return (
    context.categoryCount > 0 || {
      reason:
        'a job needs at least one category before it can be published — it is how providers find it',
      code: 'CONFLICT',
    }
  );
}

/**
 * `entity: 'job'` is written into every audit row this machine produces, so
 * `SELECT * FROM audit_record WHERE entity = 'job'` is the history of every job that ever moved.
 */
export const jobMachine = defineMachine<JobStatus, JobEvent, JobContext>({
  name: 'job',
  initial: 'DRAFT',
  states: ['DRAFT', 'OPEN', 'CANCELLED'],
  /**
   * `OPEN` was here, and `W4-T01` promised it would leave in the same change that gave it an exit.
   * This is that change — the promise is kept in one edit rather than left to be noticed later,
   * because a `terminal` list that is stale reads exactly like one that is deliberate.
   *
   * `CANCELLED` is terminal for good. Reopening a cancelled job is a *new* job: a lifecycle that
   * can restart is one whose audit trail has to be read backwards before it means anything.
   */
  terminal: ['CANCELLED'],
  transitions: [
    { from: 'DRAFT', on: 'PUBLISH', to: 'OPEN', guard: hasAnyCategory },
    /**
     * One rule from two states, not two rules. A client cancelling a draft and a client cancelling
     * a published job are the same decision — *nobody is going to do this work* — and the refusal
     * a second attempt gets should not depend on which it was.
     *
     * Unguarded: there is nothing to check. Cancelling is always allowed while the job is the
     * client's and has not been awarded, and `AWARDED` is not a state that exists yet. When it
     * does, cancelling past it is a refund decision (`W5-T05`) and arrives with its own rule.
     */
    { from: ['DRAFT', 'OPEN'], on: 'CANCEL', to: 'CANCELLED' },
  ],
});

/* ------------------------------------------------------------------------------------------- *
 * Editing
 * ------------------------------------------------------------------------------------------- */

/**
 * Which states still allow the client to change the job's own fields.
 *
 * This lived in `repository.update` as `if (existing.status !== 'DRAFT')` until `W4-T02`, and the
 * problem was never where it sat — it was that **nothing connected it to the set of states**. It
 * would have gone on refusing `AWARDED` and `CANCELLED` correctly, by accident, because they are
 * not `DRAFT` either; and correct-by-accident is the failure mode with nothing red to notice
 * (`MEM-2026-09-20-11`).
 *
 * `Record<JobStatus, boolean>` is the whole mechanism: **adding a state to `JobStatusSchema` stops
 * this package compiling until somebody decides whether that state is editable.** The decision
 * cannot be made by silence, which is the one thing the `if` allowed.
 *
 * Not an `EDIT` event on the machine: every `transition()` writes an `audit_record` row, and a row
 * per save is noise rather than history — while an event in the table that nothing transitions with
 * is the same kind of lie this ticket exists to remove.
 */
const EDITABLE_IN: Record<JobStatus, boolean> = {
  /** A work in progress, visible to its owner and nobody else. */
  DRAFT: true,
  /**
   * Providers are reading it. Editing underneath them changes what they answered, and once
   * `W4-T03` lands it silently invalidates quotes that were priced against something else.
   * Amendment is a real feature and it needs quote invalidation, so it waits for quotes to exist
   * (operator, 2026-09-20: *"no — drafts only, expressed in the machine"*).
   */
  OPEN: false,
  /** Terminal. Editing a cancelled job is asking for a job, and that is `POST /api/jobs`. */
  CANCELLED: false,
};

/**
 * Whether this job's fields may still be edited, in the machine's own rejection shape so the route
 * and the message come from one place.
 */
export function canEditJob(status: JobStatus): GuardResult {
  return (
    EDITABLE_IN[status] || {
      reason: `only a draft can be edited — this job is ${status}`,
      code: 'CONFLICT',
    }
  );
}

/* ------------------------------------------------------------------------------------------- *
 * Money
 * ------------------------------------------------------------------------------------------- */

/**
 * A range, and both ends optional.
 *
 * *"I don't know"* is the honest answer for most first-time clients, and a model that cannot hold it
 * forces a guess into a field a provider will read as a target. Integer cents, EUR only, per
 * `money.ts` — the currency is not a field here because there is nothing to choose.
 */
export const BudgetRangeSchema = z
  .object({
    minCents: z.int().nonnegative().nullable().default(null),
    maxCents: z.int().nonnegative().nullable().default(null),
  })
  .refine(
    (range) =>
      range.minCents === null || range.maxCents === null || range.minCents <= range.maxCents,
    { message: 'the minimum budget cannot exceed the maximum', path: ['minCents'] },
  );

export type BudgetRange = z.infer<typeof BudgetRangeSchema>;

/* ------------------------------------------------------------------------------------------- *
 * Wire shapes
 * ------------------------------------------------------------------------------------------- */

/** Free text a client typed. Bounded to stop a runaway paste, not to demand a minimum. */
const Title = z.string().trim().min(1).max(140);
const Description = z.string().trim().min(1).max(5000);

/**
 * Creating a draft. **Every field is optional, and `{}` is valid** — spec §2.2, AC1.
 *
 * `categorySlugs` takes slugs rather than ids because that is what a client has: the storefront
 * receives `CategorySummary` from `GET /api/categories`, whose identity on the wire is the slug
 * (`W3-T02` resolves the same way on the provider side).
 */
export const JobDraftInputSchema = z.object({
  title: Title.optional(),
  description: Description.optional(),
  categorySlugs: z.array(z.string()).max(20).optional(),
  urgency: JobUrgencySchema.optional(),
  budget: BudgetRangeSchema.optional(),
  addressId: z.uuid().optional(),
});

export type JobDraftInput = z.infer<typeof JobDraftInputSchema>;

/**
 * Updating a draft. Identical to creation, and deliberately so.
 *
 * **This is a merge, not a replacement** — the opposite of `W3-T02`'s `PUT`, and for a reason that
 * ticket spells out: a partial update of a *set* has no agreed meaning. Here it does, because a
 * draft is a work-in-progress rather than a document: an absent key means *leave it alone*, which is
 * what a half-finished form sends. To clear a field, send `null`.
 *
 * `categorySlugs` is the exception and behaves as a whole set when present — `["gas"]` means
 * *exactly gas*, because a set with no ordering has no other sensible reading.
 */
export const JobUpdateInputSchema = z.object({
  title: Title.nullable().optional(),
  description: Description.nullable().optional(),
  categorySlugs: z.array(z.string()).max(20).optional(),
  urgency: JobUrgencySchema.nullable().optional(),
  budget: BudgetRangeSchema.nullable().optional(),
  addressId: z.uuid().nullable().optional(),
});

export type JobUpdateInput = z.infer<typeof JobUpdateInputSchema>;

/**
 * Cancelling. The body is optional and so is everything in it.
 *
 * `reason` is written to `audit_record.metadata` — the column whose own comment says it holds
 * *"whatever makes the row legible for its machine"* — and to **no column on `job`**. The audit row
 * already records who cancelled it, when, and from which state; a `cancellation_reason` column
 * would be a second home for one fact, and two homes drift the moment anything writes one of them.
 *
 * Optional because *"I don't want to policy the users"* (spec §1.1) applies to the way out as much
 * as to the way in. Somebody who abandons a job owes nobody an explanation.
 */
export const JobCancelInputSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export type JobCancelInput = z.infer<typeof JobCancelInputSchema>;

/** A category as a job carries it — the same flat shape `GET /api/categories` serves. */
export const JobCategorySchema = z.object({
  slug: z.string(),
  nameEs: z.string(),
  nameEn: z.string(),
  requiresLicence: z.boolean(),
});

export type JobCategory = z.infer<typeof JobCategorySchema>;

/**
 * Where the work is.
 *
 * Nullable on a published job, on purpose (spec §2.5, AC7): a client with no saved address still
 * gets to post. The job simply will not match a radius query until one exists, which `W4-T07`
 * surfaces — refusing to publish over it would reintroduce the requirement §2.3 rejected.
 */
export const JobLocationSchema = z.object({
  city: z.string(),
  province: z.string(),
  postalCode: z.string(),
});

export type JobLocation = z.infer<typeof JobLocationSchema>;

/** A job as its owner sees it. */
export const JobSchema = z.object({
  id: z.uuid(),
  status: JobStatusSchema,
  title: z.string().nullable(),
  description: z.string().nullable(),
  categories: z.array(JobCategorySchema),
  urgency: JobUrgencySchema.nullable(),
  budget: z.object({ minCents: z.int().nullable(), maxCents: z.int().nullable() }),
  location: JobLocationSchema.nullable(),
  publishedAt: z.iso.datetime().nullable(),
  /**
   * Set once, on the transition. Mirrors `publishedAt` for the reason `W4-T01` gave that one: it is
   * the timestamp a list screen needs without joining `audit_record`. The *reason* is not here —
   * that is audit metadata (`JobCancelInputSchema`).
   */
  cancelledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Job = z.infer<typeof JobSchema>;
