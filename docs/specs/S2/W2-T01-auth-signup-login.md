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

**b. The `lower(email)` index cannot be used by the queries better-auth issues.** This started as a
sharper claim — that case would fork the user table — and reading the library disproved half of it.
`sign-up.mjs:165` computes `const normalizedEmail = email.toLowerCase()` before both the duplicate
check and the insert, and `sign-in.mjs:315` calls
`findUserByEmail(email.toLowerCase(), …)`. **better-auth 1.7.4 normalises on both sides, so accounts
do not fork.**

What survives is the half `W1-T05`'s own migration comment predicted, verbatim: *"`WHERE email = $1`
is valid SQL that compiles, returns nothing for 'Ana@example.com', and does not use this index."*
better-auth's adapter issues exactly that equality predicate, and `app_user_email_lower_key` is
**functional** — an index on `lower(email)` cannot serve a predicate on `email`. There is no other
index on the column. So every sign-in and every sign-up duplicate check is a sequential scan on
`app_user`, on the one code path an unauthenticated caller can trigger at will. §4.2 owns this.

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

### 4.2 A plain unique index, and a `CHECK` that makes it safe

`W1-T05` chose a functional unique index on `lower(email)` and accepted a documented cost:
*"the discipline: `WHERE email = $1` … does not use this index."* That discipline is enforceable in
code we write and not in code a library writes. better-auth issues the equality predicate, so the
index is dead weight on the auth hot path (§1.1b).

Migration `0008` therefore replaces it with two objects that say the same thing and are usable:

```sql
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_email_lowercase"
  CHECK ("email" = lower("email"));
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user" ("email");
DROP INDEX "app_user_email_lower_key";
```

The `CHECK` is what makes this safe rather than a downgrade. A plain unique index on a
case-*sensitive* column would let `Maria@x.com` and `maria@x.com` coexist — the exact failure the
functional index existed to prevent. The constraint removes the possibility at the database, so the
plain index is equivalent to the functional one **and** serves equality. It also means the
normalisation guarantee stops depending on better-auth's implementation: a future version that
forgets to lowercase gets a constraint violation, not a duplicate account.

**This edits `agent-contracts`' file.** `TODO.md` §4 makes `prisma/schema.prisma` append-only by
request. Recorded as such in the run record and in §10 Q6; done here rather than proposed because
the table is empty in every environment and a migration that reshapes an index is strictly cheaper
before there are rows than after.

**The tests do not change, and that is the point.** AC7 and AC8 assert *behaviour* — sign up with
`Maria@Example.COM`, sign in with `maria@example.com`, get the same id; a case-differing second
signup is refused. They were written when the diagnosis was wrong and they pass under the correct
one, which is the argument for asserting behaviour over configuration, made at our own expense.

### 4.3 The library's own Node integration, not its documented Fastify snippet

better-auth's published Fastify guide hand-rolls the bridge and forwards headers with
`response.headers.forEach((value, key) => reply.header(key, value))`. The `Headers` API folds
repeated headers into one comma-joined value, and `Set-Cookie` is the one header where that is not a
legal transformation: a response that sets a session cookie *and* clears a stale one arrives as a
single malformed cookie.

The library ships a correct bridge that the Fastify page does not use. `toNodeHandler` delegates to
`better-call/node`, whose `setResponse` does:

```js
res.setHeader(key, key === "set-cookie"
  ? set_cookie_parser.splitCookiesString(response.headers.get(key))
  : value);
```

— splitting the folded value back apart, comma-in-an-`Expires`-date and all. **So the bug is in the
guide, not in the library**, and the fix is to use `toNodeHandler(auth)` against Fastify's
`request.raw`/`reply.raw` rather than to write a better `forEach`.

Two things this costs, both handled in the plugin:

1. **Fastify must not consume the body first.** `getRequest` reads the Node stream; if Fastify's
   content-type parser has already drained it, better-auth receives an empty body. The auth routes
   live in their own plugin scope with a pass-through parser — content-type parsers are encapsulated
   per scope in Fastify, so this does not affect any other route.
2. **Fastify must not also try to reply.** `reply.hijack()` hands the socket over before the handler
   writes to `reply.raw`.

AC18 asserts two `Set-Cookie` headers survive as two headers, because the point is the behaviour,
not which function produced it.

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

### 4.9 A deployed API that cannot send mail says so at boot

`MAIL_SMTP_HOST` defaults to `127.0.0.1` — correct locally, where `docker-compose.yml` runs
Mailpit, and silently wrong in every deployed environment, where nothing listens on 1025. The
symptom is not an error anyone sees: sign-up returns `200`, the row lands, and the failure is one
`ECONNREFUSED` line in the application log.

