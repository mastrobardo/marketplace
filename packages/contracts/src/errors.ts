/**
 * The error envelope and its code registry — the frozen seam.
 *
 * `W0-T03` implemented this in `apps/api/src/lib/errors.ts` as a pre-freeze proposal. `W1-T01`
 * moves it here **without changing the wire shape**, and adds the three things a proposal left
 * open: zod as the single source of truth, `details` typed per code, and an explicit status→code
 * table. Changing the shape from here costs an ADR (`agents/policies/contract-change.md`).
 */
import { z } from 'zod';

/** Every error the platform can return, with the HTTP status it maps to. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * The structured payload each code may carry.
 *
 * A code **absent from this map carries no `details` at all** — not an optional empty object. That
 * is enforced by `DetailsFor` below, and it matters most for `INTERNAL_ERROR`: a `details` bag is
 * the easiest way to leak a stack trace onto the wire, which `INTERNAL_ERROR_MESSAGE` exists to
 * prevent.
 *
 * Adding a code that carries nothing structured touches only `ERROR_CODES`. Only a code with a real
 * payload appears here.
 */
const DETAIL_SCHEMAS = {
  VALIDATION_FAILED: z.object({
    issues: z.array(z.object({ path: z.string(), message: z.string() })),
  }),
  RATE_LIMITED: z.object({ retryAfterSeconds: z.number().int().nonnegative() }),
} as const;

export type ErrorDetails = {
  [C in keyof typeof DETAIL_SCHEMAS]: z.infer<(typeof DETAIL_SCHEMAS)[C]>;
};

/** The details a given code accepts. `never` for a code that declares none. */
export type DetailsFor<C extends ErrorCode> = C extends keyof ErrorDetails
  ? ErrorDetails[C]
  : never;

const BASE = {
  /** For humans and logs. **Never displayed** — the web app translates from `code`. */
  message: z.string().min(1),
  /** Always present, always equal to the `x-request-id` response header. */
  requestId: z.string().min(1),
};

/**
 * The schema is passed in rather than looked up as `DETAIL_SCHEMAS[code]`. Indexing with a generic
 * parameter widens the result to a union of *every* detail schema, which would make the inferred
 * `ErrorEnvelope` accept `VALIDATION_FAILED` carrying `retryAfterSeconds` — precisely the pairing
 * this task exists to make impossible. A direct property access at the call site keeps it exact.
 */
const withDetails = <C extends ErrorCode, S extends z.ZodType>(code: C, details: S) =>
  z.strictObject({ code: z.literal(code), ...BASE, details: details.optional() });

const withoutDetails = <C extends ErrorCode>(code: C) =>
  z.strictObject({ code: z.literal(code), ...BASE });

/**
 * Discriminated on `code`, so the schema says exactly which payload belongs to which error rather
 * than describing `details` as a free-form object. `W1-T03` generates OpenAPI from this, and
 * `W1-T04` asserts responses match it — a chain that only holds with one definition of the shape.
 *
 * Every member of `ERROR_CODES` must appear here; `tests/errors.test.ts` fails if one is missing.
 */
const ErrorBodySchema = z.discriminatedUnion('code', [
  withDetails('VALIDATION_FAILED', DETAIL_SCHEMAS.VALIDATION_FAILED),
  withDetails('RATE_LIMITED', DETAIL_SCHEMAS.RATE_LIMITED),
  withoutDetails('UNAUTHENTICATED'),
  withoutDetails('FORBIDDEN'),
  withoutDetails('NOT_FOUND'),
  withoutDetails('METHOD_NOT_ALLOWED'),
  withoutDetails('NOT_ACCEPTABLE'),
  withoutDetails('CONFLICT'),
  withoutDetails('PAYLOAD_TOO_LARGE'),
  withoutDetails('UNSUPPORTED_MEDIA_TYPE'),
  withoutDetails('INTERNAL_ERROR'),
]);

/** The single shape every error reaches a client in. One shape, one client-side error boundary. */
export const ErrorEnvelopeSchema = z.strictObject({ error: ErrorBodySchema });

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** One error body — the discriminated union's members, before they are wrapped in `{ error }`. */
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/**
 * The one member of the union that carries `code` — what a caller building that error gets back,
 * so `details` is reachable without narrowing.
 *
 * Extracted from the *body*, not from `ErrorEnvelope`: the union is nested inside `error`, so
 * `Extract<ErrorEnvelope, …>` matches nothing and silently resolves to `never`.
 */
export type ErrorEnvelopeFor<C extends ErrorCode> = { error: Extract<ErrorBody, { code: C }> };

/** The generic 5xx message. Nothing about an internal failure is safe to put on the wire. */
export const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred.';

/**
 * Build an envelope.
 *
 * `details` is typed against `code`: a payload belonging to another code is a compile error, and a
 * code that declares none accepts nothing (its `details` type is `never`). It stays *optional*
 * rather than required, because a `VALIDATION_FAILED` without structured issues is legitimate and
 * because the error handler builds envelopes from a code it only knows at runtime.
 */
export function errorEnvelope<C extends ErrorCode>(
  code: C,
  message: string,
  requestId: string,
  details?: DetailsFor<C>,
): ErrorEnvelopeFor<C> {
  return {
    error: {
      code,
      message,
      requestId,
      // Spread rather than assign: the caller keeps ownership of its object, and a later mutation
      // of it must not rewrite an envelope that has already been built.
      ...(details === undefined ? {} : { details: { ...details } }),
    },
  } as ErrorEnvelopeFor<C>;
}

/**
 * An error a route means to return. Anything else that escapes a handler is a bug, and is reported
 * as `INTERNAL_ERROR` with its detail moved to the logs.
 */
export class AppError<C extends ErrorCode = ErrorCode> extends Error {
  override readonly name = 'AppError';
  readonly statusCode: number;
  readonly details: DetailsFor<C> | undefined;

  constructor(
    readonly code: C,
    message: string,
    details?: DetailsFor<C>,
  ) {
    super(message);
    this.statusCode = ERROR_CODES[code];
    this.details = details;
  }

  /**
   * The handler has an `AppError` whose `code` is only known at runtime, so it cannot call
   * `errorEnvelope` and keep the per-code typing. This method is where that knowledge already
   * lives — the pairing was checked at the throw site.
   */
  toEnvelope(requestId: string): ErrorEnvelope {
    return errorEnvelope(this.code, this.message, requestId, this.details);
  }
}

/**
 * Reverse lookup for framework errors, which carry a status but no code of ours.
 *
 * Returns `matched: false` when no code claims the status. `W0-T03` mapped every unrecognised 4xx
 * to `VALIDATION_FAILED` silently — its own run record called that "a guess dressed as a mapping —
 * a 415 or a 413 is not a validation failure". The fallback is unchanged; what changed is that the
 * caller can now tell it was a guess and log it, so a gap in the registry becomes visible instead
 * of being reported to a client as a validation failure it was not.
 */
export function codeForStatus(status: number): { code: ErrorCode; matched: boolean } {
  const match = Object.entries(ERROR_CODES).find(([, value]) => value === status);
  if (match) return { code: match[0] as ErrorCode, matched: true };
  return {
    code: status >= 400 && status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR',
    matched: false,
  };
}
