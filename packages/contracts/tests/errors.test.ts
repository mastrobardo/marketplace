import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AppError,
  ERROR_CODES,
  ErrorEnvelopeSchema,
  INTERNAL_ERROR_MESSAGE,
  codeForStatus,
  errorEnvelope,
} from '../src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('AC3 — the registry is one table, and it is coherent', () => {
  it('gives every code an HTTP status', () => {
    for (const [code, status] of Object.entries(ERROR_CODES)) {
      expect(Number.isInteger(status), `${code} has a non-integer status`).toBe(true);
      expect(status, `${code} is outside the error range`).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('never gives two codes the same status', () => {
    // `codeForStatus` is a reverse lookup, so a duplicate would make it silently ambiguous —
    // whichever code `Object.entries` happened to yield first would win.
    const statuses = Object.values(ERROR_CODES);
    expect(new Set(statuses).size, 'two codes claim one status').toBe(statuses.length);
  });
});

describe('the schema knows every code in the registry', () => {
  it('accepts an envelope for each one', () => {
    // The discriminated union is written out by hand. A code added to ERROR_CODES but not to the
    // union would be rejected by the schema at runtime while type-checking perfectly at the throw
    // site — the failure would first appear as a client seeing a malformed error.
    const missing = (Object.keys(ERROR_CODES) as (keyof typeof ERROR_CODES)[]).filter(
      (code) =>
        !ErrorEnvelopeSchema.safeParse({
          error: { code, message: 'x', requestId: 'req-1' },
        }).success,
    );
    expect(missing, 'these codes are in ERROR_CODES but not in the schema union').toEqual([]);
  });
});

describe('AC2 — the schema accepts a valid envelope and rejects malformed ones', () => {
  const valid = {
    error: { code: 'NOT_FOUND', message: 'Route GET /nope not found', requestId: 'abc-123' },
  };

  it('accepts the shape W0-T03 froze', () => {
    expect(ErrorEnvelopeSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['no error key', {}],
    ['an unknown code', { error: { ...valid.error, code: 'NOPE' } }],
    ['a missing requestId', { error: { code: 'NOT_FOUND', message: 'x' } }],
    ['a non-string message', { error: { ...valid.error, message: 42 } }],
    ['a top-level extra key', { ...valid, extra: true }],
  ])('rejects %s', (_label, payload) => {
    expect(ErrorEnvelopeSchema.safeParse(payload).success).toBe(false);
  });
});

describe('AC6 — every status Fastify emits maps to its own code', () => {
  it.each([
    [400, 'VALIDATION_FAILED'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [405, 'METHOD_NOT_ALLOWED'],
    [406, 'NOT_ACCEPTABLE'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [429, 'RATE_LIMITED'],
    [500, 'INTERNAL_ERROR'],
  ])('maps %i to %s', (status, code) => {
    expect(codeForStatus(status).code).toBe(code);
  });

  it('reports an unmapped 4xx as a fallback rather than pretending it matched', () => {
    // 418 is not in the registry. W0-T03 mapped it to VALIDATION_FAILED silently, which its own
    // run record called "a guess dressed as a mapping". The code is unchanged; what changes is
    // that the caller can now tell it was a guess, and say so in the log (AC7).
    const result = codeForStatus(418);
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.matched).toBe(false);
  });

  it('reports a mapped status as matched', () => {
    expect(codeForStatus(404).matched).toBe(true);
  });
});

describe('AC8 — nothing about an internal failure reaches the wire', () => {
  it('keeps the generic 5xx message free of anything specific', () => {
    expect(INTERNAL_ERROR_MESSAGE).toBe('An unexpected error occurred.');
  });

  it('builds an envelope with no details when none is given', () => {
    const built = errorEnvelope('INTERNAL_ERROR', INTERNAL_ERROR_MESSAGE, 'req-1');
    expect('details' in built.error).toBe(false);
    expect(ErrorEnvelopeSchema.safeParse(built).success).toBe(true);
  });
});

describe('details are carried, typed, and round-trip through the schema', () => {
  it('carries VALIDATION_FAILED issues', () => {
    const built = errorEnvelope('VALIDATION_FAILED', 'Body did not match its schema', 'req-2', {
      issues: [{ path: 'email', message: 'must be an email' }],
    });
    expect(built.error.details).toEqual({
      issues: [{ path: 'email', message: 'must be an email' }],
    });
    expect(ErrorEnvelopeSchema.safeParse(built).success).toBe(true);
  });

  it('carries RATE_LIMITED retry advice', () => {
    const built = errorEnvelope('RATE_LIMITED', 'Slow down', 'req-3', { retryAfterSeconds: 30 });
    expect(built.error.details).toEqual({ retryAfterSeconds: 30 });
    expect(ErrorEnvelopeSchema.safeParse(built).success).toBe(true);
  });

  it('copies details rather than aliasing the caller’s object', () => {
    const details = { retryAfterSeconds: 30 };
    const built = errorEnvelope('RATE_LIMITED', 'Slow down', 'req-4', details);
    details.retryAfterSeconds = 999;
    expect(built.error.details).toEqual({ retryAfterSeconds: 30 });
  });
});

describe('AppError carries the status its code maps to', () => {
  it('derives statusCode from the registry', () => {
    expect(new AppError('CONFLICT', 'already exists').statusCode).toBe(409);
  });

  it('is an Error, so it survives a throw', () => {
    const thrown = new AppError('FORBIDDEN', 'nope');
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.name).toBe('AppError');
    expect(thrown.message).toBe('nope');
  });
});

/**
 * AC4/AC5. "`details` is typed against `code`" is only true if it is compiled and observed — the
 * same argument `W0-T04` made for the i18n catalogues, and the same mechanism.
 */
function typecheckFixture(name: string): { ok: boolean; output: string } {
  try {
    execFileSync('npx', ['tsc', '-p', `tests/fixtures/${name}/tsconfig.json`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: '' };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('AC4/AC5 — a wrong details payload is a compile error', () => {
  it('compiles a fixture that pairs every code with the right details', () => {
    const result = typecheckFixture('valid');
    expect(result.ok, `the valid fixture did not compile:\n${result.output}`).toBe(true);
  });

  it('refuses details that do not match the code', () => {
    const result = typecheckFixture('wrong-details');
    expect(result.ok, 'a mismatched details payload compiled').toBe(false);
  });

  it('refuses details on a code that declares none', () => {
    const result = typecheckFixture('details-on-a-code-that-has-none');
    expect(result.ok, 'INTERNAL_ERROR accepted a details payload').toBe(false);
  });
});
