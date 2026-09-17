# W3-T07 — Provider profile: `GET /api/providers/:id`

```
Slice:    S3 (agent-providers)
Task:     W3-T07  [A]
Contract: ProviderProfileSchema / ProviderIdSchema — frozen by W12-T12, not touched here
Reviewers: agent-discovery, agent-contracts
Spec date: 2026-09-17
```

## 1. Purpose

`W12-T11` ships a results list whose every row links to `/:lang/pro/:id`, and `W12-T12` ships the
page those links land on. Behind that page is `apps/web/mocks/` — a hand-built catalogue answering
`GET /providers/:id` since the route existed. This task replaces the mock with the endpoint, over
Postgres, against the schema `W12-T12` froze.

Nothing in the seam changes. `ProviderProfileSchema` is `SearchResultSchema` minus `distanceMetres`
plus `serviceRadiusMetres` and `memberSince`, and every field maps to a column that exists today.
This slice may not touch `packages/contracts/**` or `schema.prisma` and does not need to.

`W3-T05` built the first domain module in `apps/api` and this one copies its split deliberately:
`routes.ts` for the HTTP boundary, a repository for the data, so the boundary is testable without a
database and the data layer is testable without an HTTP server.

### 1.1 What this is not

It is not the profile **page** (`W12-T12`, shipped), not the private own-profile editor (`W3-T02`),
not badges, portfolio or response time — `Badge`, `Certification` and `PortfolioItem` are in
`TODO.md` §3's sketch and in no migration, so each needs its own model before an endpoint can serve
it (`W12-T12` §1). It does not retire the MSW handler either: `W3-T10` owns that, behind a seeder
(§2.8).

## 2. Design

### 2.1 The route lives under `/api`, and the module is `providers/`

`GET /api/providers/:id`, registered as a Fastify plugin from `apps/api/src/modules/providers/`,
with the prefix applied once at the composition root exactly as `searchRoutes` applies it.

The prefix is `MEM-2026-09-14-3` and not a preference: `W0-T28` splits traffic at the edge by path,
so a route that escapes `/api` is answered with the SPA's own `index.html` — a 200 full of HTML that
fails as a JSON parse error a long way from its cause, and only in a deployed environment.
`apps/web/src/shared/api.ts:182` already calls `api/providers/${id}`.

The directory is `providers/`, not `professionals/`. `agents/roles/agent-providers.md` says
`apps/api/src/modules/professionals/**`, and that glob predates every artefact that now names this
thing: the route is `/providers/:id`, the contract is `ProviderProfileSchema`, the table is
`provider_profile`, and `memory/repo/glossary.md` states the rule — *"Code, tables, API fields:
English"*, and *"`provider` covers both manitas and pro; use `manitas`/`pro` only where the
distinction matters"*. A module called `professionals` would be the one place in the stack claiming
the licensed half of the market. The charter glob is corrected in this PR.

### 2.2 A profile is a point read, so it uses the typed client

`W3-T05` is one hand-written `$queryRaw` because it has to be: `ST_DWithin` against a generated
`geography` column Prisma cannot read, facets and a keyset page that must not become four round
trips over a radius scan. **None of that is true here.** This is one row by primary key, its base
address, and its categories. No PostGIS is involved — the profile needs `latitude`/`longitude`, which
are ordinary `Decimal` columns.

So the repository is `prisma.providerProfile.findUnique` with two nested includes, and the gate that
matters is not the statement count but the **outbound parse** (§2.6). The trade is stated rather than
assumed: the typed client issues two or three statements where raw SQL would issue one, and buys
compile-time column safety on a projection whose *omissions* are load-bearing — a hand-written
`SELECT` that gains a column gains it silently.

Two `Decimal` columns cross this boundary and both need converting: `ratingAvg` is
`Decimal(3,2)?` and the address coordinates are `Decimal(9,6)`. A `Decimal` serialises to JSON as an
object, not a number, so `ProviderProfileSchema.parse` rejects it — which is the outbound parse
earning its place a second time.

### 2.3 400 before 404, because they are different answers

`:id` is parsed with `ProviderIdSchema` (`z.uuid()`) before anything is looked up. A malformed id is
`400 VALIDATION_FAILED`; a well-formed id nobody has is `404 NOT_FOUND`.

This is the order `apps/web/mocks/handlers.ts` already teaches the storefront, and its comment states
the reason: *"one is a request nobody should have sent, the other is a provider who is gone, and only
the second deserves 'no longer listed' in front of a visitor."* `W12-T12` §3's state machine has the
client making the same check and **not sending the request** — so the 400 exists for the caller that
is not the storefront, and the two must not collapse into one another.

