# Run record — W1-T01 one shape for every error

|            |                                                          |
| ---------- | -------------------------------------------------------- |
| **Task**   | `W1-T01` · issue [#55](https://github.com/mastrobardo/marketplace/issues/55) |
| **Agent**  | `agent-contracts`                                        |
| **Date**   | 2026-09-09                                               |
| **Spec**   | `W1-T01-error-envelope.md`                               |

---

## 1. What landed

`packages/contracts` exists and owns the envelope. `apps/api` builds against it;
`apps/api/src/lib/errors.ts` is gone. The wire shape is unchanged for every code that already
existed.

`pnpm verify` clean from a cold cache. 228 root + 32 contracts + 18 API tests, 0 failures.

## 2. The three decisions were taken before the spec, not in it

`W0-T03`'s run record asked for explicit agreement on three points "because after `W1-T01` merges
each costs an ADR". `agents/prompts/00-spec-authoring.md` now requires exactly that, so all three
went to the operator first: `message` stays a log string; `details` is typed per code; 5xx keeps its
fixed generic message. All three confirmed, and §2 of the spec records them with their consequences.

This is the first task to run under that rule. It cost one exchange and settled the shape before a
line was written — which is the whole argument for it, given `W0-T23` spent ~2600 lines discovering
its direction was wrong.

## 3. The red phase

Module-resolution first, unavoidably — the module *is* the deliverable, and `MEM-2026-09-09-06`
says that is not a red phase:

```
Cannot find module '../src/index.js' imported from packages/contracts/tests/errors.test.ts
  TOTAL 0  FAILED 0
```

The real red came from the typechecker, and it caught a genuine hole rather than a typo — see §4.

## 4. The bug the type system found

The first schema built its per-code members with a generic lookup:

```ts
const withDetails = <C extends keyof typeof DETAIL_SCHEMAS>(code: C) =>
  z.strictObject({ code: z.literal(code), ...BASE, details: DETAIL_SCHEMAS[code].optional() });
```

`pnpm typecheck` reported the inferred type as:

```
code: "VALIDATION_FAILED"; details?: { retryAfterSeconds: number } | { issues: … } | undefined
```

**Indexing with a generic parameter widens the result to a union of every detail schema.** Runtime
validation was still correct — `DETAIL_SCHEMAS[code]` picks the right one — so no test would have
caught it. But `ErrorEnvelope` is `z.infer` of the schema, so the *exported type* would have let a
consumer build `VALIDATION_FAILED` carrying `retryAfterSeconds`: exactly the pairing decision 2 was
chosen to make impossible.

Fixed by passing the schema in, so the call site uses a direct property access:

```ts
const withDetails = <C extends ErrorCode, S extends z.ZodType>(code: C, details: S) => …
withDetails('VALIDATION_FAILED', DETAIL_SCHEMAS.VALIDATION_FAILED)
```

A second, smaller one immediately after: `ErrorEnvelopeFor<C>` was written as
`Extract<ErrorEnvelope, { error: { code: C } }>` and silently resolved to `never`, because the union
is nested *inside* `error` and `Extract` matched no top-level member. `never` is the failure mode to
watch for with `Extract` — it does not error, it just makes every property access fail somewhere
else.

## 5. Decisions worth reviewing

- **`details` stays optional, not required, for codes that declare one.** A `VALIDATION_FAILED`
  without structured issues is legitimate, and the error handler builds envelopes from a code it
  only knows at runtime. Required would have forced a cast in the one place that cannot avoid it.

- **`AppError.toEnvelope()` exists because `errorEnvelope` cannot be called with a union.** With
  `code: ErrorCode` (not a literal), `DetailsFor<C>` is a union and the pairing is unprovable. The
  method is where the knowledge already lives — the pairing was type-checked at the `throw`.

- **Four codes added that nothing throws yet** — `METHOD_NOT_ALLOWED`, `NOT_ACCEPTABLE`,
  `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`. They exist only to make §4.3's table exhaustive.
  Dead but harmless; the alternative is the mislabelling this task was asked to remove.

- **The fallback still returns `VALIDATION_FAILED`, it just admits it.** `codeForStatus` returns
  `{ code, matched }` and the handler logs at `warn` naming the status. Changing the code itself
  would be a wire change for no gain; making the guess visible is the actual fix, and a third test
  asserts a *mapped* status does **not** warn, so the warning keeps meaning something.

- **`zod` is `external` in the tsup build.** Bundling a copy would give the API two zods and make
  `instanceof z.ZodError` fail across the boundary — a failure that appears only in the consumer.

## 6. On AC1, honestly

AC1 said "the wire shape is byte-identical for every existing code", and one test changed:
`apps/api/tests/app.test.ts` threw `new AppError('VALIDATION_FAILED', 'bad', { field: 'email' })`,
which no longer compiles.

That is a synthetic throw-route that exists only to be thrown from — **no endpoint in the app emits
`VALIDATION_FAILED` details**, and no code had a defined `details` shape before this task, so
nothing on the wire changed. But the spec's wording was stronger than what was delivered, and the
honest statement is: the *envelope* shape is unchanged; `details` for `VALIDATION_FAILED` is defined
here for the first time, which is decision 2 being applied rather than a contract being broken.

## 7. Self-assessment

- **Weakest part:** the discriminated union in `ErrorBodySchema` is written out by hand, one line
  per code. A code added to `ERROR_CODES` and forgotten there type-checks at the throw site and is
  rejected by the schema at runtime — it would first appear as a client seeing a malformed error.
  There is a test that walks `ERROR_CODES` and fails naming any code the schema does not accept, so
  the gap is caught, but the structure still invites it.

- **Look hardest at:** `errorEnvelope`'s `as ErrorEnvelopeFor<C>` cast. It is there because TypeScript
  cannot see that the object built from a generic `code` matches the extracted union member. The
  cast is sound given the inputs are constrained, but it is the one place the seam's guarantee rests
  on my reasoning rather than on the compiler.

- **Not verified:** nothing here has been exercised by a real route with real validation. `W1-T03`
  (OpenAPI generation) and `W1-T04` (contract tests) are what turn this from a schema into a proven
  contract.

## 8. The deploy failure, and what it says about the image

CI's `deploy` job failed on the first push. Every other check was green.

```
Machine 859946a4e41398 [app] was created
✖ Failed: timeout reached waiting for health checks to pass for machine 859946a4e41398
```

Five minutes of failed health checks, not a network blip — the trailing
`net/http: request canceled` is only the last poll being cancelled when the timeout hit, and it is
the most misleading line in the log.

**Cause.** `infra/docker/api.Dockerfile` lists workspace manifests by hand and builds workspace
packages by hand. `packages/contracts` was in neither list. The API bundles with
`skipNodeModulesBundle: true`, so `@marketplace/contracts` is resolved from `node_modules` at run
time; `pnpm deploy --prod` duly copied the package into the pruned tree, but its `dist/` had never
been built, so the container resolved a package with no entry point and exited on boot.

**Nothing about that reaches the log Fly shows you.** A crash-on-boot and a genuinely unhealthy app
produce the same "health checks did not pass". This is the same class of failure
`MEM-2026-09-09-22` records for the Prisma client — the image is assembled from lists that a new
workspace member does not automatically join.

**Fixed** by adding the manifest COPY and `pnpm --filter @marketplace/contracts build` before the
prune, and — because the next package will hit this too — by two assertions in
`tests/cd-workflows.test.ts` derived from the workspace rather than hard-coded: every member's
manifest is COPYed, and every `@marketplace/*` in the API's **runtime** dependencies is built
before `deploy --legacy`. Verified red against the unfixed Dockerfile (both fail, naming
`packages/contracts`) and green against the fix, so they are not assertions that cannot fail.

## 9. Handoff

- `W1-T02` (#56) inherits this envelope rather than negotiating with it — pagination errors use
  `VALIDATION_FAILED` with `issues`.
- `W1-T03` (#57) generates OpenAPI **from `ErrorEnvelopeSchema`**, not from a re-description. That
  is why the schema is zod and not interfaces.
- A slice needing a new code adds it to `ERROR_CODES` **and** to `ErrorBodySchema`'s union. If it
  carries structured data, add it to `DETAIL_SCHEMAS` too. Post-freeze changes are an ADR.
- `packages/contracts` is the second workspace member `agent-contracts` owns; `packages/testing`
  (`W1-T09`) is the next — and §8's guards now fail loudly if its manifest is not added to the
  image, so that lesson is paid for once.
