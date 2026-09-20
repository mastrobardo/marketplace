# W2-T03 — Roles, permissions and route guards

- **Slice**: S2 Identity (`agent-identity`)
- **Decides**: what an authenticated request *is* inside `apps/api`, where the permissions matrix
  lives, and what a refusal looks like on the wire — 401 and 403 as two different answers.
- **Depends on**: `W2-T01` (better-auth mounted, `roles`/`status`/`deletedAt` mapped),
  `W1-T01` (the error envelope, which already registers both codes).
- **First consumer**: `W3-T02`. Nothing in this ticket changes an existing route.
- **Contract**: none. `ERROR_CODES` already carries `UNAUTHENTICATED` and `FORBIDDEN`, so
  `packages/contracts/**` and `schema.prisma` are untouched — both are forbidden to this slice and
  neither is needed.

---

## 1. Purpose

**Every route in `apps/api` is public.** `/health`, `GET /api/search`, `GET /api/providers/:id` —
and that is correct, because each of them is meant to be. But the next ticket in the backlog is a
*write*: `W3-T02` lets a provider edit their own profile, and there is nothing in the API that can
answer the question "who is asking". `getSession` appears exactly once in `apps/api/src`, inside
better-auth's own configuration.

So the first authenticated write would have to invent its guard. That is the failure this ticket
exists to prevent: a guard written inside a domain module is a guard written once per module, and
the fifth copy is the one that reads `roles` with `includes` on a string, or answers `404` where it
meant `403`, or trusts a session payload that a suspended user is still holding. `ADR-005` already
says whose job this is — *"`roles` is our column, so the permissions matrix and every 403 test are
domain code, not library configuration"* — and the charter states the standard: **every deny in the
matrix has a test.**

What this buys, concretely: `W3-T02` adds one row to a table and one `preHandler` to a route.

### 1.1 What this is not

It is not revocation (`W2-T02`: revoke-as-a-delete, and the sliding-expiry policy). It is not rate
limiting or the audit log (`W2-T07`). It is not the provider signup fork (`W2-T05`), so this ticket
does not make anybody a `PROVIDER` who is not one already. It is not storefront role gating —
`AuthWall` (`W12-T12`) is the browser's half and stays as it is. And it adds **no product route**:
the guard's proof is a probe route registered by the tests, plus `W3-T02` landing on it next.

## 2. User stories

- As a **provider**, I want a request carrying my session to be recognised as mine, so that I can
  change my own profile and nobody else's.
- As a **client**, I want the API to refuse me an operation my role does not have, so that a bug in
  a page cannot make me do something the product never offered me.
- As a **suspended user**, I want my access to stop when I am suspended rather than when my cookie
  expires — stated from the platform's side: suspension has to mean *now* (`ADR-005` rule 3).
- As an **admin**, I want my role to grant exactly what it is listed for, so that a back-office
  account cannot quietly acquire a money permission by being "the admin".
- As an **agent building a slice**, I want one place to read to know who may call my route, so that
  the answer to "can a client do this?" is a table rather than five `if` statements.

## 3. Design

### 3.1 Two files, in `modules/auth/`

`apps/api/src/modules/auth/permissions.ts` — the matrix and the pure predicate over it.
`apps/api/src/modules/auth/guard.ts` — the Fastify `preHandler`s that apply it.

Not `plugins/auth.ts`. That file mounts better-auth and is a documented carve-out *from* the error
envelope (`app.ts:110`, `W2-T01` §4.4): everything under `/api/auth/*` answers in the library's own
error shape. The guard is the opposite kind of thing — it is what puts a refusal *into* `W1-T01`'s
envelope on an ordinary domain route — and the two do not belong in one file merely because both
say "auth". `modules/{auth,users}/**` is this slice's own glob (`agents/roles/agent-identity.md`).

### 3.2 The guard depends on a port, not on better-auth

```ts
export type Principal = { userId: string; roles: UserRole[]; sessionId: string };
export type ResolveSession = (headers: IncomingHttpHeaders) => Promise<Principal | null>;
```

`buildGuards({ resolveSession })` returns `{ requireSession, requirePermission }`. The adapter —
`buildSessionResolver({ auth, prisma })`, a separate function in the same module — is the only thing
in the guard that knows better-auth or Postgres exists. It is also where §3.3's liveness filter
lives, so the rule that account state never becomes a value is enforced in one function rather than
remembered at every call site.