A rejected id costs no database query, and the test asserts that against a recording repository
rather than trusting the code's shape.

### 2.4 A provider with no base address answers 404 — transitionally

`ProviderProfileSchema` requires `city`, `province` and `point`, all non-null. `baseAddressId` is
nullable (`schema.prisma:215`). So a provider with no base address **cannot be serialised**, and the
endpoint has to answer something.

It answers `404 NOT_FOUND`, on the grounds that such a provider is already unlisted everywhere else:
`schema.prisma:213` says *"a provider with no base is not searchable"* and `W3-T05` AC6 enforces it.
"Not publicly listed" and "no such provider" are the same answer to a visitor, and the alternative —
making `city`, `province` and `point` nullable — is a contract change this slice may not make and
`W12-T12` deliberately did not need.

**It is a workaround for a schema that permits a state the product does not.** The operator's rule,
taken 2026-09-17: *every provider, manitas or pro, must have a base address, and it is the centre of
their operating radius — not where they live.* A provider may legitimately set it to a city centre
with a wide radius. On that rule `baseAddressId` is `NOT NULL`, this 404 becomes unreachable, and the
branch stays only as a defence.

Two things follow, neither of them this PR's to do (L10):

- `W3-T02` (the provider profile editor) requires a base address at creation and is the ticket that
  makes the column's nullability vestigial. Its `TODO.md` line is amended here to say so.
- Making the column `NOT NULL` is a `schema.prisma` change and a migration with a backfill, which is
  `agent-contracts`' edit (L3). Raised as a proposal in §5, not made here.

The distinction the operator drew is also a **documentation** fix: `schema.prisma:214` and
`packages/contracts/src/search.ts` both justify the coarse point with *"usually a home address"*. The
privacy rule does not weaken — a provider may still enter their home, and the endpoint cannot tell
which did — but the column's *purpose* is an operating centre, and the comment currently teaches the
opposite. Also `agent-contracts`', also §5.

### 2.5 What a profile serves that a search result does not

A profile is not a search hit, and three exclusions from `W3-T05` do **not** carry over:

| Provider | `GET /api/search` | `GET /api/providers/:id` |
|---|---|---|
| `service_radius_metres IS NULL` | excluded (AC6) | **200** — `serviceRadiusMetres: null`, rendered "area not stated" |
| `hourly_rate_cents IS NULL` | excluded from `mode=booking` | **200** — quote-only, rendered *"presupuesto"* |
| Outside the searched radius | excluded | **200** — a profile has no centre |

A URL that survives being pasted into WhatsApp (ADR-011 §1) must not 404 because the person who
opens it happens to be far away. `distanceMetres` is omitted from the contract for the same reason.

Categories are filtered to `is_active` and ordered by `position, slug`, matching `W3-T05`'s
projection, so the same provider lists the same trades in the same order in both places.

### 2.6 The projection, and what it must never carry

`ProviderProfileSchema.parse(...)` in the handler, before returning — `MEM-2026-09-17-11`.

The exclusions are doing security work: no `userId` (a public row linking to an account is a
correlation handed out for free), no `baseAddressId`, and above all no `line1`/`line2`, which
`W1-T05` §8 states as a rule and lists as a deny this task inherits *as a test*
(`W1-T05.run.md`:164). Types are erased at runtime; a repository result spread into a typed return
value satisfies the compiler and ships the extra columns. The parse is what makes the strict object a
gate.

`point` is never the stored coordinate — `coarsenPoint` to `POINT_DECIMALS = 3`, ~110 m. `W12-T12`
§4.4 argues the case is *stronger* here than in search: a results map is many pins at a zoom the list
chose, a profile is one named person.

`memberSince` is `createdAt` as an ISO-8601 UTC string — the first datetime on the wire in
`packages/contracts` and the convention `W12-T12` Q2 set deliberately.

### 2.7 Locale resolves category names server-side

`Accept-Language: en` → `name_en`, anything else → `name_es`, decided in the route so the client never
sees the pair. Identical to `W3-T05` §2.8, and identical to what the MSW handler already does.

### 2.8 The mock stays, and says why

`apps/web/mocks/provider.ts` and the `*/providers/:id` handler are **not** deleted here. Nothing
seeds providers — `auth-demo-users` is the only seeder — so deleting them today points `pnpm dev` at
a correct endpoint over an empty table, and takes `tests/mocks.test.ts`'s contract criteria with them.
`W3-T10` owns the retirement, behind a demo seeder, on exactly the terms `W3-T05` settled for
`*/search`.

