# W3-T05 — Geo search: `GET /api/search`

```
Slice:    S5 (agent-discovery)
Task:     W3-T05  [A]
Contract: SearchQuerySchema / SearchResponseSchema — frozen by W12-T08, not touched here
Reviewers: agent-providers, agent-qa
Spec date: 2026-09-17
```

## 1. Purpose

The storefront has had a search page since `W12-T11` and no search behind it. `apps/web/mocks/`
answers `GET /search` from a hand-built catalogue, and every storefront ticket since has been
developed against that answer. This task replaces it with the endpoint — the same request schema,
the same response schema, the same paging primitives — over Postgres and PostGIS.

Nothing in the seam changes. `W12-T08` froze `SearchQuerySchema` and `SearchResponseSchema` and
`W12-T12` derived `ProviderProfileSchema` from `SearchResultSchema`; every field in the response
maps to a column that exists today. This slice may not touch `packages/contracts/**` or
`schema.prisma` and does not need to. That is the point of having spent `W12-T08` on the contract:
this is an implementation against a settled seam, not a negotiation.

### 1.1 What this is not

It is not the results UI (`W12-T11`, shipped), not the `where` autocomplete (`W3-T06`, blocked on
`OPS-12`), not licence gating (`W3-T08`, blocked on `BD-07`), and not the category tree
(`W3-T01`, same blocker). It is the endpoint, and the endpoint alone.

## 2. Design

### 2.1 The route lives under `/api`

`GET /api/search`, registered as a Fastify plugin from `apps/api/src/modules/search/`.

Not a preference — `MEM-2026-09-14-3`. `W0-T28` splits traffic at the edge by path: a Pages
`_worker.js` forwards `/api/*` to Fly and hands everything else to the static site, so a request to
`/search` is answered with the SPA's own `index.html` — a 200 full of HTML that surfaces as a JSON
parse error a long way from its cause, and only in a deployed environment. `apps/web/tests/
api-proxy.test.ts` derives the client half from the source and fails a call without the prefix.
`/health` stays at the API's root for Fly's own probes and is deliberately not reachable through the
edge.

This is also the first domain module in `apps/api`, which until now has had `/health` and
better-auth and nothing else. The layout it establishes — `routes.ts` for the HTTP boundary,
`query.ts` for the SQL, `places.ts` for the geocoder port — is what `W3-T07` will copy.

### 2.2 `where` becomes a centre through a port, not a provider

`where` is free text (`z.string().min(1).max(120)`), required, because a radius search with no
centre is `SELECT * FROM provider_profile`. Something has to turn it into a coordinate, and
`GET /places/suggest` (`W3-T06`) does not exist because `OPS-12` has not happened.

**Decision A.** A static ES gazetteer — Spanish municipalities and 5-digit postal codes mapped to a
coordinate — compiled into the module as data and resolved in memory, behind a single function:

```ts
resolvePlace(where: string): { latitude: number; longitude: number } | undefined
```

Three constraints shaped this, and they were the operator's, taken before any code was written:

1. **The database stays clean.** No table, no migration, no seeder. A real address lookup is coming
   and may well be driven by the frontend, in which case the server never stores places at all.
   A gazetteer table added now would be a table to migrate away from later.
2. **No provider is chosen yet.** Google Maps costs materially more than the alternatives. That is
   not a problem today and might be one later, and the way to keep it a later decision is to not
   bake a client into the query layer now.
3. **The role file already said so.** `agents/roles/agent-discovery.md`: *"PostGIS does the
   geography, not Google. Maps is for display and address autocomplete only — see R9, it is a cost
   risk."* and *"Cache geocoding results. Never geocode the same address twice."* An in-process
   table is the strongest form of that cache.

`resolvePlace` is the entire surface a future provider has to satisfy. Swapping in Google, a cheaper
geocoder, or deleting the thing because the frontend now sends coordinates is an edit at one seam.

