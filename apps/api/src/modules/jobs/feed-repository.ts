/**
 * `W4-T07` — the job feed's data layer.
 *
 * `W3-T05`'s statement with the operands swapped: *jobs near a provider*, rather than *providers near
 * a place*. The rule it keeps intact is the one that made that search surprising — **the radius is
 * the provider's own**, so this answers *"which jobs will I travel to"* and never *"which jobs are
 * near me"*.
 *
 * **Three queries, not one, and that is the deliberate difference from `search.ts`.** That module is
 * a single statement because its facets have to be counted over the whole matched set, which a second
 * round trip cannot see. Nothing here needs the matched set — the page is at most 101 rows — so the
 * geography stays in SQL (it must: `location` is a generated `geography` column Prisma cannot read)
 * and everything that is ordinary row-reading stays in the typed client, where the taxonomy ordering
 * and the `include` shapes are already solved.
 *
 * Spec: `docs/specs/S4/W4-T07-provider-job-feed.md` §2.1, §2.4, §3.1.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  AppError,
  fetchLimit,
  pageOf,
  quoteStatusOf,
  type CursorPosition,
  type JobFeedItem,
  type JobFeedQuery,
  type Page,
  type SortSpec,
} from '@marketplace/contracts';

/**
 * Taxonomy order, for the reason `W4-T01` found the hard way: insertion order does not exist —
 * every row written in one transaction shares a `CURRENT_TIMESTAMP`, so the tiebreak fell through to
 * a random uuid and a job's trades shuffled between reads.
 */
const JOB_CATEGORIES = {
  include: { category: true },
  orderBy: [{ category: { position: 'asc' } }, { category: { slug: 'asc' } }],
} as const satisfies Prisma.Job$categoriesArgs;

/**
 * What a feed row is read from.
 *
 * `quotes` is filtered to **the caller's own** profile before it leaves the database, which is the
 * disclosure rule expressed as a `where` rather than as a projection somebody has to remember: there
 * is no point in the pipeline at which this repository holds a competitor's quote (§2.3).
 */
function jobInclude(providerId: string) {
  return {
    categories: JOB_CATEGORIES,
    address: { select: { city: true, province: true, postalCode: true } },
    quotes: {
      where: { providerId },
      select: { id: true, status: true, validUntil: true },
    },
  } as const satisfies Prisma.JobInclude;
}

/** What the geography statement hands back: the page's identity and the one computed column. */
interface FeedRow {
  readonly id: string;
  readonly distanceMetres: number;
  readonly publishedAt: Date;
}

export interface JobFeedRepository {
  /**
   * One page of the market, for the provider behind `providerUserId`.
   *
   * Throws `CONFLICT` for the two states in which a profile cannot be served at all (§2.7) rather
   * than answering an empty page, because an empty list is a claim about the world and neither of
   * them is one.
   */
  read(providerUserId: string, query: JobFeedQuery, now?: Date): Promise<Page<JobFeedItem>>;
}

/**
 * The keyset predicate, in SQL — `search.ts`'s shape, over this endpoint's order.
 *
 * Written here rather than translated from `keysetPredicate()` for the reason that module's comment
 * gives: this statement is raw, so the predicate is interpolated directly instead of being mapped
 * into a Prisma `where`. The operators come from the sort spec rather than from a hard-coded `<`, so
 * `?sort=publishedAt` (ascending, which a client may ask for) pages forwards rather than in circles.
 */
function keyset(sort: SortSpec<'publishedAt'>, cursor: CursorPosition | undefined): Prisma.Sql {
  if (cursor === undefined) return Prisma.empty;

  const published = String(cursor.v[0]);
  const after = sort[0]?.direction === 'desc' ? Prisma.sql`<` : Prisma.sql`>`;
  // The tiebreaker is appended ascending by `trySort`, always — so this half never flips.
  const tiebreak = Prisma.sql`>`;

  return Prisma.sql`
    AND (
      m."publishedAt" ${after} ${published}::timestamptz
      OR (m."publishedAt" = ${published}::timestamptz AND m.id ${tiebreak} ${cursor.id}::uuid)
    )`;
}

