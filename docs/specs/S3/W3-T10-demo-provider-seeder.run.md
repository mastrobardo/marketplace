# W3-T10 — run record

- **Branch**: `W3-T10-demo-provider-seeder`, off `main` at `627cb40`
- **Spec**: `docs/specs/S3/W3-T10-demo-provider-seeder.md`
- **Session**: `memory/sessions/2026-09-18-agent-providers-W3-T10.md`
- **Trigger**: `W3-T05` and `W3-T07` both shipped a real endpoint and both left their mock in place,
  each saying the same thing in its own header: nothing seeds a provider, so deleting the handler
  would point `pnpm dev` at a correct endpoint over an empty table.

---

## 1. Red phase

```
 FAIL  apps/api/tests/demo-providers.test.ts
Error: Cannot find module '../prisma/seed/demo-providers.js'
  imported from apps/api/tests/demo-providers.test.ts
      Tests  no tests

 FAIL  apps/web/tests/mocks.test.ts > the one handler left answers the contract
       > is the only handler, now that search and providers are real
AssertionError: expected [ …(3) ] to have a length of 1 but got 3
      Tests  1 failed | 2 passed | 14 skipped (17)
```

The first is the seeder, which did not exist. The second is the deletion, asserted before it
happened — `handlers` still had three.

## 2. Green

| Suite | |
|---|---|
| `apps/api` live (`STACK_LIVE=1`) | **230 passed**, 14 files — 207 before this task |
| `demo-providers.test.ts` | 13, DB-free, in CI's `unit` job |
| `seed-live.test.ts` | 10, behind `STACK_LIVE=1` |
| `apps/web` | 230 passed, 15 files |
| contracts 210 · ui 255 · testing 33 · root 283 | unchanged |
| `typecheck` 10/10 · `lint` clean · `format:check` clean · `build` 6/6 | |

And the command the ticket is actually about, against the local stack:

```
$ pnpm db:seed
seed: ran 1 (providers.demo-world), skipped 1 already applied.

$ psql -c '…st_distance(a.location, sol)…'
Fontanería Gómez        |15000|   328
Manitas Rivas           |15000|  1252
Electricidad Nadal      |15000|  1500
Cerrajería 24h Chamberí |15000|  1794
Clima Costa             |50000| 29763
```

The last row is the ticket in one line: 29.8 km out, covering 50, and therefore a result for
somebody standing in Puerta del Sol — where the four providers above it cover 15 km and would not
be, from there.

## 3. Four things worth writing down

### 3.1 A recording fake cannot know what a column is

Thirteen DB-free tests passed — counts, fixed ids, no credentials, `requiresLicence: false` — while
the seeder wrote an `id` to `provider_category`, a table keyed by its pair and with no such column.
A fake satisfies `create({ data })`, and an interface says nothing about which columns exist. The
live suite caught it on its first run; nothing else could have. `MEM-2026-09-18-1`.

That is the same trade `packages/testing`'s `FactoryClient` makes deliberately, and the same reason
it carries a live criterion to close it — so the lesson is not "fakes are bad" but **one assertion
that actually writes, however thorough the fast suite is**.

### 3.2 The ticket asked for two files to be deleted and for one of them to stay

`mocks/search.ts` has a second caller: `tests/app-harness.tsx` builds the `ApiClient` stub every
component suite renders against from `searchCatalogue`, and `mocks/provider.ts` gives it
`profileFromCatalogue`. `W12-T11` extracted both precisely so the MSW handler and the stub could not
disagree about which providers match, in what order, with what facet counts.

So what retires is the two **handlers**, which is the part that changes behaviour: `pnpm dev` and
every preview now read search and profiles from the API. The modules keep their second caller.
Put to the operator rather than decided here, because "delete the file" and "keep the function"
were both in the ticket. Answered 2026-09-18.

### 3.3 Eight criteria were re-homed, and one of them was the only one of its kind

Deleting the handlers deletes the tests that go through them — `W12-T08`'s AC14–AC16 and
`W12-T12`'s AC10–AC13. Spec §3.1 maps all eight. Six were already asserted against the real
endpoints in `search.test.ts`, `search-live.test.ts`, `provider.test.ts` and
`provider-live.test.ts`; two needed writing, and both are in `seed-live.test.ts`:

- **AC14** — a search body satisfies `SearchResponseSchema`, *whole*. The live search suite works at
  the repository level and asserts fields; nothing had parsed an entire response off the route.
- **AC11** — every id the search returns resolves through `GET /api/providers/:id`. **The only
  criterion in the repo that checked the two endpoints against each other**, and the failure it
  guards reaches a visitor as a working list of links to nothing. It is now asserted over seeded
  data with both endpoints real, which is strictly more than it used to prove.

### 3.4 Real coordinates, because a map is coming

The catalogue places providers by metres north and east of Puerta del Sol, which is right for a mock
whose distances are arithmetic. Its "Alcalá de Henares" is 41 km due north — in the sierra. These
rows go into PostGIS and will be drawn by `W3-T06`, so the seeder uses Alcalá's real location
(40.482, -3.364): 29.8 km, and east, where the city is.

The radius moved with it. The mock excluded that provider from a Madrid search (its search used a
flat 40 km); the seeded one covers 50 km and is returned, because after `W3-T05` the provider's own
radius is what decides. Same five providers, one better demonstration.

## 4. What this does not do

- **Seed on deploy.** No workflow seeds anything; the seeder is merely *allowed* to run outside a
  laptop now (§2.3). Wiring it is `W0-T24`'s activation work.
- **Empty `apps/web/mocks/`.** `GET /categories` stays until `W3-T01`, which is blocked on `BD-07`.
  When it goes, the directory should move to `tests/fixtures/` in one step rather than two.
- **Decide `BD-07`.** Every seeded category says `requiresLicence: false` and names the ticket.
  The storefront's licence badge stays exercised by the component tests, which read
  `buildCatalogue()`, where `electricidad` deliberately says `true`.
- **Widen `packages/testing`.** `ProviderProfileInput` still has no `ratingAvg`, so the seeder
  writes through Prisma like `W3-T05`'s and `W3-T07`'s live suites do. Still `agent-qa`'s call.
