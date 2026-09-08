# Run record — W0-T03 API skeleton

|                  |                                                                |
| ---------------- | -------------------------------------------------------------- |
| **Agent**        | `agent-devops`                                                  |
| **Model**        | `claude-opus-5`                                                 |
| **Charter rev**  | 1                                                               |
| **Skills used**  | `test-driven-development`, `api-and-interface-design`, `observability-and-instrumentation`, `security-and-hardening`, `incremental-implementation` |
| **Started**      | 2026-09-09T00:36Z                                               |
| **Finished**     | 2026-09-09T01:05Z                                               |
| **Branch**       | `W0-T03-api-skeleton` (from `main` @ a0dbbc5)                   |
| **Issue**        | https://github.com/mastrobardo/marketplace/issues/35            |
| **Spec**         | [`W0-T03-api-skeleton.md`](W0-T03-api-skeleton.md)              |
| **Session file** | `memory/sessions/2026-09-09-agent-devops-W0-T03.md`             |

---

## Prompts

### 1. Task assignment (operator, verbatim)

> continue with the task. For this session: go from w0-t1 to W0-T04 directly. Branch the  3
> branches from main. Everything is autoapproved, however be sure to include a plan step before
> each execution. The plan will be reported on the run file

The same assignment covers `W0-T02`, `W0-T03` and `W0-T04`. No design steer was given for the API,
so every choice below is the agent's and is argued in the spec.

### 2. Plan (agent, presented before any file was written)

> 1. Branch `W0-T03-api-skeleton` from `main` (not from T02).
> 2. Spec → `docs/specs/S0/W0-T03-api-skeleton.md`.
> 3. Session memory file.
> 4. **Red**: tests for health, boot-time config validation, error envelope + machine-readable
>    codes, request-id propagation, pino structured logging. Observe failure.
> 5. **Green**: `src/config.ts`, `src/lib/errors.ts`, `src/plugins/`, `src/app.ts`,
>    `src/server.ts`; switch `apps/api` build to tsup.
> 6. Full `pnpm verify`.
> 7. Run record with this plan, session handoff, memory promotion.
> 8. Commit, push, PR against #35 — not merged.

Followed as written. Step 5 lost one item (the `pino` dependency) for the reason in *Deviations*.

### 3. Corrections

No corrective re-prompt from the operator. Five reversals inside the task, all driven by tool
output; see *Deviations*.

---

## Red phase

The first attempt was **not** a red phase and is recorded because the distinction matters:

```
Error: Cannot find module '../src/app.js' imported from .../tests/app.test.ts
 Test Files  2 failed (2)
      Tests  no tests
```

A module-resolution failure proves nothing about the assertions — none of them ran. This is the
same failure mode as `W0-T01`'s vacuously-passing loops, inverted: a red that is not evidence.
The module surface was therefore created first as stubs that throw `not implemented`, and one test
that built its `Config` at module scope was moved into `beforeEach` so its file could be collected
at all. Only then was the suite honestly red:

```
 × tests/config.test.ts > AC3/AC4/AC6 … names the missing required variable
 × tests/config.test.ts > AC3/AC4/AC6 … names every bad variable at once, not just the first
 × tests/config.test.ts > AC3/AC4/AC6 … rejects a port outside the valid range
 × tests/config.test.ts > AC3/AC4/AC6 … rejects a database url that is not a url
 × tests/config.test.ts > AC5 … defaults host, port, log level, environment and version
 × tests/config.test.ts > AC5 … takes supplied values over the defaults
 × tests/config.test.ts > AC7 … is pure: same input, equal output, and the environment is untouched
 × tests/config.test.ts > AC7 … reads the process environment exactly once
 × tests/app.test.ts > AC1/AC2 … returns ok, an uptime and a version
 × tests/app.test.ts > AC1/AC2 … depends on nothing: no outbound connection is opened to answer it
 × tests/app.test.ts > AC8/AC9/AC10 … generates a uuid request id when the client supplies none
 × tests/app.test.ts > AC8/AC9/AC10 … echoes a well-formed request id supplied by the client
 × tests/app.test.ts > AC8/AC9/AC10 … refuses a over-long request id and generates its own
 × tests/app.test.ts > AC8/AC9/AC10 … refuses a newline-injecting request id and generates its own
 × tests/app.test.ts > AC8/AC9/AC10 … refuses a empty request id and generates its own
 × tests/app.test.ts > AC11/AC12/AC13 … answers an unknown route with a NOT_FOUND envelope carrying its request id
 × tests/app.test.ts > AC11/AC12/AC13 … maps an AppError to its registered status and code
 × tests/app.test.ts > AC11/AC12/AC13 … passes structured details through untouched
 × tests/app.test.ts > AC14/AC15 … answers with a generic INTERNAL_ERROR that contains none of the original detail
 × tests/app.test.ts > AC14/AC15 … moves the detail to the log sink rather than destroying it
 × tests/app.test.ts > AC16 … maps every SCREAMING_SNAKE code to a real HTTP error status
 × tests/app.test.ts > AC17/AC18 … logs the method, url and request id of every request
 × tests/app.test.ts > AC17/AC18 … redacts credentials a slice agent logs by accident

⎯⎯⎯⎯⎯⎯ Failed Tests 23 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  2 failed (2)
      Tests  23 failed (23)
```

