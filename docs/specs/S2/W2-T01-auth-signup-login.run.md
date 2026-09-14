# W2-T01 — run record

- **Spec**: `docs/specs/S2/W2-T01-auth-signup-login.md`
- **Decision**: `docs/adr/ADR-005-authentication-and-sessions.md`
- **Branch**: `W2-T01-auth-signup-login`

---

## What this ticket turned out to be

`ADR-005` did the hard thinking — library not service, `app_user` stays the user record, sessions
are rows, credentials are `account` rows. The work here was almost entirely *reconciliation*: four
places where the decision, written before anyone ran it, did not match what the library actually
does. Three of them I got wrong first and the code corrected me.

The storefront is one endpoint less of a facade. `apps/api/src/routes/` had exactly one file when
this started.

---

## Finding 1 — the spec's sharpest claim was half wrong, and the test survived it

The spec's first draft said email case would **fork the user table**: `W1-T05` built a unique index
on `lower(email)`, better-auth's adapter issues an exact match, so `Maria@x.com` and `maria@x.com`
would become two accounts that both satisfy the index.

Reading `better-auth@1.7.4` instead of reasoning about it disproved half of that:

```js
sign-up.mjs:165   const normalizedEmail = email.toLowerCase();
sign-in.mjs:315   await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase(), …)
```

It normalises on both sides. **Accounts do not fork, and my claim that they would was incorrect.**

What survived is the half `W1-T05`'s own migration comment predicted, word for word:

> `WHERE email = $1` is valid SQL that compiles, returns nothing for 'Ana@example.com', and does
> not use this index. Lookups must say `lower(email) = lower($1)`.

That discipline is enforceable in code we write and not in code a library writes. better-auth
issues exactly the predicate the comment warns about, and it is the **only** thing reading that
column on the sign-in path — so every sign-in and every duplicate check was a sequential scan on
`app_user`, on the one route an unauthenticated caller can trigger at will.

`0008` replaces the functional index with a plain `UNIQUE` plus
`CHECK (email = lower(email))`. The `CHECK` is what makes that a swap rather than a downgrade —
mixed case cannot be stored, so the plain index is equivalent *and* serves equality — and it moves
the guarantee out of a dependency: a future better-auth that stops lowercasing hits a constraint
violation instead of silently creating a second account.

**AC7 and AC8 never changed.** They were written under the wrong diagnosis, assert *behaviour*
("sign up mixed-case, sign in lowercase, get the same id"), and passed under the right one. That is
the argument for asserting behaviour over configuration, and it happens to be made at my expense.

---

## Finding 2 — `ADR-005` rule 1 names the wrong layer, and fails loudly

The rule:

> `modelName: "app_user"` maps better-auth's `user` model onto the existing table.

Through the **Prisma** adapter that is wrong. First run:

```
Prisma schema mismatch
  Missing tables
    app_user
  Missing columns
    session.expires_at, account.provider_id, verification.expires_at, …
  Required columns Better Auth never writes
    session.userId, account.providerId, …
```

The adapter speaks Prisma, not SQL: it calls `prisma.user.create({ data: { userId … } })`. So
`modelName` and `fields` must name the *Prisma model and its fields*, and the mapping onto
`app_user` / `user_id` is already done, once, by `@@map`/`@map` in `schema.prisma`. Telling
better-auth the column names as well makes it look for Prisma fields called `user_id`.

So `modelName: 'user'`, and every `fields:` block I had written was deleted. **The ADR's intent
holds exactly** — `app_user` is still the table, still for the reason `W1-T05` gave. Only the
mechanism was a layer too low. Recorded rather than silently corrected: the next person to read
rule 1 will otherwise try what it says and get the error above.

---

## Finding 3 — a field better-auth does not know about is silently dropped

`ADR-005` calls `email_verified` + `email_verified_at` "the one place this decision costs us a
redundant column", because `fields` renames columns without converting `Boolean` to `DateTime?`. A
`databaseHooks.user.update.before` hook writes the timestamp whenever the flag flips.

