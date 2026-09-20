/**
 * `W4-T03` — the quote data layer.
 *
 * Everything that knows about rows. The contract above it knows the shapes and the two rules that
 * are about *states* rather than about data — `canQuoteOn` and `quoteMachine`.
 *
 * Spec: `docs/specs/S4/W4-T03-quote-submission.md` §2, §3.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  AppError,
  TransitionRejected,
  canDecideOn,
  canQuoteOn,
  fetchLimit,
  keysetPredicate,
  pageOf,
  quoteMachine,
  quoteStatusOf,
  transition,
  type KeysetPredicate,
  type Page,
  type Quote,
  type QuoteEvent,
  type QuoteInput,
  type QuoteListQuery,
  type QuoteStatus,
  type SortSpec,
} from '@marketplace/contracts';

/** Taxonomy order, for the reason `W4-T01` found the hard way: insertion order does not exist. */
const JOB_CATEGORIES = {
  include: { category: true },
  orderBy: [{ category: { position: 'asc' } }, { category: { slug: 'asc' } }],
} as const satisfies Prisma.Job$categoriesArgs;

const QUOTE_INCLUDE = {
  provider: {
    select: {
      id: true,
      displayName: true,
      ratingAvg: true,
      ratingCount: true,
      hourlyRateCents: true,
      categories: { select: { categoryId: true } },
    },
  },
  job: { select: { categories: JOB_CATEGORIES } },
} as const satisfies Prisma.QuoteInclude;

type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;

/**
 * Row → wire, and the only place coverage is computed.
 *
 * **Coverage is a fact about two tables at the moment somebody asks**, which is why no column
 * records it: a provider who adds `electricidad` to their profile tomorrow changes what every quote
 * they have written says, and a stored copy would keep yesterday's answer.
 */