export function createJobFeedRepository(prisma: PrismaClient): JobFeedRepository {
  return {
    async read(providerUserId, query, now = new Date()) {
      const profile = await prisma.providerProfile.findUnique({
        where: { userId: providerUserId },
        select: {
          id: true,
          serviceRadiusMetres: true,
          baseAddressId: true,
          // The trades this provider lists, which is the other half of every coverage label. Read
          // here rather than joined in the statement below: the statement answers *which jobs*, and
          // the label is a fact about the pair that the projection needs anyway.
          categories: { select: { categoryId: true } },
        },
      });

      // The role grant says PROVIDER; the profile is what `W3-T02` writes. A principal with the role
      // and no profile is a signup half-finished, not a permission problem — the same answer
      // `quote:create` gives in the same situation.
      if (profile === null) {
        throw new AppError('CONFLICT', 'create your provider profile before you can see jobs');
      }

      // `W3-T05` excludes such a provider from search and `W3-T02` calls the state *unserviceable
      // rather than merely unset*: there is no distance at which they will work, so every job is out
      // of range. Saying so beats answering "no jobs", which sends them looking for jobs that exist.
      if (profile.serviceRadiusMetres === null) {
        throw new AppError('CONFLICT', 'set how far you will travel before you can see jobs');
      }

      const order = query.sort[0]?.direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;

      /**
       * The three predicates of §2.1, and nothing else.
       *
       * `status = 'OPEN'` carries `DRAFT` and `CANCELLED` out with it, and it is also what guarantees
       * `published_at` is set — which is what makes the cursor safe and what `0015`'s partial index
       * is built on.
       *
       * The category test is an **intersection**, because `W4-T03` decided one quote covers the whole
       * job: a plumber sees a bathroom that also needs electrics, and §2.2's label is what tells them
       * about the half they do not do. `c.is_active` gates the *match* only — a retired trade should
       * not put a job in front of anybody — while `coverage` below still names every trade the job
       * asked for, which is what `toQuote` does with the same fact.
       */
      const rows = await prisma.$queryRaw<FeedRow[]>(Prisma.sql`
        WITH me AS (
          SELECT a.location AS centre, ${profile.serviceRadiusMetres}::int AS radius
          FROM address a
          WHERE a.id = ${profile.baseAddressId}::uuid
        ),
        matched AS (
          SELECT
            j.id                                          AS id,
            j.published_at                                AS "publishedAt",
            ROUND(ST_Distance(addr.location, me.centre))::int AS "distanceMetres"
          FROM job j
          JOIN address addr ON addr.id = j.address_id
          CROSS JOIN me
          WHERE j.status = 'OPEN'
            AND ST_DWithin(addr.location, me.centre, me.radius)
            AND EXISTS (
              SELECT 1
              FROM job_category jc
              JOIN provider_category pc ON pc.category_id = jc.category_id
              JOIN category c ON c.id = jc.category_id
              WHERE jc.job_id = j.id
                AND pc.provider_profile_id = ${profile.id}::uuid
                AND c.is_active
            )
        )
        -- The id stays a uuid inside the CTE and becomes text only here, which is what lets the keyset
        -- and the ORDER BY compare it the way Postgres orders uuids rather than the way it orders
        -- strings. Casting it in the CTE made the comparison text-against-uuid, which is not a slow
        -- query but no query at all -- and it only fails on the second page.
        SELECT m.id::text AS id, m."publishedAt", m."distanceMetres"
        FROM matched m
        WHERE TRUE ${keyset(query.sort, query.cursor)}
        ORDER BY m."publishedAt" ${order}, m.id ASC
        LIMIT ${fetchLimit(query.limit)}
      `);

      if (rows.length === 0) {
        return pageOf<'publishedAt', JobFeedItem>([], { limit: query.limit, sort: query.sort });
      }

      const distances = new Map(rows.map((row) => [row.id, row.distanceMetres]));
      const jobs = await prisma.job.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
        include: jobInclude(profile.id),
      });
      const byId = new Map(jobs.map((job) => [job.id, job]));

      /** The trades on this profile, as a set, so coverage is a lookup rather than a scan per row. */
      const listed = new Set(profile.categories.map((link) => link.categoryId));

      const items: JobFeedItem[] = [];
      for (const row of rows) {
        const job = byId.get(row.id);
        const distanceMetres = distances.get(row.id);
        /**
         * The statement matched it and the read did not find it whole — which means it stopped being
         * an `OPEN` job with an address between the two queries, a client cancelling while a provider
         * scrolls. Dropping it is the right answer and the honest one: it would fail the outbound
         * parse otherwise, and a page one row short beats a failed request for a row nobody may quote
         * any more.
         */
        if (
          job === undefined ||
          job.address === null ||
          job.publishedAt === null ||
          distanceMetres === undefined
        ) {
          continue;
        }

        /**
         * At most one row, because `quote_one_active_per_provider_idx` allows at most one active
         * quote per provider per job — but a withdrawn or rejected one can sit beside it, so this
         * takes the **newest** rather than assuming a single row. `quoteStatusOf` is what turns a
         * stored `PENDING` whose `validUntil` has passed into `EXPIRED`, which is how a provider
         * learns the slot is theirs again (`MEM-2026-09-20-30`).
         */
        const mine = [...job.quotes].sort(
          (a, b) => b.validUntil.getTime() - a.validUntil.getTime(),
        )[0];

        items.push({
          id: job.id,
          title: job.title,
          description: job.description,
          categories: job.categories.map((link) => ({
            slug: link.category.slug,
            nameEs: link.category.nameEs,
            nameEn: link.category.nameEn,
            requiresLicence: link.category.requiresLicence,
          })),
          urgency: job.urgency,
          budget: { minCents: job.budgetMinCents, maxCents: job.budgetMaxCents },
          // City, province and postal code. **Never a point**: a job's address is somebody's home,
          // and a coordinate beside a postal code is a house (§2.3).
          location: {
            city: job.address.city,
            province: job.address.province,
            postalCode: job.address.postalCode,
          },
          distanceMetres,
          /**
           * Every category the **job** asks for, each with whether this provider lists it — the same
           * fact `toQuote` computes for a quote, read from the other end. Computed here and stored
           * nowhere, for that function's reason: a provider who adds a trade tomorrow changes what
           * every row says, and a column would keep yesterday's answer.
           */
          coverage: job.categories.map((link) => ({
            slug: link.category.slug,
            nameEs: link.category.nameEs,
            nameEn: link.category.nameEn,
            requiresLicence: link.category.requiresLicence,
            listedByProvider: listed.has(link.categoryId),
          })),
          myQuote:
            mine === undefined
              ? null
              : { id: mine.id, status: quoteStatusOf(mine.status, mine.validUntil, now) },
          publishedAt: job.publishedAt.toISOString(),
          createdAt: job.createdAt.toISOString(),
        });
      }

      return pageOf<'publishedAt', JobFeedItem>(items, { limit: query.limit, sort: query.sort });
    },
  };
}
