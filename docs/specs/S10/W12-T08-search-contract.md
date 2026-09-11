# W12-T08 — The search contract, and mocks that are built from the factories

Task: `W12-T08` · Slice: S10 · Owner: `agent-ui` (filing) → `agent-contracts` (applying) · Issue: #208
Branch: `W12-T08-search-contract` · Run record: `W12-T08-search-contract.run.md`
Design: [ADR-011](../../adr/ADR-011-web-application-architecture.md) §3 consequence 1, §4 ·
Builds on [`W12-T07`](W12-T07-search-schema.md), [`W1-T02`](../S1/W1-T02-list-conventions.md),
[`W1-T09`](../S1/W1-T09-test-factories.md)

---

## 1. Purpose

`W12-T07` shipped the half of ADR-011 §3 consequence 1 that `packages/ui` is allowed to hold: the
*structure* of a search — declared keys, string values, a pure function from a schema to a query
string. It could not ship the other half, and said so. `boundaries.test.ts` AC15 forbids the design
system from importing `packages/contracts` at all, so the *meaning* of a search — which keys, which
values, parsed — has nowhere to live inside `packages/ui`. It lives here.

This task is therefore two artefacts that only make sense together:

1. **The contract.** `SearchQuerySchema` and `SearchResultSchema` in `packages/contracts`, so that
   `GET /search` is defined by its real caller before `agent-discovery` implements it (`W3-T04`)
   rather than reverse-engineered from whichever form someone screenshotted.
2. **The mocks.** MSW handlers for `GET /search` and `GET /categories`, built **from** the
   `packages/testing` factories. ADR-011 §4: *"the storefront fixtures are built from the factories,
   never alongside them. A second fixture set that drifts from the first is the failure mode that
   gate exists to prevent, and a front end built in isolation is the most likely place to introduce
   one."* `W12-T09` through `W12-T13` are exactly that front end, built in exactly that isolation.

Who suffers without it: `agent-discovery`, handed an endpoint shape derived from a component's
props; and every storefront task from `W12-T09` on, which would each stand up its own bag of
plausible-looking providers and be wrong about a different field.

## 2. User stories

- **As `agent-discovery`**, I want `GET /search`'s request and response frozen before I implement
  it, so that I am building the endpoint the storefront actually calls.
- **As a storefront task (`W12-T09`…`W12-T13`)**, I want a running `GET /search` from day one, so
  that I can build a results page before the API exists.
- **As `agent-qa`**, I want the storefront's mock data to come from the same factories as every
  other test in the repo, so that "were they testing the same kind of provider?" has an answer.
- **As a visitor**, I want a shared search URL to open the search I ran, so the link is worth
  sending — which requires the URL to survive a round trip through a schema that validates it.
- **As a provider**, I want my home address never returned by a public search, so that listing my
  services does not publish where I sleep.

## 3. State machine

None. A search query is a value, and `GET /search` is a pure read. The only lifecycle here belongs
to the mock worker, and it is not a domain machine:

| From | Event | To | Guard |
|---|---|---|---|
| `off` | app boots with `import.meta.env.DEV` | `intercepting` | dev build only |
| `off` | app boots in a production build | `off` | the module is never imported |

That guard is the whole design of §4.4 and it is asserted, not assumed.

## 4. API surface

### 4.1 The files

| File | Holds | Owner |
|---|---|---|
| `packages/contracts/src/search.ts` | `SearchQuerySchema`, `SearchResultSchema`, `SearchResponseSchema`, the facets | `agent-contracts` |
| `packages/contracts/src/index.ts` | one added `export *` | `agent-contracts` |
| `packages/contracts/tests/search.test.ts` | AC1–AC12 | `agent-contracts` |
| `apps/web/mocks/handlers.ts` | `GET /search`, `GET /categories`, built from the factories | `agent-ui` |
| `apps/web/mocks/catalogue.ts` | the seeded world the handlers answer from | `agent-ui` |
| `apps/web/mocks/browser.ts` | the worker, started only in dev | `agent-ui` |
| `apps/web/tests/mocks.test.ts` | AC13–AC18 | `agent-ui` |

### 4.2 `GET /search`

Public, unauthenticated (ADR-011 §2 — all of M11 is). Request is `SearchQuerySchema`, response is
`SearchResponseSchema`, errors are the `W1-T01` envelope.