export function toQuote(row: QuoteRow, now: Date): Quote {
  const listed = new Set(row.provider.categories.map((link) => link.categoryId));

  return {
    id: row.id,
    jobId: row.jobId,
    status: quoteStatusOf(row.status, row.validUntil, now),
    amountCents: row.amountCents,
    breakdown: row.breakdown,
    validUntil: row.validUntil.toISOString(),
    provider: {
      id: row.provider.id,
      displayName: row.provider.displayName,
      // `Decimal` serialises to JSON as an object, not a number — `W3-T07` found this at the wire.
      ratingAvg: row.provider.ratingAvg === null ? null : Number(row.provider.ratingAvg),
      ratingCount: row.provider.ratingCount,
      hourlyRateCents: row.provider.hourlyRateCents,
    },
    // Every category the **job** names. Not the provider's list, which would answer a different
    // question — "what do they do?" instead of "what does this job need, and who is standing here?"
    coverage: row.job.categories.map((link) => ({
      slug: link.category.slug,
      nameEs: link.category.nameEs,
      nameEn: link.category.nameEn,
      requiresLicence: link.category.requiresLicence,
      listedByProvider: listed.has(link.categoryId),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface QuoteRepository {
  /** `null` when the job is not visible to a provider — it does not exist, or it is a draft. */
  create(providerUserId: string, jobId: string, input: QuoteInput): Promise<Quote | null>;
  /** `null` when the job is not the caller's. One page of its quotes, newest first (`W4-T04`). */
  listForJob(
    clientId: string,
    jobId: string,
    query: QuoteListQuery,
    now?: Date,
  ): Promise<Page<Quote> | null>;
  listOwn(providerUserId: string, limit: number, now?: Date): Promise<Quote[]>;
  withdraw(providerUserId: string, quoteId: string): Promise<Quote | null>;
  /** `null` when the quote is not on a job the caller owns. `W4-T04`. */
  accept(clientId: string, quoteId: string): Promise<Quote | null>;
  reject(clientId: string, quoteId: string): Promise<Quote | null>;
}

/* ------------------------------------------------------------------------------------------- *
 * Paging — `W4-T04` §2.7
 * ------------------------------------------------------------------------------------------- */

/**
 * The contract's keyset predicate, expressed as a Prisma `where`.
 *
 * `search.ts` writes its own SQL and interpolates the same predicate directly; this endpoint uses
 * the typed client, so the disjunction has to be translated rather than printed. The translation is
 * mechanical and lives here **once**: a hand-rolled `createdAt < cursor` at the call site is the
 * subtly-wrong keyset `pagination.ts` warns about, and a wrong one does not error — it skips rows.
 */
function whereAfter(predicate: KeysetPredicate): Prisma.QuoteWhereInput {
  return {
    OR: predicate.or.map((branch) => ({
      AND: branch.and.map((clause) => ({
        [clause.field]: clause.op === 'eq' ? clause.value : { [clause.op]: clause.value },
      })) as Prisma.QuoteWhereInput[],
    })),
  };
}

/** The sort spec as Prisma's `orderBy`, so the cursor and the `ORDER BY` come from one source. */
function orderBy(sort: SortSpec): Prisma.QuoteOrderByWithRelationInput[] {
  return sort.map((field) => ({ [field.field]: field.direction }));
}

/** The profile id for a principal, or `null` if they have no provider profile at all. */
async function profileIdOf(db: Prisma.TransactionClient, userId: string): Promise<string | null> {
  const profile = await db.providerProfile.findUnique({ where: { userId }, select: { id: true } });
  return profile?.id ?? null;
}

export function createQuoteRepository(prisma: PrismaClient): QuoteRepository {
  return {
    async create(providerUserId, jobId, input) {
      return prisma.$transaction(async (db) => {
        const providerId = await profileIdOf(db, providerUserId);
        if (providerId === null) {
          // The role grant says PROVIDER; the profile is what `W3-T02` writes. A principal with the
          // role and no profile is a signup half-finished, not a permission problem.
          throw new AppError('CONFLICT', 'create your provider profile before quoting');
        }

        const job = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });

        // Two different refusals, and the difference matters. A **draft** is invisible to everyone
        // but its owner — `W4-T01` §3's rule, so the answer is the same 404 a non-existent job
        // gets. A **cancelled** job was legitimately visible in the feed, and a provider quoting one
        // late deserves to be told it closed rather than that it never existed.
        if (job === null || job.status === 'DRAFT') return null;

        const quotable = canQuoteOn(job.status);
        if (quotable !== true) throw new AppError(quotable.code ?? 'CONFLICT', quotable.reason);

        try {
          const created = await db.quote.create({
            data: {
              jobId,
              providerId,
              amountCents: input.amountCents,
              validUntil: new Date(input.validUntil),
              ...(input.breakdown === undefined ? {} : { breakdown: input.breakdown }),
            },
            select: { id: true },
          });
          const row = await db.quote.findUniqueOrThrow({
            where: { id: created.id },
            include: QUOTE_INCLUDE,
          });
          return toQuote(row, new Date());
        } catch (error) {
          // The partial unique index is the enforcement; this only translates it. Catching the
          // violation rather than checking first is deliberate — a check-then-insert has a race,
          // and the index does not.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new AppError(
              'CONFLICT',
              'you already have an active quote on this job — withdraw it before sending another',
            );
          }
          throw error;
        }
      });
    },

    async listForJob(clientId, jobId, query, now = new Date()) {
      const job = await prisma.job.findFirst({
        where: { id: jobId, clientId },
        select: { id: true },
      });
      // Not the caller's job, or no job. The caller cannot tell which — `W4-T01` §3.
      if (job === null) return null;

      const rows = await prisma.quote.findMany({
        where: {
          jobId,
          ...(query.cursor === undefined
            ? {}
            : whereAfter(keysetPredicate(query.sort, query.cursor))),
        },
        include: QUOTE_INCLUDE,
        orderBy: orderBy(query.sort),
        // One more than the page needs: its presence *is* `hasMore`, and `pageOf` drops it, so the
        // flag and the cursor cannot disagree.
        take: fetchLimit(query.limit),
      });

      return pageOf(
        rows.map((row) => toQuote(row, now)),
        { limit: query.limit, sort: query.sort },
      );
    },

    async listOwn(providerUserId, limit, now = new Date()) {
      const providerId = await profileIdOf(prisma, providerUserId);
      if (providerId === null) return [];

      const rows = await prisma.quote.findMany({
        where: { providerId },
        include: QUOTE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return rows.map((row) => toQuote(row, now));
    },

    async withdraw(providerUserId, quoteId) {
      return prisma.$transaction(async (db) => {
        const providerId = await profileIdOf(db, providerUserId);
        if (providerId === null) return null;

        const existing = await db.quote.findFirst({
          where: { id: quoteId, providerId },
          // `validUntil` is loaded because the machine takes a context now (`W4-T04` §2.5) — guards
          // are pure and synchronous, so whatever they read, the caller loads first.
          select: { id: true, status: true, validUntil: true },
        });
        // Somebody else's quote and a quote that never existed are the same answer.
        if (existing === null) return null;

        const now = new Date();
        try {
          await transition(
            quoteMachine,
            {
              entityId: quoteId,
              from: existing.status,
              event: 'WITHDRAW',
              actor: { type: 'USER', id: providerUserId },
              context: { validUntil: existing.validUntil, now },
              now: () => now,
            },
            async (audit) => {
              await db.auditRecord.create({ data: audit });
            },
          );
        } catch (error) {
          if (error instanceof TransitionRejected) throw new AppError(error.code, error.reason);
          throw error;
        }

        await db.quote.update({ where: { id: quoteId }, data: { status: 'WITHDRAWN' } });

        const row = await db.quote.findUniqueOrThrow({
          where: { id: quoteId },
          include: QUOTE_INCLUDE,
        });
        return toQuote(row, now);
      });
    },

    accept(clientId, quoteId) {
      return decide(prisma, clientId, quoteId, 'ACCEPT', 'ACCEPTED');
    },

    reject(clientId, quoteId) {
      return decide(prisma, clientId, quoteId, 'REJECT', 'REJECTED');
    },
  };
}

/* ------------------------------------------------------------------------------------------- *
 * The decision — `W4-T04` §2.2, §2.5
 * ------------------------------------------------------------------------------------------- */

/**
 * Accept and reject are **one function with two events**, and they should be.
 *
 * Everything that differs between them is already declared elsewhere: which state they lead to, and
 * whether an expired quote may still be answered, both live in `quoteMachine`'s transitions. Two
 * copies of this body would be two places for the ownership check and the audit write to drift, and
 * the audit write is the one this repo refuses to have two of.
 *
 * **What it deliberately does not do is touch anything else.** No sibling quote is rejected and the
 * job's status is not read for writing: accepting is not awarding (ADR-013 §4), the award takes a
 * payment `W5-T02` has not built, and a failed award must leave every alternative still standing.
 */
async function decide(
  prisma: PrismaClient,
  clientId: string,
  quoteId: string,
  event: Extract<QuoteEvent, 'ACCEPT' | 'REJECT'>,
  to: Extract<QuoteStatus, 'ACCEPTED' | 'REJECTED'>,
): Promise<Quote | null> {
  return prisma.$transaction(async (db) => {
    const existing = await db.quote.findFirst({
      // `job: { clientId }` is the whole authorisation: a quote on somebody else's job simply is
      // not found, which is the same answer a quote that never existed gets (`W4-T01` §3).
      where: { id: quoteId, job: { clientId } },
      select: {
        id: true,
        status: true,
        validUntil: true,
        job: { select: { status: true } },
      },
    });
    if (existing === null) return null;

    // The job's state, not the quote's. A cancelled job's quotes stay as history and nobody
    // answers them — and when `AWARDED` arrives, this `Record` fails the build until somebody
    // decides what it means (`MEM-2026-09-20-13`).
    const decidable = canDecideOn(existing.job.status);
    if (decidable !== true) throw new AppError(decidable.code ?? 'CONFLICT', decidable.reason);

    const now = new Date();
    try {
      await transition(
        quoteMachine,
        {
          entityId: quoteId,
          from: existing.status,
          event,
          actor: { type: 'USER', id: clientId },
          // The expiry guard reads these. A lapsed quote still *stores* `PENDING`, so without them
          // the machine would accept an offer that expired last week (§2.5).
          context: { validUntil: existing.validUntil, now },
          now: () => now,
        },
        async (audit) => {
          await db.auditRecord.create({ data: audit });
        },
      );
    } catch (error) {
      if (error instanceof TransitionRejected) throw new AppError(error.code, error.reason);
      throw error;
    }

    try {
      await db.quote.update({ where: { id: quoteId }, data: { status: to } });
    } catch (error) {
      // `quote_one_accepted_per_job_idx`. Caught rather than checked for, and the order matters:
      // the audit row was written first, inside this transaction, so the index rejecting the update
      // rolls **both** back. A check-then-write has a race between two clicks; the index does not.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(
          'CONFLICT',
          'another quote on this job has already been accepted — reject it first',
        );
      }
      throw error;
    }

    const row = await db.quote.findUniqueOrThrow({
      where: { id: quoteId },
      include: QUOTE_INCLUDE,
    });
    return toQuote(row, now);
  });
}
