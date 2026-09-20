/**
 * `W4-T01` — the job data layer, with `W4-T02`'s way out of `OPEN`.
 *
 * Everything that knows about rows. The routes above it know only the contract, and the machine in
 * `@marketplace/contracts` knows only a category count — which is what keeps the publish rule
 * testable without a database.
 *
 * Spec: `docs/specs/S4/W4-T01-job-posting.md` §2, §3.
 */
import { type Prisma, type PrismaClient } from '@prisma/client';
import {
  AppError,
  TransitionRejected,
  canEditJob,
  jobMachine,
  transition,
  type Job,
  type JobCancelInput,
  type JobContext,
  type JobDraftInput,
  type JobEvent,
  type JobStatus,
  type JobUpdateInput,
  type TransitionRequest,
} from '@marketplace/contracts';

/** The shape every read returns before it becomes a `Job`. */
const JOB_INCLUDE = {
  categories: {
    include: { category: true },
    /**
     * **Taxonomy order**, so a job's categories read the way the picker showed them (AC8).
     *
     * Not insertion order, which was the first attempt and does not exist: Postgres gives every row
     * written in one transaction the *same* `CURRENT_TIMESTAMP`, so `createdAt` cannot separate
     * them and the tiebreak fell through to a random uuid. The categories then shuffled between
     * reads — the exact thing AC8 is there to catch, found by it.
     *
     * A job's categories are a **set** the client picked, so there is no order inherent in the
     * choice. `position` is the one the rest of the product already uses (`W3-T01` §3.8), which
     * makes "tiles, plumbing, electricity" read the same here as in the tree it was chosen from.
     */
    orderBy: [{ category: { position: 'asc' } }, { category: { slug: 'asc' } }],
  },
  address: { select: { city: true, province: true, postalCode: true } },
} as const satisfies Prisma.JobInclude;

type JobRow = Prisma.JobGetPayload<{ include: typeof JOB_INCLUDE }>;

/** Row → wire. The only place that mapping exists. */
export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    description: row.description,
    categories: row.categories.map((link) => ({
      slug: link.category.slug,
      nameEs: link.category.nameEs,
      nameEn: link.category.nameEn,
      requiresLicence: link.category.requiresLicence,
    })),
    urgency: row.urgency,
    budget: { minCents: row.budgetMinCents, maxCents: row.budgetMaxCents },
    location:
      row.address === null
        ? null
        : {
            city: row.address.city,
            province: row.address.province,
            postalCode: row.address.postalCode,
          },
    publishedAt: row.publishedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Slugs → category ids, refusing anything a client cannot legitimately pick.
 *
 * An unknown slug and a retired one are both `VALIDATION_FAILED` and both name the offender (AC9).
 * Silently dropping either would publish a job that reaches fewer providers than the client thinks
 * it does — the failure mode this whole ticket is trying to avoid.
 */
async function resolveCategoryIds(
  db: Prisma.TransactionClient,
  slugs: readonly string[],
): Promise<string[]> {
  if (slugs.length === 0) return [];

  const wanted = [...new Set(slugs)];
  const found = await db.category.findMany({
    where: { slug: { in: wanted }, isActive: true },
    select: { id: true, slug: true },
  });

  const bySlug = new Map(found.map((row) => [row.slug, row.id]));
  const missing = wanted.filter((slug) => !bySlug.has(slug));
  if (missing.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      `unknown or retired categor${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}`,
      {
        issues: missing.map((slug) => ({
          path: 'categorySlugs',
          message: `"${slug}" is not an active category`,
        })),
      },
    );
  }

  return wanted.map((slug) => bySlug.get(slug) as string);
}

/** Replace a job's category set. Present-means-whole-set, per the contract's own note. */
async function setCategories(
  db: Prisma.TransactionClient,
  jobId: string,
  slugs: readonly string[],
): Promise<void> {
  const ids = await resolveCategoryIds(db, slugs);
  await db.jobCategory.deleteMany({ where: { jobId } });
  if (ids.length === 0) return;
  // `createMany`, because write order carries no meaning: reads are ordered by the category's own
  // `position` (see `JOB_INCLUDE`), not by when the link row happened to be written.
  await db.jobCategory.createMany({ data: ids.map((categoryId) => ({ jobId, categoryId })) });
}

/**
 * `transition()` bound to this machine, with the rejection mapped once.
 *
 * Both writers that move a job need the same three things — the audit row written through *this*
 * transaction, `TransitionRejected` turned into the envelope a route can send, and anything else
 * rethrown untouched. Written twice, the two copies would eventually disagree about which of those
 * is a client error.
 *
 * The recorder is bound to `db`, not to `prisma`: the audit row and the status change commit
 * together or not at all, which is the guarantee `state-machine.ts` asks every caller to provide.
 */
async function move(
  db: Prisma.TransactionClient,
  request: TransitionRequest<JobStatus, JobEvent, JobContext>,
): Promise<void> {
  try {
    await transition(jobMachine, request, async (audit) => {
      await db.auditRecord.create({ data: audit });
    });
  } catch (error) {
    if (error instanceof TransitionRejected) {
      // The machine already decided both the reason and whether it is a 409 or a 403.
      throw new AppError(error.code, error.reason);
    }
    throw error;
  }
}

