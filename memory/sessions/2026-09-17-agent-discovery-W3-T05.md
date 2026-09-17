---
task:    W3-T05
agent:   agent-discovery
session: 2026-09-17
status:  closed
---

# Session — W3-T05

## Goal

`GET /api/search` — the real geo-search endpoint, against the `SearchQuerySchema` /
`SearchResponseSchema` seam `W12-T08` froze and `apps/web/mocks/search.ts` has been standing in for.
Radius by PostGIS `ST_DWithin`, category and mode filters, keyset pagination, facets within the
matched set, and the privacy exclusions the contract already refuses to serialise.

## Current state

- Contracts frozen and complete; every response field maps to a column that exists today. This
  slice may not touch `packages/contracts/**` or `schema.prisma`, and does not need to.
- `apps/api` has `/health` and better-auth and nothing else — this is the first domain module, so
  it sets the pattern (`apps/api/src/modules/search/`).
- `apps/web/mocks/{handlers,search}.ts` is the executable specification: 400-before-anything,
  facet counts within the matched set, `fetchLimit` + `pageOf` over-fetch, `coarsenPoint`.
- Only `auth-demo-users` is seeded. No categories, providers or addresses — `W3-T01` is blocked on
  `BD-07`, so tests build their own world through `packages/testing`'s factories.
- Branched from `chore-memory-consolidation`, not `main`: that branch is unmerged and holds the
  TODO.md NEXT block and the `memory/repo/` entries this task must edit.

## Log

- 09:40 Three decisions taken with the operator before any code (all three recorded in the spec §2):
  - **`where` → centre**: a static ES gazetteer behind a one-function port, no table and no
    migration. The operator's constraint was explicit — a real address lookup arrives later and may
    be driven by the frontend, so *the database stays clean*; and the provider is undecided because
    Google costs materially more than the alternatives. A port with one in-repo adapter is what
    makes that a later edit at one seam instead of a rewrite.
  - **Radius**: the provider's own `serviceRadiusMetres` — "who will travel to me", not "who is
    near me". `schema.prisma:127` already says a provider with no base is not searchable.
  - **Mocks**: remove only the `*/search` handler here (and `*/providers/:id` in `W3-T07`).
    `*/categories`, `catalogue.ts` and `searchCatalogue` stay — the category box has no API until
    `W3-T01`, and `apps/web/tests/app-harness.tsx` stubs `searchCatalogue` for component tests.
- 10:20 Endpoint built and green except the escalation: `places.ts` (gazetteer port), `repository.ts`
  (one statement), `routes.ts` (parse → resolve → page → parse out), wired through `buildApp`'s
  `search?` option the way `auth?` already is. 27 boundary tests, 13 live tests.
- 10:35 **`packages/testing` cannot describe the rows this endpoint selects on.**
  `ProviderProfileInput` types `serviceRadiusMetres` and `hourlyRateCents` as non-nullable `number`
  and has no `baseAddressId` field at all, while `schema.prisma` makes all three nullable/optional.
  So the factories can express neither a provider with no radius, nor a quote-only provider, nor a
  provider with a base address — which is every distinction `W3-T05` turns on. Worked around in
  `search-live.test.ts` by taking defaults from `buildProviderProfile` and applying the nullable
  fields through Prisma. Widening the factories is `agent-qa`'s call (`escalation.md`'s table), and
  it should happen before `W3-T07` writes the same workaround a second time.
- 10:50 Decision C is entangled more than it looked, and is paused for the operator (see Handoff):
  deleting the `*/search` handler also deletes `W12-T08`'s AC14–AC16 in `apps/web/tests/mocks.test.ts`,
  **and leaves `pnpm dev`'s search page empty** — the endpoint is real but no provider, address or
  category is seeded anywhere (`auth-demo-users` is the only seeder, and `W3-T01` is blocked on
  `BD-07`). The facade is currently the only thing making that page show anything.
- 10:55 Gate state: typecheck 10/10 · lint clean · root 266 · web 239 · api 182 of 183 — the single
  red is the `coarsenPoint` regression test, by design, until the escalation is answered.
