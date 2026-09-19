# Run record — W3-T01 the category tree

```
Agent:        agent-providers
Model:        claude-opus-5
Charter rev:  1
Skills used:  spec-driven-development, api-and-interface-design, security-and-hardening,
              test-driven-development
Started:      2026-09-18   Finished: 2026-09-18
Session file: memory/sessions/2026-09-18-agent-providers-W3-T01.md
```

## Prompts

### 1. Spec

Four operator inputs shaped the spec before any test existed, and three of them changed it:
the wire contract **stays flat** (§3.2); draft the `BD-07` table and put it up for a ruling rather
than asking for a taxonomy from nothing (§10.1); **five gated trades**, with the rule that *a
licence attaches to the trade performed, not to the umbrella above it* (§3.5.1); and the correction
that outranks the rest — *"My idea was verification, not hard block"* (§3.5.2), which reversed a
rule three artefacts in this repo were carrying.

### 2. Red phase

> Please continue with next steps. I think point chapter 7 is next

§7, via `agents/prompts/02-tdd-red.md`. The plan was put up as a numbered list and approved with
`GO!`, including three findings raised before any file was written — the `tests/fixtures` exclude
(§2 below), `localeOf` being private, and the shape AC16 has to take to assert anything.

## Red phase

Four suites, no implementation. Twenty-three criteria, fifty-seven new tests — 16 + 20 + 15 in
`apps/api`, 6 in `apps/web` — and one rewritten.

```
apps/api
 FAIL  tests/categories.test.ts
   Error: Cannot find module '../src/modules/categories/repository.js'
 FAIL  tests/categories-seed.test.ts
   Error: Cannot find module '../prisma/seed/categories.js'
 FAIL  tests/categories-live.test.ts
   Error: Cannot find module '../src/modules/categories/repository.js'

 Test Files  3 failed (3)

apps/web
 FAIL  tests/mocks.test.ts
   Error: Cannot find module './fixtures/catalogue.js'

 Test Files  1 failed (1)
```

Every failure is a missing module — the behaviour, not the test. `eslint` passes on all four files,
which is what stands in for "the assertions are well-formed" while an unresolved import stops any
of them from executing.

| Suite | Criteria | Database |
|---|---|---|
| `apps/api/tests/categories.test.ts` | AC1–AC11, AC13, AC14 | no — stub repository |
| `apps/api/tests/categories-seed.test.ts` | AC2, AC15–AC18, AC20, AC21 | no — recorder |
| `apps/api/tests/categories-live.test.ts` | AC1, AC5–AC7, AC9, AC10, AC12, AC15–AC17, AC19–AC21 | `STACK_LIVE=1` |
| `apps/web/tests/mocks.test.ts` | AC22, AC23 | no |
| `tests/cd-workflows.test.ts` | AC22's workflow half — the flag is gone from both | no |

### What the tests pin that the spec left to the implementer

**1. The wire rules live in the route, not the repository.** §7 says AC1–AC14 run against a stub,
and four of them — AC3 (roots are not served), AC8 (`isActive`), AC9 and AC10 (the order) — are
only a real assertion if the *route* applies them. So `CategoryRepository` returns
`{ slug, name, requiresLicence, parentId, position, isActive }` — the contract's three fields plus
the three structural columns — with the locale already resolved, and the route filters to active
leaves, sorts by `position` then `slug`, projects, and parses on the way out. §3.8's
`ORDER BY position, slug` still belongs in SQL and `categories-live.test.ts` pins that it is there;
the boundary simply does not depend on it.

This also gives AC11 its natural home: a row with an empty name or a slug the contract rejects fails
the outbound parse and becomes a `500`, rather than being silently dropped from the menu.

**2. AC17 and AC18 are asserted without a database**, though §7 lists them under *live*. Both are
assertions over a recorder and an array — no database makes them truer, and unit placement means a
registry reorder fails CI's fast job instead of only the `database` one. Approved by the operator
before the tests were written. They are *also* asserted live, because the live seed would throw if
the order were wrong.

**3. AC16 is asserted past the ledger.** `run.ts` skips a seeder whose ledger row exists, so running
`db:seed` twice asserts the ledger and not idempotency. The live test calls
`categoryTaxonomy.run()` a second time directly, against rows that already exist — the
`category_slug_key` collision §8.4 is actually about. The unit suite pins the mechanism: every
category write is an `upsert` keyed on `slug`, and a `create` fails the test.

