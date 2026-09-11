# ADR-005: Authentication and sessions

## Status
Accepted — 2026-09-11

## Context

`W1-T08` promised five ADRs — stack, contracts seam, money, geo, **auth** — and the repo has none of
them: `docs/adr/` starts at `ADR-006`. This is the auth one, written when it became the thing
blocking work rather than when the list was drafted. `ADR-001`–`ADR-004` are still unwritten; their
decisions are live in `TODO.md` §1 and in the code, and the gap is recorded here so it reads as
outstanding rather than lost.

The trigger is `M11`. Its exit criterion is deliberately *"a CTA that stops cleanly at the auth
wall"*, and `W12-T12` shipped that wall as `AuthWall`. Everything behind it is `W2`/`M1`, and `W2`
cannot start until this document exists — `W2-T01` and `W2-T02` are the two tickets whose shape
depends entirely on the answer.

Three constraints were already fixed before this decision, and they do most of the work:

1. **`W1-T05` put the user record in our database.** `app_user` carries `roles`, `status`, `locale`,
   `deletedAt`, both profiles, `address`, and every state change lands in `AuditRecord`. The identity
   row is not a thing we can outsource; it is already the centre of the domain model.
2. **`ADR-006` rejected Supabase** partly because it *"bundles auth and APIs we are deliberately
   building"*. That was a leaning about hosting, not a decision about auth, but it is on the record.
3. **`W12-T15` is already over its budget** of ≤170 KB initial JS, and the storefront is the surface
   any client-side auth SDK would land on.

## Decision

**`better-auth`, self-hosted, against our own Postgres. `app_user` stays the user record.**

A library, not a service: the session table is a table in our Neon database, the user row is the row
`W1-T05` already designed, and nothing about a user leaves the EU or the connection string. What we
buy is the part that is genuinely hard to get right and boring to own — password hashing, token
entropy, verification and reset flows, timing-safe comparison, the OAuth dance — without buying a
second system that also believes it owns the user.

### Rules

1. **The user record does not move.** `modelName: "app_user"` maps better-auth's `user` model onto
   the existing table, and `advanced.database.generateId: false` leaves ids to
   `gen_random_uuid()`. Our columns reach better-auth through `additionalFields`; better-auth's type
   inference keeps the logical names regardless of what the column is called.
2. **Credentials live in the `account` table, not on `app_user`.** This is better-auth's model and it
   is the better one: a user may have a password *and* a Google identity as two `account` rows.
   `app_user.passwordHash` therefore never gets written and `W2-T01` drops the column. Its comment —
   *"Nullable so that adding a social login later is not a migration"* — was right about the goal and
   is superseded by a mechanism that achieves it properly.
3. **Sessions are database rows, not access tokens.** One opaque session token in an httpOnly,
   `Secure`, `SameSite=Lax` cookie; the server looks it up on every request. **This overrides
   `W2-T02` as written** (*"httpOnly refresh cookie + short-lived access token, rotation, revoke"*).
   That design makes revocation eventually consistent — a revoked user keeps their access token until
   it expires — and `W2-T02` asks for revoke in the same breath. A marketplace that can suspend a
   provider (`UserStatus.SUSPENDED`) and that will grow support impersonation (`BD-11`) needs
   revocation to mean *now*. Rotation survives as better-auth's `updateAge` sliding expiry.
4. **Cookie caching stays off.** better-auth can cache session data in a signed `session_data` cookie
   to save a query. It is explicitly documented to leave revoked sessions live on other devices until
   the cache expires, which is exactly the property rule 3 exists to prevent. Revisit only with a
   measured query-load problem and a cache TTL small enough that the ban story survives it.
5. **One origin.** `apps/web/src/shared/api.ts` already defaults `baseUrl()` to `/`, with
   `VITE_API_URL` as the escape hatch. That default becomes load-bearing: Cloudflare must route
   `/api/*` to the Fly app so the browser sees a single origin. See Consequences — this is the one
   place the decision creates new platform work.
6. **Email + password first; Google second, not instead.** The supply side is autónomos in Spain, and
   social-only login is a conversion tax on the scarce side of a marketplace with a cold-start
   problem (`R3`). Google arrives later as one more `account` row and needs no migration — the goal
   rule 2 preserved.

### Schema reconciliation

better-auth needs four models. One of them already exists, and mapping it is the actual work in
`W2-T01`:

| better-auth | ours | action |
|---|---|---|
| `user.id` | `app_user.id` `uuid` db-generated | `generateId: false` |
| `user.email` | `email` | maps directly — **every lookup stays `WHERE lower(email) = lower($1)`**, or it misses the functional index `W1-T05` built |
| `user.emailVerified` `Boolean` | `emailVerifiedAt` `DateTime?` | **a type mismatch, not a naming one** — `fields` renames columns, it does not convert types. better-auth owns a new `email_verified` boolean; `email_verified_at` stays as the audit fact, written alongside it. The one place this decision costs us a redundant column |
| `user.name` | *(none — `displayName` is on `ClientProfile`)* | `app_user` gains a `name`. It is the account's name, not the marketplace-facing one; `ClientProfile.displayName` remains *"what a provider sees. Not the legal name."* |
| `user.image` | *(none)* | nullable; unused until there are avatars |
| — | `roles`, `status`, `locale`, `deletedAt` | `additionalFields` |
| `session` | *(none)* | new table, `W2-T02`'s migration |
| `account` | *(none)* | new table — credentials and, later, Google |
| `verification` | *(none)* | new table — email verification and password reset |

