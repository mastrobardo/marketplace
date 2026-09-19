/**
 * `W3-T01` — the category tree, read.
 *
 * The route owns the wire rule and the envelope; this owns the data. The split is `W3-T05`'s and it
 * buys the same two things: `tests/categories.test.ts` asserts the whole HTTP boundary — the
 * prefix, the leaves-only rule, the order, the outbound parse — without a database, and
 * `tests/categories-live.test.ts` asserts the columns without an HTTP server.
 *
 * **What this returns is deliberately wider than what is served.** `parentId`, `position` and
 * `isActive` never reach a client; they are here because §3.2's rule — *a category on the wire is a
 * thing you can pick* — is a statement about the wire, and the wire is the route's. Handing the
 * route the structure lets four acceptance criteria (AC3, AC8, AC9, AC10) be asserted against a
 * stub instead of against Postgres, which is what §7 promises.
 *
 * The `ORDER BY position, slug` below is therefore not the only thing keeping the list stable — the
 * route sorts too. It is here because the index is, because a stable read is worth having on its
 * own, and because §3.8 asks for it.
 *
 * **Prisma's typed client, not raw SQL**, for `modules/providers/repository.ts`'s reason: this is a
 * small read of ordinary columns with no PostGIS in it, and an explicit `select` gives compile-time
 * safety on a projection whose *omissions* matter. `include` is a review failure in this slice
 * (`MEM-2026-09-17-13`).
 *
 * Spec: `docs/specs/S3/W3-T01-category-tree.md` §3.2, §3.7, §3.8.
 */
import { type PrismaClient } from '@prisma/client';

export interface CategoryCriteria {
  /** Resolved from `accept-language` by the route. The repository never sees the header. */
  readonly locale: 'es' | 'en';
}

/**
 * One row, with the locale already collapsed to a single `name`.
 *
 * `slug`, `name` and `requiresLicence` are `CategorySummarySchema`'s three fields. The rest is
 * structure the route reads and then drops.
 */
export interface CategoryNode {
  readonly slug: string;
  readonly name: string;
  readonly requiresLicence: boolean;
  /** `null` for a family root. A root is storage, not a thing anyone can pick (§3.2). */
  readonly parentId: string | null;
  readonly position: number;
  /**
   * The **parent's** position, and the wire order's first key.
   *
   * `position` is per sibling set (§8.3), so both families start at 1. Sorting the flattened leaf
   * list by `position` alone interleaves them — `fontaneria, reforma-integral, albanileria,
   * electricidad, …` — and the curated order §3.8 promises reaches the client as a shuffle whose
   * only real signal is the slug tie-break. A root is storage, but *where its family sits* is not.
   */
  readonly parentPosition: number;
  readonly isActive: boolean;
}

export type CategoryRepository = (
  criteria: CategoryCriteria,
) => Promise<readonly CategoryNode[]>;

/** The columns this endpoint reads, named once. The pair `nameEs`/`nameEn` collapses below. */
const CATEGORY_SELECT = {
  slug: true,
  nameEs: true,
  nameEn: true,
  requiresLicence: true,
  parentId: true,
  position: true,
  isActive: true,
  // A nested `select`, not an `include`: the parent contributes exactly one column and the rule in
  // this slice is that the columns not named are the projection (`MEM-2026-09-17-13`).
  parent: { select: { position: true } },
} as const;

export function createCategoryRepository(prisma: PrismaClient): CategoryRepository {
  return async ({ locale }: CategoryCriteria): Promise<readonly CategoryNode[]> => {
    const rows = await prisma.category.findMany({
      select: CATEGORY_SELECT,
      // Tens of rows, no paging (§4). `category_parent_id_position_idx` covers the tree read; the
      // `slug` tie-break is what makes two rows sharing a position stop swapping between requests.
      // Family first, then the curated order inside it, then the slug tie-break — the same three
      // keys the route sorts by, so the two cannot disagree about what "ordered" means.
      orderBy: [{ parent: { position: 'asc' } }, { position: 'asc' }, { slug: 'asc' }],
    });

    return rows.map(
      (row): CategoryNode => ({
        slug: row.slug,
        // The client receives one name and never the pair — the contract says this endpoint owns
        // that decision, because `W12-T14` will make it a per-request concern on a Worker.
        name: locale === 'en' ? row.nameEn : row.nameEs,
        requiresLicence: row.requiresLicence,
        parentId: row.parentId,
        position: row.position,
        // A root has no parent and is never served, so the value is unused rather than wrong.
        parentPosition: row.parent?.position ?? 0,
        isActive: row.isActive,
      }),
    );
  };
}
