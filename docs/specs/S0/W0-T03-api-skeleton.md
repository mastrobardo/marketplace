# Spec — W0-T03 API skeleton

|               |                                                      |
| ------------- | ---------------------------------------------------- |
| **Task**      | `W0-T03` `[A]`                                       |
| **Slice**     | S0 Platform                                          |
| **Owner**     | `agent-devops`                                       |
| **Reviewers** | `agent-contracts`, `agent-qa`                        |
| **Issue**     | https://github.com/mastrobardo/marketplace/issues/35 |
| **Status**    | draft                                                |

---

## 1. Purpose

`apps/api` is currently one exported string. Sixteen domain modules are about to be written into
it by eleven different agents, and every one of them needs the same four things on their first
day: a way to read configuration, a way to fail a request, a way to correlate a log line with the
request that produced it, and a server to hang a route on.

If those four things are not decided here, they get decided eleven times. The concrete cost is
predictable, because it is the same cost every service pays: three different error shapes on the
wire so the web client needs three parsers; `process.env.STRIPE_KEY!` scattered through modules so
a missing variable surfaces as a 500 on the first payment rather than a refusal to boot; and logs
that cannot be joined to a request, which is the difference between diagnosing a production
failure and guessing at it.

The people who suffer without it are every slice agent from `W2-T01` onward, and whoever is on
call for the first production incident.

## 2. User stories

- **As a slice agent**, I want to register a route on an app that already has logging, error
  handling and config, so that my first PR is a feature and not a framework.
- **As a slice agent**, I want to throw a typed error with a machine-readable code, so that the
  web client can branch on the code instead of matching on a message.
- **As the web app**, I want every error to arrive in one shape, so that one error boundary
  handles all of them.
- **As an operator**, I want a missing required variable to stop the process at boot with a
  message naming it, so that a misconfigured deploy fails at the deploy rather than in front of a
  user.
- **As an operator debugging an incident**, I want the request id in the client's response and in
  every log line for that request, so that a user's bug report is a log query.
- **As a security reviewer**, I want an unexpected exception to reach the client as a generic
  message, so that a stack trace or a SQL fragment is never part of an HTTP response body.
- **As Fly's health checker** (`W0-T07`), I want an endpoint that answers without touching a
  database, so that a database blip does not cause a rolling restart of healthy machines.

## 3. State machine

Not applicable. The one lifecycle worth naming is boot, and it is deliberately trivial: **load and
validate configuration → build the app → listen**. Validation happens before anything is
constructed, so an invalid environment can never produce a half-started server that accepts
traffic. That ordering is asserted by criterion 3.

## 4. API surface

| Method | Path      | Auth | Request | Response                                              | Codes |
| ------ | --------- | ---- | ------- | ----------------------------------------------------- | ----- |
| `GET`  | `/health` | none | —       | `{ status: 'ok', uptime: number, version: string }`   | `200` |

`/health` answers from process state alone. It never opens a database connection, because a
liveness probe that fails when a dependency is down turns one outage into two.

Every response, on every route, carries an `x-request-id` header.

### Error envelope — a **proposal**, not a frozen contract

