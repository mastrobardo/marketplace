# Run record — W12-T11 results page

Agent:        agent-ui
Model:        claude-opus-5
Charter rev:  2
Skills used:  spec-driven-development, test-driven-development, frontend-ui-engineering,
              api-and-interface-design, performance-optimization, code-review-and-quality,
              git-workflow-and-versioning
Started:      2026-09-11
Session file: memory/sessions/2026-09-11-agent-ui-W12-T11.md

## Prompts

### 1. Spec authoring
`agents/prompts/00-spec-authoring.md` against `W12-T11`. Four decisions went to the operator with the
plan rather than being assumed — the map (no key exists), the pager shape (`W1-T02` forbids page
numbers), which facets can filter (the seam is frozen), and the stale `W3` backlog lines. All four
confirmed as recommended.

### 2. Contract proposal
`agents/prompts/01-contract-proposal.md` — **nothing proposed.** `SearchResponseSchema` already
covers the page. The one thing this ticket wanted and could not have is a `kind` filter, and
`packages/contracts` is the frozen seam (L3), so §10 Q2 files it as a request instead of widening it
inside a page PR.

### 3. TDD / implementation
`02-tdd-red.md` then `03-implement-green.md`. Two new suites written before anything existed —
`apps/web/tests/results.test.tsx` (16) and `packages/ui/tests/result-row.test.tsx` (6) — plus one new
build assertion in `mocks.test.ts`.

## Red phase

```
=== packages/ui ===
 Test Files  1 failed (1)
      Tests  6 failed (6)
 FAIL  tests/result-row.test.tsx > AC17 — a result row is one tab stop
 FAIL  tests/result-row.test.tsx > AC18 — a pager with nowhere to go renders nothing
 FAIL  tests/result-row.test.tsx > AC19 — an empty state is a heading, a sentence, and a way out
Error: Element type is invalid: expected a string (for built-in components) or a class/function …

=== apps/web ===
 Test Files  1 failed (1)
      Tests  16 failed (16)
 × AC1 — asks where, and never calls the endpoint
     TestingLibraryElementError: Unable to find an element by: [data-testid="needs-where"]
 × AC3 — one row per match, nearest first
     TestingLibraryElementError: Unable to find an element by: [data-testid="results"]
 × AC9 — an empty result names the filters and offers a way to widen
     TestingLibraryElementError: Unable to find an element by: [data-testid="results-empty"]
 × AC10 — a failing search is an error inside the shell, with a retry and a usable rail
     Error: Test timed out in 5000ms.
 … 12 more
```

## Green phase

```
@marketplace/web:   Test Files  10 passed (10)    Tests  94 passed (94)
@marketplace/ui:    Test Files  22 passed (22)    Tests 175 passed (175)

turbo run test --force — Tasks: 10 successful, 10 total
lint · format:check · typecheck · build — all green
```

Emitted chunks, which is the `R9` claim made visible:

```
dist/assets/index-C0ysvcN5.js       652.06 kB │ gzip: 203.06 kB
dist/assets/dist-CWYc7o3q.js        108.18 kB │ gzip:  31.77 kB   ← packages/ui
dist/assets/ResultsMap-eAQLphxW.js    0.38 kB │ gzip:   0.29 kB   ← the map, on its own
```

## What the tests and the review caught

### 1. The deferred-chunk gate, proven by a deliberate red probe

AC14 asserts the map is its own chunk. A passing assertion nobody has seen fail is not a gate, and
this is the kind that fails open: replace `lazy(() => import('./ResultsMap.js'))` with a static
import and **everything still works** — every behavioural test passes, the page renders, and the map
has quietly moved into the entry chunk.

So it was probed: the import was flattened by hand and the test run.

```
× AC14 — the map is its own chunk, absent from the entry
  AssertionError: the map module is only in the entry chunk — the dynamic import was flattened
```

Restored, green again. Same discipline `W12-T04` used for the axe gate, and the same failure class as
`W12-T08`'s one-sided mock assertion.

### 2. `SearchQuerySchema` decodes the cursor, so the parsed query cannot be re-serialised

The first `ApiClient.search` took `SearchQuerySchema`'s **output** and serialised it with
`String(value)`. That is wrong in a way that would have shipped: `cursor` comes out of the parse as a
decoded `CursorPosition` object and `sort` as an array of `{ field, direction }`, so page two would
have requested `?cursor=[object Object]`.

The fix is a boundary decision, not a cast. `search` now takes the query **as strings** — the shape
that goes in a URL — and the caller validates before sending. Serialising the parsed output back
would mean re-deriving, with the contract's own encoders, a string the caller already had in its
hand.

It also turned out to be what makes AC11 work: because the schema *decodes* rather than accepting any
string, a stale cursor fails validation, and the loader can treat that failure as "no cursor" and
serve a valid first page. A shared paged link degrades instead of expiring.

### 3. A nested list inside a list item

`ResultRow` rendered its badges as a `<ul>`, and each row is itself an `<li>` in the results list. So
`getAllByRole('listitem')` returned the rows *and* their badges — AC3 read a badge as a result, and
AC4 compared row *n* against provider *n* while the two lists were offset.

The test failure was the symptom; the markup was the bug. Two or three words like "PRO" read as a
phrase, not as a list, and a nested list inside a row makes "the items in this list" ambiguous to a
screen reader in exactly the way it was ambiguous to the query. Badges are now spans.

### 4. A React Aria Select is named by its label *and* its value

AC12 asserts the rail renders all four declared fields. Written first with `getByLabelText`, it found
`Servicio` and not `Dónde`; rewritten against control roles, it found the two comboboxes and not
`Cuándo`. The Select's trigger is accessibly named *"Cuándo Cuando sea"* — label plus current value,
which is correct for a screen reader and fails any equality check that only ever met a Combobox.