This is the split `W3-T05` laid down and `W3-T07` copied — `routes.ts` testable without a database,
`repository.ts` testable without an HTTP server — applied to the third boundary. Every 401/403
criterion in §7 is then a boundary test with a stub resolver: no Postgres, no cookie jar, no
sign-in round trip, and a matrix-driven test can enumerate *every* role × permission pair in
milliseconds. The live suite still signs in for real (§7 AC8–AC10); it is proving the adapter, not
the matrix.

**One resolution per request.** `requirePermission` does not chain `requireSession`; it resolves
once, stores the principal on the request, and a second guard on the same request reuses it. With
`cookieCache` disabled every resolution is a database round trip, so this is a property worth
asserting rather than assuming (AC14).

### 3.3 Liveness is a filter, not a field — operator's rule, 2026-09-18

A suspended, blocked or deleted user resolves to **nothing**: not a principal carrying a flag, not a
`deletedAt` the guard then remembers to check. *"A suspended/blocked/deleted user should return no
data. Not even `deletedAt`."*

So the adapter does not read account state at all. It authenticates with `auth.api.getSession` —
which owns the cookie's signature and the session row — and then establishes liveness with one
Prisma read whose `where` does the work:

```ts
const user = await prisma.user.findFirst({
  where: { id: session.user.id, status: 'ACTIVE', deletedAt: null },
  select: { id: true, roles: true },
});
if (user === null) return null; // 401, identical to no cookie at all
```

The state is in the predicate, so it never becomes a value: there is no `status` variable to log, no
`deletedAt` to put on the principal, and no branch anywhere downstream that could answer differently
for a suspended user than for an absent one. `Principal` is `{ userId, roles, sessionId }` and **may
never gain an account-state field** (AC4).

This also removes a dependency on library behaviour. `roles`, `status` and `deletedAt` are declared
as `additionalFields` (`auth/auth.ts:100`), and whether better-auth's *read* path returns them is a
property of the version we happen to be on; whether Postgres applied a `WHERE` is not. The red phase
still records what `getSession` returns, because `W2-T02` will want to know — the guard just does not
rest on it.

The cost is one extra statement per authenticated request: a primary-key read of a row better-auth
has just touched. That is the trade, stated rather than discovered — revisit only with a measured
problem, and the fix then is one raw statement joining `session` to `app_user`, not a cached flag.

**Why this is effective at all**: `cookieCache` is off (`auth/auth.ts:126`, `ADR-005` rule 4), so
there is a database round trip on every authenticated request either way and the liveness read sees
the row as it is *now*. A suspension takes effect on the next request, not when a cookie expires.

This does not flip `auth.test.ts:320`, and must not. That test pins better-auth's *own*
`get-session` still answering a suspended user's live cookie, and names `W2-T02` as the ticket that
changes it; deleting the session row is still `W2-T02`'s. What changes here is narrower and is what
the product actually needs first: **a suspended user can hold a cookie and still do nothing.**

Why `401` and not `403` (operator, 2026-09-18: *"401 should be"*): a `403` says "you, specifically,
may not" — an answer about the principal, and a principal is what a suspended account no longer
supplies. It is also the answer that leaks least. `403 ACCOUNT_SUSPENDED` would be a state oracle on
every route, in the slice whose non-negotiable is that "unknown email" and "wrong password" are
indistinguishable.

### 3.4 401 and 403 are different answers, and neither is 404

| Situation | Answer |
|---|---|
| No session cookie | `401 UNAUTHENTICATED` |
| A cookie for a session that does not exist, or has expired | `401 UNAUTHENTICATED` |
| A valid session whose user is `SUSPENDED` or soft-deleted | `401 UNAUTHENTICATED` |
| A valid principal whose roles do not carry the permission | `403 FORBIDDEN` |

The first three are byte-identical. The fourth is deliberately different: "sign in" and "you cannot
do this" send a person to two different places, and collapsing them produces the sign-in loop where
an already-signed-in user is asked to sign in again, forever.

Both codes are `withoutDetails` in the registry (`errors.ts:84`), so neither carries a `details` bag
naming a role or a permission. The *message* is generic for the same reason.

