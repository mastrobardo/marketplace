---
task: W0-T03
agent: agent-devops
session: 2026-09-09
status: closed
---

# Session — W0-T03 API skeleton

## Goal

Turn `apps/api` from a one-line placeholder into a Fastify app with health, boot-time config
validation, a machine-readable error envelope, request-id correlation and structured pino logging.

## Starting state

`main` at a0dbbc5. `apps/api/src/index.ts` is the W0-T01 placeholder (`export const name`).
Branch `W0-T03-api-skeleton` off `main`, independent of `W0-T02-local-stack`.

## Log
- First "red" was fake: `Cannot find module '../src/app.js'`, `Tests  no tests`. Created the module
  surface as `not implemented` stubs and moved a module-scope `loadConfig()` in the test into
  `beforeEach`, then got an honest 23-failure red. → `memory/repo/gotchas.md` MEM-2026-09-09-06.
- Sharpened AC7 before implementing it: "no value read from process.env after the first call" is
  only testable by proxying `process.env`. Replaced with purity + `getConfig()` reference identity.
- Dead end: pino as `loggerInstance` broke typing across every file taking a `FastifyInstance`.
  Fastify's own `logger: {…, stream}` does the same job. Removed the pino dependency.
  → slice memory MEM-2026-09-09-07.
- **The expensive one**: the request-id hook wrapped in `app.register` silently covered nothing —
  `register` encapsulates. `/health` had no `x-request-id` at all. → `memory/repo/gotchas.md`
  MEM-2026-09-09-05.
- AC18 was passing for the wrong reason: Fastify's `req` serialiser drops headers, so pino's redact
  never fired. Rewritten to log `{ headers }` too and assert `[redacted]` is actually present.
- Switched `apps/api` build to tsup so `tests/**` is typechecked. → slice memory MEM-2026-09-09-08.
- Ran the real process, not just `app.inject()`: boot refuses a missing `DATABASE_URL` with exit 78,
  `/health` and the 404 envelope verified over HTTP with correlated log lines.

## Handoff
`W0-T03` is complete and green; the PR is open and **not merged** (L6).

**What the next agent inherits**
- `buildApp({ config })` is the composition root. It takes an explicit `Config` — never read
  `process.env` inside a module, add the variable to `EnvSchema` in `src/config.ts` instead.
- Throw `new AppError('<CODE>', message, details?)` from a route. Do not hand-build a reply: the
  error handler owns the envelope, the status and the logging.
- Root-level cross-cutting behaviour goes on `app.addHook`, **not** `app.register`.
- `apps/api/src/modules/**` is still empty and is `forbidden:` to this agent — it is yours.

**Open, and it needs `agent-contracts`**: `src/lib/errors.ts` is a **pre-freeze proposal** for the
error envelope that `W1-T01` owns. The run record lists the three decisions in it that need
explicit agreement (message is never displayed; `details` is untyped; 5xx messages are generic).
Cheapest moment to change any of them is on this PR.

**Next**: `W0-T04` (web skeleton) is independent. `W0-T05` (Prisma) should add the readiness probe
`/health/ready` when there is finally a dependency worth checking — `/health` reports `ok`
unconditionally and becomes a lie the moment a database exists.
