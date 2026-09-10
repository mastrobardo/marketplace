# Spec — W1-T01 one shape for every error

|               |                                                                          |
| ------------- | ------------------------------------------------------------------------ |
| **Task**      | `W1-T01` `[A]`                                                           |
| **Slice**     | S1 Contracts                                                             |
| **Owner**     | `agent-contracts`                                                        |
| **Reviewers** | `agent-devops` · `agent-qa`                                              |
| **Issues**    | [#55](https://github.com/mastrobardo/marketplace/issues/55)              |
| **Status**    | in progress                                                              |

---

## 1. Purpose

`apps/api/src/lib/errors.ts` implements the error envelope as a **pre-freeze proposal**
(`W0-T03`, PR #151). This task moves it into `packages/contracts` and freezes it, because every
slice from `W2` onward returns errors and none of them may invent a shape.

The wire shape does not change. `{ error: { code, message, requestId, details? } }` and the seven
codes are already live and already tested; changing them now would break `apps/api` for no benefit.
What this task adds is the things a proposal deliberately left out: a zod schema as the single
source of truth, `details` typed per code, and an explicit status→code table replacing a guess.

## 2. Decisions taken before this spec

`W0-T03`'s run record asked for explicit agreement on three points "because after `W1-T01` merges
each costs an ADR" (`agents/policies/contract-change.md`). Agreed with the operator before writing
this spec:

| # | Decision | Consequence |
|---|---|---|
| 1 | **`message` is never displayed.** It is for humans reading logs. | The web app renders copy from `code` through the i18n catalogues. The API never emits user-facing Spanish, so there is no locale negotiation and no translated string in a response body. |
| 2 | **`details` is typed per code.** | A client branching on `VALIDATION_FAILED` gets `details` typed. `W1-T04` can assert OpenAPI describes it. Cost: the map lives in the seam, so a slice adding a code *with* details edits one shared file — roughly thirteen edits ever, not one per task. |
| 3 | **5xx carries a fixed generic message.** | A security property, asserted by tests. The original never reaches the wire. |

## 3. Scope

**In:** `packages/contracts` as a workspace member; the envelope and code registry as zod schemas;
per-code `details`; an explicit HTTP-status→code table; moving `apps/api` onto the package.

**Out:** OpenAPI generation and the typed client — `W1-T03`. This task defines the schema that
`W1-T03` generates *from*, which is the reason decision 3 puts it in zod now rather than leaving
plain interfaces for `W1-T03` to re-describe and drift from.

**Out:** pagination, sorting and filtering — `W1-T02`.

**Out:** a compatibility shim at the old path. There are exactly two consumers
(`apps/api/src/app.ts` and `apps/api/tests/app.test.ts`); a deprecation window for two imports in
one app is ceremony.

## 4. Design

### 4.1 The registry is one table, and status is derived from it

```ts
export const ERROR_CODES = {
  VALIDATION_FAILED:      400,
  UNAUTHENTICATED:        401,
  FORBIDDEN:              403,
  NOT_FOUND:              404,
  METHOD_NOT_ALLOWED:     405,
  NOT_ACCEPTABLE:         406,
  PAYLOAD_TOO_LARGE:      413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CONFLICT:               409,
  RATE_LIMITED:           429,
  INTERNAL_ERROR:         500,
} as const;
```

The four new codes exist to fix §4.3, not to speculate. Each is a status Fastify itself produces.

### 4.2 `details` typed per code

```ts
type ErrorDetails = {
  VALIDATION_FAILED: { issues: { path: string; message: string }[] };
  RATE_LIMITED: { retryAfterSeconds: number };
};
```

A code absent from the map **carries no `details` at all** — not an optional empty object. That is
enforced at the type level, so `INTERNAL_ERROR` cannot acquire a payload by accident, which matters
because decision 3 says nothing about a 5xx is safe on the wire.

The shape is a *map*, not a union of envelope types, so adding a code without details is a
one-line change to `ERROR_CODES` and nothing else. Only a code that genuinely carries structured
data touches `ErrorDetails`.

### 4.3 The status→code table replaces a guess

Today `app.ts:78-79` maps any unrecognised 4xx to `VALIDATION_FAILED`. `W0-T03`'s own run record
calls this "a guess dressed as a mapping — a 415 or a 413 is not a validation failure", and hands
the fix to this task. It is contained today only because nothing produces those statuses yet; the
first slice to add a body parser makes it wrong.

Replaced by an exhaustive reverse lookup over `ERROR_CODES`, with **one** documented fallback: an
unmapped 4xx becomes `VALIDATION_FAILED` *only* if no code claims that status, and the mismatch is
logged at `warn` naming the status. A gap becomes visible instead of silently mislabelled.

### 4.4 zod is the source of truth, TypeScript is derived

`ErrorEnvelopeSchema` is defined in zod; `ErrorEnvelope` is `z.infer` of it. Nothing declares the
shape twice. `W1-T03` generates OpenAPI from the same schema, and `W1-T04` asserts responses match
it — a chain that only holds if there is exactly one definition.

### 4.5 `AppError` stays a class, and stays in the seam

Routes throw `new AppError(code, message, details)`. Keeping it beside the registry is what makes
`details` type-checked against `code` at the throw site rather than at the handler.

## 5. Acceptance criteria

| # | Criterion | How it is proved |
|---|---|---|
| AC1 | The wire shape is byte-identical to `W0-T03`'s for every existing code | the existing `apps/api/tests/app.test.ts` assertions pass unchanged |
| AC2 | `ErrorEnvelopeSchema` accepts a valid envelope and rejects each malformed one | `packages/contracts/tests/errors.test.ts` |
| AC3 | Every `ERROR_CODES` entry maps to exactly one status, and no two codes share a status | test over the table |
| AC4 | `details` is type-checked against `code` — a wrong payload is a compile error | a compile-failure fixture, as `apps/web/tests/fixtures/` does for i18n |
| AC5 | A code with no entry in `ErrorDetails` accepts no `details` at all | same fixture |
| AC6 | Every status Fastify can emit maps to its own code, not to `VALIDATION_FAILED` | table test asserting 405/406/413/415 each resolve distinctly |
| AC7 | An unmapped 4xx falls back to `VALIDATION_FAILED` **and warns** naming the status | handler test asserting the log line |
| AC8 | A 5xx response contains the generic message and never the original text | the existing security assertion, moved and kept |
| AC9 | `packages/contracts` satisfies the four workspace requirements | `tests/workspace.test.ts` |
| AC10 | `apps/api` imports the envelope from `@marketplace/contracts`, and `lib/errors.ts` is gone | grep test |

## 6. Risks

- **Freezing early.** After this merges, a shape change costs an ADR. That is the point, and the
  three decisions in §2 were taken with the operator for exactly this reason — but it does mean
  `W1-T02`'s pagination work inherits the envelope rather than negotiating with it.
- **`ErrorDetails` is a shared file.** Adding a code that carries details edits it. Accepted: it is
  ~13 edits over the project, the alternative loses the typing the operator chose, and per
  `MEM-2026-09-09-28` a shared file is rebased by hand rather than designed away.
- **Four new codes are added before anything throws them.** They exist only to make §4.3's table
  exhaustive. If a slice never produces a 406, the code is dead but harmless — and the alternative
  is the mislabelling this task exists to remove.