**Soft delete is ours, not better-auth's.** It has no concept of `deletedAt`, so a deleted user can
still authenticate unless every lookup excludes them. That guard belongs in `W2-T01`, with a test,
and `W2-T08` owns the rest of the erasure story.

### What the `W2` tickets become

- `W2-T01` — mount better-auth on Fastify, map `app_user`, drop `passwordHash`, add `name` and
  `email_verified`, wire email through the existing transport (MailHog locally; `OPS-14` to ship).
- `W2-T02` — the `session`/`account`/`verification` migration, cookie configuration, revoke
  endpoints. **Its line in `TODO.md` §6 is rewritten by rule 3.**
- `W2-T03` — unchanged and still ours: `roles` is our column, so the permissions matrix and every
  403 test are domain code, not library configuration.
- `W2-T07` — better-auth covers rate limiting and lockout; the audit-log half stays ours, emitting
  into `AuditRecord` via `W1-T07`'s helper.

## Alternatives considered

- **Hand-rolled, exactly as `W2-T01`/`T02`/`T07` are written.** Zero dependencies and total control,
  and the backlog already budgeted for it. Rejected because the tail is long and unglamorous —
  token entropy, reset-token single-use, email enumeration, timing-safe compare, lockout — in the
  one slice where a mistake is catastrophic and where an agent's confident-looking code is hardest
  to review. This ADR keeps the parts that are *domain* decisions (roles, soft delete, audit) and
  buys only the parts that are the same in every application.
- **Auth0.** Mature, and it removes the security surface entirely. Rejected on three counts: it
  duplicates the user record alongside `app_user`, which makes `W2-T08`'s GDPR export and erasure a
  two-system problem in a slice already blocked on `BD-14`; B2C MAU pricing is the wrong curve for a
  marketplace that wants many low-value browsers before it has supply; and role data would live in
  app metadata, split from the `roles` column every 403 test reads.
- **Clerk.** The best developer experience of the four and genuinely fast to stand up. Rejected for
  the same duplicate-user-record reason, plus the bundle: its client SDK lands on a storefront
  `W12-T15` is already over budget on, and rule 5's single origin is not enough to fix a payload.
- **Google-only ("just use Google").** Cheapest possible answer and the OAuth client is nearly free
  given `OPS-12` already needs a GCP project. Rejected as a *sole* method by rule 6 — it is a
  supply-side conversion tax, not a simplification. It is adopted as a second method.

## Consequences

- **Cross-origin cookies are now a platform problem, and previews are where it bites.** A production
  cookie on `.<domain>` covers `api.<domain>` (`OPS-16`). Previews do not get that: the web is
  `<task>.<project>.pages.dev` and the API is `marketplace-api-<task>.fly.dev` — **different
  registrable domains**, so a `SameSite=Lax` cookie is never sent and every preview login fails. §9's
  *"every PR gets a URL"* is the principle this would quietly break. Rule 5's `/api/*` proxy is the
  fix and it is new work for `agent-devops` — filed as `W0-T28`, and a prerequisite for `W2-T02`
  rather than for `W2-T01`.
- **`W2-T02`'s backlog line is now wrong** and is corrected in `TODO.md` §6 by this ADR.
- **`app_user.passwordHash` is dead on arrival.** It has never been written; dropping it in `W2-T01`
  costs nothing, and leaving it would be a column that looks like the credential store and is not.
- **A dependency lands in the highest-blast-radius slice.** Pin the version exactly, treat an upgrade
  as a reviewed change rather than a lockfile bump, and keep the `account`/`session` tables in our
  own migrations so an exit is a data problem we can already see.
- **`OPS-14` (Resend/Brevo) blocks shipping `W2-T01`, not building it.** MailHog is already in the
  local stack and verification and reset are testable end to end without an account.
- **Rule 3 costs a database round trip per request.** That is the price of immediate revocation, it
  is one indexed primary-key lookup, and rule 4 names the escape hatch we are deliberately not taking
  yet.

## Open questions

- **Q1 — does `W2-T05`'s MANITAS/PRO split happen at signup or after?** better-auth creates the
  `app_user` row; `ProviderProfile` and its `ProviderKind` are ours. Whether one form writes both, or
  signup always creates a `CLIENT` who then becomes a provider, is a product decision that shapes
  `W2-T05` and the `become-a-pro` page `W12-T10` already stops at. Not blocking `W2-T01`.
- **Q2 — `BD-06` (do manitas need ID verification?) still gates `W2-T05`,** unchanged by this ADR and
  repeated here because it is the next thing `W2` will hit.
- **Q3 — session lifetime.** better-auth defaults to 7 days with a 1-day sliding refresh. A
  marketplace where a provider checks for leads on a phone probably wants longer, and one that holds
  payment methods probably wants `freshAge` short for anything money-touching. `W2-T02` should pick
  deliberately rather than inherit.
