import { type ReactElement } from 'react';
import { createBrowserRouter, createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from './routes.js';

export interface AppProps {
  /**
   * Tests render at a chosen path with an in-memory history. In the browser this is undefined and
   * the real history is used — the component under test is then the same one that ships.
   */
  initialEntries?: string[];
}

export function App({ initialEntries }: AppProps = {}): ReactElement {
  const router =
    initialEntries === undefined
      ? createBrowserRouter(routes)
      : createMemoryRouter(routes, { initialEntries });

  return <RouterProvider router={router} />;
}