`W1-T01` (`agent-contracts`) owns the canonical error envelope and code registry in
`packages/contracts`, which does not exist yet. Per `agents/policies/contract-change.md` this is a
pre-freeze proposal, implemented provisionally in `apps/api/src/lib/errors.ts` so that the
skeleton has something to be correct about. **The intent is that `W1-T01` moves this file into
`packages/contracts` without changing the wire shape.**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route GET /nope not found",
    "requestId": "0f9c2b7a-...",
    "details": { "field": "email" }
  }
}
```

- `code` — `SCREAMING_SNAKE_CASE`, stable, the only field a client may branch on.
- `message` — for humans and logs. **Not** for display: the web app translates from `code`
  (`TODO.md` §5.3, "no hardcoded strings"), so this is never a localisation surface.
- `requestId` — always present, always equal to the `x-request-id` response header.
- `details` — optional, structured, per-code. Absent unless a code defines it.

Initial registry, each with its default HTTP status:

| Code                | Status | Fires when                                              |
| ------------------- | ------ | ------------------------------------------------------- |
| `VALIDATION_FAILED` | 400    | the request did not match its schema                     |
| `UNAUTHENTICATED`   | 401    | no credential, or an invalid one                         |
| `FORBIDDEN`         | 403    | authenticated, but not permitted                         |
| `NOT_FOUND`         | 404    | the route or the addressed resource does not exist       |
| `CONFLICT`          | 409    | the request contradicts current state                    |
| `RATE_LIMITED`      | 429    | too many requests                                        |
| `INTERNAL_ERROR`    | 500    | anything unexpected — the catch-all                      |

Slices add codes; they do not invent shapes.

## 5. Permissions matrix

No authentication exists yet (`W2-T02`), so there are no roles to tabulate. Two access rules are
nonetheless enforced and tested here, because both are security properties rather than features:

| Actor                      | Sees                                                        |
| -------------------------- | ------------------------------------------------------------ |
| any HTTP client            | the error `code`, a safe `message`, and its own `requestId`   |
| any HTTP client, on a 5xx  | a **generic** message only — never the underlying error text |
| the log sink               | the full error, its stack, and the request id                 |

The charter-ownership constraint applies as usual: `apps/api/src/modules/**` is `forbidden:` to
`agent-devops`, so nothing in this task may be written there. Everything here lives in
`src/plugins/`, `src/lib/`, `src/routes/` and the two entry points.

## 6. Error cases

| Condition                                            | Surfaces as                                   | Expected behaviour                                            |
| ---------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| A required variable is missing                       | process refuses to start                      | `ConfigError` naming the variable; **non-zero exit**           |
| Several variables are wrong at once                  | one boot, one message                         | the error names **all** of them, not just the first            |
| `PORT` is not a valid port number                    | process refuses to start                      | `ConfigError` naming `PORT`                                    |
| An unknown route is requested                        | `404` + `NOT_FOUND` envelope                  | never Fastify's default `{"message":"Route ... not found"}`    |
| A route throws an `AppError`                         | that code's status + envelope                 | `details` passed through untouched                             |
| A route throws anything else                         | `500` + `INTERNAL_ERROR` + generic message    | the original message **must not** appear in the body           |
| A client sends a hostile `x-request-id`              | log injection, unbounded log lines            | rejected; a fresh id is generated in its place                 |
| A request carries `authorization` or `cookie`        | credentials written to the log sink           | redacted in logs                                               |

## 7. Acceptance criteria

**Health**

1. **Given** the app, **when** I `GET /health`, **then** the status is `200` and the body is
   `{ status: 'ok', uptime: <number>, version: <string> }`.
2. **Given** an app built with no database and no network, **when** I `GET /health`, **then** it
   still answers `200` — the probe depends on nothing.

**Configuration**

3. **Given** an environment with no `DATABASE_URL`, **when** configuration is loaded, **then** it
   throws and the message names `DATABASE_URL`.
4. **Given** an environment where `DATABASE_URL` is missing **and** `PORT` is `"not-a-port"`,
   **when** configuration is loaded, **then** the message names **both** variables.
5. **Given** an environment supplying only the required variables, **when** configuration is
   loaded, **then** `PORT` is `3000`, `HOST` is `127.0.0.1`, `LOG_LEVEL` is `info` and `NODE_ENV`
   is `development`.
6. **Given** `PORT="70000"`, **when** configuration is loaded, **then** it throws and the message
   names `PORT`.
7. **Given** a valid environment, **when** `loadConfig(env)` is called twice, **then** the two
   results are equal and `env` is unmodified; and **when** `getConfig()` is called twice, **then**
   it returns the **same object reference** both times — the environment is read once, at boot,
   and passed around as a value rather than looked up ambiently in each module.

**Request id**

8. **Given** a request with no `x-request-id`, **when** it is handled, **then** the response
   carries an `x-request-id` that is a v4 UUID.
9. **Given** a request with `x-request-id: 11111111-2222-3333-4444-555555555555`, **when** it is
   handled, **then** that exact value comes back in the response header.
10. **Given** a request whose `x-request-id` is 500 characters long, or contains a newline,
    **then** it is **not** echoed; a generated id is used instead.

**Error envelope**

11. **Given** a request to an unknown route, **when** it is handled, **then** the status is `404`
    and the body is an envelope with `code: 'NOT_FOUND'` whose `requestId` equals the
    `x-request-id` response header.
12. **Given** a route that throws `new AppError('FORBIDDEN', 'nope')`, **when** it is called,
    **then** the status is `403` and the body's `code` is `FORBIDDEN`.
13. **Given** a route that throws `new AppError('VALIDATION_FAILED', 'bad', { field: 'email' })`,
    **when** it is called, **then** the body's `details` is `{ field: 'email' }`.
14. **Given** a route that throws `new Error('connection string postgres://user:pw@host')`,
    **when** it is called, **then** the status is `500`, the `code` is `INTERNAL_ERROR`, and the
    response body **does not contain** the substring `postgres://` — nor the original message.
15. **Given** that same route, **when** it is called, **then** the log sink received an
    `error`-level line containing the original message **and** the request id — the detail is
    moved, not destroyed.
16. **Given** the error-code registry, **when** it is enumerated, **then** every code is
    `SCREAMING_SNAKE_CASE` and maps to an integer HTTP status in `[400, 599]`.

**Logging**

17. **Given** any handled request, **when** the log sink is read, **then** it contains a
    structured line with that request's id, its method and its URL.
18. **Given** a request carrying `authorization: Bearer secret-token` and a `cookie` header,
    **when** the log sink is read, **then** neither value appears in it.

## 8. Data

No Prisma models and no migrations — `W0-T05`. `DATABASE_URL` is validated at boot but nothing
connects to it yet, deliberately: the variable is required from the first commit so that the day a
module needs a database is not also the day the deployment discovers it has no connection string.

## 9. Out of scope

- **The error-code registry as a frozen contract** — `W1-T01`. §4 is a proposal; the
  implementation is a provisional home for the shape, not ownership of it.
- **Readiness (`/health/ready`)** — deliberately absent. A readiness probe that checks nothing is
  worse than none, because it reports "ready" as a fact. It arrives with the first real dependency
  in `W0-T05`.
- **Anything under `apps/api/src/modules/**`** — `forbidden:` to this agent. No domain route, no
  auth, no database plugin.
- **Authentication, sessions, roles** — `W2-T01`…`W2-T03`. `UNAUTHENTICATED` and `FORBIDDEN` are
  in the registry so slices have them; nothing here issues them.
- **Rate limiting, CORS, helmet, request-body limits** — hardening belongs with the first public
  surface (`W0-T13`/`W2`), and adding it now would be untested policy: there is no origin to allow
  and no consumer to limit.
- **OpenAPI generation and contract tests** — `W1-T03`, `W1-T04`.
- **`.env.example`** — `W0-T09`. This task defines which variables exist and validates them; it
  does not own the file that documents them.
- **Sentry, metrics, log shipping** — `W0-T08`. Logs go to stdout in the agreed structured shape,
  which is the prerequisite; where they are shipped is that task's decision.

## 10. Open questions

None blocking. One decision taken by the owning agent, flagged because it crosses a seam:

- **The error envelope is implemented before `agent-contracts` owns it.** The alternative was to
  block `W0-T03` on `W1-T01`, which would block every W2 slice on a task in a different agent's
  backlog. Per `policies/contract-change.md` this is pre-freeze, so proposing is allowed and the
  cheap moment to argue about the shape is now. **`agent-contracts`: if any of `code`, `message`,
  `requestId`, `details` is wrong, say so on this PR — after `W1-T01` merges it costs an ADR.**