**A consequence worth writing down before someone discovers it.** If the frontend does the lookup,
it has to send a coordinate — and `where: z.string()` is frozen. Adding `lat`/`lng` to
`SearchQuerySchema` is a contract change owned by `agent-contracts` and costs an ADR
(`agents/policies/contract-change.md`). Whoever picks up `W3-T06` should budget for that rather than
finding it mid-task.

**A place the gazetteer does not know** is answered `400 VALIDATION_FAILED` with an issue on
`where` — see §5 Q1, because the honest status code for this does not exist in `ERROR_CODES`.

### 2.3 The radius is the provider's, not the search's

**Decision B.** A provider matches when **they cover the searched point**:

```sql
ST_DWithin(address.location, :centre, provider_profile.service_radius_metres)
```

"Who will travel to me", not "who happens to be near me". The mock used a flat 40 km for both,
which was the right stand-in for a catalogue with no radius data and is the wrong endpoint:
`service_radius_metres` exists precisely for this, carries its own `CHECK (> 0 AND <= 200000)`, and
`schema.prisma:127` already states the consequence — *"Null until set, and a provider with no base
is not searchable."*

So the search sees a provider only when **all** of these hold:

| Condition | Why |
|---|---|
| `base_address_id IS NOT NULL` | no base, no geography — `schema.prisma:127` |
| `service_radius_metres IS NOT NULL` | "not set" is not "zero" and is not "infinite" |
| `ST_DWithin(location, centre, service_radius_metres)` | they cover the point |

`distanceMetres` is still returned — the page renders "3 km away" — but it no longer decides who is
in the set. A provider 60 km out who covers 80 km is a result; one 5 km out who covers 2 km is not.

The GiST index on `address.location` (`address_location_gist`) is what makes this cheap. Note that
`ST_DWithin` with a *column* as the distance argument still uses the index for the bounding-box
stage; the exact test is per-row either way.

### 2.4 One query, and it stays one query

Search is the highest-traffic endpoint in the product (`agents/roles/agent-discovery.md`), so the
`N+1` that would come from fetching categories per provider is ruled out by construction: the
categories are aggregated in the same statement, through `provider_category` — which `W1-T05`
declared explicitly rather than as a Prisma implicit m-n *because* this query has to join it from
raw SQL and `_CategoryToProviderProfile` is not a name to rely on (`schema.prisma:295`).

The statement is a CTE: an inner select that applies the filters and computes the distance once, and
an outer select that pages it. `$queryRaw` with parameter binding — never string interpolation of
`where`, which arrives from the URL.

Prisma's `location` column is `Unsupported("geography(Point, 4326)")` and cannot be read or written
through the client, which is stated in the schema itself. Raw SQL is not a shortcut here; it is the
only access path.

### 2.5 The cursor pages over the rounded distance

`SEARCH_SORTABLE` is `['distanceMetres']` and `W12-T08` argued at length why it is only that:
`ratingAvg` is `Decimal?`, `encodeCursor` throws on a null sort value by design, and on a
marketplace with no reviews the providers with a null rating are almost all of them.

The subtlety this implementation has to get right: **`distanceMetres` is `z.number().int()`**, so
the value that goes into the cursor is rounded. If the SQL then compares the cursor against the
*unrounded* distance, the keyset predicate and the serialised value disagree, and rows at the
boundary are either skipped or served twice — a paging bug that appears only on the second page and
only sometimes.

So the rounding happens **in the CTE**, once, and both the `ORDER BY` and the keyset predicate use
the rounded column. Ties at the same rounded metre are broken by `id`, which is what `TIEBREAKER`
and `trySort`'s appended `{ field: 'id', direction: 'asc' }` already guarantee.

Paging uses the contract's own primitives so that the endpoint and the mock cannot disagree about
`hasMore`: over-fetch `fetchLimit(limit)` rows, hand them to `pageOf`, return its `page` verbatim.
The sort spec is taken from the parsed query (`query.sort`), not hardcoded — a client may legitimately
ask for `?sort=-distanceMetres`, which the mock ignored.

### 2.6 Facets count the matched set, not the page

`SearchFacetsSchema` carries two counts, and the contract is explicit that they are *"counts within
the matched set, which the search has already scanned"* — with no `total`, because `W1-T02`
decision D removed it on the grounds that a count over a radius query costs the query.

