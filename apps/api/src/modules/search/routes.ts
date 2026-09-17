/**
 * `W3-T05` — `GET /api/search`.
 *
 * The HTTP boundary: parse, resolve the centre, ask the repository, page it, and parse the answer
 * on the way out. Everything it knows about geography it learned from `places.ts`; everything it
 * knows about data it learned from `repository.ts`.
 *
 * Spec: `docs/specs/S5/W3-T05-geo-search.md`.
 */
import { type FastifyInstance, type FastifyPluginAsync, type FastifyRequest } from 'fastify';
import {
  AppError,
  PAGE_LIMIT_DEFAULT,
  SearchQuerySchema,
  SearchResponseSchema,
  pageOf,
  type SearchResponse,
} from '@marketplace/contracts';
import { resolvePlace } from './places.js';
import { type SearchRepository } from './repository.js';

export interface SearchRoutesDeps {
  readonly repository: SearchRepository;
}

/**
 * `nameEs` or `nameEn`, decided here so the client never sees the pair — the contract says the
 * endpoint resolves it. Spanish is the default because the market is Spain.
 */
function localeOf(request: FastifyRequest): 'es' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/**
 * `/search`, under `/api` — `MEM-2026-09-14-3`. Registered with the prefix at the composition root
 * rather than spelled into the path here, so every route this module ever adds inherits it.
 */
export function searchRoutes({ repository }: SearchRoutesDeps): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.get('/search', async (request): Promise<SearchResponse> => {
      const parsed = SearchQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        throw new AppError('VALIDATION_FAILED', 'The search query is not valid.', {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }

      const { where, what, mode, limit, sort, cursor } = parsed.data;

      // A place we cannot resolve is not a place with no providers, and the two must not look alike
      // to the storefront. `undefined` rather than a default centre is deliberate — see `places.ts`.
      const centre = resolvePlace(where);
      if (centre === undefined) {
        throw new AppError('VALIDATION_FAILED', 'That place could not be resolved.', {
          issues: [{ path: 'where', message: `"${where}" is not a place we can search from.` }],
        });
      }

      const size = limit ?? PAGE_LIMIT_DEFAULT;

      const { rows, facets } = await repository({
        centre,
        what,
        mode,
        limit: size,
        sort,
        cursor,
        locale: localeOf(request),
      });

      // `pageOf` over the repository's over-fetch, so `hasMore` and `nextCursor` cannot disagree
      // with what the mock taught the storefront — both call the same function on the same shape.
      const page = pageOf([...rows], { limit: size, sort });

      // Parsed, not merely typed. Types are erased at runtime; this is what makes the strict
      // projection and the coarse-point refinement a gate rather than a convention (§2.7).
      return SearchResponseSchema.parse({
        items: [...page.items],
        page: page.page,
        facets,
      });
    });
  };
}
