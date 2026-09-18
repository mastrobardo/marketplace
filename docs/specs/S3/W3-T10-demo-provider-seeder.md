# W3-T10 — A demo provider seeder, and the end of the storefront's search mock

- **Slice**: S3 Providers (`agent-providers`)
- **Decides**: where the storefront's providers come from at development time. After this ticket
  that is Postgres, not MSW.
- **Unblocks**: nothing formally, and it is the last thing standing between the storefront and real
  data — `W3-T05` and `W3-T07` made both endpoints real and both mocks outlived them.

---

## 1. Purpose

`GET /api/search` and `GET /api/providers/:id` are real. `apps/web/mocks/` still answers both,
because **nothing seeds a provider**: `auth.demo-users` is the only seeder, so deleting the handlers
today would point `pnpm dev` at a correct endpoint over an empty table — a search page that works
perfectly and shows nothing.

So the seeder comes first and the handlers go with it, in one ticket, because either half alone
leaves the repo in a worse state than it is now.

## 2. The seeded world

**It is `apps/web/mocks/catalogue.ts`, persisted.** The mock world was designed for exactly this
job — five providers around Madrid with one out of town, one quote-only, one unrated — and
reproducing it means the storefront looks the same the day the handlers are deleted. A different
demo world would make the change look like a regression to anyone who had the old one on screen.

| Provider | Kind | Categories | Rating | Rate | Where | Radius |
|---|---|---|---|---|---|---|
| Fontanería Gómez | `PRO` | fontanería | 4.7 (31) | 42 €/h | Madrid, ~0.5 km | 15 km |
| Electricidad Nadal | `PRO` | electricidad, climatización | 4.2 (12) | **quote-only** | Madrid, ~2 km | 15 km |
| Manitas Rivas | `MANITAS` | fontanería, cerrajería | **unrated** | 24 €/h | Madrid, ~1.7 km | 15 km |
| Cerrajería 24h Chamberí | `PRO` | cerrajería | 3.9 (58) | 55 €/h | Madrid, ~2.3 km | 15 km |
| Clima Costa | `MANITAS` | climatización | 5.0 (3) | 31 €/h | Alcalá de Henares, ~30 km | **50 km** |

Three of those rows are load-bearing rather than decorative, and each is a case the storefront has a
branch for: the quote-only provider is what `?mode=booking` excludes and what renders as "presupuesto"
instead of a price; the unrated one is the cold-start card; and **Clima Costa's 50 km radius is
`W3-T05`'s headline rule made visible** — *who will travel to me*, not *who is near me*. A Madrid
search returns it at 30 km because its own radius reaches, where every other provider here covers
15 km and would not. That is the one thing about this search that surprises people.

The coordinates are **real**, not the catalogue's metre offsets from Puerta del Sol. The mock's
arithmetic put "Alcalá de Henares" 41 km due north, which is in the sierra; these rows are read by
PostGIS and drawn on a map by `W3-T06`, so a city name and a point that disagree is a bug waiting
for a map to reveal it.

### 2.1 Categories, and not deciding `BD-07` by accident

Four categories, the same slugs the catalogue uses, **all with `requiresLicence: false`** and a
comment naming `BD-07`. The flag is a legal boundary that a human has to answer (`W3-T01`,
`W3-T08`); a demo seeder that guesses it puts a guess in a column a later ticket will read as fact.

The storefront's licence badge stays exercised, because the component tests read `buildCatalogue()`,
where `electricidad` deliberately carries `true` — so the seeder gives up nothing that was being
tested.

### 2.2 The seeder creates its own users, and must

`auth.demo-users` is `localOnly`; this one is not (§2.3). A seeder that attached its profiles to
`provider@marketplace.local` would therefore work on a laptop and fail in every environment where
the local-only seeder correctly refuses to run. Each demo provider gets its own `user` row, with no
`account` row — so none of them can sign in, which is the point of the next section.

### 2.3 Not `localOnly`, and why that is safe

`auth.demo-users` carries that flag because its rows have a **published password**: a known
credential reaching an environment somebody demos is a real account somebody else can use. Nothing
here has a credential, a phone number, a licence number or a real person's name. The rows are
invented businesses at approximate coordinates.

What that buys: a preview or staging database *can* be seeded and demo a working storefront, which
the moment the handlers are deleted is the only way any deployed environment shows a result at all.
**Wiring a deploy to run it is not this ticket** — nothing seeds on deploy today, and that is
`W0-T20`'s and `W0-T24`'s territory.

## 3. What is retired

The two **MSW handlers** — `GET *//search` and `GET *//providers/:id` — and with them MSW's role in
serving anything but categories. `pnpm dev` and every preview then read both from the API.