**And neither is `404`.** Hiding a route behind a 404 is a real technique, and it is the wrong one
here: it is for resources whose *existence* is a secret, and `PUT /api/providers/me` has no secret
existence. Where a route addresses somebody else's resource by id, the ticket that builds it owns
that choice — §3.6.

### 3.5 The matrix, and how it is allowed to grow

```ts
export const PERMISSIONS = {
  'provider-profile:update-own': ['PROVIDER'],
} as const satisfies Record<string, readonly UserRole[]>;
```

A permission is a **domain operation**, not a route: `provider-profile:update-own`, not
`PUT /api/providers/me`. Routes move (`/providers/:id` was nearly `/professionals/:slug`); the
operation does not, and a matrix keyed by URL is a matrix that has to be re-read every time a path
changes.

It ships with one row, because one row has a consumer. **The growth rule is the deliverable, not
the table**: a permission enters `PERMISSIONS` in the same pull request as the route that guards
with it. The alternative — pre-populating rows for `W3-T03`, `W3-T09`, `W4`, `W5` — is a registry
whose cells nothing enforces, and `contracts/provider.ts` already states the equivalent rule for
columns (*"inventing fields for them here is how a schema acquires a column nothing ever writes
to"*). A row with no route is a permission that is allowed and denied by nobody.

A slice adding its own row edits this file, which it does not own. That is a reviewed edit with
`agent-identity` added as a reviewer, and it is deliberately the only way: one table that every
agent can read beats five correct guards nobody can enumerate.

**`ADMIN` is not implicit** (operator, 2026-09-18). There is no superuser branch; `ADMIN` is
allowed exactly the permissions that list it, which today is none. A blanket admin bypass is how a
back-office role acquires a refund permission without anyone deciding it should, and `agent-admin`'s
slice is where that decision belongs — one row at a time, each with a test (AC7).

**Which is only acceptable because an explicit grant works, so §3.5.1 says where the money ones
go.** The operator's condition on approving this: *"either a super admin or a way to actually have
money permissions is required: someone should be able to look into transactions."*

### 3.5.1 The money permissions, and the role they must not attach to

There are no transactions to look into today — no `Booking`, `Payment` or ledger model exists
(`schema.prisma` ends at `AuditRecord`), `W5-T10` is the ledger table and `OPS-13` has not happened.
So this ticket cannot ship the view, and inventing `ledger:read` here would be exactly the cell that
enforces nothing. What it ships instead is the guarantee that the mechanism is ready and a rule that
constrains who gets it:

> **Money permissions never attach to the role moderation uses.** `W9-T04` hands `ADMIN` to content
> moderators; `W9-T03` and `W9-T05` read refunds and GMV. The day those are the same role, one grant
> is every power, and the audit trail `W9-T01` builds cannot tell a moderator from a treasurer.

The concrete consequence, recorded in `memory/repo/decisions.md` in this PR and carried onto
`W9-T01`'s backlog line: the transactions view arrives with **its own role** — an additive
`UserRole` enum member, a cheap migration `agent-contracts` makes — rather than by widening `ADMIN`.
Deferred rather than decided now because the split only becomes real when there is money to see, and
because a role added before its first route is the same empty cell as a permission added before its
first route.

That the mechanism itself works — an explicitly granted permission passes for `ADMIN` — is asserted
here, over a fixture matrix rather than the product one (AC15), so the proof does not require a
product permission nothing consumes.

**Roles are a set.** `app_user.roles` is `UserRole[]` and the seeded provider is
`['CLIENT','PROVIDER']`. `can()` is an intersection test, never `roles[0]` (AC10) — the charter's
slice rule, and retrofitting it later breaks every guard.

### 3.5.2 `MANITAS` and `PRO` are a kind, not a role — and a trade is neither

Providers come in two main types, *manitas* and *profesionales*, and more subtypes are coming
(electricista, fontanero, …). None of them is a `UserRole`, and the matrix must not grow a column
for any of them.

| Distinction | Where it lives | Why not a role |
|---|---|---|
| manitas vs profesional | `ProviderProfile.kind` (`schema.prisma:58`) | It is a property of the *profile*, not of the person asking. A user can be `['CLIENT','PROVIDER']` and the kind is still a column the guard has not read. |
| electricista, fontanero, … | the `Category` tree + `ProviderCategory` (`W3-T01`) | A trade is a many-to-many with a licence flag on it. A role per trade is a role explosion, and the day one is added the session carries a legal claim. |
| may work a gated category | `Certification` + `requiresLicence` (`W3-T08`, `BD-07`) | The legal boundary is a *verified document*, not a claim in a cookie. `agent-trust` owns it. |

So a rule the guard can state and every later ticket inherits: **the matrix keys on `UserRole` and
nothing else.** `PERMISSIONS` is `satisfies Record<string, readonly UserRole[]>`, so `'MANITAS'` in a
cell is a type error rather than a review comment (AC17).

Where a route genuinely must serve manitas and pros differently — `W2-T05`'s signup fork, `W3-T08`'s
licence gating — that check happens **after** the row is read, exactly like ownership (§3.6), and for
the same reason: the guard runs before any repository, and a permission that needs a database read
to evaluate is not a permission, it is a query.

**A divergence worth naming**, because a reader will hit it: `TODO.md` §3's domain sketch lists
`role(s) CLIENT | MANITAS | PRO | ADMIN` on `User`. The schema that shipped does not — `UserRole` is
`CLIENT | PROVIDER | ADMIN` (`schema.prisma:41`) and `ProviderKind` is a separate enum on the
profile. The schema is the artefact in force; `memory/repo/glossary.md` already states the
vocabulary rule (*"`provider` covers both manitas and pro"*), and `W3-T07` corrected the same class
of drift in its own charter. Fixing the sketch is `agent-contracts`' edit, noted as O3.

### 3.6 Ownership is not the guard's job, and `/me` is why

`provider-profile:update-own` says *own* in its name and the guard cannot check it: ownership is a
question about data, and the guard runs before any repository. The rule this ticket sets, for
`W3-T02` and everything after it:

> **Prefer `/me` addressing for own-scoped writes.** `PUT /api/providers/me` resolves the row *from*
> the principal, so there is no id to compare and no way to address somebody else's profile at all.
> Ownership becomes structural instead of checked.

Where a route genuinely must take an id it does not own the check is the route's, after it has the
row, and the answer is `403` if the resource's existence is already public (a provider profile is)
and `404` if it is not (a booking, a message thread). Stated here so that the two halves of the
decision live in one place; enforced by whichever ticket writes such a route.

**Amended 2026-09-20 by `W4-T02` — singular and plural take different spellings.** §3.7 below writes
both of them (`app.put('/providers/me')` and `app.get('/me/addresses')`) without naming the rule
that separates them, and `W4-T01` then picked the wrong half for a collection. The rule:

> A **singleton** the principal owns is `/<resource>/me` — the profile *is* the resource and `me`
> says which one. A **collection** the principal owns is `/me/<collection>` — `/me/jobs`,
> `/me/addresses`. `jobs` is not a job whose id is `me`.

Not style. `/jobs/me` shares a path space with `/jobs/:id`, so it survives only while the static
route is registered first — a fact `W3-T02` found the hard way and `W4-T01` had to carry a test for.
`/me/jobs` shares no path space with anything, so the hazard is absent rather than defended against.
`GET /api/jobs/me` moved to `GET /api/me/jobs` in `W4-T02` while it had no callers;
`PUT /api/providers/me` is the singleton half and does not move.

### 3.7 A build without `auth` has no guarded routes — it does not have open ones

`buildApp` takes `auth` as optional, so that `/health` and the boundary tests can build an app with
no database (`app.ts:30`). Guards are built from it when it is present and passed into route modules
the way `search` and `providers` repositories already are.

A route module that needs a guard is therefore registered **only when the guard exists**. An
unauthenticated build answers `404` on a private route; it never answers `200`. This is the one
place where fail-closed has to be structural — a guard that silently degrades to "no guard" when a
dependency is missing is the outage that looks like a successful deploy.

Two halves, asserted in two places. The *construction* half is enforced by types and holds today:
`buildSessionResolver` takes `auth` and `prisma`, `buildGuards` takes a resolver, and there is no
argument spelling that yields a guard which permits everything. The *registration* half needs a
private route to leave unregistered, so it is asserted by `W3-T02` alongside the route that first
needs it. What this ticket asserts instead is the runtime edge of the same rule: a resolver that
**throws** produces a `500`, never a pass (AC13).

## 4. API surface

No new endpoint, and no change to an existing one.

| Route | Before | After |
|---|---|---|
| `/health`, `/api/auth/*`, `GET /api/search`, `GET /api/providers/:id` | public | **unchanged, still public** (AC11) |

What ships is the mechanism two route modules will import:

```ts
app.put('/providers/me', { preHandler: guards.requirePermission('provider-profile:update-own') }, …)
app.get('/me/addresses',  { preHandler: guards.requireSession },                                  …)
```

and `request.auth: Principal` inside the handler, declared by module augmentation in `guard.ts`.

## 5. Permissions matrix

Rows are roles, columns are operations, and every `deny` cell is a test (AC6 enumerates the table
itself, so a row added later cannot arrive without its denies).

| Role | `provider-profile:update-own` |
|---|---|
| `CLIENT` | **deny** — being a customer is not being a provider |
| `PROVIDER` | **allow**, own row only (§3.6) |
| `ADMIN` | **deny** — no implicit superuser (§3.5); a back-office edit is `agent-admin`'s row to add |
| *no session* | **deny**, `401` — not a role |

`ADMIN` has no allow cell anywhere in this table, and that is the state the operator approved rather
than an oversight: the first one is added with the route that needs it, under §3.5.1's constraint.
AC15 proves an explicit grant works without inventing one here.

## 6. Error cases

| Code | HTTP | When | What the UI shows |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | no cookie; unknown or expired session; the user is `SUSPENDED` or soft-deleted | the sign-in door. `apps/web` already branches on status **and** code (`MEM-2026-09-14-2`) |
| `FORBIDDEN` | 403 | a valid principal whose roles lack the permission | "your account cannot do this" — never a sign-in prompt, never the reason |

Both answer in `W1-T01`'s envelope with the request id, never in better-auth's shape: the carve-out
is `/api/auth/*` and nothing else (`app.ts:110`, AC12). Neither carries `details`. The log line
carries the code; `cookie` is already redacted at the logger (`app.ts:59`) and AC12 pins that it
stays that way on the refusal path.

## 7. Acceptance criteria

1. **Given** a guarded probe route and a request with no cookie, **when** it is called, **then** the
   response is `401` with `code: 'UNAUTHENTICATED'`, carries the request id, has no `details`, and
   the handler never ran.
2. **Given** a cookie carrying a session token nobody has, **when** the same route is called,
   **then** the response is **byte-identical** to AC1's apart from the request id.
3. **Given** a principal whose roles carry the permission, **when** the route is called, **then** the
   handler runs and the response is the handler's own.
4. **Given** that handler, **when** it reads `request.auth`, **then** it is exactly
   `{ userId, roles, sessionId }` — no email, no session token, and **no `status` or `deletedAt`**
   (§3.3: account state is a filter, never a field).
5. **Given** a principal whose roles do not carry the permission, **when** the route is called,
   **then** the response is `403` with `code: 'FORBIDDEN'` and the handler never ran.
6. **Given** `PERMISSIONS`, **when** the suite enumerates every (role × permission) pair, **then**
   every pair the matrix denies answers `403` and every pair it allows answers `200` — the test
   iterates the table, so a permission added without a deny test cannot exist.
7. **Given** an `ADMIN` principal, **when** it calls a permission that does not list `ADMIN`,
   **then** the response is `403` — asserted separately from AC6 because it is a decision, not a
   cell.
8. **Given** a user signed in for real against Postgres, **when** their row is set to `SUSPENDED`
   and the *same* cookie is replayed, **then** the guarded route answers `401` — and
   `auth.test.ts:320`'s assertion about better-auth's own `get-session` is unchanged. *(live)*
9. **Given** the same, **when** the row is soft-deleted (`deletedAt`), **then** the guarded route
   answers `401`. *(live)*
10. **Given** the seeded `['CLIENT','PROVIDER']` user, **when** they call a `PROVIDER`-only
    permission, **then** it is allowed — roles are a set. *(live)*
11. **Given** `GET /api/search` and `GET /api/providers/:id`, **when** they are called with no
    cookie, **then** they answer exactly as they do today.
12. **Given** a `401` and a `403` from a guarded route, **when** the response and the log line are
    inspected, **then** both bodies are `W1-T01` envelopes (not better-auth's shape) and no log
    line contains the cookie header.
13. **Given** a guard whose `resolveSession` **throws** — an unreachable session backend, a
    misconfigured adapter — **when** the route is called, **then** the answer is `500
    INTERNAL_ERROR` in the envelope and the handler never ran. A guard that fails is a closed door,
    never an open one. *(The composition half of §3.7 — a private route not registered at all when
    `auth` is absent — is asserted by `W3-T02`, in the PR that adds the first such route: there is
    no private route here to leave unregistered.)*
14. **Given** a route carrying two guards, **when** it is called, **then** `resolveSession` is
    invoked **once** (asserted by counting calls on the stub).
15. **Given** a *fixture* matrix granting a permission to `ADMIN`, **when** an `ADMIN` principal
    calls it, **then** it is allowed — an explicit grant works, which is what the transactions view
    will use (§3.5.1). Asserted over a fixture, so no product permission is invented for it.
16. **Given** the adapter and a signed-in user, **when** the user's row is suspended, **then** the
    liveness read returns no row and the adapter returns `null` **without** the suspended state
    reaching the caller — asserted by the resolver's return value being `null`, identical to the
    unknown-session case, not an object carrying a reason. *(live)*
17. **Given** `PERMISSIONS`, **when** a cell names a `ProviderKind` (`'MANITAS'`) or any other
    non-`UserRole` string, **then** it fails to compile — asserted with `@ts-expect-error` in the
    matrix test, so §3.5.2's rule is enforced by `pnpm typecheck` rather than by review.

## 8. Data

None. No Prisma model, no migration, no index. The matrix is code, and `roles`/`status`/`deletedAt`
are columns `W1-T05` and `W2-T01` already shipped.

## 9. Out of scope

- **Revocation** — deleting the session row on suspend, sliding expiry, "sign out everywhere".
  `W2-T02`. This ticket makes suspension effective on *guarded routes*; it does not delete anything.
- **Rate limiting, lockout, the auth audit log** — `W2-T07`. The guard is where auth events will be
  emitted from later; it emits none today.
- **The provider signup fork** — `W2-T05`. Nothing here creates a `PROVIDER`.
- **Ownership checks that need a row** — §3.6 sets the rule; the routes enforce it.
- **Storefront role gating** — `AuthWall` is the browser's half and is unchanged.
- **Any product route.** `W3-T02` is the first consumer, in its own PR.
- **The transactions view and its permissions** — §3.5.1. `W5-T10` (the ledger) has to exist before
  there is anything to read; this ticket records the constraint on who may read it and ships the
  mechanism that will carry it.

## 10. Decisions, and what is still open

**Settled by the operator, 2026-09-18 — all three answers are in the design above:**

| | Decision | Where it landed |
|---|---|---|
| Q1 | A suspended user's guarded request is **`401`**, not `403` | §3.3, §3.4, AC8–AC9 |
| Q2 | **`ADMIN` has no implicit bypass** — *and* money permissions must be reachable: *"someone should be able to look into transactions"* | §3.5, §3.5.1, AC7, AC15 |
| Q3 | **A suspended, blocked or deleted user returns no data — not even `deletedAt`** | §3.3: liveness is a `where` clause, `Principal` carries no state, AC4/AC16 |

Q3 changed the design rather than confirming it. The guard no longer reads account state from the
session payload at all, which also makes the measurement it depended on unnecessary: whether
`getSession` returns `additionalFields` on its read path is now a note for `W2-T02`, not a premise
of this ticket.

**Still open, and neither blocks this ticket:**

**O1 — the role that sees money, for whoever owns `W9-T01`.** §3.5.1 defers it deliberately: an
additive `UserRole` member when the first ledger route exists, never by widening the `ADMIN` that
`W9-T04` gives to moderators. The decision this PR records is the *constraint*; the name and the
grant are `W9-T01`'s, and `W5-T10` has to exist first for there to be anything to read.

**O3 — `TODO.md` §3's sketch lists `MANITAS`/`PRO` as roles.** §3.5.2. The schema disagrees and the
schema is what runs; the sketch is the document a new agent reads first, which is what makes it worth
correcting. One line, `agent-contracts`', and this ticket's spec is the evidence.

**O2 — where a role gate belongs in the browser.** The API is now able to refuse, and `apps/web`
still has no notion of roles beyond `AuthWall`'s signed-in/signed-out. A page that offers a control
the API will `403` is a bad page, but the fix is a storefront ticket (`W2-T05` is the first to need
it, for the pro fork) and not a guard concern.
