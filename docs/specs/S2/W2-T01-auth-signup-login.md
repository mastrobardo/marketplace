# W2-T01 — Signup, login, email verification and password reset

- **Slice**: S2 Identity (`agent-identity`)
- **Issue**: (to be filed — `W2` has no issues yet)
- **Decides**: nothing new. `ADR-005` decided it; this spec is where that decision meets the code
  and where four places it does not survive contact are settled.
- **Blocks**: `W2-T02` … `W2-T08`, all of `W4` (a job has a poster), all of `W6` (a bid has a
  bidder), `W3-T02`/`T03` (a provider edits *their own* profile).

---

## 1. Purpose

The storefront is a facade. Seven route modules render against MSW handlers; `apps/api/src/routes/`
contains exactly one file, `health.ts`. `W12-T12` shipped `AuthWall` as the place the facade stops
honestly — a boundary stated in words, with no disabled button and no link to a form that does not
exist. This ticket is the form.

`ADR-005` already made the decision: **`better-auth`, self-hosted, against our own Postgres,
`app_user` stays the user record.** What is left is the mapping, and the mapping is where the
interesting parts are.

### 1.1 Four things `ADR-005` did not survive contact with

Each of these is settled in §4. They are collected here because they are the reason this spec is
longer than "install the library".

**a. The migration cannot wait for `W2-T02`.** `ADR-005` assigns the `session`/`account`/
`verification` tables to `W2-T02` and signup/login to `W2-T01`. But credentials *are* `account`
rows (rule 2), a verification token *is* a `verification` row, and a successful login *is* a
`session` row. There is no subset of this ticket that works without all four tables. The split was
drawn along "what the tables are called" rather than along "what has to exist for a flow to run".
§4.1 redraws it: **`W2-T01` lands the schema, `W2-T02` owns session *policy*** — lifetime,
rotation, revoke endpoints, and the `W0-T28` cross-origin fix. That is also consistent with why
`W2-T02` is blocked on `W0-T28` and `W2-T01` is not: a table existing is not a cookie crossing a
registrable domain.

**b. Email case will silently fork the user table.** `W1-T05` built a *functional* unique index on
`lower(email)`, and `ADR-005` repeats the rule: every lookup must be written
`WHERE lower(email) = lower($1)` or it misses the index. better-auth does not know that. Its Prisma
adapter issues `where: { email: <whatever the form posted> }` — an exact match. Two consequences,
and the second is worse than the first: the lookup misses the index (slow), and `Maria@gmail.com`
and `maria@gmail.com` become **two accounts that both satisfy the unique index**, because the index
is on the lowered value and the *insert* also goes through better-auth. One of them owns the
provider profile; the other is the one that can log in. §4.2 owns this.

**c. The documented Fastify bridge drops cookies.** better-auth's own Fastify guide forwards the
response headers with `response.headers.forEach((value, key) => reply.header(key, value))`. The
`Headers` API folds repeated headers into one comma-joined value, and `Set-Cookie` is the one
header where that is not a legal transformation — a response setting a session cookie *and*
clearing a stale one arrives as a single malformed cookie. §4.3 uses `getSetCookie()`.

**d. The API would speak two error dialects.** `W1-T01` froze an error envelope and a code registry,
and `app.ts` has a `setErrorHandler` that guarantees it. better-auth answers through `better-call`
with its own shape. Mounted naively, `POST /api/auth/sign-in` returns something the frozen envelope
does not describe, on the same origin as every other route. §4.4 decides what to do about it, and
the answer is *not* "translate everything".

### 1.2 What this ticket is not

It is not the login *page*. `ADR-011` §1 exists because UI work sitting as an unstated tail on an
API ticket is how thirteen agents each invent their own button. The pages are `W2`'s own frontend
work and are scoped in §9.

---

## 2. User stories

1. **As a client**, I can create an account with an email and a password, so that the `AuthWall`
   `W12-T12` renders stops being the end of the road.
