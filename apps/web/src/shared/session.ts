/**
 * Who is signed in, and how the shell asks without being able to break.
 *
 * Two rules meet here. `W12-T09`'s, learned when the shell hard-depended on `GET /categories` and a
 * 404 on the preview deploy replaced the whole storefront with the 500 page: **a loader may not
 * fail the page over an endpoint that can fail.** And a second one that is specific to this
 * endpoint — *"we could not reach the API" must never render as "you have been logged out"*. A
 * signed-out header is the honest rendering of "we do not know who you are", and it is also the
 * only one that keeps the site usable, so an unreachable session degrades to it rather than to an
 * error boundary.
 *
 * The `null` here is therefore two different facts wearing one shape: nobody is signed in, and we
 * could not find out. The difference matters to `W2-T02`, which owns what a stale cookie means; it
 * does not matter to a header with two links in it.
 */
import { type RouterContextProvider } from 'react-router';
import * as z from 'zod';
import { queryKeys, routeContext } from './query.js';

/**
 * The fields the storefront uses, not the fields better-auth sends.
 *
 * `roles` is deliberately absent. `W2-T09` renders no role-dependent navigation — `W2-T03` owns the
 * permissions matrix — and a field parsed into the client is a field a component can branch on
 * before anyone has decided what the branch means.
 */
export const SessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
});

export type SessionUser = z.infer<typeof SessionUserSchema>;

/** better-auth answers `200` with a `null` body when there is no cookie, not `401`. */
export const SessionSchema = z.object({ user: SessionUserSchema }).nullable().catch(null);

export async function loadSession(
  context: Readonly<RouterContextProvider>,
): Promise<SessionUser | null> {
  const { queryClient, api } = context.get(routeContext);

  return queryClient
    .fetchQuery({
      queryKey: queryKeys.session(),
      queryFn: () => api.getSession(),
      /**
       * **`fetchQuery`, not `ensureQueryData` — and the difference is the whole sign-out bug.**
       *
       * `ensureQueryData` returns cached data whenever the cache *has* data: it reads
       * `query.state.data`, and only fetches when that is `undefined` (query-core 5.102,
       * `queryClient.ts`). Invalidation does not clear data, it marks it stale — so a loader built
       * on `ensureQueryData` answers from the cache after an `invalidateQueries`, and the header
       * keeps showing a user who has just signed out. Measured, not reasoned: the sign-in test
       * failed on exactly this, with the action invalidating correctly and the loader ignoring it.
       *
       * `fetchQuery` honours `staleTime` instead — fresh data is returned without a request, stale
       * or invalidated data is refetched and awaited. Which is what a loader wants and what
       * "invalidate the session after a write" has to mean.
       */
      staleTime: 60_000,
      /**
       * No retry here, unlike every other query.
       *
       * The shell blocks on this: nothing renders until it settles, because a header that flips
       * from "log in" to a name is worse than one that is right a moment later. A retry with the
       * default backoff puts a second or more of blank page in front of every visitor whose session
       * call fails — to answer a question whose fallback (signed out) is already the safe one.
       */
      retry: false,
    })
    .catch((): SessionUser | null => null);
}

/**
 * What every write does afterwards — and the whole of React Query's job on a write.
 *
 * `invalidateQueries` rather than `setQueryData`: the action knows *that* the session changed, and
 * the server is what knows what it changed to. Writing the client's guess into the cache is how a
 * header ends up showing a user a sign-in the API refused.
 */
export async function invalidateSession(context: Readonly<RouterContextProvider>): Promise<void> {
  await context.get(routeContext).queryClient.invalidateQueries({ queryKey: queryKeys.session() });
}