```ts
export const SearchQuerySchema = listQuery({
  sortable: ['distanceMetres'],
  defaultSort: 'distanceMetres',
  filters: { what: …, where: …, when: …, mode: … },
});
```

Composed with `listQuery` rather than declared flat, which buys three things `W1-T02` already
decided and this endpoint would otherwise re-decide badly: `limit`/`cursor`/`sort` parse identically
to the other eight list endpoints, `RESERVED_QUERY_KEYS` makes a filter named `sort` a boot failure
rather than a silent shadowing, and `strictObject` makes `?offset=40` a rejected request instead of
an ignored parameter that pages in a circle.

The four filters are `W12-T07`'s run record proposal, reconciled against the columns that exist:

| Key | Schema | Why |
|---|---|---|
| `what` | `z.string().regex(SLUG)` optional | A category *slug*, not an id: `Category.slug` is the unique, stable, URL-safe column (`W1-T05`) and `?what=fontaneria` is the URL ADR-011 §3 prints. |
| `where` | `z.string().min(1).max(120)` **required** | Free text until `GET /places/suggest` (`W3-T06`). Required because a radius search has no meaning without a centre. |
| `when` | `z.enum(['urgente','hoy','semana','flexible'])` optional | Urgency. Absent = any. |
| `mode` | `z.enum(['quote','booking'])` optional | Quote-only providers have a null `hourlyRateCents`; `booking` is the filter that excludes them. |

`what` optional and `where` required is a deliberate reconciliation, and it differs from the fixture
in `SearchBar.stories.tsx`, which marks both required. That fixture declares itself *"a fixture, not
the product's"* in its own header comment; the binding artefact is the `W12-T07` run record, which
has `where` required and `what` optional. Browsing every trade in a postcode is a real search.
Browsing every plumber in Spain is not one this product can rank.

`sortable` names **one** order, spelled exactly as the response spells it so that `pageOf` can read
a cursor off a row without a synonym in between. `distanceMetres` is computed per query and is
deterministic for a fixed centre, which is all keyset paging requires.

Sorting by rating is deliberately **not** offered, and the reason is `Q4`: `ProviderProfile.ratingAvg`
is `Decimal?`, `encodeCursor` throws on a null sort value by design, and the providers with a null
rating are the new ones — which on a cold-start marketplace is almost all of them.

### 4.3 The response

```ts
SearchResponseSchema = pageEnvelope(SearchResultSchema).extend({ facets: SearchFacetsSchema });
```

Built **on** `pageEnvelope` rather than beside it, so `items`/`page` are the frozen `W1-T02` shape by
construction and a change to `PageInfoSchema` reaches search automatically. `.extend` on a
`strictObject` preserves strictness, so the envelope stays closed.

`SearchResultSchema` is the public projection of a provider, and every field is a column that
exists today:

| Field | Type | Note |
|---|---|---|
| `id` | uuid | |
| `displayName` | string | |
| `kind` | `MANITAS` \| `PRO` | |
| `bio` | string, nullable | |
| `categories` | `{ slug, name }[]` | `name` resolved to the request locale; the client never sees `nameEs`/`nameEn` and never picks. |
| `ratingAvg` | number 0–5, **nullable** | Null is "no reviews yet", which is not 0.00 — the Prisma comment is explicit and a 0 here would rank a new provider below a bad one. |
| `ratingCount` | int ≥ 0 | |
| `hourlyRateCents` | int ≥ 0, **nullable** | Null = quote-only (`W1-T06`: integer cents, never a float). |
| `distanceMetres` | int ≥ 0 | Metres, because `ST_DWithin` on geography takes metres. |
| `city`, `province` | string | |
| `point` | `{ latitude, longitude }` | **Coarsened** — see §4.5. |

What is deliberately **not** here: `userId` (a public row that links to an account is a correlation
handed out for free), `baseAddressId`, and above all `line1`/`line2`. `W1-T05` §8 states it as a
rule — *"no response may ever return its line1/line2"* — and a provider's base is usually a home
address. AC9 is that rule as a test rather than as a comment.

Facets are two counts, because two are what a rail can render without a second query:

