/**
 * What a failed call looks like to a loader, an action, or a retry policy.
 *
 * **Its own module, and `W2-T10` is why.** It used to live in `api.ts`, which gave the storefront a
 * runtime import cycle — `api.ts` → `session.ts` → `query.ts` → `api.ts` — the moment `W2-T09` had
 * the client parse a session. A cycle does not fail on its own: it fails depending on which module
 * the bundler reaches first, so `login.tsx` worked and `signup.tsx` crashed with
 * `seedSession is not a function`, on a line that had nothing to do with it.
 *
 * An error class is not "the API client" anyway. `query.ts` now imports *only a type* from `api.ts`
 * (erased at build time), so there is no runtime edge back and the cycle cannot re-form without
 * somebody adding a value import on purpose — which `api-boundaries.test.ts` fails them for.
 *
 * `status` is `undefined` for a request that never got an answer: a network failure is not a 500,
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