## Green phase

```
$ pnpm --filter @marketplace/api test
 Test Files  2 passed (2)
      Tests  23 passed (23)

$ pnpm verify        # typecheck · lint · format:check · test · build
 @marketplace/api:test:  Test Files  2 passed (2)   Tests  23 passed (23)
 Test Files  3 passed (3)      Tests  22 passed (22)     (root workspace suite)
 Tasks:    3 successful, 3 total   (build)
verify -> 0
```

The unit suite is not the only evidence — the server was run for real, because `app.inject()` never
opens a socket and a skeleton whose *process* does not boot is worthless:

```
$ env -u DATABASE_URL npx tsx src/server.ts
Invalid environment:
  DATABASE_URL: Invalid input: expected string, received undefined
exit=78                                    # EX_CONFIG, not a generic 1

$ DATABASE_URL=postgres://…/marketplace PORT=3999 npx tsx src/server.ts &
$ curl -sD- http://127.0.0.1:3999/health
HTTP/1.1 200 OK
x-request-id: eb4414a2-3825-4be7-8589-a93ff3ccac20
{"status":"ok","uptime":2.717398875,"version":"0.0.0-dev"}

$ curl -sD- -H 'x-request-id: 11111111-2222-3333-4444-555555555555' http://127.0.0.1:3999/nope
HTTP/1.1 404 Not Found
x-request-id: 11111111-2222-3333-4444-555555555555
{"error":{"code":"NOT_FOUND","message":"Route GET /nope not found","requestId":"11111111-2222-3333-4444-555555555555"}}

# and the matching log lines, correlated by reqId:
{"level":30,…,"reqId":"11111111-…","req":{"method":"GET","url":"/nope",…},"msg":"incoming request"}
{"level":30,…,"reqId":"11111111-…","code":"NOT_FOUND","msg":"Route GET /nope not found"}
{"level":30,…,"reqId":"11111111-…","res":{"statusCode":404},"responseTime":0.27,"msg":"request completed"}
```

## Deviations from spec

1. **The `pino` dependency was added and then removed.** The first implementation constructed a
   pino logger and passed it as Fastify's `loggerInstance`. That makes the instance's `Logger`
   generic concrete, and every function taking a `FastifyInstance` then fails to typecheck
   (`Type 'FastifyBaseLogger' is not assignable to type 'Logger<never, boolean>'`). Fastify's own
   `logger: { …, stream }` option takes the same pino options, keeps the default generics, and
   removes a direct dependency. Fewer moving parts for the same behaviour.

2. **`AC7` was sharpened before it was implemented.** As drafted it said "no value is read from
   `process.env` after the first call", which is only testable by proxying `process.env` and
   counting reads — a test about a mechanism rather than a property. Rewritten to two honest
   claims: `loadConfig(env)` is pure and does not mutate its input, and `getConfig()` returns the
   **same object reference** on repeated calls. Same intent, tested directly.

3. **The request-id hook is `app.addHook`, not `app.register`.** The plugin form silently did
   nothing: `register` creates an encapsulation context, and a hook added inside one does not apply
   to routes registered in a sibling context — so `/health` had no `x-request-id` header while the
   tests for the hook itself would have passed in isolation. This is the single most dangerous
   thing found in this task, because the failure is *silent partial coverage*: a correlation header
   present on some routes and absent on others.

