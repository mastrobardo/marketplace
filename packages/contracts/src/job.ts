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
 * Frozen seam — changing a shape here costs an ADR (`agents/policies/contract-change.md`).
 * Spec: `docs/specs/S4/W4-T01-job-posting.md`.
 */
import { z } from 'zod';

import { SearchUrgencySchema } from './search.js';
import { defineMachine, type GuardResult } from './state-machine.js';

/* ------------------------------------------------------------------------------------------- *
 * States
 * ------------------------------------------------------------------------------------------- */

/**
 * Two states, and `W4-T02` owns the rest of the lifecycle.
 *
 * Declaring `AWARDED`, `IN_PROGRESS`, `COMPLETED` and `CANCELLED` here would put four values in a
 * Postgres enum that nothing can produce and no route can reach — the same empty promise
 * `permissions.ts` refuses when it declines to hold a row for a route that does not exist yet.
 * `ALTER TYPE … ADD VALUE` is a cheap migration; a machine that lies about what it supports is not.
 */
export const JobStatusSchema = z.enum(['DRAFT', 'OPEN']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** The only event this ticket ships. `W4-T02` adds `AWARD`, `CANCEL` and the rest. */
export const JobEventSchema = z.enum(['PUBLISH']);
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
 * What the publish guard needs to decide, loaded by the caller before it asks.
 *
 * Guards are synchronous and pure by the state machine's own contract — *"a guard that could query
 * is a guard that decides differently depending on when it runs"* — so the count arrives here
 * already known.
 */
export interface JobPublishContext {
  readonly categoryCount: number;
}

/**
 * The one rule that stands between a draft and a published job.
 *
 * Not "the form is complete". `OPEN` means *providers can find this*, and `W4-T07` matches on
 * category — so a job with none reaches nobody and the client experiences that as silence. Every
 * other field stays optional, description included (spec §2.3).
 */
export function hasAnyCategory(context: JobPublishContext): GuardResult {
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
export const jobMachine = defineMachine<JobStatus, JobEvent, JobPublishContext>({
  name: 'job',
  initial: 'DRAFT',
  states: ['DRAFT', 'OPEN'],
  /**
   * `OPEN` is terminal **in this machine**, and that is a statement about `W4-T01`, not about the
   * product. `defineMachine` refuses a state with no way out that is not declared terminal, and it
   * is right to: an undeclared dead end is almost always a rule somebody forgot to write.
   *
   * Here it is deliberate — `W4-T02` owns `AWARDED` and everything after it, and will remove
   * `OPEN` from this list in the same change that gives it an exit. Declaring it keeps the machine
   * honest about what it can actually do today rather than hinting at transitions it does not have.
   */
  terminal: ['OPEN'],
  transitions: [{ from: 'DRAFT', on: 'PUBLISH', to: 'OPEN', guard: hasAnyCategory }],
});

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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Job = z.infer<typeof JobSchema>;