**4. AC19 goes through `createProviderWriter`, not `PUT /api/providers/me`**, the way
`provider-write-live.test.ts` does it. The slug resolution the criterion is about lives in the
writer; `provider-write.test.ts` already pins that the route reaches it, and building a better-auth
session here would assert `W2-T03`. Twenty slugs is also exactly `PROVIDER_CATEGORY_MAX`, so the
test doubles as the bound §8.3 flagged.

## Findings

### 1. `tests/fixtures/` is excluded from typecheck, and §8.6 sends the mock world into it

`apps/web/tsconfig.json` carries `"exclude": [..., "tests/fixtures"]`, because that directory holds
three **deliberately broken** i18n-lint fixture projects, each with its own `tsconfig.json`. §8.6
moves `catalogue.ts`, `search.ts` and `provider.ts` there — into a directory whose name, in this
repo, means *not typechecked*.

AC23 would still pass by accident: `exclude` only filters the initial file glob, so TypeScript
follows `app-harness.tsx`'s import and checks the files anyway. The guard is what is lost — nothing
would notice if that import went away.

**Resolution, approved with the plan**: narrow the exclude to the three subdirectories
(`tests/fixtures/incomplete-catalogue`, `tests/fixtures/unknown-key`, `tests/fixtures/valid`) so the
mock world is typechecked and the broken fixtures stay out of the program. `mocks.test.ts`'s
tsconfig criterion asserts both halves — the old assertion (`mocks/**/*.ts` is in `include`) is
gone with the directory it described.

### 2. `localeOf` is private, and already written twice

`modules/search/routes.ts:31` and `modules/providers/routes.ts:42` hold the same eight lines, and
§3.7 says to reuse the providers one — which is not exported. A third copy is a review failure, so
green exports it from `modules/providers/routes.ts`. The tidier home is somewhere neutral, but that
edit lands in `agent-discovery`'s file and is not this ticket's to make.

### 3. MSW is deleted whole — **operator decision, 2026-09-18**

Raised as an open fork: §8.6 says `handlers.ts` and `browser.ts` are deleted, AC22 says the suite
*"reflects an empty handler list"*, and those are different instructions. `browser.ts` is the only
thing `VITE_ENABLE_MOCKS` switches on, and that flag reaches `src/main.tsx`, `vite.config.ts`,
`deploy-preview.yml`, `visual-baselines.yml` and `tests/cd-workflows.test.ts`.

**The operator ruled: delete MSW as a whole.** So the red tests assert the strong form — no
`apps/web/mocks/` directory, no `startMocks` in the entry point, no `stripMocks` plugin, no `msw`
in `package.json` (the `"msw": { … }` worker block included), and the flag named nowhere.
`W12-T09`'s AC19 is retired with a comment explaining what it guarded and why the absence it
guarded against is now the intended state; what replaces it points the same shape the other way —
a build with the old flag still set must contain no msw.

**The operator also offered a static hardcoded category list as a stopgap. It is not needed, and
the tests do not add one.** `apps/web/src/shared/api.ts` already calls `GET api/categories` through
the one `ApiClient`, parsed by `CategoryListSchema` on the way in, and `shared/categories.ts`
already degrades — `.catch((): CategorySummary[] => [])` — a rule `W12-T09` learned when the shell
hard-depended on this endpoint and a 404 replaced the whole storefront with the 500 page. A
hardcoded list would be a second definition of the taxonomy inside the storefront, which is the
exact property the MSW handler was retired for, and it would render a plausible category grid while
the endpoint was dead. `W3-T01` **is** the endpoint, so after green there is no gap to bridge.

#### What deleting it actually costs, and it is not the preview deploy

Preview is fine and arguably better: `W0-T28` routes `/api/*` to the real API through one origin,
and `categories.taxonomy` is deliberately **not** `localOnly` (§8.4), so a preview database holds
the real taxonomy rather than a fixture.

The cost lands on the **nightly a11y pass and the visual baselines**, which serve a *local*
`vite preview` build with no API behind it at all. `tests/cd-workflows.test.ts` already said the
quiet part in its own assertion messages — *"without mocks every page renders its degraded shape"*.
With MSW gone that degraded shape is the subject: the home page's category grid renders its empty
state and the search facet rail empties.

That is a real shape a visitor can reach and it has an explicit empty state (`routes/home.tsx`
already handles *"what a naive `.map()` produces the day `GET /categories` is down"*), so it is
worth covering — but **the committed baselines are now wrong and must be regenerated** by running
`visual-baselines.yml`. That is an operator action; no agent can bless an image.

#### Files this puts outside the slice