It did nothing, and said nothing. `emailVerified` went `true`; `emailVerifiedAt` stayed `null`.

`additionalFields` is not only a type declaration — the adapter **strips any key it does not
recognise** before the write reaches Prisma. Declaring `emailVerifiedAt` there fixed it.

This is the failure mode worth naming: a redundant column is only a cost while it agrees. The
moment it drifts it is a lie, and this one drifted with no error, on a path that reports success.

---

## Finding 4 — the broken bridge is in better-auth's docs, not in better-auth

The spec flagged that better-auth's own Fastify guide forwards headers with

```js
response.headers.forEach((value, key) => reply.header(key, value));
```

and that the `Headers` API folds repeats into one comma-joined value — not a legal transformation
for `Set-Cookie`.

That is real, and the fix turned out not to be "write a better `forEach`". The library ships a
correct bridge its Fastify page does not use: `toNodeHandler` delegates to `better-call/node`,
whose `setResponse` does

```js
res.setHeader(key, key === "set-cookie"
  ? set_cookie_parser.splitCookiesString(response.headers.get(key))
  : value);
```

— splitting the folded value back apart, `Expires`-date commas and all. So the plugin uses the
library's own Node integration. Two costs, both in `src/plugins/auth.ts`:

1. **`reply.hijack()`**, or Fastify serialises a second response onto the same socket.
2. **The body has to survive the trip.** This one cost a debugging cycle: `getRequest` prefers to
   read `request.raw` as a stream and falls back to `request.raw.body`, and inside Fastify the
   stream is always spent while the parsed body lives on the *Fastify* request. better-auth found
   neither and answered `VALIDATION_ERROR: expected object, received undefined` — credentials
   looking wrong when the body was simply absent. The plugin buffers the body as a string in an
   encapsulated content-type parser and hands it over untouched. Not `JSON.stringify(request.body)`
   as the guide does: a `parse`/`stringify` round trip is not an identity, and "the bytes we
   forward are the bytes we received" is worth keeping by construction.

---

## Finding 5 — the guards are half of what "suspension means now" requires

`ADR-005` rule 3 chose database sessions over access tokens so revocation means *now*, naming
`UserStatus.SUSPENDED` as the reason. §4.5's hook refuses **session creation** for a soft-deleted
or non-`ACTIVE` user, using the library's own recommendation:

> Non-provider returning sign-ins are not re-validated; use … a `databaseHooks.session.create.before`
> hook for those.

That stops a suspended user signing in *again*. It does nothing about the cookie they are already
holding.

Nothing can reach that state today — no route suspends a user; `W9` builds the back office — so it
takes a direct database write. `W2-T02` owns "revoke as a delete". The gap is asserted rather than
described:

```
it('does NOT revoke a live session when a user is suspended — W2-T02 owns this', …)
```

deliberately written as what *happens*, not what should, so it cannot be mistaken for coverage and
so `W2-T02` has a test that flips when it lands.

---

## Red phase

Three probes, each reverted immediately. Each produced **exactly one** failure, and the right one.

| probe | failures | the one that failed |
|---|---|---|
| `status !== 'ACTIVE'` guard removed | 1 / 20 | `refuses a SUSPENDED user, indistinguishably from a wrong password` |
| `deletedAt !== null` guard removed | 1 / 20 | `refuses a soft-deleted user, …` |
| `app_user_email_lowercase` constraint dropped | 1 / 20 | `stores the address lowercased, and the database refuses anything else` |

The third probe left a mixed-case row behind, so restoring the constraint failed with
`is violated by some row` — a small demonstration that the constraint does what it claims.

---

## Two corrections made during the work

**A test that read the commentary instead of the code.** `expect(plugin).not.toContain('fastify-plugin')`
failed against a file whose *prose* explains why `fastify-plugin` is not used. Narrowed to
`not.toMatch(/^import .*'fastify-plugin'/m)`. Same shape as two assertion bugs in `W12-T15`:
a substring match over a region wider than the claim.

