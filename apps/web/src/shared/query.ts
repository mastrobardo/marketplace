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
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** The key builders, in one place, so a loader and its component cannot disagree about a key. */
export const queryKeys = {
  categories: (locale: string) => ['categories', locale] as const,
};