Now a substring match over `combobox` and `button` roles. The assertion is stronger than the one it
replaced: it says a visitor can reach a *control* with that name, not that some node carries the text.

### 5. Three older tests asserted the 404 this ticket exists to remove

`home.test.tsx` AC2 and `routing.test.tsx` AC8b/AC9 all ended with *"this lands on the 404 for now,
and that is the correct intermediate state"*. It is not the correct state any more. Updated to assert
the results page, with the comment saying why rather than silently reversed — the state was argued
for in `W12-T09` §10 Q1 and it deserves a visible ending.

### 6. `turbo` served a cached test result and I nearly reported it

`pnpm test` printed `Tests 231 passed | 6 skipped (237)` — the same total as before this ticket, with
`@marketplace/web:test: cache hit, replaying logs`. Running each package directly gave 94 and 175.
The cached figure was not wrong about anything; it was answering about a different tree.

This is `MEM` "CI gates fail open" for the second time, and the lesson is narrower than "don't trust
turbo": **a number is evidence only if the run that produced it is the run you are asking about.**
The totals in this record come from `turbo run test --force`.

### 7. The error boundary had to keep the rail

AC10 asks for a usable rail on the error state, and the first boundary rendered only an `EmptyState`.
That is the `W12-T09` argument one level down: the rail is the only way a visitor fixes a query that
failed, so an error page without it is terminal. The boundary now renders the rail — with **no
categories**, because a boundary has no loader data and re-fetching a backlog endpoint from an error
state is the bare `await` that took the whole storefront down once already.

## Deviations from spec

- **`apps/web/mocks/search.ts` is new** — the search logic moved out of `handlers.ts` because the test
  harness became a second caller. A stub that reimplements "which providers match, in what order,
  with what facet counts" is a second definition of the mock's behaviour, and a component test that
  disagrees with the dev server teaches the page something the dev server does not do. Same argument
  `W12-T08` made about fixture *data*, one level up.
- **`ErrorState` was not built.** ADR-012 §1 lists it; it ships as a use of `EmptyState` with an
  action. Two components differing by one prop are two components that drift. Called out because a
  reviewer checking the ADR's list will look for it.
- **`ResultRow` badges are spans, not a list** — finding 3.
- **Three existing tests changed** — finding 5.
- **`TODO.md`'s `W3` lines edited**, which is outside this slice: `W3-T06` shrinks to
  `/places/suggest` + the Maps key, `W3-T07` becomes the provider API with the page pointed at
  `W12-T12`, and `W3-T05` is marked as the owner of `GET /search`. Agreed with the operator in the
  plan. Leaving them means `agent-discovery` builds this page a second time, which is the precise
  condition ADR-011 §1 was written to end.

## Known gaps, carried deliberately

- **The map does not render a map.** The boundary, the on-viewport trigger, the fallback and the
  "page is complete without it" assertion all ship; behind them is a sentence saying there is no map
  yet. There is no Maps API key — `OPS-12` is human-blocked — and Leaflet on OSM tiles was rejected
  in §10 Q3 (≈40 KB against a budget already over, on a tile policy that excludes production use).
- **Kind facets are counts, not controls.** `kind` is not in `SearchQuerySchema`. §10 Q2 escalates it
  as a contract request rather than widening the frozen seam from a page PR.
- **Rows link to `/:lang/pro/:id`, which 404s** until `W12-T12`. The third and last time this
  storefront ships a deliberate intermediate 404.
- **No `noindex, follow`.** No `meta` machinery until `W12-T14`; all SEO deferred by Amendment 1.2.
- **Initial JS is ~235 KB gzipped** (203 entry + 32 for `packages/ui`) against `W12-T15`'s ≤170 KB.
  Pre-existing and unchanged in character by this ticket — the map is 0.29 KB and deferred — but this
  page is the one the budget was written about, so the number is now load-bearing.
- **No axe pass over the composed page.** `W12-T16`. The three new patterns' stories are covered by
  `W12-T04`; the page they compose into is not.

## Human input received

The operator approved the plan and all four decisions in one pass ("proceed"):

1. **Map: the seam, not the renderer.** Build the chunk boundary and prove the page works without it.
2. **Paging: `Next` only, cursor in the URL.** `W1-T02` decision D makes numbered pages impossible.
3. **Facets: categories filter, kinds count.** A contract request rather than a local edit.
4. **Fix the stale `W3` backlog lines** so two agents do not build one page.

## Self-assessment

- **Weakest part of this change**: the loader's cursor handling. It parses the query twice —
  once with the cursor and once without — to decide whether a cursor is stale, and a reader could
  reasonably call that clumsy. I kept it because the alternative is asking `decodeCursor` directly,
  which makes the route know the cursor's encoding, and the whole point of `W1-T02` putting the decode
  inside the schema is that a handler never has to.
- **What a reviewer should look at hardest**: `ApiClient.search` taking strings rather than the
  contract's parsed type (finding 2). It is the right call and it makes the interface *look* weaker
  than the typed client `W1-T03` will generate. If that generated client takes the parsed shape, this
  is the seam that has to change, and it should change deliberately rather than by a cast at the call
  site.
- **What is not proven**: the same thing as last time, and it is now the third ticket in a row.
  There is no screenshot, no axe run over the composition, and no Lighthouse number for the page the
  performance budget was written about. What is proven is that the map is deferred, the page survives
  it never loading, the contract is parsed in both directions and the rail is the same declaration as
  the other two bars. Whether a visitor would use it is still a human at the preview URL.