```ts
SearchFacetsSchema = z.strictObject({
  categories: z.array(z.strictObject({ slug, name, count })),
  kinds:      z.array(z.strictObject({ kind, count })),
});
```

No `total`. `W1-T02` decision D removed it from the page envelope because a count over a radius
query costs the query, and a facet count is that same count wearing a hat. These are counts *within
the matched set*, which the search has already scanned.

### 4.4 The mock worker

MSW lives in `apps/web/mocks/`, a sibling of `src/` and not a child of it. That is not a matter of
taste. `packages/testing/tests/factories.test.ts` walks every `.ts`/`.tsx` under `apps/web/src` and
fails on the literal string `@marketplace/testing`; the factories are a `devDependency` and a
production module importing them is the exact failure `W1-T09` built the gate for. Handlers built
from the factories therefore cannot live under `src` — and should not, because they must not ship.

`src/main.tsx` reaches them through a guarded dynamic import:

```ts
if (import.meta.env.DEV) {
  const { startMocks } = await import('../../mocks/browser.js');
  await startMocks();
}
```

`import.meta.env.DEV` is statically `false` in a production build, so Rollup drops the branch and
the dynamic import with it. AC17 asserts that on the real `vite build` output rather than trusting
it, because "tree-shaken, surely" is how a test-data package reaches production.

`mocks/**` is added to `apps/web/tsconfig.json`'s `include` and linted by the existing flat config.
An untypechecked mock is precisely the drift this task exists to prevent, and the current `include`
covers only `src`, `tests`, `eslint` and `*.config.ts`.

### 4.5 The one thing the map needs and the address rule forbids

`W12-T11` renders results on a map, so a result must carry a point. A provider's base is usually
their home. Returning `Address.latitude`/`longitude` unmodified would satisfy the letter of the
`line1` rule while publishing the doorstep to three decimal places of a metre.

The contract therefore returns `point` **rounded to three decimals** — roughly 110 m at this
latitude, which places a pin in the right neighbourhood and not on the right doorstep. Rounding is
in the contract's own helper (`coarsenPoint`) rather than left to each caller, because a rule that
every implementer must remember is a rule that one of them will forget, and the one who forgets
ships a privacy incident rather than a failing test.

This is flagged as `Q2`: 3 decimals is an engineering guess at a product/legal question, and the
number is one constant to change.

## 5. Permissions matrix

| Role | `GET /search` | `GET /categories` |
|---|---|---|
| anonymous | allow | allow |
| CLIENT | allow | allow |
| PROVIDER | allow | allow |
| ADMIN | allow | allow |

Public by design (ADR-011 §2). The access-control surface of this task is not *who* may call it but
*what comes back* — which is §4.3's exclusion list, and AC9.

## 6. Error cases

| Code | HTTP | When | UI |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | `where` absent; unknown query key; `limit` > 100; undecodable cursor; `what` not a slug | The rail keeps the last good results and marks the offending field; copy is the app's (`W12-T11`). |
| `RATE_LIMITED` | 429 | search is unauthenticated and cheap to abuse | Retry after `details.retryAfterSeconds`. |
| `INTERNAL_ERROR` | 500 | geo query fails | Error state, retry affordance. |

No `NOT_FOUND`: a search matching nothing is an empty page with `hasMore: false`, not a 404. That is
`W1-T02`'s `emptyPage`, and conflating "no results" with "no endpoint" is how an empty state becomes
an error screen.

## 7. Acceptance criteria