**The mock does not do this.** `apps/web/mocks/search.ts` ends with
`facets: facetsOf([...page.items], locale)` — facets over the *page*, contradicting both the
contract's comment and its own two lines above it. On a 20-item page of a 90-provider match, the
rail currently offers counts that are a fifth of the truth and that change as the user pages.

This endpoint implements the contract: facets are aggregated over the filtered set inside the same
CTE, before paging. That is a deliberate, visible behaviour change for the storefront — the numbers
in the rail will get larger — and it is recorded here so that it reads as a fix rather than as a
regression when someone compares the two.

### 2.7 The projection, and what it must never carry

`SearchResultSchema` is a `strictObject`, and `W12-T08` is explicit that the fields which are
*absent* are doing the work: no `userId` (a public row linking to an account is a correlation handed
out for free), no `baseAddressId`, and above all no `line1`/`line2` — a provider's base address is
usually their home (`schema.prisma:129`) and `W1-T05` §8 states the rule.

`point` is never the stored coordinate. `coarsenPoint` rounds to `POINT_DECIMALS = 3` — roughly
110 m at this latitude, the right block and not the right doorstep — and `SearchPointSchema` refuses
a coordinate that has not been through it. A handler that forwards the stored value fails its own
response schema in a test rather than shipping a privacy incident that looks like a working map.

The response is therefore parsed through `SearchResponseSchema` **on the way out**, in the handler,
not merely typed. Types are erased at runtime; the parse is what makes §2.7 a gate.

### 2.8 Locale resolves category names server-side

`Category` carries `nameEs` and `nameEn`; `SearchCategorySchema` carries one `name`, and the
contract notes it is *"resolved to the request's locale by the endpoint; the client never sees the
pair"*. `Accept-Language` starting with `en` selects `nameEn`, everything else `nameEs` — matching
what the mock handlers already do, and defaulting to Spanish because the market is Spain.

### 2.9 `when` parses and filters nothing, on purpose

`SearchUrgencySchema` is in the frozen query schema, and there is nothing to filter against: there
is no `Job` table (`W4-T01`), no availability calendar (`W3-T09`), and `W12-T08` says so in the
schema's own comment. The parameter is accepted, validated, ignored, and that is stated here and in
the module rather than left for a reader to infer from a query that never mentions it.

The alternative — rejecting `when` — would break the storefront, which sends it.

### 2.10 The mock loses one handler, not the file

**Decision C.** `handlers.ts` says the mock is *"deleted, not migrated"* when this lands. Taken
literally that removes `*/categories` too, and `W3-T01` has not shipped it — plus
`apps/web/tests/app-harness.tsx` stubs `searchCatalogue` for component tests, which would have to be
rewritten inside a ticket that does not carry that scope.

So: the `*/search` handler goes, `searchCatalogue` and `catalogue.ts` stay for the harness, and
`*/categories` stays until `W3-T01`. A note in `handlers.ts` names `W3-T01` as what finally empties
it. `W3-T07` removes `*/providers/:id` on the same terms.

### 2.11 Tests

Two files, split by what they can prove without a database:

- `apps/api/tests/search.test.ts` — the HTTP boundary through `app.inject()`: the `/api` prefix,
  the 400 envelope and its `issues`, the unknown-place 400, `Accept-Language`, and the response
  parse. No database.
- `apps/api/tests/search-live.test.ts` — gated on `STACK_LIVE === '1'` like every other live suite,
  building its world through `packages/testing`'s factories (`buildProviderProfile`, `buildAddress`,
  `buildCategory`, `buildProviderCategory` + `persist.ts`), because only `auth-demo-users` is
  seeded and `W3-T01` is blocked on `BD-07`.

The `database` job runs the whole `apps/api` suite under `STACK_LIVE=1` — derived with
`pnpm --filter @marketplace/api exec vitest run`, not a hand-maintained file list — so the live
suite runs in CI on the day it lands and `ci.yml` needs no edit. (The comment at the top of
`factories-live.test.ts` claiming otherwise predates `W2-T01` and is stale; see §5 Q5.)

