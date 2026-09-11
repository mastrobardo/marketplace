/**
 * Loading the category list, in one place, because there are now two loaders that need it.
 *
 * The rule this file exists to hold is `W12-T09`'s, learned the expensive way: **a deployed page
 * may not hard-depend on an endpoint that does not exist.** `GET /categories` is `W3-T01`. The
 * shell's first version awaited it without a fallback, the request 404'd on the preview deploy, the
 * loader rejected and the root boundary replaced the entire storefront with the 500 page — over one
 * empty dropdown.
 *
 * `W12-T10` adds the home page, which needs the same list. Two copies of a degrade rule is one copy
 * too many: the second is the one that gets forgotten, and it would be forgotten in the loader that
 * ships the marketing page.
 *
 * The key is shared with the shell's call on purpose. React Query answers the second loader from a
 * warm cache, so a page under the shell costs no extra request — which is what lets a child route
 * own its own loader (R3) instead of reading the parent's data.
 */
import { type CategorySummary } from '@marketplace/contracts';
import { type RouterContextProvider } from 'react-router';
import { queryKeys, routeContext } from './query.js';

export async function loadCategories(
  context: Readonly<RouterContextProvider>,
  locale: string,
): Promise<CategorySummary[]> {
  const { queryClient, api } = context.get(routeContext);

  return queryClient
    .ensureQueryData({
      queryKey: queryKeys.categories(locale),
      queryFn: () => api.getCategories(locale),
    })
    .catch((): CategorySummary[] => []);
}
