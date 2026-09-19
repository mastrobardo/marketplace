---
task:    W3-T01
agent:   agent-providers
session: 2026-09-18
status:  green — implemented, tested, not committed
---

# Session — W3-T01

## Goal

The real category tree. `W3-T02` validates submitted slugs against `category`, and that table holds
the four demo rows `W3-T10` seeded, all saying `requiresLicence: false` as an admitted deferral. This
ticket is the vocabulary a provider picks from, and the legal column `W3-T08` will read as fact.

## Current state

- Branch `W3-T01-category-tree`, cut from `origin/main` at `7ade5cd` (after `W3-T02` merged as #264
  and the docs branch as #265).
- **The spec is written** — `docs/specs/S3/W3-T01-category-tree.md`, all ten sections.
- **Green.** Everything in §7 is implemented and passing: `apps/api` 215 unit / **338 live, all 22
  files, nothing skipped**, `apps/web` 235, `packages/ui` 255, `contracts` 227, `testing` 33, root
  `cd-workflows` 115, `turbo run typecheck lint` 16/16. Run record:
  `docs/specs/S3/W3-T01-category-tree.run.md`.
- **The live gate is `STACK_LIVE=1` *and* `DATABASE_URL`.** `auth.test.ts` and `guard-live.test.ts`
  read the environment's database instead of building a scratch one, so with the flag alone they
  throw `ConfigError: Invalid environment: DATABASE_URL` in `beforeAll`. The local port is **5433**
  (`.env`'s `POSTGRES_PORT`), and `provider-write-live.test.ts`'s header already spelled the full
  command out. **An incomplete invocation, not a failing test** — and the reason it reads as one is
  that the run reports the rest as *skipped*, so a missing database looks like "did not apply".
- `Category` in `schema.prisma` already carries `parentId`, `position`, `isActive`,
  `requiresLicence` and the `category_parent_id_position_idx` index, from `W1-T05`. **No migration
  is needed**, which is what keeps this ticket inside a charter that forbids `schema.prisma`.
- `CategorySummarySchema` / `CategoryListSchema` exist and are frozen (`W12-T09`,
  `packages/contracts/src/catalogue.ts`). **No contract change is needed** either — `packages/
  contracts/**` is likewise `forbidden:` for this slice.
- `apps/api/src/modules/` holds `auth/`, `providers/`, `search/`. There is no `categories/` module
  and no `GET /categories` route; the storefront is still answered by the last MSW handler.

## Log

- Boot: charter (`agents/roles/agent-providers.md`), `agents/prompts/00-spec-authoring.md`,
  `agents/policies/escalation.md`, `LONG_TERM.md`, `slices/agent-providers.md`, `repo/glossary.md`,
  `TODO.md` §3 and §6, and the four artefacts that already touch categories.
- Started from a wrong premise and corrected it before any work: the operator asked to branch
  `W3-T02`, which had already merged as #264. The board's `▶ NEXT` had moved to `W3-T01`, and
  `W3-T02`'s own handoff names it. Confirmed with the operator before cutting a branch.
- **Operator decision A, 2026-09-18: the wire contract stays flat and unchanged.** The alternative
  was nesting `CategorySummarySchema` to carry children — an ADR, a change in another agent's slice,
  and a shape no current consumer reads. Flat gave the endpoint a rule worth having instead: *a
  category on the wire is a thing you can pick*, so `items` is leaves only and the two family roots
  are storage (spec §3.2).
- **Operator decision B, 2026-09-18:** draft the candidate taxonomy first and put `BD-07` to them as
  a table to rule on, rather than asking them to invent a taxonomy from nothing. That table is spec
  §10.1, twenty rows with the reason to suspect regulation beside each.
- Found while writing §3.1: **`urgencias` is not a category**, and `TODO.md` §6's one-liner is the
  only artefact that says it is. `glossary.md` calls *urgencia* `EmergencyRequest`;
  `SearchUrgencySchema = ['urgente','hoy','semana','flexible']` has been the frozen `when` dimension
  since `W12-T08`. Seeding it would make a third definition of urgency, and the only one a provider
  could accidentally *be in* — categories `['fontaneria','urgencias']` is an availability claim
  inside a column that means trade. Raised as §10.2, recommendation A (two roots), non-blocking.
- Found while writing §3.6: **the four demo slugs must be adopted, not replaced.**
  `demo-providers.ts` creates them with fixed uuids `aaaa…0001`–`0004` and `MEM-2026-09-18-1` says
  why they are fixed. Anything else duplicates a unique slug or orphans the demo world. This makes
  seeder *order* load-bearing for the first time in the pipeline — AC18 asserts the index rather
  than leaving a comment asking future editors to be careful.
- §3.4 records a modelling limit rather than hiding it: `fontaneria` belongs to both families and
  `parentId` is one column. Chose one-parent-by-usual-home because §3.2 makes the choice
  unobservable — a wrong guess costs a seeder edit and no migration.
- **Operator answered `BD-07`, 2026-09-18.** The "likely true" set confirmed whole —
  `electricidad`, `gas`, `climatizacion`, `telecomunicaciones`, `placas-solares` — and both "unsure"
  rows came back `false`. Five `true`, fifteen `false`.
- **The reforma-integral answer was worth more than the cell**, and became spec §3.5.1: *a licence
  attaches to the trade performed, not to the umbrella above it*. Tiling and wall work need nothing;
  rewiring during a renovation is gated as `electricidad` because the **work** is electrical, not
  because the job was filed under `reforma-integral`. Marking the umbrella `true` would demand a
  licence from a tiler and teach the column to mean "this job might involve something regulated" —
  a guess about scope, not a legal boundary.
  - It also vindicates `W1-T05`'s no-inheritance comment from the other direction: the flag must not
    propagate **down** either, which retroactively makes §3.4's arbitrary parent assignment safe —
    a trade's legal status is its own, never its family's.
  - The gap it leaves is real and **the operator chose it knowingly** (*"I would not put any hard
    blocker there"*): a provider listing only `reforma-integral` can be surfaced for work needing a
    gated trade by simply never claiming it. No taxonomy can close that — the table cannot know what
    a job turns out to involve. Stated in §3.5.1 and carried to §10.3 so `W3-T08` inherits it.
- **Operator correction, 2026-09-18, and the most consequential input of the session:**
  *"My idea was verification, not hard block. While you can be listed as a pro, you will get a
  'verified' badge once documents are uploaded and verified by me."* `requiresLicence: true` marks a
  trade whose claim is **checkable and worth badging**, not one that hides unverified providers.
  Became spec §3.5.2.
  - **Three artefacts said otherwise and are corrected in this PR**: `glossary.md`'s *manitas* row
    (*"cannot be surfaced for `requiresLicence` categories"*), its *profesional* row, and
    `TODO.md` §6's `W3-T08` line (*"only surface verified pros"*).
  - **The frozen contract already agreed**, which is why nothing in §4 changes:
    `packages/contracts/src/catalogue.ts` surfaces the flag so a storefront *"can render the badge
    that makes `requiresLicence` mean anything to a visitor"*. `W12-T09` modelled it as a badge
    before anyone wrote the rule down as a gate.
  - **It shrank §10.3.** That section was written against the exclusion rule, where an ungated
    `reforma-integral` was a gate to dodge. With no gate there is nothing to evade; what survives is
    an information asymmetry — a provider in `electricidad` with no documents shows a *missing*
    badge, one in `reforma-integral` alone shows nothing, so the client has no signal that the
    renovation includes regulated work. Downstream (`W4-T01`, `W4-T03`), not here.
  - The verification machinery already exists in the backlog and matches the operator's description
    exactly: `W8-T01` upload, `W8-T02` review queue (**the operator is the reviewer**), `W8-T04` the
    `VERIFIED_LICENCE` badge. `Certification` is **not yet a model** — `schema.prisma` has eleven and
    it is not among them.
  - Operator is seeking a meeting with the gremio and asking whether it exposes an **API for
    registration lookups**. That would turn `W8-T02` from human document review into a call, and
    settle `desatascos` as a side effect. `[H]`, recorded in spec §10.1 and on `BD-07`'s row.
- `fontaneria` is `false` beside three `true` rows, and §8.3 says why out loud: plumbing carries no
  national authorisation, and the moment the work touches a gas appliance it is `gas`, which does.
  A reviewer expecting plumbing to be regulated should find the reason rather than file a bug.

- **Red phase, 2026-09-18.** Plan put up as a numbered list with three findings attached and
  approved with `GO!`. Four suites: `apps/api/tests/categories.test.ts` (AC1–11, 13, 14, stub
  repository), `categories-seed.test.ts` (AC2, 15–18, 20, 21, recorder), `categories-live.test.ts`
  (`STACK_LIVE=1`), and an edited `apps/web/tests/mocks.test.ts` (AC22, AC23). All four fail on a
  missing module; `eslint` passes on all four, which is what stands in for "the assertions are
  well-formed" while an unresolved import stops any of them executing.
- **The tests decided where the wire rules live, because §7 forced it.** §7 says AC1–AC14 run
  against a stub, and AC3/AC8/AC9/AC10 are only real assertions if the **route** applies them. So
  `CategoryRepository` returns the three contract fields **plus** `parentId`, `position` and
  `isActive`, locale already resolved, and the route filters to active leaves, sorts by
  `position` then `slug`, projects and parses out. §3.8's SQL `ORDER BY` still exists and the live
  suite pins it — the boundary just does not depend on it. This is the one design decision the spec
  left open and the red phase had to close.
- **AC16 is asserted past the ledger, or it asserts nothing.** `run.ts` skips a seeder whose ledger
  row exists, so a second `db:seed` proves the ledger works. The live test calls
  `categoryTaxonomy.run()` again directly against existing rows; the unit test pins that every
  category write is an `upsert` keyed on `slug` and fails on a `create`.
- **Found while writing AC23: `apps/web/tsconfig.json` excludes `tests/fixtures` wholesale**, because
  it holds three *deliberately broken* i18n-lint fixture projects — and §8.6 moves the mock world
  into exactly that directory. AC23 would have passed by accident (`exclude` only filters the initial
  glob; TS follows `app-harness.tsx`'s import anyway), so the guard, not the typecheck, was what was
  being lost. Operator approved narrowing the exclude to the three subdirectories.
- **Found while writing AC22: deleting `browser.ts` reaches outside this slice.** `VITE_ENABLE_MOCKS`
  is set by `deploy-preview.yml` and `visual-baselines.yml`, asserted by `tests/cd-workflows.test.ts`,
  stripped by `vite.config.ts`, and pinned by `mocks.test.ts` AC19 — all of it there because
  `GET /categories` did not exist. AC22 says *"an empty handler list"* and §8.6 says *"`handlers.ts`
  and `browser.ts` go with it"*; those are different instructions, so it went to the operator.
- **Operator decision C, 2026-09-18: delete MSW as a whole.** The tests now assert the strong form —
  no `apps/web/mocks/`, no `startMocks`, no `stripMocks`, no `msw` in `package.json`, and the flag
  named nowhere. `W12-T09`'s AC19 is retired and replaced by its inverse. `tests/cd-workflows.test.ts`
  gains a preview assertion and has two inverted; three of its tests now fail because the two
  workflows still set the flag, which is green's edit.
- **The operator offered a static hardcoded category list as a stopgap, and it is not needed — the
  tests deliberately do not add one.** `shared/api.ts` already calls `GET api/categories` through the
  one `ApiClient`, and `shared/categories.ts` already degrades with `.catch(() => [])` — the rule
  `W12-T09` learned when the shell hard-depended on this endpoint and a 404 replaced the storefront
  with the 500 page. A hardcoded list would be a second definition of the taxonomy inside the
  storefront (the exact property the MSW handler was retired for) and would show a plausible grid
  while the endpoint was dead. **`W3-T01` is the endpoint**, so after green there is no gap.
- **The real cost of deleting MSW is the nightly, not preview.** Preview is fine: `W0-T28` routes
  `/api/*` to the real API and `categories.taxonomy` is not `localOnly`, so a preview database holds
  the real tree. But `visual-baselines.yml` and the nightly serve a *local* `vite preview` with no
  API, so the home page's category grid and the facet rail render their empty states. That shape is
  real and worth covering — **but the committed baselines are now wrong and the operator must
  regenerate them** by running `visual-baselines.yml`. No agent can bless an image.
- **Noted against §9, not actioned**: the operator's *"back office will actually be the writer of
  those"* is the opposite of §9's argument that an admin CRUD makes `BD-07`'s answer editable by
  whoever holds an admin session. Nothing here depends on it — the taxonomy ships as seed data and
  this endpoint is a read — but whoever builds the admin write path should meet the argument first.
- **Green phase, 2026-09-18.** Built in the handoff's order: `modules/categories/`
  (`repository.ts` + `routes.ts`), `app.ts`/`server.ts` wiring, `prisma/seed/categories.ts`, the
  registry row, `demo-providers.ts`'s decoupling, then the web deletion.
- **`localeOf` is exported from `modules/providers/routes.ts`** rather than copied a third time, as
  spec §3.7 asked. The tidier home is neutral ground, but that edit lands in `modules/search/`.
- **Four existing suites asserted behaviour this ticket reverses**, and each was rewritten rather
  than deleted — the old criterion's intent survives as a comment above the new assertion:
  `demo-providers.test.ts` AC1 (*creates four categories* → *creates none*) and AC6 (*does not
  decide `BD-07`* → *has no opinion about the column at all*), `mocks.test.ts` AC19, and
  `auth-api.test.ts`/`auth-config.test.ts` AC23, which both read `mocks/handlers.ts` to prove no
  auth route was mocked and now assert the directory's absence — a stronger form of the same claim.
  `seed-live.test.ts`'s category count became the taxonomy's.
- **A test-design correction worth keeping**: `mocks.test.ts`'s absence assertions grepped raw
  source, so the comments explaining *why* there is no mock layer failed them — `main.tsx` cannot
  say "there is no worker any more" without containing the word. Added a `code()` helper that strips
  comments first, which is what `tests/cd-workflows.test.ts` already does to YAML. **Assert code,
  not vocabulary.**
- **The recorder in `categories-seed.test.ts` had to return an `id` from `upsert`.** The seeder reads
  the row back to parent the next level, so a double that returned only its `create` argument made
  every leaf unparentable. A test double that cannot model "the database generates a key" is not
  modelling the database.
- **`VITE_ENABLE_MOCKS` was set by four workflows, not two.** `deploy-staging.yml` and
  `nightly-visual.yml` carried it as well as `deploy-preview.yml` and `visual-baselines.yml`. Found
  by grepping after the first two were cleaned — the red tests only covered the two the earlier
  survey found.
- **Code review, 2026-09-18 — five findings, four fixed, one for the operator.** All verified
  against the code before acting; the review's reasoning was right on every one.
- **The worst was mine and the spec's**: §3.8 said `ORDER BY position, slug` while §8.3 says
  `position` is per sibling set. Flattened to leaves by §3.2, both families start at 1 and
  **interleave** — the served list was `fontaneria, reforma-integral, albanileria, electricidad, …`,
  a curated order reduced to a tie-break. **AC9 and AC10 could not see it because both were written
  against one family**, and the live test mirrored the same wrong `ORDER BY` instead of checking the
  property. `CategoryNode` gained `parentPosition`; §3.8 is amended; two new tests pin family
  contiguity. *A test that mirrors the implementation's own ordering clause asserts nothing.*
- **`isActive: true` was in the upsert's shared `fields`**, so re-running the seeder after a typo fix
  would have un-retired every trade an operator had taken off the wire. Written on `create` only now.
- **`apps/web/public/mockServiceWorker.js` was still shipping** — `public/` is copied verbatim into
  `dist/` and is never in the module graph, so no bundle grep could reach it, and it contains
  neither `setupWorker` nor its own name. Deleted with its eslint ignore. *When asserting a deletion,
  `public/` is a second door.*
- **My own workflow comments asserted something false** — that a preview database would hold the real
  taxonomy because the seeder is not `localOnly`. It does not: no deploy runs `db:seed`, and
  `assertSafeTarget` refuses the whole run while `auth.demo-users` is in the registry. *Not being
  `localOnly` gets a seeder past its own gate and no further* — the gate is per-run, not per-seeder,
  which means **no** seeder currently reaches a deployed database.
  - **Operator chose the empty list, 2026-09-18**: *"For now, empty categories. Seed will come with
    /categories api."* Filed as `W0-T30`; both workflow comments rewritten to say why the grid is
    empty and to forbid papering over it with a mock.
## Blocked / escalations

**None blocking.** The MSW fork was raised on 2026-09-18 and **the operator settled it: delete it
whole** (Log, and the run record's Finding 3).

**Two operator actions are outstanding, and no agent can do either:**

1. **Regenerate the visual baselines** (`visual-baselines.yml`). The nightly now shoots a storefront
   with no API; the committed `route-es.png`/`route-en.png` show a populated grid, so the first run
   after merge diffs on both.
2. ~~Decide how the deployed databases get the taxonomy.~~ **Decided 2026-09-18**: *"For now, empty
   categories. Seed will come with /categories api."* Preview and staging answer `{items: []}` and
   render an empty grid — degraded, not broken. Filed as **`W0-T30`** on the board, because the
   blocker is bigger than this ticket: `assertSafeTarget` rejects the *whole* run when any seeder is
   `localOnly`, so **no** seeder can reach a deployed database while `auth.demo-users` is
   registered. Both deploy workflows now carry the reason inline, and the instruction not to
   reintroduce a mock to cover it.

**`BD-07` was answered by the operator on 2026-09-18** — see the Log. `TODO.md` §10.1's row is
struck through and carries the answer, so `W3-T08` does not have to find it in a spec.

One item is **provisional rather than settled**: `desatascos` is `false`, and the operator is
checking with the gremio. Recorded as provisional because the risk is asymmetric — `false` is the
permissive answer, so being wrong surfaces an unlicensed provider, while being wrong the other way
only asks for a certificate nobody needed. **It is the operator's to chase, not an agent's**; the fix
if it flips is one seeder row and one AC20 line.

## Handoff

**The spec is done, `BD-07` is answered, §7 is implemented and green, and nothing is committed.**

**Next action**: `04-refactor.md` and `05-code-review.md`, then the PR. Nothing is committed. §10.2 (`urgencias`) is the one thing still
unconfirmed; it is non-blocking and the spec builds option A (two roots), which is an additive
seeder edit to reverse.

**What green built, and why it is shaped that way:**
- `CategoryRepository = (criteria: { locale }) => Promise<readonly CategoryNode[]>`, where
  `CategoryNode` is `{ slug, name, requiresLicence, parentId, position, isActive }` — `name`
  resolved, structure kept. The **route** owns the wire rule; see the Log.
- `apps/api/prisma/seed/categories.ts` exports `TAXONOMY` (roots and leaves, `parent` as a **slug**)
  and `categoryTaxonomy: Seeder`, id `categories.taxonomy`, **not** `localOnly`.
- `buildApp` grows an optional `categories?: CategoryRepository`, registered under `/api` like the
  other three.
- `localeOf` is exported from `modules/providers/routes.ts` rather than copied a third time.
- `apps/web/tsconfig.json`'s exclude narrows from `tests/fixtures` to its three subdirectories.

**Do not redo:**
- Re-asking `BD-07`, or defaulting any row's flag. Five `true`, fifteen `false`, every one explicit
  on the row (§8.3). `desatascos` is the only provisional cell and the operator owns the re-check.
- Gating a parent or a wide category. §3.5.1 is an operator rule, and AC21 fails if any root or
  parent row carries `true`.
- Writing anything that makes `requiresLicence` exclude a provider from search, a listing or a
  booking. §3.5.2 — it is a verification and a badge. If an artefact says otherwise it is one of the
  three this PR corrected, or a fourth nobody has found yet; correct it rather than following it.
- Looking for a migration or a contract change. Neither is needed and §8.1/§8.2 say why. Both paths
  are `forbidden:` for this slice, so finding that they need no edit is the finding.
- Proposing a nested `CategorySummarySchema`. Operator settled it flat on 2026-09-18 (§3.2).
- Seeding an `urgencias` category without reading §3.1 first.
- Deleting `apps/web/mocks/catalogue.ts`, `search.ts` or `provider.ts`. They **move** to
  `tests/fixtures/`; `tests/app-harness.tsx` stubs `ApiClient` from them, and the operator
  reaffirmed this on 2026-09-18 when `W3-T10` proposed deleting them.
- Moving the wire rules into the repository to "keep the route thin". §7 requires AC3/AC8/AC9/AC10
  to be assertable against a stub, and they are not if the repository does the filtering.
- Asserting AC16 by running `pnpm db:seed` twice. That asserts the ledger. Call the seeder again.
- Re-asking whether MSW survives. It does not: operator, 2026-09-18, *"I would delete MSW as a
  whole for now."*
- Sorting the served list on `position` alone, or writing a test for the order that feeds it a
  single family. Both families start at 1; see the Log.
- Putting `isActive` in the taxonomy upsert's `update` half.
- Adding a static hardcoded category list to the storefront. `shared/categories.ts` already degrades
  to `[]` and `W3-T01` is the endpoint; a hardcoded list is a second taxonomy that hides a dead
  endpoint behind a plausible grid.
- Adding a row to `permissions.ts`. The route is public; `W2-T03`'s growth rule is that a permission
  enters with the route that guards with it, and this one guards nothing (§5).

**Carry forward to `W3-T08` and `agent-trust`:** the ticket is *verification*, not gating, and its
`TODO.md` line now says so. The five flagged trades are the categories that should **ask** for proof;
nothing about the flag may exclude. `W8-T01`/`W8-T02`/`W8-T04` are the machinery, `Certification`
does not exist yet, and the gremio API — if it exists — changes `W8-T02`'s shape entirely, so check
with the operator before building a manual review queue.

**Carry forward:** `packages/testing`'s `ProviderProfileInput` still has no `ratingAvg` — the fourth
ticket to route around it (`agent-qa`, from `W3-T10`). And with exactly twenty leaves, a provider can
now select the entire taxonomy and still pass `W3-T02`'s bound; §8.3 argues that is a trust problem,
not a validation one.

**Skills used so far**: `spec-driven-development` (the spec), `test-driven-development` (the red
phase, via `agents/prompts/02-tdd-red.md`), `api-and-interface-design`
(§3.2's flat-wire rule and §4's unreachable `400`/`404`), `security-and-hardening` (§3.5 — why a
guessed `requiresLicence` is worse than an absent one, §3.5.1's evasion, and §9's refusal to add an
admin CRUD that would make a legal boundary runtime-editable).