## 3. Acceptance criteria

| # | Criterion |
|---|---|
| AC1 | `GET /api/search` is registered; `GET /search` (no prefix) answers the 404 envelope. |
| AC2 | A query failing `SearchQuerySchema` answers `400 VALIDATION_FAILED` with `details.issues`, and no database query is issued. |
| AC3 | `?offset=40` is rejected — `strictObject`, not silently ignored. |
| AC4 | A `where` the gazetteer cannot resolve answers `400 VALIDATION_FAILED` with an issue naming `where`. |
| AC5 | A provider whose `service_radius_metres` covers the centre is returned even when far; one closer whose radius does not reach it is not. |
| AC6 | A provider with `base_address_id IS NULL` or `service_radius_metres IS NULL` never appears. |
| AC7 | `what` filters by category slug through `provider_category`; `mode=booking` excludes providers with a null `hourly_rate_cents`. |
| AC8 | `when` is accepted and changes no result. |
| AC9 | Results are ordered by rounded `distanceMetres` then `id`; `?sort=-distanceMetres` reverses the first key. |
| AC10 | Paging is a total order: walking every page with the returned `nextCursor` yields each provider exactly once, with no gap at a rounded-distance tie. |
| AC11 | `page.hasMore` and `page.nextCursor` come from `pageOf` over a `fetchLimit` over-fetch. |
| AC12 | Facets count the **matched set**, not the page: a match of 30 with a limit of 10 reports facet counts summing over all 30. |
| AC13 | No response carries `line1`, `line2`, `userId` or `baseAddressId`; a raw coordinate fails `SearchPointSchema` in a test. |
| AC14 | The response is parsed through `SearchResponseSchema` in the handler. |
| AC15 | `Accept-Language: en` returns `nameEn` category names; anything else returns `nameEs`. |
| AC16 | One SQL statement per request — no per-provider category query. |
| AC17 | The `*/search` MSW handler is gone; `*/categories` and `searchCatalogue` remain and the web suite is green. |

## 4. Out of scope

`W3-T06` (`/places/suggest` and the Maps account) · `W3-T08` (licence gating — and note AC-wise
that `requiresLicence` categories currently surface unverified providers, which is exactly what that
ticket exists to fix) · `W3-T01` (the category tree and its seed) · `W3-T09` (availability) ·
ranking beyond distance, including the `BD-03` subscription boost · `W10-T04` load testing ·
`GET /api/providers/:id`, which is `W3-T07` and the next branch.

## 5. Open questions

**Q1 — there is no 422.** `ERROR_CODES` runs 400/401/403/404/405/406/409/413/415/429/500. "That
place does not resolve" is not really a malformed request, but `VALIDATION_FAILED` is the only code
that both carries `issues` and means "look at what you sent". A dedicated code would be clearer and
costs a `packages/contracts` change owned by `agent-contracts`. Recorded, not taken.

**Q2 — facet semantics confirmed against the mock's drift** (§2.6). The contract wins here; the
storefront's rail numbers will change. Flagging to `agent-ui` at review.

**Q3 — gazetteer coverage.** How many municipalities is enough for a product that has not launched?
Starting with the provincial capitals and the postal-code prefixes around them, which covers every
seeded test case and any realistic demo, and treating an unknown place as Q1's 400.

**Q4 — ranking is distance, and only distance.** `BD-03` may buy a ranking boost with a subscription
tier, and `SEARCH_SORTABLE` has one field. When that decision lands, the boost belongs in config
(the role file requires it) and almost certainly changes the sort key — which means a cursor format
change. Nothing to do now; worth knowing the cursor is not free to reshape later.

**Q5 — a stale comment in `factories-live.test.ts`.** It says the file is not in `ci.yml`'s
hand-maintained list and therefore does not run in the `database` job. That list stopped existing at
`W2-T01`; the job now derives the suite. The comment should be corrected — not in this branch, but
it is worth an issue so the next person does not skip a live test believing it will not run.