2. **As a client**, I receive a verification email and the account is not fully usable until I click
   it, so that a typo'd address is caught before a provider tries to reach me on it.
3. **As anyone who forgot a password**, I can request a reset and set a new one from a link that
   works once, so that losing a password is not losing an account.
4. **As a person who typed their email with a capital letter**, I get *my* account, so that
   `Maria@gmail.com` on Tuesday and `maria@gmail.com` on Friday are the same person.
5. **As a suspended provider**, I cannot sign in, so that `UserStatus.SUSPENDED` means something
   before `W2-T03` exists to enforce it per-route.
6. **As a deleted user**, I cannot sign in, so that `deletedAt` is a fact the auth path respects
   rather than a column `W2-T08` will eventually get around to.
7. **As an operator**, a misconfigured deployment fails at boot with a message naming the variable,
   so that a missing auth secret is never silently replaced by a default.

---

## 3. State machine

The account's authentication state, which is *not* `UserStatus` and must not be conflated with it.

```
                      sign-up
                         │
                         ▼
              ┌──────────────────────┐
              │ REGISTERED           │  app_user row + account row (credential)
              │ email_verified=false │  verification row issued, email sent
              └──────────┬───────────┘
                         │ click the link (single use, TTL §8.3)
                         ▼
              ┌──────────────────────┐
              │ VERIFIED             │  email_verified=true, email_verified_at=now()
              │ can sign in          │
              └──────────┬───────────┘
                         │
      ┌──────────────────┼──────────────────┐
      │                  │                  │
      ▼                  ▼                  ▼
 sign-in ok        status=SUSPENDED    deletedAt set
 session row       sign-in REFUSED     sign-in REFUSED
                   (§4.5)              (§4.5)
```

`REGISTERED → VERIFIED` is the only transition better-auth owns. The two refusals are ours: the
library has no concept of either column (`ADR-005`, "Soft delete is ours, not better-auth's").

**Whether `REGISTERED` may sign in at all is `requireEmailVerification`, and §4.6 decides it.**

---

## 4. API surface

### 4.1 The schema lands here, the session *policy* lands in `W2-T02`

`W2-T01` adds migration `0007_auth_tables`:

| table | why it is in this ticket |
|---|---|
| `session` | a successful sign-in writes one; there is no login without it |
| `account` | `ADR-005` rule 2 — the password credential is a row here, not a column on `app_user` |
| `verification` | email verification and password reset tokens both live here |

and migration `0008_app_user_auth_fields`:

| change | why |
|---|---|
| **drop** `app_user.password_hash` | `ADR-005` rule 2. Grepped: the column appears in exactly one file in the repo, `0003_core_identity/migration.sql`. Nothing has ever written it, so the drop is not a data migration |
| **add** `app_user.name TEXT` | better-auth requires `user.name`. It is the *account's* name; `ClientProfile.displayName` stays "what a provider sees. Not the legal name." |
| **add** `app_user.email_verified BOOLEAN NOT NULL DEFAULT false` | a type mismatch, not a naming one — `fields` renames columns, it does not convert `DateTime?` to `Boolean` |
| **add** `app_user.image TEXT` | better-auth's `user.image`; nullable and unused until there are avatars |
| **keep** `app_user.email_verified_at` | the audit fact — *when*, which the boolean cannot answer. Written alongside the boolean by the hook in §4.5 |

`W2-T02` then owns: `expiresIn`/`updateAge` (`ADR-005` Q3 — *chosen*, not inherited from the 7-day
default), the cookie attributes, revoke endpoints, and the `/api/*` origin fix (`W0-T28`).

> **This reassignment contradicts `ADR-005`'s "What the `W2` tickets become" table.** It does not
> contradict any *decision* in that ADR — rules 1–6 are untouched. It is recorded here, in
> `TODO.md` §6 on both ticket lines, and in the run record, rather than left as a surprise for
> whoever picks up `W2-T02`.

### 4.2 Email is lowercased on the way in, and every lookup lowercases too

Two halves, because either alone is a hole.

