/**
 * The error envelope and its code registry.
 *
 * ⚠️ This is a **pre-freeze proposal**, not the frozen seam. `W1-T01` (`agent-contracts`) owns the
 * canonical registry in `packages/contracts` and is expected to move this file there **without
 * changing the wire shape**. Until then, slices import from here.
 * See `docs/specs/S0/W0-T03-api-skeleton.md` §4 and `agents/policies/contract-change.md`.
 */

/** Every error the platform can return, with the HTTP status it maps to. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** The single shape every error reaches a client in. One shape, one client-side error boundary. */
export interface ErrorEnvelope {
  error: {
    /** Stable and machine-readable. The **only** field a client may branch on. */
    code: ErrorCode;
    /** For humans and logs. Never displayed: the web app translates from `code`. */
    message: string;
    /** Always present, always equal to the `x-request-id` response header. */
    requestId: string;
    /** Optional, structured, defined per code. */
    details?: Record<string, unknown>;
  };
}

/**
 * An error a route means to return. Anything else that escapes a handler is a bug, and is reported
 * as `INTERNAL_ERROR` with its detail moved to the logs.
 */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly statusCode: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    readonly code: ErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.statusCode = ERROR_CODES[code];
    this.details = details;
  }
}

/** The generic 5xx message. Nothing about an internal failure is safe to put on the wire. */
export const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred.';

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Readonly<Record<string, unknown>>,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details: { ...details } }),
    },
  };
}

/** Reverse lookup for framework errors, which carry a status but no code of ours. */
export function codeForStatus(status: number): ErrorCode {
  const match = Object.entries(ERROR_CODES).find(([, value]) => value === status);
  return (match?.[0] as ErrorCode | undefined) ?? 'INTERNAL_ERROR';
}