- 11:20 Operator answered both: fix the contract here (option A), and keep the `*/search` mock until
  a provider seeder exists. `isCoarse` now asks whether rounding changes the value; the property
  test was checked against the *old* predicate first and failed 18/1000, so it is a gate rather than
  a decoration. `W3-T10` cut for the seeder and the mock retirement; `handlers.ts` and `mocks/search.ts`
  now say why they outlived the endpoint, including that the mock's facets are page-scoped while the
  API's are matched-set.
- 11:35 Green: api 183/183, contracts 210, root 266, web 239, typecheck 10/10, lint clean.

## Blocked / escalations

```
ESCALATION
Task:      W3-T05
Question:  `coarsenPoint` produces values that `SearchPointSchema`'s own `isCoarse` refinement
           rejects, for ~1.63% of coordinates. Fix the predicate in `packages/contracts`
           (forbidden path for this slice), or work around it here?
ANSWERED:  A, by the operator (2026-09-17). Fixed in this branch, flagged for agent-contracts
           review, with a seeded property test over Spain's bounding box that was confirmed to
           fail against the old predicate (18/1000) before being kept. Promoted as
           MEM-2026-09-17-9.
Options:   A) One-line fix in `packages/contracts/src/search.ts`:
              `isCoarse = v => Number(v.toFixed(POINT_DECIMALS)) === v`.
              Measured: 0 failures in 100k samples. Not a shape change — no field, type or
              optionality moves — so it is an amend under `contract-change.md` §"additive is
              free", but it is still `agent-contracts`' edit to make.
           B) Leave the contract alone and stop parsing the response outbound in this endpoint.
              Cost: deletes the gate §2.7 exists for — the privacy exclusions stop being
              enforced at runtime — to work around a bug that would still be there.
Recommend: A. B trades a real safety property for a cosmetic boundary.
Blocked:   AC13 and AC14. With the outbound parse in place, `SearchResponseSchema.parse` throws
           on ~1.63% of coordinate pairs; at 20 results a page, ~27.9% of search pages 500.
Not blocked: the repository, the SQL, the routes, the gazetteer, and every other criterion.
```

**Evidence.** Over Spain's bounding box (lat 36–44, lng −9..4), 100k samples: 1.63% of coordinate
pairs produce a `coarsenPoint` output that fails `isCoarse`, because `isCoarse` asks
`Math.round(v * 1000) === v * 1000` and `40.417 * 1000` is not always exactly `40417` in a double
(`16.033 * 1000 === 16033.000000000002`). `Number(v.toFixed(3)) === v` has 0 failures on the same
sample.

**Why nothing caught it.** `packages/contracts/tests/search.test.ts` AC12 only ever coarsens `SOL`
(40.416775, −3.70379) → 40.417 / −3.704, and both happen to be exactly representable. And the
search *mock* never parses its own output — `handlers.ts` returns `searchCatalogue(...)` raw, while
only the provider handler calls `ProviderProfileSchema.parse`. So the one path that would have
exercised the refinement at volume is the one path that skips it.

## Handoff

**`W3-T05` is complete.** Endpoint, both suites, spec, run record, memory and `TODO.md` all landed on
`W3-T05-geo-search`. Gates: typecheck 10/10 · lint clean · contracts 210 · root 266 · web 239 ·
api 183/183 (`STACK_LIVE=1`).

**Next action:** `W3-T07` (`GET /api/providers/:id`) on its own branch, copying this module's split —
`routes.ts` for the boundary, a repository for the data, so the boundary tests need no database.
`ProviderProfileSchema` is derived from `SearchResultSchema` with `distanceMetres` omitted, so the
projection and its exclusions come for free; the 400-before-404 ordering in `apps/web/mocks/handlers.ts`
is the behaviour to match.

**Do not redo:**
- The `coarsenPoint` fix. It is in this branch and `W3-T07` depends on it — `ProviderProfileSchema`
  carries the same `point`, so the same ~1.63% would have hit the profile endpoint too.
- The mock removal. Deliberately not done; `W3-T10` owns it behind a demo provider seeder.

**Carry into `W3-T07`:** `packages/testing` still cannot express a provider's nullable columns
(`MEM-2026-09-17-10`) — either widen the factories first with `agent-qa`, or reuse the
`buildProviderProfile` + Prisma pattern from `apps/api/tests/search-live.test.ts` rather than
inventing a third way.
