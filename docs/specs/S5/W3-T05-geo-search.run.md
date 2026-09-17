# W3-T05 — run record

```
Agent:   agent-discovery     Model: claude-opus-5
Branch:  W3-T05-geo-search   Spec: docs/specs/S5/W3-T05-geo-search.md
Session: memory/sessions/2026-09-17-agent-discovery-W3-T05.md
Date:    2026-09-17
```

## Prompts

### 1. Sequencing

The operator asked to "continue with next tasks — W3T5 and W3T7". The ids were confirmed against
`TODO.md` (`W3-T05`/`W3-T07`, zero-padded) rather than assumed, and the NEXT block named exactly
those two, in that order, one branch at a time.

### 2. Three decisions before any code

The spec's §2.2, §2.3 and §2.10 were taken with the operator **before** implementation, because each
changed what would be built rather than how. That is the whole reason this run has no rework in it:
the expensive question — what `where` resolves through, when there is no Maps key — was answered
first, and the answer came with a constraint (*the database stays clean; the lookup may end up
frontend-driven; Google costs more than the alternatives*) that produced a port instead of a table.

## Red phase

`tests/search.test.ts` first: 26 assertions over the HTTP boundary against a recording stub, so the
prefix, the 400s, the locale, the sort, the paging and the outbound parse are all provable without a
database. It failed on `Cannot find module '../src/modules/search/places.js'` — the right red.

`tests/search-live.test.ts` second: 13 criteria over a migrated scratch database, each fixture
existing to make exactly one row of §2.3's table pass or fail.

## Green phase

`places.ts`, `repository.ts`, `routes.ts`, and a `search?` option on `buildApp` mirroring `auth?`.
Both suites went green without a correction round. The live suite passed on its first run, including
the single-statement assertion and the matched-set facet counts.

## What building it caught

### 1. The contract rejected its own output, and would have 500'd a quarter of all searches

`coarsenPoint` is the contract's helper and `SearchPointSchema` is the contract's refinement, and
for **~1.63% of coordinates the second rejected the first**. `isCoarse` asked
`Math.round(v * 1000) === v * 1000`; scaling reintroduces exactly the floating-point error that
rounding removed, so `40.764 * 1000` is `40763.99999999999`.

Found by §2.7 doing its job — the endpoint parses its own response, so the first realistic
coordinate that failed produced a 500 rather than a wrong map pin. At `PAGE_LIMIT_DEFAULT` = 20
results a page, **about 28% of search pages would have carried at least one**.

Nothing had caught it because `packages/contracts/tests/search.test.ts` AC12 only ever coarsens
Puerta del Sol, which is exactly representable — and the search *mock* never parses its own output
(`handlers.ts` returns `searchCatalogue(...)` raw; only the provider handler calls
`ProviderProfileSchema.parse`). The one path that would have exercised the refinement at volume was
the one path that skipped it.

Escalated rather than patched around, per `contract-change.md`: `packages/contracts/**` is a
`forbidden:` path for this slice. The operator chose the one-line fix in this branch, flagged for
`agent-contracts` review. `isCoarse` now asks *"does rounding change it?"* —
`Number(value.toFixed(POINT_DECIMALS)) === value`.

**The new test was verified to fail against the old predicate before being kept** — 18 rejections in
1000 samples. A property test that has never seen the bug is a property test nobody should trust.

### 2. The factories cannot describe the rows this endpoint selects on

`ProviderProfileInput` types `serviceRadiusMetres` and `hourlyRateCents` as non-nullable `number`
and has no `baseAddressId` at all, while `schema.prisma` makes all three nullable or optional. So
`packages/testing` can express neither a provider with no radius, nor a quote-only provider, nor a
provider with a base address — which is every distinction `W3-T05` turns on.

Worked around in the live suite by taking defaults from `buildProviderProfile` and applying the
nullable fields through Prisma, with the reason written at the call site. Not fixed here: widening
shared fixtures is `agent-qa`'s (`escalation.md`'s table), and it should land before `W3-T07` writes
the same workaround a second time.

### 3. The mock counts facets over the page; the contract says the matched set

`apps/web/mocks/search.ts` ends `facets: facetsOf([...page.items], locale)` — contradicting both the
contract (*"counts within the matched set"*) and its own comment two lines above. On a 20-item page
of a 90-provider match the rail has been showing a fifth of the truth, changing as the user pages.

The endpoint implements the contract. The divergence is deliberate and recorded in both files so it
reads as a fix rather than a regression when someone compares them.

### 4. "Delete the mock when this lands" described something the repo cannot do

The instruction in `handlers.ts` was written before anyone noticed that **nothing seeds providers**.
Removing `*/search` would point `pnpm dev` at a correct endpoint over an empty table, and would also
delete `W12-T08`'s AC14–AC16, which are criteria about the *contract* that happen to be asserted
through the handler.

Raised with the operator mid-task rather than either following it literally or quietly ignoring it.
Outcome: the mock stays, `W3-T10` retires it behind a demo seeder, and both files now say why.

### 5. Keyset paging has to compare the number that went into the cursor

`distanceMetres` is `z.number().int()`, so the cursor carries a rounded value. Comparing it against
an unrounded `ST_Distance` would skip or repeat rows at a page boundary — a bug that appears only on
the second page and only sometimes. The rounding happens once, in the CTE, and both the `ORDER BY`
and the predicate use the rounded column. AC10 walks every page and asserts each provider appears
exactly once.

## The evidence

```
typecheck   10/10
lint        clean
contracts   210 passed
root        266 passed
web         239 passed
api         183 passed   (STACK_LIVE=1, incl. 13 live geo criteria)
```

The live database is on port **5433** locally (`POSTGRES_PORT` in `.env`), not 5432. An initial run
against 5432 produced 23 `auth.test.ts` failures that were pure environment error — worth knowing
before someone reads a red suite as a regression.

## Deviations from spec

**§2.10 was revised mid-task**, with the operator, from "remove the `*/search` handler" to "keep it
until a provider seeder exists". Reason in §4 above; `W3-T10` carries the work.

Everything else was built as specified. AC17 is the only criterion not met, by that decision.

## Known gaps, carried deliberately

- **`when` filters nothing.** No `Job` table, no availability calendar. Accepted, validated,
  ignored, and said so in the module rather than left to be inferred from a query that omits it.
- **`requiresLicence` categories surface unverified providers.** That is `W3-T08`, and it is a
  compliance boundary — worth saying out loud that this endpoint does not enforce it yet.
- **Ranking is distance and only distance.** `BD-03` may buy a ranking boost; when it lands the sort
  key changes, and the cursor format with it.
- **The gazetteer is province-grained.** A search for a village resolves to its provincial capital,
  which can be 80 km from the village. Acceptable for a radius query and not for much else; it is
  the thing `W3-T06` replaces.

## Human input received

Three decisions before implementation (`where` resolution, radius semantics, mock scope), and two
mid-task: the `coarsenPoint` escalation (option A — fix in this branch) and the revised mock scope
(keep it, cut `W3-T10`).

## Self-assessment

No corrective iterations on the implementation — both suites went green first run. The two rounds of
operator input were both genuine forks in the work rather than clarifications of a vague prompt,
which is the distinction `agents/prompts/` cares about.

The thing worth repeating from this run is that **§2.7's outbound parse paid for itself immediately**:
it converted a latent privacy-shaped bug in a frozen contract into a failing test on the first
realistic coordinate. The thing worth watching is that it only did so because the endpoint parses
what it serves — the mock does not, and that is exactly why the defect survived four storefront
tickets.