`agent-providers` forbids only `packages/contracts/**` and `schema.prisma`, so none of this is
barred — but three of the files belong to other slices' work and are named here so review sees them
deliberately: `.github/workflows/deploy-preview.yml` and `.github/workflows/visual-baselines.yml`
(`agent-devops`), and `tests/cd-workflows.test.ts` (likewise). The red phase edits only the test;
green edits the two workflows.

### 4. The back office as the taxonomy's writer contradicts §9 — **noted, not actioned**

The operator's note that *"back office will actually be the writer of those"* is the opposite of
what §9 argues: an admin CRUD *"makes `BD-07`'s answer editable by whoever holds an admin session,
which is the opposite of a legal boundary"*. Nothing in this ticket depends on the disagreement —
`W3-T01` ships the taxonomy as curated seed data either way, and the endpoint is a read. It is
recorded so that whoever picks up the admin write path meets the argument rather than rediscovering
it, and so §9 can be amended on purpose if the operator still wants it after reading the reasoning.

## Green phase

```
apps/api      215 passed |  123 skipped        (unit)
apps/api      338 passed |    0 skipped        (live — 22 files, nothing skipped)
apps/web      235 passed
packages/ui   255 passed
contracts     227 passed
testing        33 passed
root          115 passed                       (tests/cd-workflows.test.ts)

turbo run typecheck lint → 16 successful, 16 total
```

The live run needs `DATABASE_URL` as well as the flag, because `auth.test.ts` and
`guard-live.test.ts` read the environment's database rather than building a scratch one the way
`categories-live` and `search-live` do:

```
STACK_LIVE=1 DATABASE_URL="postgres://marketplace:marketplace_local@127.0.0.1:5433/marketplace" \
  pnpm --filter @marketplace/api exec vitest run
```

Without it those two throw `ConfigError: Invalid environment: DATABASE_URL` in `beforeAll` — an
incomplete invocation, not a failure. Worth writing down because `STACK_LIVE=1` alone looks like the
whole gate and silently skips nothing: the suite reports 30 *skipped* rather than a missing
database, so the gap reads as "these tests did not apply here".

### What was built

| Path | |
|---|---|
| `src/modules/categories/repository.ts` | new — Prisma `select`, locale collapsed, ordered |
| `src/modules/categories/routes.ts` | new — the wire rule, the sort, the outbound parse |
| `src/modules/providers/routes.ts` | `localeOf` exported rather than copied a third time |
| `src/app.ts`, `src/server.ts` | an optional `categories` repository, registered under `/api` |
| `prisma/seed/categories.ts` | new — `TAXONOMY` (22 rows) and `categories.taxonomy` |
| `prisma/seed/registry.ts` | the taxonomy **before** `providers.demo-world` |
| `prisma/seed/demo-providers.ts` | `CATEGORIES` and the create loop deleted; slugs resolved |

The web side is a deletion: `apps/web/mocks/` is gone, `catalogue.ts`/`search.ts`/`provider.ts`
moved to `tests/fixtures/`, `main.tsx` starts no worker, `vite.config.ts` has no `stripMocks`,
`package.json` has no `msw`, and `VITE_ENABLE_MOCKS` is set by no workflow. The lockfile was
regenerated.

### Tests this ticket changed rather than added

Four suites asserted behaviour `W3-T01` deliberately reverses. Each was rewritten to assert the new
property, with the old criterion's intent preserved in a comment rather than deleted:

- **`demo-providers.test.ts` AC1** — *creates four categories* became *creates none*, and its
  recorder grew a `category.findMany` because the seeder now reads.
- **`demo-providers.test.ts` AC6** — *the seeder does not decide `BD-07`* is retired: `BD-07` is
  answered and this file writes no category at all. What replaced it is stronger — the seeder must
  never mention `requiresLicence`, and must resolve by slug rather than name a uuid.
- **`mocks.test.ts` AC19** (`W12-T09`) — *the flag keeps the mocks in the bundle* became *no build
  carries msw even with the flag set*.
- **`auth-api.test.ts` AC23** and **`auth-config.test.ts` AC23** (`W2-T09`) — both read
  `apps/web/mocks/handlers.ts` to prove no auth route was mocked. The file is gone, so both now
  assert the directory's absence, which is the strongest form the criterion can take.
- **`seed-live.test.ts`** — the seeded category count is the taxonomy's, not `4`.

### One test-design correction, made during green

`mocks.test.ts`'s absence assertions grepped raw source, so the comments explaining *why* there is no
mock layer failed them — `main.tsx` cannot say "there is no worker any more" without containing the
word. Added a `code()` helper that strips comments before matching, which is what
`tests/cd-workflows.test.ts` already does to YAML. The assertions are about code, not vocabulary.