export interface JobRepository {
  createDraft(clientId: string, input: JobDraftInput): Promise<Job>;
  /** `null` when the job does not exist **or** belongs to somebody else — the caller cannot tell. */
  findOwn(clientId: string, jobId: string): Promise<Job | null>;
  listOwn(clientId: string, limit: number): Promise<Job[]>;
  update(clientId: string, jobId: string, input: JobUpdateInput): Promise<Job | null>;
  publish(clientId: string, jobId: string): Promise<Job | null>;
  cancel(clientId: string, jobId: string, input: JobCancelInput): Promise<Job | null>;
}

export function createJobRepository(prisma: PrismaClient): JobRepository {
  return {
    async createDraft(clientId, input) {
      const row = await prisma.$transaction(async (db) => {
        const created = await db.job.create({
          data: {
            clientId,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.urgency === undefined ? {} : { urgency: input.urgency }),
            ...(input.addressId === undefined ? {} : { addressId: input.addressId }),
            ...(input.budget === undefined
              ? {}
              : { budgetMinCents: input.budget.minCents, budgetMaxCents: input.budget.maxCents }),
          },
          select: { id: true },
        });

        if (input.categorySlugs !== undefined) {
          await setCategories(db, created.id, input.categorySlugs);
        }

        return db.job.findUniqueOrThrow({ where: { id: created.id }, include: JOB_INCLUDE });
      });

      return toJob(row);
    },

    async findOwn(clientId, jobId) {
      const row = await prisma.job.findFirst({
        where: { id: jobId, clientId },
        include: JOB_INCLUDE,
      });
      return row === null ? null : toJob(row);
    },

    async listOwn(clientId, limit) {
      const rows = await prisma.job.findMany({
        where: { clientId },
        include: JOB_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return rows.map(toJob);
    },

    async update(clientId, jobId, input) {
      return prisma.$transaction(async (db) => {
        const existing = await db.job.findFirst({
          where: { id: jobId, clientId },
          select: { id: true, status: true },
        });
        if (existing === null) return null;

        // Asked, not decided. `canEditJob` is exhaustive over `JobStatus`, so a new state cannot
        // reach this line without someone having said whether it is editable — which is the whole
        // difference from the `if` that stood here (`MEM-2026-09-20-11`, W4-T02 §2.3).
        const editable = canEditJob(existing.status);
        if (editable !== true) {
          throw new AppError(editable.code ?? 'CONFLICT', editable.reason);
        }

        await db.job.update({
          where: { id: jobId },
          // An **absent** key means "leave alone", a `null` means "clear". Spread rather than
          // assigned, because `exactOptionalPropertyTypes` makes an explicit `undefined` a
          // different thing from an omitted key — and Prisma treats them the same way only by
          // accident. Spreading keeps the contract's two meanings distinct all the way down.
          data: {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.urgency === undefined ? {} : { urgency: input.urgency }),
            ...(input.addressId === undefined ? {} : { addressId: input.addressId }),
            ...(input.budget === undefined
              ? {}
              : input.budget === null
                ? { budgetMinCents: null, budgetMaxCents: null }
                : { budgetMinCents: input.budget.minCents, budgetMaxCents: input.budget.maxCents }),
          },
        });

        if (input.categorySlugs !== undefined) {
          await setCategories(db, jobId, input.categorySlugs);
        }

        const row = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: JOB_INCLUDE });
        return toJob(row);
      });
    },

    async publish(clientId, jobId) {
      return prisma.$transaction(async (db) => {
        const existing = await db.job.findFirst({
          where: { id: jobId, clientId },
          select: {
            id: true,
            status: true,
            addressId: true,
            _count: { select: { categories: true } },
          },
        });
        if (existing === null) return null;

        // §2.5 — the address is inferred, never demanded. If the client has no default either, the
        // job publishes without one: it will not match a radius query until an address exists, and
        // refusing over that would reintroduce the requirement §2.3 rejected.
        let addressId = existing.addressId;
        if (addressId === null) {
          const profile = await db.clientProfile.findUnique({
            where: { userId: clientId },
            select: { defaultAddressId: true },
          });
          addressId = profile?.defaultAddressId ?? null;
        }

        const now = new Date();
        await move(db, {
          entityId: jobId,
          from: existing.status,
          event: 'PUBLISH',
          actor: { type: 'USER', id: clientId },
          context: { categoryCount: existing._count.categories },
          now: () => now,
        });

        await db.job.update({
          where: { id: jobId },
          data: { status: 'OPEN', publishedAt: now, addressId },
        });

        const row = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: JOB_INCLUDE });
        return toJob(row);
      });
    },

    async cancel(clientId, jobId, input) {
      return prisma.$transaction(async (db) => {
        const existing = await db.job.findFirst({
          where: { id: jobId, clientId },
          select: { id: true, status: true, _count: { select: { categories: true } } },
        });
        if (existing === null) return null;

        const now = new Date();
        await move(db, {
          entityId: jobId,
          from: existing.status,
          event: 'CANCEL',
          actor: { type: 'USER', id: clientId },
          // `CANCEL` has no guard and does not read this, but the count is loaded rather than
          // faked: a context carrying a `0` that is not true is one somebody later guards on.
          context: { categoryCount: existing._count.categories },
          // Omitted rather than null when absent — `AuditRecord.metadata` is a nullable Json
          // column, and an absent key is what produces a NULL there (`state-machine.ts`).
          ...(input.reason === undefined ? {} : { metadata: { reason: input.reason } }),
          now: () => now,
        });

        await db.job.update({
          where: { id: jobId },
          data: { status: 'CANCELLED', cancelledAt: now },
        });

        const row = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: JOB_INCLUDE });
        return toJob(row);
      });
    },
  };
}
