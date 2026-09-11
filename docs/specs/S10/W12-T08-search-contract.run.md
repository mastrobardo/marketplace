# Run record — W12-T08 search contract

Agent:        agent-ui (filing) → agent-contracts (applying the seam)
Model:        claude-opus-5
Charter rev:  2
Skills used:  spec-driven-development, api-and-interface-design, test-driven-development,
              documentation-and-adrs, git-workflow-and-versioning
Started:      2026-09-11
Session file: memory/sessions/2026-09-11-agent-ui-W12-T08.md

## Prompts

### 1. Spec authoring
`agents/prompts/00-spec-authoring.md` against `W12-T08` in `TODO.md` §6, with `W12-T07`'s run record
as the input artefact rather than a re-reading of the component. The operator's instruction was
"continue with W12-T08"; a numbered plan was put back and confirmed before a file was touched.

### 2. Contract proposal
`agents/prompts/01-contract-proposal.md`. The unusual part of this task is that the proposal and the
application happen on one branch: the shapes are **new**, so this is a pre-freeze proposal under
`policies/contract-change.md` ("propose freely, put the proposal in your spec"), not a post-freeze
amendment. Nothing frozen changed — one module added, one `export *` line.

### 3. TDD red
`agents/prompts/02-tdd-red.md`. `packages/contracts/tests/search.test.ts` written in full against a
`src/search.ts` that did not exist, then `apps/web/tests/mocks.test.ts` against a `mocks/` that did
not exist.

### 4. Implementation
`agents/prompts/03-implement-green.md`, twice — the contract, then the handlers.

## Red phase

```
 FAIL  tests/search.test.ts > AC12 … TypeError: Cannot read properties of undefined (reading 'safeParse')
 Test Files  1 failed (1)
      Tests  18 failed (18)
```

## Green phase

```
packages/contracts   Test Files  5 passed (5)    Tests  179 passed (179)
apps/web             Test Files  7 passed (7)    Tests   43 passed  (43)
packages/testing     Test Files  1 passed (1)    Tests   29 passed  (29)   ← the W1-T09 gate
turbo typecheck lint test                        Tasks: 22 successful, 22 total
```

## Two things the tests caught that the spec had wrong

### 1. `ratingAvg` was declared sortable, and it cannot be

The spec's §4.2 shipped `sortable: ['distanceMetres', 'ratingAvg']` until it was checked against
`W1-T02`. `ProviderProfile.ratingAvg` is `Decimal?`; `pagination.ts:178` throws on a null sort value
by design, because keyset paging over a nullable column silently loses exactly the rows whose value
is null. The providers with a null rating are the unrated ones — on a marketplace that has not
launched, nearly all of them.

So the failure would have been a 500 the first time a rating-sorted page ended on an unrated
provider, or — with the throw worked around — every new provider vanishing from the results. Neither
is visible in a unit test seeded with five-star providers. Corrected to one sortable field before
any code was written, and escalated as `Q4` with the three options rather than quietly dropped.

### 2. AC17 caught a 511 KB mock bundle shipping to production

`src/main.tsx` guards the MSW import with `import.meta.env.DEV`, which is the documented pattern and
is **not sufficient**. Rollup resolves a dynamic import while building the module graph, before the
`false` branch is minified away. The first AC17 run failed on the real build output:

```
AssertionError: dist/assets/browser-GHq_Y-HS.js contains a seeded provider:
  expected 'var e=/(%?)(%([sdijo]))/g;…' not to contain 'Fontanería Gómez'
```

`dist/assets/browser-GHq_Y-HS.js` was 511 KB of MSW plus the whole seeded catalogue, and
`grep -o 'browser-[A-Za-z0-9_-]*\.js' dist/assets/index-*.js` confirmed the entry chunk *referenced*
it — not merely emitted-and-orphaned.

Fixed structurally rather than by tuning the guard: `vite.config.ts` gains a `stripMocks()` plugin
that resolves `mocks/browser` to two empty exports in production builds, so the graph edge does not
exist. The stub chunk is now 0 bytes. This is the difference between a guard that depends on a
bundler's dead-code elimination and one that does not, and it is the entire reason AC17 was written
against a build instead of against the source.

## Deviations from spec

- `sortable` reduced from two fields to one — see above; the spec was corrected before implementation
  and carries the reasoning as `Q4`.
- `vite.config.ts` gained a build plugin, which §4.4 did not anticipate. It is the smaller change:
  the alternative was moving the mock bootstrap out of `main.tsx` entirely.
- `apps/web/eslint.config.js` and `.prettierignore` ignore `public/mockServiceWorker.js`, vendored by
  `msw init`. It carries its own `eslint-disable` header, which our config reports as an unused
  directive — a warning nobody can action on a file that is regenerated on every msw upgrade.

## Known gap, carried deliberately

`buildProviderProfile` has no `ratingAvg`, and types `hourlyRateCents` as non-nullable where the
column is `Int?`. The builder predates both (`W1-T09` vs `schema.prisma:136-137`). `mocks/catalogue.ts`
therefore carries `ratingAvg` and `hourlyRateCents` **beside** the profile rather than inside it, and
says so in a comment. The alternative was an `as` cast, which would have hidden a real drift between
the factories and the schema behind a type assertion.

Widening the factory is `agent-contracts`' change and `W1-T09`'s file, not this task's. Flagged here
because the next person to build a provider fixture will hit it, and because it is the one place in
this change where the mocks and the schema are knowingly not the same shape.

## Human input received

- The operator confirmed the numbered plan before implementation, including the two decisions put
  back explicitly: `providers/:slug` has no slug column (filed as `Q1`, not invented), and
  `ratingAvg` goes on the wire as a `number` rather than a money-style string.

## Self-assessment

- **Weakest part of this change**: `mocks/catalogue.ts`'s `PLACES` table. A mock has to answer
  "where is 28013?" somehow, and a six-row lookup is a stand-in with an expiry date (`W3-T06`). It is
  the thing most likely to grow into a fake postcode database if nobody deletes it.
- **What a reviewer should look at hardest**: the `stripMocks()` plugin in `vite.config.ts`. It is the
  only thing standing between the factories and a production bundle, AC17 is the only thing standing
  behind it, and AC17 is the slowest test in the repo — so it is also the one most likely to be
  weakened by someone trying to speed the suite up. If that test goes, the guarantee goes with it.
- **What is not proven**: the browser half of MSW. `tests/mocks.test.ts` drives the handlers through
  `setupServer` (node). The dev server was smoke-tested by hand — `/mockServiceWorker.js` serves 200
  and `main.tsx` still carries the import in dev — but no automated test starts the worker in a real
  browser. `W12-T11` will be the first task to find out if that is a problem.