**Two guard tests asserted the wrong property.** Both said `sessionCount === 0` after a refusal and
both failed — because `autoSignInAfterVerification` had already created a session when the
verification link was followed, *before* the account was suspended. The count was right and my
property was wrong: what this ticket owns is that a refused sign-in creates **nothing new**. Now
`count(after) === count(before)`, and the surviving session got its own test (Finding 5).

---

## What the full suite caught that the package suites did not

`pnpm --filter @marketplace/api test` was green while **eight** root-level assertions were red. The
same lesson as last session, and this time the gates were worth more than the code:

| gate | what it caught |
|---|---|
| `cd-workflows` AC30 | **A production bug.** It derives required-with-no-default variables from `EnvSchema` and asserts each is set on the Fly app. I added two required variables and wired them into no deploy — every environment would have deployed a container that exits 78 on boot |
| `cd-workflows` AC28 | The pre-flight guard must be *handed* every secret it checks for. Three workflows named the new secret in `REQUIRED` and never passed it in — the guard would report "configured", create a Fly app and a Neon branch, and only then find it missing |
| `env-example` | `.env.example` drifted from `EnvSchema` (`MAIL_SMTP_HOST`, `MAIL_FROM`), and the secret inventory disagreed with `REQUIRED` in `scripts/deploy/config.ts` |
| `db.test` AC9 | **Neither migration had a `down.sql`.** A repo convention I did not know about |
| `factories` AC10 | Three new models with no factories — forced a decision rather than a default |
| `db.test` AC13 | `expect(seeders).toEqual([])` |

Two of those deserve more than a row.

**AC13 was a gate that had to be weakened, and that is the right call.** It asserted the seeder
registry was literally empty. True when `W0-T05` shipped the scaffold; false the moment a slice did
what the registry's own comment invites. Emptiness is not what AC13 claims — AC13 is *"an empty
registry is a working registry"*, which the next test (`runSeeders([])`) actually covers. Replaced
with a derived assertion that every entry is well-formed, so a seeder with no id or no description
still fails here.

**AC35's secret allowlist needed one name added, not a pattern.** Its purpose is *"a new secret
name here would mean somebody had added a vendor"*. `PREVIEW_BETTER_AUTH_SECRET` is a signing key
for a service we already run — which is most of why `ADR-005` chose a library over a fifth service.
Listed explicitly, so a real fifth vendor still fails.

---

## What CI caught that the full local suite did not

The root suite was green and the `database` job was not — twice. Both failures were the same shape
as each other and as the ones above, which is the point of recording them.

**A hand-written migration list.** `core-schema.test.ts` named four migrations and walked them in
reverse to roll back. `migrated()` applies *all* of them, so `session` and `account` were still
present when `0003`'s `down.sql` reached `app_user`:

```
ERROR:  cannot drop table app_user because other objects depend on it
```

`0006_audit_record` had been missing from that list for just as long and never failed — because
`audit_record` deliberately carries no foreign key to `app_user`. The gap was invisible until a
migration added one. Now derived from the directory, with a count assertion, because a derivation
that derives nothing passes AC-2 vacuously.

**A hand-written suite list in `ci.yml`.** The `database` job ran three files by name.
`auth.test.ts` was not among them, so **20 live tests would have passed locally and never run in
CI at all** — the tests carrying every guard in Finding 5. The job now runs the whole `apps/api`
suite with `STACK_LIVE=1`.

**And behind that, a second defect the first was hiding.** Running the whole suite immediately
failed with `Failed to resolve entry for package "@marketplace/contracts"`: these suites call
`vitest` directly rather than through `pnpm test`, so turbo's `dependsOn: ["^build"]` never runs
and the package resolves to a `dist/` that does not exist. None of the three named suites imported
it, so the job had been one new import away from breaking since it was written. Fixed with
`pnpm turbo run build --filter='@marketplace/api^...'` — derived, so a new workspace dependency
needs no one to remember it.