4. **`disableRequestLogging: false` was removed.** Deprecated in Fastify 5 (`FSTDEP023`) and it was
   the default anyway. Left in, it would have emitted a deprecation warning on every boot in every
   environment for no benefit.

5. **`apps/api` builds with tsup, not `tsc`.** The `W0-T01` stub used `tsc` with
   `outDir`/`rootDir`, which forces `tsconfig.json` to include only `src/` — so tests would never
   have been typechecked. With tsup owning the build, `tsconfig.json` covers `src`, `tests` and
   `*.config.ts` under `noEmit`, and the type errors in the test files (there were some) are caught
   by the gate rather than at review.

One test-side correction:

- **AC18** asserted that logging `{ req: { headers } }` produces `[redacted]`. The credentials were
  indeed absent — but because *Fastify's* `req` serialiser discards everything except
  method/url/host/remoteAddress, not because pino's redaction fired. The test was passing for a
  reason unrelated to the thing it claimed to verify. It now logs both shapes an agent actually
  reaches for: `{ headers }`, which pino's redact paths censor (asserted by the presence of
  `[redacted]`), and `{ req: { headers } }`, which the serialiser drops.

## Human input received

- The task assignment in *Prompts §1*, including the standing "everything is autoapproved"
  authorisation.
- Nothing else. No credential or account was needed: `DATABASE_URL` is validated but never
  connected to, and its only value used anywhere is the local stack's.

## Notes for `agent-contracts` — please read before `W1-T01`

`apps/api/src/lib/errors.ts` implements the error envelope **as a pre-freeze proposal**, not as
ownership of the seam (`policies/contract-change.md`). The intent is that `W1-T01` moves this file
into `packages/contracts` **without changing the wire shape**. The shape is
`{ error: { code, message, requestId, details? } }` with the seven codes in the spec's §4 table.

Three decisions in it are worth your explicit agreement or rejection now, because after `W1-T01`
merges each costs an ADR:

1. **`message` is never displayed.** The web app translates from `code`, so `message` is for humans
   reading logs and is not a localisation surface. If you disagree, the whole i18n story for errors
   changes.
2. **`details` is untyped per code** (`Record<string, unknown>`). Typing it per code is the obvious
   improvement and belongs to you, not here.
3. **5xx responses carry a fixed generic message.** The original error never reaches the wire. This
   is a security property, and the tests assert the absence of the original text, so relaxing it
   should be deliberate.

## Self-assessment

- **Weakest part of this change**: the error handler maps framework 4xx errors to
  `VALIDATION_FAILED` when no better code matches. That is a guess dressed as a mapping — a 415 or
  a 413 is not a validation failure. It is contained (only Fastify-generated errors reach that
  branch, and none exist yet without a body parser or schemas) but it will produce a misleading
  code the first time a slice adds request-body validation. `W1-T01` should replace it with an
  explicit table.
- **Second weakest**: `/health` reports `status: 'ok'` unconditionally. It is honest today because
  the app has no dependencies, but the moment `W0-T05` adds a database it becomes a lie unless
  someone remembers to revisit it. The spec says readiness arrives with the first dependency; that
  is a note, not a gate.
- **What a reviewer should look at hardest**: the error envelope proposal above — it is the seam,
  and this is the cheap moment to change it. After that, `generateRequestId`'s validation regex
  (`/^[A-Za-z0-9_-]{1,128}$/`): it is what stands between a client-supplied header and every log
  line the platform writes.
- **What I would tell the next agent working in this slice**: `buildApp()` is the composition root
  and takes an explicit `Config` — do not reach for `process.env` inside a module, add the variable
  to `EnvSchema` instead. Throw `AppError` with a code from the registry rather than calling
  `reply.status(...)`, so the envelope stays uniform. And add root-level hooks with `addHook`, not
  `register`, unless you actually want encapsulation (deviation 3).
- **Not verified**: nothing runs in CI (`W0-T06`). No load, no concurrency, and no behaviour under
  a real database — there is no database. The graceful-shutdown path in `server.ts` is written but
  untested; it needs a real process to be worth asserting, which belongs with `W0-T07`.
