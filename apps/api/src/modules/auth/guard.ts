/**
 * `W2-T03` — route guards: the first authenticated boundary in this API.
 *
 * Two `preHandler`s and one adapter. The guards know nothing about better-auth or Postgres — they
 * take a `ResolveSession` port, which is what lets every 401/403 be asserted without a database
 * (`guard.test.ts`) and the adapter be asserted against the real stack (`guard-live.test.ts`). The
 * split is the one `W3-T05` laid down for routes and repositories, applied to the third boundary.
 *
 * Spec: `docs/specs/S2/W2-T03-route-guards.md` §3.
 */
import { type IncomingHttpHeaders } from 'node:http';
import { type FastifyRequest, type preHandlerAsyncHookHandler } from 'fastify';
import { type PrismaClient, type UserRole } from '@prisma/client';
import { AppError } from '@marketplace/contracts';

import { type Auth } from '../../auth/auth.js';
import { can, PERMISSIONS, type PermissionMatrix } from './permissions.js';

/**
 * Who is asking — and **nothing about the state of their account**.
 *
 * Operator's rule, 2026-09-18: *"a suspended/blocked/deleted user should return no data. Not even
 * `deletedAt`."* So this type may never gain `status`, `deletedAt`, or any other field describing
 * why a request might be refused. A flag here is a flag some later route branches on, and the first
 * branch that answers differently for a suspended user than for a signed-out one is a state oracle
 * on every endpoint.
 *
 * `sessionId` rather than the token: `W2-T07`'s audit log wants to name the session, and the token
 * is the credential itself — it is redacted at the logger and must not travel in a structure that
 * ends up logged.
 */
export interface Principal {
  readonly userId: string;
  readonly roles: readonly UserRole[];
  readonly sessionId: string;
}

/** The one question a guard asks. `null` means "there is nobody here" — for every reason. */
export type ResolveSession = (headers: IncomingHttpHeaders) => Promise<Principal | null>;

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by a guard, and only by a guard. Read it through `principalOf`. */
    auth?: Principal;
  }
}

/**
 * The principal a guard put on this request.
 *
 * Throws — loudly, as a 500 — if a handler reads it on a route with no guard. That is a
 * programming error rather than an authentication failure, and answering `401` there would hide a
 * missing `preHandler` behind a plausible-looking refusal.
 */
export function principalOf(request: FastifyRequest): Principal {
  if (request.auth === undefined) {
    throw new Error('principalOf() on a route with no guard — the preHandler is missing');
  }
  return request.auth;
}

export interface Guards<M extends PermissionMatrix> {
  /** Authenticated, any role. For routes whose only rule is "be somebody". */
  readonly requireSession: preHandlerAsyncHookHandler;
  /** Authenticated **and** carrying the operation in the matrix. */
  readonly requirePermission: (permission: keyof M & string) => preHandlerAsyncHookHandler;
}

export interface GuardDeps<M extends PermissionMatrix> {
  readonly resolveSession: ResolveSession;
  /** Tests pass a fixture matrix; production uses `PERMISSIONS` and cannot pass one. */
  readonly permissions?: M;
}

export function buildGuards<M extends PermissionMatrix = typeof PERMISSIONS>({
  resolveSession,
  permissions,
}: GuardDeps<M>): Guards<M> {
  const matrix: PermissionMatrix = permissions ?? PERMISSIONS;

  /**
   * Resolve once per request, not once per guard.
   *
   * `cookieCache` is off (`ADR-005` rule 4), so every resolution is a database round trip; a route
   * carrying both guards would otherwise pay for two, and the second could disagree with the first
   * if a row changed between them.
   */
  async function ensurePrincipal(request: FastifyRequest): Promise<Principal> {
    if (request.auth !== undefined) return request.auth;

    const principal = await resolveSession(request.headers);
    if (principal === null) {
      // One answer for no cookie, an unknown session, an expired one, and an account that is
      // suspended or deleted (§3.4). The message says nothing about which.
      throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    }

    request.auth = principal;
    return principal;
  }

  return {
    requireSession: async (request) => {
      await ensurePrincipal(request);
    },

    requirePermission: (permission) => async (request) => {
      const principal = await ensurePrincipal(request);

      if (!can(matrix, principal.roles, permission)) {
        // Deliberately not the same answer as `401`: "sign in" and "you cannot do this" send a
        // person to two different places. The permission is not named — the code carries no
        // `details` and the message describes nothing the client did not already know.
        throw new AppError('FORBIDDEN', 'Your account cannot perform this action.');
      }
    },
  };
}

export interface SessionResolverDeps {
  readonly auth: Auth;
  readonly prisma: PrismaClient;
}

/** `IncomingHttpHeaders` → the `Headers` better-auth's API expects. */
function toFetchHeaders(headers: IncomingHttpHeaders): Headers {
  const fetchHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) {
      fetchHeaders.append(name, single);
    }
  }
  return fetchHeaders;
}

/**
 * The only thing in this module that knows better-auth or Postgres exists.
 *
 * Two steps, and the second is the operator's rule made structural. better-auth validates the
 * signed cookie and the `session` row; then **liveness is a `where` clause**, so account state
 * never becomes a value in this process — there is no `status` to log and no `deletedAt` to carry.
 * A suspended, blocked or deleted user resolves to `null`, byte-identically to a request that
 * carried no cookie at all.
 *
 * Reading the row here rather than trusting `additionalFields` on the session payload also drops a
 * dependency on better-auth's read path, which is a property of the version we are on. Whether
 * Postgres applied a `WHERE` is not.
 *
 * The cost is one extra primary-key read per authenticated request, on a row better-auth has just
 * touched. Revisit only with a measurement — and the fix then is one statement joining `session` to
 * `app_user`, never a cached flag.
 */
export function buildSessionResolver({ auth, prisma }: SessionResolverDeps): ResolveSession {
  return async (headers) => {
    const session = await auth.api.getSession({ headers: toFetchHeaders(headers) });
    if (session === null) return null;

    const user = await prisma.user.findFirst({
      where: { id: session.user.id, status: 'ACTIVE', deletedAt: null },
      select: { id: true, roles: true },
    });
    if (user === null) return null;

    return { userId: user.id, roles: user.roles, sessionId: session.session.id };
  };
}