`mocks/search.ts` and `mocks/provider.ts` **stay**, and the ticket's own text is why: it says to
delete them *and* says `searchCatalogue` stays because `tests/app-harness.tsx` stubs it for
component tests. Both cannot hold. `W12-T11` extracted those two modules precisely so that the MSW
handler and the component-test stub could not disagree about which providers match, in what order,
with what facet counts — and deleting them would put that second definition back, in the harness.
So they lose their HTTP wrapper and keep their second caller. Operator's call, 2026-09-18.

`mocks/catalogue.ts` and the categories handler stay for `W3-T01`, which is what finally empties the
directory. **When it does, the whole directory should move to `tests/fixtures/` in one step** rather
than be dismantled in two.

### 3.1 Where the handlers' criteria go

They are `W12-T08`'s criteria *about the contract*, asserted through a handler that is being
deleted. They survive as criteria about the real endpoint:

| `mocks.test.ts` | asserts | survives as |
|---|---|---|
| AC14 — a search body satisfies `SearchResponseSchema` | the whole body parses | **new** in `seed-live.test.ts` — the live search suite asserted fields, never the whole body, and it works at the repository level with no route in the path |
| AC15 — a rejected query is a 400 envelope | `what=FONTANERIA`, missing `where` | `search.test.ts` — "rejects a `what` that is not a category slug", "rejects a query with no `where`" (DB-free, already green) |
| AC16 — `what` filters and the facets describe the returned set | filter + facet arithmetic | `search-live.test.ts` AC7, AC12 |
| AC16 — `mode=booking` excludes the quote-only provider | the booking filter | `search-live.test.ts` AC7 |

`W12-T12` put four more criteria through the provider handler, and they go the same way:

| `mocks.test.ts` | asserts | survives as |
|---|---|---|
| AC10 — a seeded id parses as the contract, with no leaks | the projection | `provider.test.ts` "serves a body that is exactly the contract"; `provider-live.test.ts` "never carries an address line, a user id or a base address id" |
| AC11 — every id the search returns resolves | **the two endpoints agree** | **new** in `seed-live.test.ts` — over the seeded world, with both endpoints real |
| AC12 — an unseeded uuid is a `NOT_FOUND` envelope | the 404 | `provider.test.ts`, `provider-live.test.ts` |
| AC13 — a malformed id is `VALIDATION_FAILED`, not `NOT_FOUND` | 400 before 404 | `provider.test.ts` "does not treat a malformed id as a missing provider" |

Two of the eight need writing — AC14 and AC11 — and both are in `seed-live.test.ts`. The rest is a
mapping, recorded here so the criteria are demonstrably re-homed rather than quietly dropped, which
is the failure `W3-T05` and `W3-T07` both refused to commit when they left the mocks in place.

AC11 is the one that was worth having: it is the only criterion that checked the *two* endpoints
against each other, and that failure reaches a visitor as a working list of links to nothing.

## 4. Acceptance criteria

- **AC1** — `pnpm db:seed` on an empty local database creates 4 categories, 5 users, 5 addresses,
  5 provider profiles and 7 provider-category links.
- **AC2** — every id is fixed, so a `db:reset` + re-seed produces the same world, and a link in a
  pull request still resolves tomorrow.
- **AC3** — the seeder is ledgered: a second `pnpm db:seed` reports it skipped and writes nothing.
- **AC4** — it does not depend on `auth.demo-users` having run; it creates its own users.
- **AC5** — it is not `localOnly`, holds no credential and no personal data, and `assertSafeTarget`
  therefore permits a non-local target.
- **AC6** — every seeded category carries `requiresLicence: false`, with `BD-07` named in the file.
- **AC7** — the world is searchable: `GET /api/search?where=28013` returns all five providers,
  ascending by distance, with Clima Costa last at ~30 km — a provider whose own radius reaches
  where a 15 km one would not.
- **AC8** — `what=fontaneria` returns exactly the two plumbers, and `mode=booking` excludes the
  quote-only provider.
- **AC9** — every seeded provider id resolves through `GET /api/providers/:id` with a body
  `ProviderProfileSchema` accepts. No provider in this world answers 404: all five have a base
  address (`W3-T07` §2.4).
- **AC10** — `mocks/handlers.ts` exports exactly one handler, `GET /categories`.
- **AC11** — AC14's and AC11's assertions exist against the real endpoints; §3.1's two tables are
  the mapping for the other six.
- **AC12** — the storefront's component suites still pass unchanged, and the production build still
  contains no `msw` and no factory data (`mocks.test.ts` AC17/AC18 untouched).

## 5. Out of scope

- **Seeding on deploy.** No workflow seeds anything today; making one is `W0-T24`'s activation work.
- **The categories handler and `mocks/catalogue.ts`** — `W3-T01`, which is blocked on `BD-07`.
- **Moving `mocks/` to `tests/fixtures/`** — one move, when `W3-T01` empties it (§3).
- **`ratingAvg` in `packages/testing`.** The builder still has no field for it, so the seeder writes
  it through Prisma like `W3-T05`'s and `W3-T07`'s live suites do. Still `agent-qa`'s call.
