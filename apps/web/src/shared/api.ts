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
  ProviderProfileSchema,
  SearchResponseSchema,
  type CategorySummary,
  type ProviderProfile,
  type SearchResponse,
} from '@marketplace/contracts';
import { type SearchQuery } from '@marketplace/ui';
import axios, { type AxiosInstance } from 'axios';

/**
 * What a failed call looks like to a loader.
 *
 * The loader has to tell one failure apart from the rest — a 404 is a *page*, with a way out, while
 * everything else is the error boundary — and the alternative is a route module reaching into an
 * `AxiosError`'s `response.status`. That would make the transport visible to the page, so the day
 * the generated client replaces this file every loader would need editing. This module is the only
 * one that knows there is HTTP underneath; `status` is what it tells the rest of the app.
 *
 * `status` is `undefined` for a request that never got an answer — a network failure is not a 500,
 * and pretending it is would mean claiming to know what the server did.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
    // `Error`'s own `cause`, not a second field of the same name — a `readonly cause` property here
    // shadows the base class and TypeScript says so.
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  getCategories: (locale: string) => Promise<CategorySummary[]>;
  /**
   * Takes the query as **strings** — the shape that goes in a URL — not `SearchQuerySchema`'s parsed
   * output. That output is transformed: `cursor` comes out as a decoded `CursorPosition` and `sort`
   * as an array, so serialising it back would need the contract's encoders and would re-derive a
   * string the caller already had. The caller validates, then sends what the URL said.
   */
  search: (query: SearchQuery, locale: string) => Promise<SearchResponse>;
  /**
   * The id is a uuid the caller has **already** checked against `ProviderIdSchema`. This method does
   * not re-check it: a client that validates its own arguments invites a caller to stop, and the
   * caller is the one route that can render a 404 instead of sending a request nobody should send.
   */
  getProvider: (id: string, locale: string) => Promise<ProviderProfile>;
}

/**
 * Same origin by default, which is what the MSW handlers intercept and what a single-origin
 * deployment wants. `VITE_API_URL` exists for the day the API moves to its own host.
 */
function baseUrl(): string {
  const configured: unknown = import.meta.env['VITE_API_URL'];
  return typeof configured === 'string' && configured !== '' ? configured : '/';
}

/** Every call goes through here, so there is one place that turns a transport error into `ApiError`. */
async function call<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new ApiError(error.response?.status, error.message, { cause: error });
    }
    throw error;
  }
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

    async getProvider(id, locale) {
      const response = await call(() =>
        http.get<unknown>(`providers/${id}`, { headers: { 'Accept-Language': locale } }),
      );
      return ProviderProfileSchema.parse(response.data);
    },
  };
}
