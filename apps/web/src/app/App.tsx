import { type ReactElement, useState } from 'react';
import {
  RouterContextProvider,
  createBrowserRouter,
  createMemoryRouter,
  RouterProvider,
} from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';
import { createApiClient, type ApiClient } from '../shared/api.js';
import { createQueryClient, routeContext } from '../shared/query.js';

export interface AppProps {
  /**
   * Tests render at a chosen path with an in-memory history. In the browser this is undefined and
   * the real history is used — the component under test is then the same one that ships.
   */
  initialEntries?: string[];
  /** Tests substitute the client; the application never passes one. */
  api?: ApiClient;
}

/**
 * The composition root, and the only place the `QueryClient` is constructed.
 *
 * `useState` rather than a module constant is ADR-011 R5/R6 taken literally: a module-scope client
 * is one cache shared by every request a Worker serves, which is a data-leak class rather than a
 * bug class. `getContext` hands it to loaders — React Router builds a fresh context per navigation,
 * so a loader never reaches for a singleton.
 */
export function App({ initialEntries, api }: AppProps = {}): ReactElement {
  const [queryClient] = useState(createQueryClient);
  const [apiClient] = useState(() => api ?? createApiClient());

  const [router] = useState(() => {
    const getContext = (): RouterContextProvider => {
      const context = new RouterContextProvider();
      context.set(routeContext, { queryClient, api: apiClient });
      return context;
    };

    return initialEntries === undefined
      ? createBrowserRouter(routes, { getContext })
      : createMemoryRouter(routes, { initialEntries, getContext });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