**On write** — a `databaseHooks.user.create.before` hook lowercases and trims `email` before the row
is inserted. The stored value is therefore always already normalised, which means
`lower(email) = email` and the functional index is usable by an equality predicate.

**On read** — every sign-in, verification and reset lookup must normalise the *input* the same way.
better-auth's own docs do not document normalisation, so this is treated as absent until proven
present: the implementation wraps the Prisma adapter so that a `where` clause naming `email`
lowercases its value before it reaches Prisma.

**The test is the specification here** (§7 AC7): sign up as `Maria@Example.COM`, then sign in as
`maria@example.com`, and get the same `app_user.id`. If better-auth turns out to normalise already,
the wrapper becomes a redundant no-op and the test still passes — an assertion about behaviour
survives a library upgrade that an assertion about configuration does not.

**Not solved with `citext`.** It is a non-core extension, `W1-T05` already chose the functional
index, and changing that choice is a schema decision belonging to `agent-contracts`, not a thing to
slip into an auth ticket.

### 4.3 The bridge is ours, not the one in the docs

One catch-all Fastify route at `/api/auth/*`, `GET` and `POST`, converting Node → Web `Request`,
calling `auth.handler(req)`, converting `Response` → Fastify reply. Three deviations from
better-auth's published snippet, each for a reason:

1. **`response.headers.getSetCookie()`** for `Set-Cookie`, looped and appended individually;
   `headers.forEach` for everything else, with `set-cookie` skipped. §1.1c. A test asserts two
   cookies survive as two headers.
2. **The raw body, not `JSON.stringify(request.body)`.** The published snippet re-serialises
   whatever Fastify's content-type parser produced, which changes the bytes better-auth signs and
   validates. The route opts out of body parsing and forwards the buffer.
3. **No `fastifyCors`.** The published snippet registers permissive CORS with `credentials: true`.
   `ADR-005` rule 5 chose a single origin precisely so that is unnecessary, and a credentialed CORS
   allowance is a thing that gets widened once and never narrowed. Local development gets the same
   shape as production via §4.7.

### 4.4 Two dialects, one carve-out — stated, not discovered

`/api/auth/*` answers in better-auth's error shape. Everything else answers in `W1-T01`'s envelope.

**The alternative was translating better-auth's errors into the frozen envelope, and it is worse.**
The envelope's `details` are typed *per code* (`W1-T01` §4.5), so a translation layer must either
invent a code per better-auth failure — a registry that drifts on every library upgrade, in the
slice where an upgrade is most sensitive — or collapse them all into one code and throw away the
distinction between "wrong password" and "account locked", which is exactly what `W2-T07`'s lockout
work will need.

So: **`/api/auth/*` is a documented carve-out from the error envelope.** It is asserted, not
assumed — a test pins that the carve-out is exactly that prefix and no other route escapes the
envelope (AC12), so the day someone mounts a second library the gate notices.

`W1-T03`/`W1-T04` (OpenAPI generation and the contract-test harness) are both unstarted, so nothing
today would catch this drifting. Recorded in §10 Q4.

### 4.5 The two refusals better-auth cannot make

Neither `deletedAt` nor `status` exists in better-auth's model. Both guards are ours, in a
`databaseHooks.session.create.before` hook — *session creation*, not sign-in, because that is the
single choke point every present and future credential type passes through. Google sign-in
(`ADR-005` rule 6) inherits the guard for free; a guard on the password path would not.

| condition | result |
|---|---|
| `deletedAt IS NOT NULL` | refuse. The account does not exist, as far as authentication is concerned |
| `status = 'DELETED'` | refuse |
| `status = 'SUSPENDED'` | refuse — §10 Q1 records that this is a *decision*, not an inevitability |
| `status = 'ACTIVE'` | allow |

Both refusals return the **same** response as a wrong password (§6). A distinct "this account is
suspended" answer is an oracle that tells an attacker which addresses are real and which are worth
pursuing.

