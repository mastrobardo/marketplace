/**
 * React Query, wired so that ADR-011 R3, R5 and R6 all still hold.
 *
 * The naive integration — `useQuery` in a component, fetching on mount — violates **R3** outright
 * ("data comes from the loader; a component never fetches on mount") and would make `W12-T14`'s SSR
 * switch a rewrite rather than a switch. The integration here is the loader-first one: a route
 * `loader` calls `ensureQueryData`, and the component reads an already-warm cache. React Query is
 * the cache and the revalidation story; the loader is still what triggers the fetch.
 *
 * The `QueryClient` is created **per application instance and handed to loaders through the
 * router's own context**, never imported from module scope. That is **R5** and **R6**, and it is not
 * theoretical: a module-scope `new QueryClient()` is one cache shared by every request a Worker
 * serves, which is the "one user's results served to another" data-leak class R5 names. React
 * Router's `getContext` exists for exactly this and builds a fresh context per navigation.
 *
 * `createContext` below is a *key*, not a value — an immutable token with no per-user state in it —
 * which is why it may live at module scope when the client may not.
 */
import { QueryClient } from '@tanstack/react-query';
import { createContext } from 'react-router';
// The class from its own module and the interface as a *type*: a value import from `api.ts` here
// would rebuild the cycle `api-error.ts` exists to break (`api.ts` → `session.ts` → `query.ts`).
import { ApiError } from './api-error.js';
import { type ApiClient } from './api.js';

/** What every loader is handed. One place to add to when a second dependency appears. */
export interface RouteContext {
  queryClient: QueryClient;
  api: ApiClient;
}

export const routeContext = createContext<RouteContext>();

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The loader has already awaited the data by the time a component renders, so an immediate
        // background refetch on mount would be a second request for something we just fetched.
        staleTime: 60_000,
        /**
         * Retry a failure that might be transient; never one the server has already decided.
         *
         * A 404 is an answer — the provider is gone, and asking again a second later gets the same
         * answer more slowly. A 400 is the request's own fault. Retrying either buys nothing and
         * costs the visitor the retry delay before they are told anything at all, which on the
         * profile page is a blank screen in front of a page that was ready immediately.
         */
        retry: (failureCount, error) => {
          const status = error instanceof ApiError ? error.status : undefined;
          if (status !== undefined && status >= 400 && status < 500) return false;
          return failureCount < 1;
        },
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** The key builders, in one place, so a loader and its component cannot disagree about a key. */
export const queryKeys = {
  categories: (locale: string) => ['categories', locale] as const,
  // The serialised query is the key, because it is also the URL: two searches that produce one URL
  // are one cache entry, and `toSearchQuery` already emits keys in schema order so they cannot
  // differ by ordering alone.
  search: (locale: string, query: string) => ['search', locale, query] as const,
  provider: (locale: string, id: string) => ['provider', locale, id] as const,
  // No locale in the key: who is signed in does not change with the language, and a locale-keyed
  // session would re-fetch on every language switch and — worse — keep a stale entry per language
  // for a sign-out to miss.
  session: () => ['session'] as const,
  /**
   * No locale on any of these — `W4-T04`.
   *
   * A job's title and a quote's breakdown are what two people typed; they do not have a Spanish
   * version and an English one. Keying them by language would hold two identical copies and refetch
   * both on every switch, and — the part that actually bites — a decision written against one key
   * would leave the other showing a quote that had already been answered.
   */
  myJobs: () => ['me', 'jobs'] as const,
  job: (id: string) => ['job', id] as const,
  jobQuotes: (jobId: string) => ['job', jobId, 'quotes'] as const,
};