| # | Given / When / Then | Test |
|---|---|---|
| AC1 | Given the package, when it is imported, then `SearchQuerySchema`, `SearchResultSchema`, `SearchResponseSchema`, `SearchFacetsSchema` and `coarsenPoint` are exported from the index | `search.test.ts` |
| AC2 | Given `?where=28013`, when parsed, then `limit` is 20 and `sort` is `[distanceMetres asc, id asc]` — the `W1-T02` defaults and the appended tiebreaker | `search.test.ts` |
| AC3 | Given a query with no `where`, when parsed, then it fails — a radius search needs a centre | `search.test.ts` |
| AC4 | Given `?what=FONTANERIA` or `?what=a b`, when parsed, then it fails the slug pattern | `search.test.ts` |
| AC5 | Given `?when=mañana` or `?mode=barter`, when parsed, then it fails with the key on the issue path | `search.test.ts` |
| AC6 | Given `?offset=40`, when parsed, then it fails — the envelope is strict | `search.test.ts` |
| AC7 | Given `toSearchQuery` output for the canonical four-field declaration, when passed to `SearchQuerySchema.parse`, then it succeeds — the two halves of ADR-011 §3 compose | `search.test.ts` |
| AC8 | Given `sort=distanceMetres`, when used with `pageOf` over rows shaped like `SearchResult`, then a cursor round-trips — the sortable name is the response's name | `search.test.ts` |
| AC8b | Given `sort=ratingAvg`, when parsed, then it fails: a nullable column is not keyset-sortable (`Q4`) | `search.test.ts` |
| AC9 | Given any object carrying `line1`, `line2`, `userId` or `baseAddressId`, when parsed as a `SearchResult`, then it fails | `search.test.ts` |
| AC10 | Given `ratingAvg: null` and `hourlyRateCents: null`, when parsed, then it succeeds; given `ratingAvg: 5.5`, then it fails | `search.test.ts` |
| AC11 | Given a response with an extra top-level key, when parsed, then it fails — `.extend` did not open the envelope | `search.test.ts` |
| AC12 | Given `coarsenPoint`, when given a point, then both components carry at most 3 decimals | `search.test.ts` |
| AC13 | Given the mock catalogue, when built, then every provider, category and address came from a `packages/testing` builder — no object literal row | `mocks.test.ts` |
| AC14 | Given `GET /search?where=…`, when handled, then the body satisfies `SearchResponseSchema` | `mocks.test.ts` |
| AC15 | Given a request the schema rejects, when handled, then the mock returns the `W1-T01` `VALIDATION_FAILED` envelope with a 400 — not a 200 with an empty list | `mocks.test.ts` |
| AC16 | Given `?what=<slug>` and `?mode=booking`, when handled, then results are filtered and the facet counts match the returned set | `mocks.test.ts` |
| AC17 | Given a production `vite build`, when the bundle is searched, then no chunk contains a factory symbol or `msw` | `mocks.test.ts` |
| AC18 | Given `apps/web/tsconfig.json`, when read, then `mocks/**` is in `include` — the mocks are typechecked | `mocks.test.ts` |

## 8. Data

**No migration, and no new model.** Every field in `SearchResultSchema` is a column that `W1-T05`
already shipped on `ProviderProfile`, `Address`, `Category` or `ProviderCategory`. That is the
property that makes this contract fileable as additive rather than as an ADR: nothing frozen
changes, one module is added, one `export *` line moves.

Two indexes the endpoint will want, named here so `W3-T04` does not discover them under load —
neither is created by this task:

- a GiST index on `Address.location` for `ST_DWithin`, which `W1-T05` may already carry;
- `provider_profile_rating_id_idx` exists, and is what a rating sort would use **if** `Q4` is
  resolved — today nothing in this contract reaches it.

## 9. Out of scope

- **The endpoint.** `GET /search` is `W3-T04` (`agent-discovery`). This task defines it and mocks
  it; it does not implement it, and no Fastify route is touched.
- **The concrete `SearchSchema` instance.** `what · where · when · mode` with real categories and
  real copy is `W12-T09`/`W12-T10`, in the discovery feature folder.
- **`GET /places/suggest`, `GET /providers/:slug`, `GET /listings/:id`** — ADR-011 §4 lists them;
  only the two the storefront needs on day one are mocked here.
- **The rail's extra filters** (`valoracion`, `verificado` in the T07 story fixture). ADR-011 §3
  names four fields; the rail's extras are declared by `W12-T11` when the product declares them, and
  adding a filter is additive-free under `policies/contract-change.md`.
- **The generated client.** `W1-T03` generates it from the OpenAPI document; this task adds the zod
  source it will be generated from.
- **Ranking.** `defaultSort: distanceMetres` is an *order*, not a relevance model. `BD-03` (what a
  PLUS/PREMIUM subscription buys) explicitly includes a ranking boost, and it is a human decision.

## 10. Open questions

### ESCALATION — Q1: `GET /providers/:slug` has no slug