The same hook writes `email_verified_at` when `email_verified` flips true, keeping the audit fact
and the boolean in step (§4.1).

### 4.6 Verification is required to sign in

`emailAndPassword.requireEmailVerification: true`.

The case against: it adds a step before a cold-start marketplace's scarce supply side reaches value,
and `R3` is about exactly that friction. The case for, which wins: an unverified address on a
marketplace is a provider who never receives a lead and a client a provider cannot reach, and the
failure is silent on both sides. Mailpit makes it free to test locally, and `OPS-14` makes it work
in production.

**This is reversible in one line** and is flagged as such in §10 Q2, because it is a conversion
decision and conversion decisions belong to the operator, not to this spec.

### 4.7 Local development gets production's shape

The web dev server is `localhost:5173`; the API is `localhost:3000`. Today nothing bridges them —
`apps/web/src/shared/api.ts` defaults `baseUrl()` to `/` and there is no Vite proxy, which has been
invisible while every page ran on MSW.

Adding a Vite `server.proxy` entry for `/api` → `http://127.0.0.1:3000` is the local mirror of what
`W0-T28` does in preview and production. The alternative — CORS with credentials in development
only — means the one environment where auth is developed is the one environment whose cookie
behaviour does not match any deployed one.

### 4.8 Configuration

Every variable through `config.ts`. A module reaching for `process.env` directly is a review failure
and the existing file says so.

| variable | shape | note |
|---|---|---|
| `BETTER_AUTH_SECRET` | `z.string().min(32)` | **required, no default.** A defaulted auth secret that reaches production is the whole security model gone. `loadConfig` reports every problem at once, so a fresh clone learns about it in one boot |
| `BETTER_AUTH_URL` | `z.url()` | the origin better-auth builds links against — the verification and reset emails contain it |
| `MAIL_SMTP_HOST` / `MAIL_SMTP_PORT` | host + port | Mailpit locally (already in `docker-compose.yml`, SMTP `1025`, UI `8025`); `OPS-14` replaces the values, not the code |
| `MAIL_FROM` | `z.email()` | |

`telemetry: { enabled: false }` is set **explicitly**, even though better-auth defaults it off.
`ADR-005`'s premise is that nothing about a user leaves the EU or the connection string; a default
is a thing that changes in a minor release, and an explicit `false` is a thing a reviewer can see.
AC14 asserts it.

---

## 5. Permissions matrix

| actor | sign-up | sign-in | verify email | request reset | set new password |
|---|---|---|---|---|---|
| anonymous | ✅ | ✅ | ✅ (token) | ✅ | ✅ (token) |
| authenticated `ACTIVE` | ✅ (creates a second account) | ✅ | ✅ | ✅ | ✅ |
| `SUSPENDED` | n/a | ❌ §4.5 | ✅ | ✅ | ✅ — the password may be set; sign-in still refuses |
| soft-deleted | n/a | ❌ §4.5 | ❌ | ❌ | ❌ |
| `ADMIN` | — | — | — | — | — |

`ADMIN` has no special powers *here*. Impersonation is `BD-11` and route guards are `W2-T03`; an
admin capability invented in this ticket is a capability with no test describing who may use it.

---

## 6. Error cases

| case | response | why |
|---|---|---|
| sign-in, no such email | generic "invalid credentials" | enumeration |
| sign-in, wrong password | **byte-identical** to the above | enumeration |
| sign-in, suspended | **byte-identical** to the above | §4.5 |
| sign-in, soft-deleted | **byte-identical** to the above | §4.5 |
| sign-in, unverified | a *distinct* answer naming verification | the address is already known to whoever owns it; the alternative is a user who cannot tell "I am locked out" from "check your inbox" |
| reset requested, no such email | **success** | enumeration. No email is sent |
| verification token reused | refused | single-use (§8.3) |
| verification token expired | refused, with an offer to resend | |
| password below `minPasswordLength` | validation error naming the rule | |
| SMTP unreachable | sign-up **fails**, the `app_user` row is rolled back | a registered account whose verification email never sent is an account nobody can use and nobody can re-register — §10 Q3 |

