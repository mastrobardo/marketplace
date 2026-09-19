/**
 * `W3-T01` — `GET /api/categories`.
 *
 * The HTTP boundary: pick a locale, ask the repository, apply the wire rule, and parse the answer
 * on the way out. Everything it knows about data it learned from `repository.ts`.
 *
 * **The wire rule lives here, and §3.2 is the reason.**
 *
 * > A category on the wire is a thing you can pick.
 *
 * So `items` is the active **leaves**, in the curated order, and the two family roots — real rows
 * with real children — are not served at all. Doing it here rather than in a `WHERE` clause is what
 * lets `tests/categories.test.ts` prove it against a stub: a repository that filtered would make
 * AC3, AC8, AC9 and AC10 assertions about SQL, and §7 says those four run without a database.
 *
 * There is no `400` and no `404` to write. Nothing is parsed — no params, no query, no body — and
 * an empty taxonomy is `200 { items: [] }`, because a collection that exists and is empty is not a
 * missing resource (§4).
 *
 * Spec: `docs/specs/S3/W3-T01-category-tree.md` §3.2, §3.7, §3.8, §4, §5.
 */
import { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import { CategoryListSchema, type CategoryList } from '@marketplace/contracts';
import { localeOf } from '../providers/routes.js';
import { type CategoryNode, type CategoryRepository } from './repository.js';

export interface CategoryRoutesDeps {
  readonly repository: CategoryRepository;
}

/** Active, and a child of something. Both halves are §3.2's single rule. */
function isPickable(node: CategoryNode): boolean {
  return node.isActive && node.parentId !== null;
}

/**
 * Family, then the curated order inside it, then the slug.
 *
 * **The first key is not decoration.** `position` is per sibling set (§8.3), so *reformas* and
 * *mantenimiento* both start at 1 — and §3.2 flattens the tree to leaves before anyone sees it.
 * Sorting on `position` alone therefore interleaves the two families into
 * `fontaneria, reforma-integral, albanileria, electricidad, …`: twenty trades in an order no one
 * curated, whose only real signal is the tie-break. The header's search box and the facet rail
 * render this with a flat `.map()`, so the shuffle is what a visitor reads.
 *
 * `slug` breaks the remaining ties so that two rows sharing a position never swap between requests
 * — a paging-free list that reorders itself breaks a snapshot test and moves a menu item under a
 * visitor's cursor (AC10).
 */
function byFamilyThenPositionThenSlug(a: CategoryNode, b: CategoryNode): number {
  return (
    a.parentPosition - b.parentPosition ||
    a.position - b.position ||
    a.slug.localeCompare(b.slug, 'en')
  );
}

/**
 * `/categories`, under `/api` — `MEM-2026-09-14-3`. The prefix is applied at the composition root
 * rather than spelled into the path here, so every route this module ever adds inherits it.
 *
 * **No guard, and no row in `permissions.ts`.** The list is what the header renders before anyone
 * signs in and there is nothing private in a trade name. `W2-T03`'s growth rule is that a
 * permission enters with the route that guards with it; this one guards nothing, so a row would
 * imply a boundary that does not exist (§5).
 */
export function categoryRoutes({ repository }: CategoryRoutesDeps): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.get('/categories', async (request): Promise<CategoryList> => {
      const nodes = await repository({ locale: localeOf(request) });

      const items = nodes
        .filter(isPickable)
        .sort(byFamilyThenPositionThenSlug)
        .map((node) => ({
          slug: node.slug,
          name: node.name,
          requiresLicence: node.requiresLicence,
        }));

      /**
       * Parsed, not merely typed — and here the input is **seed data**, which is what makes this
       * more than ceremony. A row with an empty `nameEs`, or a slug that violates `CATEGORY_SLUG`,
       * fails this parse and the request becomes a `500` from `app.ts`'s handler. Loudly, rather
       * than shipping a malformed menu item or silently dropping a trade from the list (§6, AC11).
       */
      return CategoryListSchema.parse({ items });
    });
  };
}