```
ESCALATION
Task:      W12-T08
Question:  Does ProviderProfile get a unique `slug` column, or does the public profile route key on `id`?
Options:   A) Add `slug String @unique` to ProviderProfile (additive; needs a backfill for existing
              rows and a generation rule for collisions — "juan-perez-2").
           B) Route on `id`, i.e. /providers/<uuid>.  Zero schema change, and worth less in search
              results: a uuid in a URL is not a keyword, and ADR-011 §5 makes indexability the
              commercial test for a public page.
Recommend: A, but it is agent-providers' column and W3-T02's task, not this one's.
Blocked:   Nothing here. SearchResult carries `id`; a slug is additive when it lands.
Not blocked: The whole of this task. The result card links by id until A is decided.
```

ADR-011 §4 lists `GET /providers/:slug` as a storefront endpoint, but `schema.prisma:123`'s
`ProviderProfile` has no slug — its only unique columns are `id` and `userId`. The ADR's table was
written before the column was checked. Filed rather than invented: this task does not own the
Prisma half.

### ESCALATION — Q2: how coarse is a coarsened point?

```
ESCALATION
Task:      W12-T08
Question:  Is rounding a provider's map pin to 3 decimal places (~110 m) the right privacy/utility trade?
Options:   A) 3 decimals (~110 m). A pin in the right block. Current implementation.
           B) 2 decimals (~1.1 km). Safe, and useless at city zoom — every provider in Chamberí
              stacks on one point.
           C) Return the service-area circle instead of a point, and no pin at all.
Recommend: A, with the constant named and tested so that changing it is one line.
Blocked:   Nothing. The constant ships at 3 and W12-T11 can render against it.
Not blocked: Everything else.
```

A provider's base address is usually their home (`schema.prisma:129`). This is a product and
possibly a legal question wearing an engineering costume, and the honest thing is to name the number
rather than let it be an accident of whoever wrote the `toFixed`.

### Q3 — why is `when` an enum here when no `Urgency` enum exists in Prisma?

Because a search filter is a *request*, not a row. `W1-T05` shipped six tables and `Job` is not
among them, so there is no `Job.urgency` column for this to mirror and no enum to import. The four
values are `W12-T07`'s run-record proposal, and they are the vocabulary the UI already renders.

The risk is real and worth writing down: when `agent-jobs` lands `Job.urgency` (`W4-T01`), the two
lists must agree, and nothing mechanical will notice if they do not. The mitigation is that the
`W4-T01` spec is the place to check, and this paragraph is the note it will find when it greps for
`urgencia`. A shared enum in `packages/contracts` is the obvious refactor once there are two
consumers; with one, it is speculative generality.

### ESCALATION — Q4: search cannot sort by rating, and the reason is structural

```
ESCALATION
Task:      W12-T08
Question:  How does `GET /search` offer "best rated" when `ratingAvg` is nullable and keyset paging forbids that?
Options:   A) Do not offer it. Ship `sortable: ['distanceMetres']`. Current contract.
           B) Make `ratingAvg` NOT NULL DEFAULT 0. Breaks the column's stated meaning — schema.prisma:136
              says "Null = no reviews yet, which is not 0.00" — and ranks a new provider below a bad one.
           C) Sort on a non-null projection the response also carries, e.g. `ratingSort` =
              COALESCE(rating_avg, -1). Keyset-safe, additive, and puts unrated providers last
              deterministically. Costs one derived column in the response.
Recommend: A now, C when a product decision says unrated providers sort last. Never B.
Blocked:   Nothing. Distance order is the right default for a local services marketplace anyway.
Not blocked: Everything else.
```

`packages/contracts/src/pagination.ts:169` is explicit: *"keyset paging over a nullable column needs
`NULLS FIRST/LAST` agreement between the `ORDER BY` and the predicate, and getting it wrong loses
exactly the rows whose value is null."* `encodeCursor` enforces it by throwing (`:178`), which is
the correct place for it — the first page, not a silently wrong second one.

Declaring `ratingAvg` sortable would therefore have meant one of two failures, both of them in
production and neither of them visible in a unit test with seeded five-star providers: a
`PaginationError` rendered as a 500 the first time a page ended on an unrated provider, or — with
the throw worked around — every unrated provider dropping out of the result set. `ratingAvg` was in
this spec's own §4.2 until it was checked against `W1-T02`. It is written down here rather than
quietly removed, because the next person to want a rating sort will want it for good reasons.
