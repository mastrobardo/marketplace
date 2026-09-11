/**
 * The one module the storefront gets data from — ADR-011 §4, until `W1-T03` generates the real one.
 *
 * *"The storefront imports one module for data: the generated client from `packages/contracts`. No
 * `fetch` in a component, no hand-written URL, no Prisma anywhere near React."* `W1-T03` (zod →
 * OpenAPI → typed client) has not run, so this is the stand-in: **one** module, hand-written URLs
 * confined to it, and every response parsed by the contract's own zod schema on the way in.
 *
 * That last part is what keeps it honest. A hand-written client that trusts the wire is a second
 * definition of the API shape; one that parses is a *consumer* of the single definition, and it
 * fails loudly the day the endpoint drifts. When `W1-T03` lands, the generated client replaces the
 * calls below and nothing else in the app changes — the query keys and the loaders stay.
 *
 * Not a route module, so no route rule applies here. But `axios` is created **per client instance**
 * rather than as a module singleton, for the same reason R6 exists: on a Worker a module-scope
 * client outlives the request that configured it.
 */
import {
  CategoryListSchema,
  SearchResponseSchema,
  type CategorySummary,
  type SearchResponse,
} from '@marketplace/contracts';
import { type SearchQuery } from '@marketplace/ui';
import axios, { type AxiosInstance } from 'axios';

export interface ApiClient {
  getCategories: (locale: string) => Promise<CategorySummary[]>;
  /**
   * Takes the query as **strings** — the shape that goes in a URL — not `SearchQuerySchema`'s parsed
   * output. That output is transformed: `cursor` comes out as a decoded `CursorPosition` and `sort`
   * as an array, so serialising it back would need the contract's encoders and would re-derive a
   * string the caller already had. The caller validates, then sends what the URL said.
   */
  search: (query: SearchQuery, locale: string) => Promise<SearchResponse>;
}

/**
 * Same origin by default, which is what the MSW handlers intercept and what a single-origin
 * deployment wants. `VITE_API_URL` exists for the day the API moves to its own host.
 */
function baseUrl(): string {
  const configured: unknown = import.meta.env['VITE_API_URL'];
  return typeof configured === 'string' && configured !== '' ? configured : '/';
}

export function createApiClient(
  http: AxiosInstance = axios.create({ baseURL: baseUrl() }),
): ApiClient {
  return {
    async getCategories(locale) {
      const response = await http.get<unknown>('categories', {
        // The endpoint resolves `nameEs`/`nameEn` down to one `name`, so it has to be told which.
        headers: { 'Accept-Language': locale },
      });
      return CategoryListSchema.parse(response.data).items;
    },

    async search(query, locale) {
      const params = new URLSearchParams(Object.entries(query));
      const response = await http.get<unknown>(`search?${params.toString()}`, {
        headers: { 'Accept-Language': locale },
      });
      // Parsed on the way in, like the categories call. A client that trusts the wire is a second
      // definition of the API shape; one that parses is a consumer of the single definition.
      return SearchResponseSchema.parse(response.data);
    },
  };
}