That is **four instances of this failure mode in one ticket**, across three files. The repo's own
memory note says a hand-written subject list has now failed four times; this ticket makes it seven,
and every one of them was silent.

**AC-3 restated rather than loosened.** §4.2 changed which constraint refuses a mixed-case
duplicate — the `CHECK` fires before uniqueness, so `23514` where it was `23505`. The test now
pins both codes *and* adds the case the functional index could not enforce: mixed case refused with
no twin to collide with.

---

## Finding 6 — the deploy proved a spec claim wrong

The operator set the three environment secrets on 2026-09-14 and the preview deploy ran for the
first time: `marketplace-api-pr-246.fly.dev`, against its own Neon branch. Sign-up works on real
infrastructure — a database-generated uuid, `roles: ["CLIENT"]`, `locale: ES` from the column
defaults.

It also disproved §6. The spec said a sign-up whose verification email cannot be sent **fails and
rolls the row back**, and called that "the honest behaviour available today". It was a guess stated
as a fact:

```
POST /api/auth/sign-up/email           → 200, row created
  (logs) ERROR [Better Auth]: connect ECONNREFUSED 127.0.0.1:1025
POST /api/auth/sign-in/email           → 403 EMAIL_NOT_VERIFIED
POST /api/auth/sign-up/email (again)   → 200, synthetic user, roles: null, no row
POST /api/auth/send-verification-email → 500
```

better-auth does not fail the request when `sendVerificationEmail` throws. So the account is
created and **stranded**: it cannot sign in, cannot be re-registered — the duplicate response is
deliberately synthetic so as not to leak which addresses exist, and the `null` fields are what give
it away — and cannot request another link. Precisely the trap the wrong claim said we were
avoiding.

Three consequences, and only the third was this ticket's to fix:

1. **`OPS-14` is the fix**, and `ADR-005` already said so: *"blocks shipping `W2-T01`, not building
   it."* No deployed environment has a mail provider, so verification cannot be completed anywhere
   but locally. Not a defect introduced here — the dependency, now demonstrated instead of asserted.
2. **The right design is a queue with retries**, not a rollback, and it needs a job runner that
   does not exist.
3. **The default was a footgun.** `MAIL_SMTP_HOST` defaults to `127.0.0.1` — Mailpit locally,
   nothing at all on Fly — and the failure is one log line nobody reads. §4.9 adds a boot warning
   when a non-development environment points mail at a loopback address, naming `OPS-14` so the
   warning says when it stops being true. A warning and not a refusal, because refusing would mean
   no deployed API at all and nothing else in this service touches mail.

§6 and §10 Q3 now record what happens rather than what I assumed, and `auth.test.ts` pins it with a
test written as an observation. Red probe on the new guard: 6 failures, exactly the positive cases,
with both negative cases still passing.

**The general lesson is the same one as Finding 1**, and it cost less there only by luck: the
assertions that survived were about behaviour, and the claims that fell over were the ones I
reasoned my way to instead of running.

---

## Deviations from spec

**§4.1 — the schema lands in `W2-T01`, not `W2-T02`.** Argued in the spec before any code:
credentials are `account` rows, tokens are `verification` rows, a login *is* a `session` row. There
is no subset of this ticket that runs without all three. `W2-T02` keeps session *policy* — lifetime
(`ADR-005` Q3), rotation, revoke, and the `W0-T28` cross-origin fix. Contradicts the ADR's ticket
table; contradicts none of its six rules.

**§4.2 edits `agent-contracts`' file.** `TODO.md` §4 makes `prisma/schema.prisma` append-only by
request, and §4.2 does not append — it replaces an index `W1-T05` deliberately chose. Done anyway
because the table is empty in every environment and an index reshape is cheaper before there are
rows. Spec §10 Q6; the fourth such deviation, and nobody has decided whether it is allowed.