## Review

`/code-review high` over the branch and the working tree. Five findings, all verified before acting
— four fixed here, one is the operator's call.

### Fixed

**1. The served order was a shuffle** — `routes.ts`, and the spec was the source.
§3.8 said `ORDER BY position, slug`; §8.3 says `position` is per sibling set. Once §3.2 flattens the
tree to leaves, both families start at 1 and interleave. The list a visitor actually got was
`fontaneria, reforma-integral, albanileria, electricidad, alicatado-solados, cerrajeria, …` — the
"curated order" reduced to a tie-break. **Neither AC9 nor AC10 could see it**: both were written
against a single family, and the live test mirrored the same wrong `ORDER BY`. `CategoryNode` now
carries `parentPosition`, both the SQL and the route sort on it first, §3.8 is amended, and two
tests pin it — one at the boundary with two interleaved families, one live asserting each family
arrives as a contiguous run.

**2. A re-run resurrected retired trades** — `prisma/seed/categories.ts`.
`isActive: true` sat in the shared `fields` object used for both halves of the `upsert`, while §3.8
makes `isActive: false` the retirement mechanism. Retire `desatascos`, let anyone fix a typo in a
`nameEn` and re-run, and it is back on the public wire. `isActive` is now written on `create` only;
a test asserts the update half never mentions it.

**3. The vendored MSW worker was still shipping** — `apps/web/public/mockServiceWorker.js`.
9.4 KB, copied verbatim into `dist/` because `public/` is never part of the module graph — so
neither `stripMocks` nor AC17's `setupWorker` grep could ever have caught it, and it contains
neither that string nor its own filename. The `msw` devDependency that regenerates it was gone, so
it was an orphan nobody could refresh. Deleted, with its `eslint.config.js` ignore, and AC22 now
asserts both `public/` and `dist/`.

**4. Two workflow comments claimed a regeneration that had not happened.** `git status
packages/ui/visual/` is clean — the committed `route-es.png` and `route-en.png` were shot with a
populated grid. Both comments now say the first run after this merges *will* diff on those two
subjects until `visual-baselines.yml` is re-run.

### Decided, not fixed

**5. Preview and staging serve an empty category list.** Operator, 2026-09-18: *"For now, empty
categories. Seed will come with /categories api."* See Findings 5 — the false claim in both deploy
workflows is corrected, and the reason the list is empty is now written where somebody debugging an
empty grid will find it.

## Findings (cont.)

### 5. Nothing seeds the deployed databases, so `GET /api/categories` returns `{items: []}` there

Raised by review and verified. My own workflow comments asserted the opposite — *"`categories.taxonomy`
is deliberately not `localOnly`, so a preview database holds the real taxonomy"* — and **that is
false**. Three facts:

- No deploy workflow runs `db:seed`. `deploy-preview.yml`, `deploy-staging.yml` and
  `release-production.yml` run `db:migrate:deploy` and nothing else.
- The preview database is branched from `sanitised-staging`, which is likewise never seeded.
- **Seeding them by hand is impossible as the registry stands.** `assertSafeTarget`
  (`prisma/seed/run.ts:38`) throws `SEED_UNSAFE_TARGET` for the *whole run* if any seeder in the
  list is `localOnly`, and `auth.demo-users` is. Not being `localOnly` gets `categories.taxonomy`
  past its own gate and no further.

So after this merges, preview and staging answer `200 {items: []}`, `loadCategories` degrades
silently, and the home grid and facet rail render empty — the regression `W12-T09` exists to
prevent, now with no MSW fallback behind it.

This is not a reason to keep MSW: a mocked taxonomy in front of a real, empty endpoint is the
facade, not the fix. But the seeding gap is real and it is **`agent-devops`' surface**, not this
slice's — `W0-T20` owns what is safe to put in a non-local environment.

**Operator decision, 2026-09-18 — the third option**: *"For now, empty categories. Seed will come
with /categories api."*

So this ships with preview and staging rendering an empty grid, degraded rather than broken, and the
work is deferred rather than dropped. What the deferral needs when it is picked up, recorded here so
it is not rediscovered:

| | |
|---|---|
| **A run-one-seeder path** — `db:seed --only categories.taxonomy`, so `assertSafeTarget` judges the filtered list | The blocker is structural: the gate is per-run, not per-seeder, so *no* seeder can reach a deployed database while `auth.demo-users` is registered |
| **A deploy step** after `db:migrate:deploy` on preview and staging | Needs the above first |

Both deploy workflows now carry the reason inline, including the instruction not to reintroduce a
mock to cover it.