`provider.ts`'s header currently says *"When `W3-T07` lands, this file is deleted, not migrated"*.
That is now wrong, and a comment that is wrong about the future is worse than no comment: it is
updated to name `W3-T10` and to say why it outlived the endpoint.

### 2.9 Tests

Two suites, split the way `W3-T05` split them.

`apps/api/tests/provider.test.ts` — the HTTP boundary, no database. The route takes a
`ProviderRepository`, so a stub that records its calls proves the prefix, both error shapes, that a
rejected id costs no lookup, the locale, and the outbound parse. A raw stored coordinate fed through
the stub must fail `SearchPointSchema` — the privacy rule asserted as a failure, not a convention.

`apps/api/tests/provider-live.test.ts` — against real Postgres, gated on `STACK_LIVE=1`, in a
migrated scratch database (`w3t07_provider`) as `search-live.test.ts` does it. What only a database
can prove: the `Decimal` conversions, the category join and its `is_active` filter, that a null radius
and a quote-only provider both serve 200, that a provider with no base address serves 404, and that
no response carries `line1`, `line2`, `userId` or `baseAddressId`.

`packages/testing`'s `ProviderProfileInput` is widened in this PR (`MEM-2026-09-17-10`) rather than
worked around a third time — `serviceRadiusMetres` and `hourlyRateCents` become nullable and
`baseAddressId` is added, matching `schema.prisma`. Agreed with the operator; flagged for `agent-qa`
as the owner of shared fixtures.

## 3. Acceptance criteria

| # | Criterion |
|---|---|
| AC1 | `GET /api/providers/:id` is registered; `GET /providers/:id` (no prefix) answers the 404 envelope. |
| AC2 | A malformed `:id` answers `400 VALIDATION_FAILED` with `details.issues`, and no database query is issued. |
| AC3 | A well-formed uuid with no row answers `404 NOT_FOUND` in the `W1-T01` envelope. |
| AC4 | A provider with `base_address_id IS NULL` answers `404 NOT_FOUND`, not a 500. |
| AC5 | A provider with `service_radius_metres IS NULL` answers 200 with `serviceRadiusMetres: null`. |
| AC6 | A provider with `hourly_rate_cents IS NULL` answers 200 with `hourlyRateCents: null`. |
| AC7 | `ratingAvg` and the address coordinates cross the boundary as JSON numbers, never `Decimal` objects. |
| AC8 | `memberSince` is `createdAt` as an ISO-8601 UTC string. |
| AC9 | `categories` carries only `is_active` categories, ordered by `position` then `slug`. |
| AC10 | `Accept-Language: en` returns `name_en` category names; anything else returns `name_es`. |
| AC11 | No response carries `line1`, `line2`, `userId` or `baseAddressId`; a raw coordinate fails `SearchPointSchema` in a test. |
| AC12 | The response is parsed through `ProviderProfileSchema` in the handler. |
| AC13 | `packages/testing`'s `ProviderProfileInput` expresses a null radius, a null rate and a `baseAddressId`, with a test. |
| AC14 | The `*/providers/:id` MSW handler still answers, and the web suite is green. |

## 4. Out of scope

`W3-T02` (the profile editor, and the base address requirement) · `W3-T10` (the seeder and the mock
retirement) · `W3-T03` (portfolio) · `W3-T08` (licence gating, blocked on `BD-07`) · badges,
certifications and individual reviews, none of which have models · a provider slug and its redirect
(`W12-T12` Q1) · `meta`/canonical/JSON-LD (`W12-T14`).

## 5. Open questions and proposals

**Q1 — `ProviderProfile.baseAddressId` should be `NOT NULL`.** For `agent-contracts`, per the
operator's rule of 2026-09-17 (§2.4). It needs a migration with a backfill decision for any existing
null row and a reversible `down.sql`, and it retires `GET /api/providers/:id`'s 404-for-a-provider-
that-exists. `W3-T02` is the ticket that stops new nulls arriving; this is the one that forbids them.

**Q2 — the base address is an operating centre, not a home.** `schema.prisma:214` and
`packages/contracts/src/search.ts`'s `POINT_DECIMALS` comment both say *"usually a home address"*.
The privacy behaviour is correct and does not change — a provider may still enter their home and the
endpoint cannot tell — but the stated *purpose* is wrong, and it is the sentence a future reader will
reason from. A comment fix in both files, `agent-contracts`'.

**Q3 — the charter glob said `professionals`.** Corrected to `providers` in this PR (§2.1). Recorded
because a charter is a boundary and editing one's own boundary deserves to be visible in review.