**Rule 1's mechanism corrected** — Finding 2.

---

## Verification

| | |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm format:check` | clean |
| `pnpm test` (root + every package) | **246 passed, 6 skipped** |
| `apps/api` **whole** suite live (`STACK_LIVE=1`) | **122 passed** — reproduced from a deleted `dist/`, the way CI runs it |
| `tests/local-stack.test.ts` live | 15 passed |
| CI on `#246` | **12 / 12 green** |
| preview deploy | **live** — `marketplace-api-pr-246.fly.dev`, sign-up and the unverified refusal exercised against real infrastructure |
| `apps/api` live, after Finding 6 | **131 passed** |
| `actionlint 1.7.7` | clean |
| `prisma migrate diff` | no drift between schema and migrations |
| `pnpm db:seed` | ran; both seeded accounts sign in (checked against a real database) |
| red probes | 3, one failure each, correct test each time |

---

## Known gaps, carried deliberately

- **A live session survives suspension.** Finding 5. `W2-T02`.
- **The emails are English.** `app_user.locale` exists and `W12`'s catalogues exist; wiring a
  locale through better-auth's callbacks is its own decision about where message catalogues live
  for a service with no React in it. Spanish-first is the product (`R1`), so this is a real gap and
  not a stylistic one.
- **No login page.** `ADR-011` §1 — UI work as an unstated tail on an API ticket is how thirteen
  agents each invent their own button. `W2` owns it as its own ticket.
- **Rate limiting is at better-auth's defaults**, unconfigured and unasserted. `W2-T07` owns it;
  picking a limit without a spec is picking it by accident.
- **No auth events in `AuditRecord`.** `W2-T07`, through `W1-T07`'s helper.
- **Nothing watches the dependency tree.** `ADR-005` asks for an exact pin (AC22, done) and
  reviewed upgrades. That covers deliberate change, not a transitive one: better-auth pulls
  `@noble/hashes`, `jose`, `better-call` and eleven more, the lockfile pins them, and no gate in
  `ci.yml` audits them. Spec §10 Q5.
- **`W1-T03`/`W1-T04` still unstarted.** This ticket adds the first real routes and therefore the
  first opportunity for the API to drift from the frozen contracts. It does not add the detector.
  Spec §10 Q4 — cheapest to build before two slices have written routes by hand.

---

## What a human has to do

**Three secrets, one per environment**, or the API exits 78 on boot there:

```
Settings → Environments → preview    → PREVIEW_BETTER_AUTH_SECRET
Settings → Environments → staging    → STAGING_BETTER_AUTH_SECRET
Settings → Environments → production → PRODUCTION_BETTER_AUTH_SECRET
```

Generate each independently — `openssl rand -base64 32` — and **never share one across
environments**: a staging secret that also signs production sessions makes staging a way into
production. Rotating one signs out every user in that environment at once, which is the correct
behaviour for a compromised key and a bad surprise otherwise.

Only `preview` is set and verified today (`#156`), so only `preview` blocks anything now.

---

## Self-assessment

The spec was worth writing, and three of its four findings were wrong in some way that the code
corrected. That is the honest summary. Finding 1's central claim was mistaken; Finding 2 was a
mistake inherited from the ADR and reproduced faithfully; Finding 4 was right about the bug and
wrong about where it lived. Only Finding 3 came out of running the thing rather than reading it,
and it was the one that failed silently.

What held up was the *shape*: every assertion pinned behaviour rather than configuration, so being
wrong about mechanisms cost nothing. AC7 and AC8 were written to catch a forking bug that does not
exist and are now the regression test for a library that might stop lowercasing.

The highest-value thing in this ticket is not the auth. It is that `cd-workflows` AC30 caught a
change that would have taken down every deployed environment, using a list derived from
`EnvSchema` rather than written by hand — and that I found it by running the *root* suite, which is
the step I skipped twice last session and nearly skipped again.