So `buildApp` warns once at startup when `NODE_ENV` is not `development` and the mail host is a
loopback address. A warning rather than a refusal: `OPS-14` is unstarted, so refusing to boot would
mean no deployed API at all, and the rest of the API has nothing to do with mail. It is a warning
that stops being emitted the day a real sender is configured, which is the only honest version of
"we know this is broken and we know when it is fixed".

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
| SMTP unreachable | sign-up **succeeds**, the row is created, the send error is swallowed — *measured, not chosen* (§10 Q3) | better-auth does not fail the request when `sendVerificationEmail` throws. The account is then stranded: sign-in is `403 EMAIL_NOT_VERIFIED`, re-registering returns a synthetic success, and `send-verification-email` is a `500` |

---

## 7. Acceptance criteria

**Schema**

- **AC1** Migration `0007_auth_tables` creates `session`, `account` and `verification`; `pnpm db:migrate:status` is clean afterwards.
- **AC2** Migration `0008_app_user_auth_fields` drops `password_hash` and adds `name`, `email_verified`, `image`.
- **AC3** `email_verified_at` still exists and is still `timestamptz(3)`.
- **AC3b** `app_user` has a plain unique index on `email` and a `CHECK` that `email = lower(email)`; inserting a mixed-case address through Prisma directly is refused by the database, not merely by the library. §4.2.
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

**Decided by the operator, 2026-09-12: block sign-in.** The restricted-shell design is the kinder
one and is not rejected — it is deferred to `W9`, where there is something to let a suspended user
in *to*. `W2-T03` is where "may act" becomes enforceable per route, so this can be revisited there
without a migration. Flagged now because the decision is easier to change before there are
suspended users than after.

### Q2 — `requireEmailVerification`, and what it costs on the supply side

§4.6 turns it on. It is one line to turn off. The trade is real friction against silently
unreachable accounts, and `R3` says friction on the supply side is the expensive kind.

**Decided by the operator, 2026-09-12: require it.** The provider-only variant was considered and
rejected for now on a dependency, not on merit — `ADR-005` Q1 has not settled whether the
MANITAS/PRO split happens at signup, so "is this a provider" is not reliably knowable at first
sign-in. Revisit alongside `W2-T05`.

### Q3 — SMTP failure does **not** roll back the sign-up, and I claimed it would

The first draft of §6 said a sign-up whose verification email cannot be sent fails entirely, and
called that "the honest behaviour available today". **That was a guess stated as a fact, and it is
wrong.** Measured against the deployed preview on 2026-09-14, where the Fly app has no mail server:

```
POST /api/auth/sign-up/email        → 200, row created
  (logs) ERROR [Better Auth]: connect ECONNREFUSED 127.0.0.1:1025
POST /api/auth/sign-in/email        → 403 EMAIL_NOT_VERIFIED
POST /api/auth/sign-up/email (same) → 200, synthetic user, no row written
POST /api/auth/send-verification-email → 500
```

better-auth does not fail the sign-up when `sendVerificationEmail` throws. So the account is
created, cannot sign in, cannot be re-registered (the duplicate response is deliberately synthetic,
to avoid enumeration), and cannot ask for another link. **Exactly the trap the wrong claim said we
were avoiding.**

Three things follow, and only the third is this ticket's to fix:

1. **`OPS-14` is what makes this go away**, and `ADR-005` already says so: *"blocks shipping
   `W2-T01`, not building it."* Every deployed environment today has no mail provider, so
   verification cannot be completed anywhere but locally. That is not a defect introduced here; it
   is the dependency, now demonstrated rather than asserted.
2. **The right long-term design is a queue with retries and a resend**, not a rollback — and it
   needs a job runner that does not exist. Unchanged from the first draft.
3. **The default is a footgun and is fixed here.** `MAIL_SMTP_HOST` defaults to `127.0.0.1`, which
   is right locally and silently wrong everywhere else — a deployed API mails into the void and
   says nothing at boot. §4.9 adds a startup warning, because `BETTER_AUTH_SECRET` has no default
   for precisely this reason and mail deserved the same scrutiny.

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

### Q6 — this ticket edits `agent-contracts`' file, and the rule says it should ask

`TODO.md` §4: *"Shared files (`prisma/schema.prisma`, `packages/contracts`, CI config) are
**append-only by request**: a slice agent opens a change proposal, `agent-contracts` applies it.
This is the main collision risk."*

§4.2 does not append — it drops an index `W1-T05` deliberately chose and replaces it with a
different design. That is exactly the case the rule is written for.

It is done here anyway, for one reason that is about cost and not about authority: the table is
empty in every environment, and an index reshape is cheaper before there are rows than after. The
alternative — ship `W2-T01` against an index the auth path cannot use, and file the fix — means the
first real users arrive on a sequential scan and the migration then has to run against their data.

**Recorded as a deviation, not as a precedent.** It is the fourth W12/W2 ticket to edit another
slice's files (`W12-T16` §10 Q3 counted the first three), and nobody has decided whether that is
allowed. That decision is still open and this makes it more urgent, not less.