---

## 7. Acceptance criteria

**Schema**

- **AC1** Migration `0007_auth_tables` creates `session`, `account` and `verification`; `pnpm db:migrate:status` is clean afterwards.
- **AC2** Migration `0008_app_user_auth_fields` drops `password_hash` and adds `name`, `email_verified`, `image`.
- **AC3** `email_verified_at` still exists and is still `timestamptz(3)`.
- **AC4** `prisma/schema.prisma` and the migrations agree — `prisma migrate diff` reports no drift.

**Mapping**

- **AC5** better-auth writes to `app_user`, not to a table called `user` — asserted by reading the row back through Prisma, not by reading the config.
- **AC6** An id created by sign-up is a database-generated uuid (`generateId: false`), not a base62 string.
- **AC7** Signing up as `Maria@Example.COM` and signing in as `maria@example.com` yields the same `app_user.id`. §4.2.
- **AC8** A second sign-up differing only in case is rejected as a duplicate, not accepted as a second account.
- **AC9** `roles`, `status`, `locale` and `deletedAt` are readable through better-auth's user object (`additionalFields`), with `roles` defaulting to `[CLIENT]`.

**Flows**

- **AC10** Sign-up creates an `app_user` row **and** an `account` row; `app_user` has no password column to write to.
- **AC11** Sign-up sends a verification email; the message is retrievable from Mailpit's API in the test, and the link in it verifies the account.
- **AC12** Every route outside `/api/auth/*` still answers in `W1-T01`'s envelope — including 404 and 500. The carve-out is exactly that prefix.
- **AC13** A password reset link works once; the second use is refused.

**Guards** — each proven with a red probe before the guard exists (§5.3):

- **AC14** `telemetry.enabled` is `false` and set explicitly in the config object.
- **AC15** A soft-deleted user cannot sign in, and the response is byte-identical to a wrong-password response.
- **AC16** A `SUSPENDED` user cannot sign in, byte-identical likewise.
- **AC17** An `ACTIVE`, verified user *can* — so AC15/AC16 are proving a guard, not a broken path.
- **AC18** Two `Set-Cookie` headers in one better-auth response arrive as two headers, not one comma-joined value. §4.3.
- **AC19** `BETTER_AUTH_SECRET` shorter than 32 characters, or absent, fails `loadConfig` with a message naming the variable.
- **AC20** No module outside `config.ts` reads `process.env` for an auth variable — a source assertion, because this is the rule `config.ts` already states and nothing currently enforces.
- **AC21** Requesting a reset for an unknown address returns success and sends no mail.

**Shape**

- **AC22** `better-auth` is pinned **exactly** (`1.7.4`, no `^`) — `ADR-005`: "treat an upgrade as a reviewed change rather than a lockfile bump".
- **AC23** `/api/auth/*` does not appear in `apps/web`'s MSW handlers. The auth path is real from day one; mocking it would reproduce the facade this ticket exists to remove.
- **AC24** The Vite dev proxy routes `/api` to the API (§4.7), asserted from `vite.config.ts`.

---

## 8. Data

### 8.1 Tables

