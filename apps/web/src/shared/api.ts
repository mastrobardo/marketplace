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
import { SessionSchema, SessionUserSchema, type SessionUser } from './session.js';

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

  /**
   * ── The auth calls — `W2-T09` §4.3 ───────────────────────────────────────────────────────────
   *
   * Here rather than behind better-auth's client SDK, because ADR-011 §4 asks for exactly one
   * module the storefront gets data from and this one already has the properties these calls need:
   * same origin by default (which is what makes the `SameSite=Lax` cookie work through the dev
   * proxy and through `W0-T28` in preview), one place that turns a transport failure into
   * `ApiError`, and one file to replace when `W1-T03` generates the real client. A second HTTP
   * client for five endpoints would put the session cookie on a code path no other call uses — and
   * the cookie is the part most likely to break.
   *
   * The paths are better-auth 1.7.4's own, read from the installed package.
   */

  /**
   * Returns **nothing**, and that is the point.
   *
   * `W2-T01` §4.5 answers a duplicate signup with a synthetic `200` — a user object with
   * `roles: null` and no row written — so that the endpoint cannot be used to discover which
   * addresses are registered. Handing that body back to a page puts the enumeration oracle one
   * `if` away from the screen. The client sees the request succeeded; nothing else.
   */
  signUp: (input: {
    name: string;
    email: string;
    password: string;
    /** Where the emailed link should land. Relative, so `trustedOrigins` needs no entry. */
    callbackURL: string;
  }) => Promise<void>;
  /**
   * Returns the user the API just authenticated — **the server's own answer, not a guess.**
   *
   * better-auth's sign-in response carries the whole user, so asking `get-session` immediately
   * afterwards is a second request for something we were just told. The caller seeds the session
   * cache with this, which is what makes signing in **one** API call.
   */
  signIn: (input: { email: string; password: string }) => Promise<SessionUser>;
  signOut: () => Promise<void>;
  /** `null` for a visitor with no session — better-auth answers `200` with a null body, not `401`. */
  getSession: () => Promise<SessionUser | null>;
  /** Works without a session, is floored at 500 ms, and answers `200` for an address it cannot find. */
  resendVerification: (input: { email: string; callbackURL: string }) => Promise<void>;
  requestPasswordReset: (input: { email: string; redirectTo: string }) => Promise<void>;
  resetPassword: (input: { token: string; newPassword: string }) => Promise<void>;
}

/**
 * Same origin by default, which is what the MSW handlers intercept and what a single-origin
 * deployment wants. `VITE_API_URL` exists for the day the API moves to its own host.
 */
function baseUrl(): string {
  const configured: unknown = import.meta.env['VITE_API_URL'];
  return typeof configured === 'string' && configured !== '' ? configured : '/';
}

/**
 * The machine-readable code a failed response carries, in whichever of the two shapes it arrives.
 *
 * Our own API answers `{ error: { code, … } }` (README, `apps/api/src/lib/errors.ts`); better-auth
 * answers `{ code, message }`. Both are *codes*, and a code is the only field a client may branch
 * on — `403 EMAIL_NOT_VERIFIED` has to be distinguishable from the `403` an origin check produces,
 * or the login page tells a user to check their inbox because a proxy header was wrong.
 *
 * The status alone is not enough, and the human message is not stable enough. This is the one place
 * that knows either shape exists.
 */
function errorCode(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const body = data as { code?: unknown; error?: { code?: unknown } };
  if (typeof body.code === 'string') return body.code;
  if (typeof body.error?.code === 'string') return body.error.code;
  return undefined;
}

/** Every call goes through here, so there is one place that turns a transport error into `ApiError`. */
async function call<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // The code when there is one, axios's own sentence when there is not — a request that never
      // got an answer has no code, and inventing one would be claiming to know what the server did.
      throw new ApiError(error.response?.status, errorCode(error.response?.data) ?? error.message, {
        cause: error,
      });
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

    async signUp(input) {
      // The response is awaited and dropped. See the interface: a client that returns it is a page
      // that can tell a duplicate from a new account.
      await call(() => http.post<unknown>('api/auth/sign-up/email', input));
    },

    async signIn(input) {
      const response = await call(() => http.post<unknown>('api/auth/sign-in/email', input));
      // Parsed on the way in like every other response: a client that trusts the wire is a second
      // definition of the shape. `SessionUserSchema` takes the four fields the storefront uses and
      // drops the rest — `roles` included, because `W2-T03` owns what a role may change.
      return SessionUserSchema.parse((response.data as { user?: unknown }).user);
    },

    async signOut() {
      /**
       * `{}` rather than no body, and it is not a formality — measured against the running API.
       *
       * Sign-out is the one auth route with nothing to send, and a `POST` that announces
       * `application/json` with an empty body is rejected by Fastify's own JSON parser before
       * better-auth sees it: `400 VALIDATION_FAILED, "Body cannot be empty when content-type is set
       * to 'application/json'"`. (`plugins/auth.ts`'s pass-through parser is registered as `*`,
       * which Fastify uses only for content types that have no parser of their own — so JSON still
       * goes through the built-in one.) An empty object costs two bytes and does not depend on
       * whether the HTTP client felt like sending a content-type header.
       */
      await call(() => http.post<unknown>('api/auth/sign-out', {}));
    },

    async getSession() {
      const response = await call(() => http.get<unknown>('api/auth/get-session'));
      // `.catch(null)` in the schema, not a `safeParse` here: a session body we cannot read is a
      // visitor we cannot identify, which is the signed-out rendering — never a thrown loader.
      return SessionSchema.parse(response.data)?.user ?? null;
    },

    async resendVerification(input) {
      await call(() => http.post<unknown>('api/auth/send-verification-email', input));
    },

    async requestPasswordReset(input) {
      await call(() => http.post<unknown>('api/auth/request-password-reset', input));
    },

    async resetPassword(input) {
      await call(() => http.post<unknown>('api/auth/reset-password', input));
    },
  };
}
