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
  canQuoteOn,
  quoteMachine,
  quoteStatusOf,
  transition,
  type Quote,
  type QuoteInput,
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
  /** `null` when the job is not the caller's. Every quote on it, newest first. */
  listForJob(clientId: string, jobId: string, now?: Date): Promise<Quote[] | null>;
  listOwn(providerUserId: string, limit: number, now?: Date): Promise<Quote[]>;
  withdraw(providerUserId: string, quoteId: string): Promise<Quote | null>;
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

    async listForJob(clientId, jobId, now = new Date()) {
      const job = await prisma.job.findFirst({
        where: { id: jobId, clientId },
        select: { id: true },
      });
      if (job === null) return null;

      const rows = await prisma.quote.findMany({
        where: { jobId },
        include: QUOTE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map((row) => toQuote(row, now));
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
          select: { id: true, status: true },
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
              context: undefined,
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
  };
}