`session`, `account`, `verification` as better-auth defines them, in **our** migrations
(`ADR-005`: "keep the `account`/`session` tables in our own migrations so an exit is a data problem
we can already see"). Snake-cased to match the repo, mapped with `@@map`/`@map`.

### 8.2 What is in `account`

One row per credential. For email+password: `providerId = 'credential'`, the hash in `password`.
For Google later: `providerId = 'google'`, tokens, no password. Same table, no migration —
`ADR-005` rule 2's whole point.

### 8.3 Token lifetimes

| token | TTL | single use |
|---|---|---|
| email verification | 1 hour | yes |
| password reset | 1 hour | yes |

Both are better-auth defaults and both are deliberate here rather than inherited: an hour is long
enough for an email to arrive and short enough that a forwarded message is not a standing key.
Session lifetime is **not** set in this ticket — it is `ADR-005` Q3 and belongs to `W2-T02`.

### 8.4 Seed

`prisma/seed.ts` gains a verified `ACTIVE` client and a verified `ACTIVE` provider with known
passwords, so that a developer can log in without registering, and so `W4`'s job-posting work has an
actor the day it starts.

---

## 9. Out of scope

- **The login/signup pages.** `ADR-011` §1. `W2` owns them as its own frontend ticket.
- **Session policy** — lifetime, rotation, revoke. `W2-T02`, per §4.1.
- **Roles and route guards, and every 403.** `W2-T03`. `roles` is readable here; nothing reads it.
- **Google sign-in.** `ADR-005` rule 6 — second, not instead.
- **Rate limiting and lockout.** `W2-T07`. better-auth's defaults are active but unconfigured and
  unasserted; configuring them without a spec is how a limit gets picked by accident.
- **Audit records for auth events.** `W2-T07`, through `W1-T07`'s helper.
- **Phone verification.** `W2-T06`, and it needs an SMS account (`OPS-15`).
- **GDPR export/erasure.** `W2-T08`, blocked on a retention decision.
- **The provider MANITAS/PRO split at signup.** `ADR-005` Q1 — a product decision, `W2-T05`.
- **`OPS-14`.** Mailpit covers building and testing this; a real sender blocks shipping it.

---

## 10. Open questions

### Q1 — should `SUSPENDED` block sign-in, or only block acting?

§4.5 says block. The argument for: suspension that still lets you in is suspension a user has to
discover by failing at something, and `ADR-005` rule 3 chose immediate revocation precisely so a
suspended provider stops being one *now*.

The argument against, which is real: a suspended provider who cannot sign in also cannot read why
they were suspended, cannot export their data, and cannot appeal — and the back-office (`W9`) will
eventually want to show them exactly that. The kinder design is sign-in permitted into a
restricted shell.

**Blocking on nothing today** — `W2-T03` is where "may act" becomes enforceable per route, and this
can be revisited there without a migration. Flagged now because the decision is easier to change
before there are suspended users than after.

### Q2 — `requireEmailVerification`, and what it costs on the supply side

§4.6 turns it on. It is one line to turn off. The trade is real friction against silently
unreachable accounts, and `R3` says friction on the supply side is the expensive kind. **Operator
decision**; the default chosen here is the safe one rather than the converting one.

### Q3 — SMTP failure rolls back the sign-up. Is that right?

§6 says a sign-up whose verification email cannot be sent fails entirely. The alternative — create
the account, queue the email, let the user retry — is better for the user and needs a queue,
retries, and a way to re-send, none of which exist. Rolling back is the honest behaviour available
today. It means a Mailpit outage in development looks like a broken sign-up, which is at least loud.

Revisit when there is a job runner. Not before.

### Q4 — nothing would notice if the API drifted from the contracts

`W1-T03` (zod → OpenAPI, typed client) and `W1-T04` (the contract-test harness that spins the API
and asserts every route matches) are both unstarted. Today the MSW handlers are hand-written to
match `packages/contracts` and the API implements nothing, so there is no drift to detect. **The
moment `W3-T05` lands a real `GET /search`, there is.** This ticket adds the first real routes and
therefore the first opportunity; it does not add the detector.

Raised here rather than in `W3-T05` because the cheapest moment to build the harness is before two
slices have written routes by hand, not after.

### Q5 — a dependency in the highest-blast-radius slice, and how we would know it went bad

`ADR-005` asks for an exact pin and reviewed upgrades (AC22). That covers *deliberate* change. It
does not cover a transitive change: `better-auth` pulls `@noble/hashes`, `jose`, `better-call` and
eleven more, and the lockfile pins them but nothing watches them. There is no dependency-audit gate
in `ci.yml`.

Not this ticket's job to build one. Naming it so it is a known gap rather than an assumed absence —
and `W0` is where it would go.
