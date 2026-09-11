# Run record — W12-T10 home page

Agent:        agent-ui
Model:        claude-opus-5
Charter rev:  2
Skills used:  spec-driven-development, test-driven-development, frontend-ui-engineering,
              api-and-interface-design, documentation-and-adrs, code-review-and-quality,
              git-workflow-and-versioning
Started:      2026-09-11
Session file: memory/sessions/2026-09-11-agent-ui-W12-T10.md

## Prompts

### 1. Spec authoring
`agents/prompts/00-spec-authoring.md` against `W12-T10`. A numbered plan went to the operator first
with **three decisions attached** rather than assumed — prerendering, category counts, and whether
`/:lang/become-a-pro` is in this ticket. All three were confirmed as recommended. The plan gate paid
for itself on the first: ADR-011 says shipping this page flips the rendering mode, and building that
without asking would have been faithful to a sentence whose rationale Amendment 1 had already
deleted.

### 2. Contract proposal
`agents/prompts/01-contract-proposal.md` — **nothing to propose.** `CategorySummary` already carries
what the cards need, and the one field ADR-011 asks for that does not exist (a count per category) is
`W3-T01`'s to add when it implements the endpoint. Recorded as spec §10 Q2 rather than invented here:
`packages/contracts` is the frozen seam and `agent-ui` may not widen it (L3).

### 3. TDD / implementation
`02-tdd-red.md` then `03-implement-green.md`. Two new suites written before any component existed —
`apps/web/tests/home.test.tsx` (13) and `packages/ui/tests/card.test.tsx` (3) — plus one appended
case in `routing.test.tsx` for the header half of the required-field guard.

## Red phase

```
 Test Files  1 failed (1)
      Tests  3 failed (3)

 FAIL  |unit| tests/card.test.tsx > AC14 — a linked card is one tab stop over the whole surface
 FAIL  |unit| tests/card.test.tsx > AC15 — an unlinked card is a heading and some text
Error: Element type is invalid: expected a string (for built-in components) or a class/function
(for composite components) but got: undefined. You likely forgot to export your component from the
file it's defined in, or you might have mixed up default and named imports.
```

```
 Test Files  1 failed (1)
      Tests  13 failed (13)

 × AC1 — renders the hero heading and a second search landmark, still with one h1
     AssertionError: expected [ <form novalidate …(3)>…(2)</form> ] to have a length of 2 but got 1
 × AC2 — submits to /:lang/search with the query the schema produced
     TestingLibraryElementError: Unable to find role="combobox" and name "Dónde"
 × AC3 — refuses to search with no location, and says which field is missing
     TestingLibraryElementError: Unable to find role="alert"
 × AC4 — renders one card per active category, in position order
     TestingLibraryElementError: Unable to find role="region"
 × AC5 — links to the search URL the search bar itself would have produced
 × AC6 — shows the English names on the English page
 × AC7 — renders every other region when the categories request fails
 × AC8 — treats an empty list the same as a failed request
 × AC9 — how it works has three steps and the trust strip has three points
 × AC10 — names every landmark that appears more than once
 × AC11 — the supply CTA links to become-a-pro in the reading language
 × AC12 — renders inside the shell and says registration is not open
 × AC13 — renders in English at /en/become-a-pro
```

AC1's failure is the useful one to read: *one* `role="search"` where two were expected. The header's
bar was already there; the hero's was the thing being asked for, and the assertion that catches its
absence is the same one that will catch it being given a duplicate name.

## Green phase

```
 Test Files  10 passed (10)
      Tests  231 passed | 6 skipped (237)

 Tasks:    10 successful, 10 total     (lint · typecheck · test · build)
```

`packages/ui` 18 files / 157 tests — the story-driven axe gate included, which now walks seven `Card`
stories. `apps/web` 9 files / 75 tests.

## What the tests and the review caught

### 1. Two search landmarks on one page, and only one of them could be named `search.label`

`SearchBar` renders `role="search"` with its `label` as the accessible name, and the shell puts one
on every page. The home page is therefore the first with two — the case `SearchBar.tsx`'s own comment
predicted for `W12-T11`, arriving a ticket early. Two landmarks of one role sharing a name is an axe
failure and, before that, a screen-reader user hearing *"search"* twice with no way to tell which is
which. The hero got `search.hero.label`; the header kept `search.label`. AC10 is the assertion, and
it checks the whole landmark set rather than the two that happened to collide.

### 2. The header was navigating to `/es/search?` with an empty query string

Found while writing AC3, which asks the hero to refuse a search with no location. `SearchBar` sets
`validationBehavior="aria"` deliberately — it reports the required state and lets the form submit,
because the sentence a user reads is the application's to own (`W12-T07`). The application had not
owned it: `W12-T09`'s `onSearch` navigated unconditionally, so an empty submit produced a URL
`SearchQuerySchema` rejects outright.

Fixing it only in the hero would have shipped two renderings of one declaration that disagree about
what "incomplete" means, which is the exact drift `W12-T07` and `W12-T09` exist to prevent. So the
guard is one hook — `features/search/navigation.ts` — and the header calls it too. `search.where.required`
had been sitting in both catalogues since `W12-T07` with nothing rendering it; this is what renders
it. AC3b covers the header.

### 3. A heading over an empty grid is worse than no heading

The naive `categories.map()` renders *"Todos los servicios"* above nothing the day `GET /categories`
is down — which, since that endpoint is still `W3-T01`, is every day. The section is absent rather
than empty, and AC7/AC8 assert that an empty list and a failed request produce the same page. This is
`W12-T09`'s rule applied one level down: a missing endpoint may remove a section, never the page.

### 4. The degrade rule was about to exist in two places

The home page needs the same category list the shell has. Two loaders, two `.catch(() => [])`, and
the second one is the one that gets forgotten in six months. `shared/categories.ts` now holds it
once, with the incident that produced it written above the function, and `root.tsx` was refactored
onto it.

The related decision is in spec §4.2: the home page gets its **own loader on the shared query key**
rather than reading the shell's data through `useRouteLoaderData`. R3 then holds by construction, the
cache makes the second call free, and `W12-T11`/`T12`/`T13` copy a pattern that still works when
their data is *not* something the shell happens to have.

### 5. Self-review: the `Card` was deciding that a caller's content was decorative

First version hardcoded `aria-hidden="true"` on the eyebrow, because the eyebrow in the first use is
a step number that the surrounding `<ol>` already announces as *"item 2 of 3"*. That reasoning is
correct and it is **the page's**, not the component's — a later caller putting a badge there would
have had it silently hidden from screen readers with no way to say otherwise. The `aria-hidden` moved
to the call site, where the `<ol>` is visible.

Same review pass: the `<ol>` needed `role="list"`, because `list-style: none` strips list semantics
in Safari and an ordered list that does not announce its order is the one thing that region needs.

### 6. A `renderLink` render prop rather than an `href`

The one design decision in `Card`, argued in spec §4.5. A `Card` that took an `href` renders an `<a>`
— correct, and a full page reload inside an SPA. A `Card` that took an `onPress` is a button
pretending to be a link: no middle-click, no open-in-new-tab, no URL to copy, and a category card
**is** a URL. Handing out the stretch class and letting the app bring its own `Link` is the only
version that is both domain-free (ADR-012 §1, gated by `boundaries.test.ts` AC15) and right.

### 7. The category card href is built by the same functions the bar submits through

`serializeSearchQuery(toSearchQuery(schema, { what: slug }))`, in the page **and in AC5's
expectation**. Asserting `href === '/es/search?what=fontaneria'` would have passed while the card and
the search bar disagreed about encoding — the test would have become a second definition of the query
string, which is the thing `W12-T07` exists to prevent. The first category with an accent is where a
hand-written `?what=${slug}` breaks.

## Deviations from spec

- **ADR-011 amended again.** Spec §10 Q1 escalated the prerendering arrow; the operator deferred it
  to `W12-T14`. Recorded as **Amendment 2** with the cost stated, and §1's state diagram edited so
  the arrow now reads `W12-T14`. Leaving the diagram alone would have had the next agent build a
  prerender pipeline in good faith against a sentence Amendment 1.2 had already emptied.
- **`root.tsx` changed, which the plan did not call for.** Two changes: onto `shared/categories.ts`,
  and onto the shared submit guard. Both are consequences of adding a second consumer, and both
  *remove* a divergence rather than adding a feature. Called out here because a reviewer looking only
  at "the home page ticket" would not expect the shell in the diff.
- **`Card` tests live in `packages/ui/tests/card.test.tsx`**, not in `primitives.test.tsx` as the
  first draft of the spec said. `primitives.test.tsx` already has an `AC14`, and `Card` is a pattern,
  not a primitive — `search-bar.test.tsx` set that precedent.

## Known gaps, carried deliberately

- **Every exit from this page is a 404 until `W12-T11`.** The hero, the header and all eight category
  cards navigate to `/:lang/search`. Deliberate, and the same argument as `W12-T09` §10 Q1: a
  disabled control hides whether the schema, the query string, the router and the locale segment
  agree until the ticket that would have revealed it.
- **A category card is a search with no `where`, and `where` is required.** Spec §10 Q3, and it is a
  **hand-off, not a defect**: the results page has to have that state anyway, because a visitor can
  delete the location from the header search. `missingRequiredFields` already returns it. Written
  into `TODO.md` against `W12-T11` so it is not discovered by a 500 during the M11 demo.
- **No counts on the cards.** Spec §10 Q2. The two ways to fake one now are a number that is real in
  preview and absent in production — the exact shape of the `W12-T09` preview failure — or one
  `GET /search` per category on load, for a query that could not be built because `where` is required.
- **No axe run against the composed page.** Unchanged from `W12-T09` §9 and still `W12-T16`'s. The
  seven new `Card` *stories* are covered by `W12-T04`'s gate; the page they compose into is not.
  `home.test.tsx` AC10 checks landmark naming and uniqueness by hand, which is strictly weaker.
- **No photography.** The reference puts its search over a photograph. There is no asset pipeline
  until `W12-T15` and no licensed imagery at all.
- **Initial JS is 231 KB gzipped**, against `W12-T15`'s ≤170 KB budget. Pre-existing — `Card` adds
  well under a kilobyte — but this ticket is the one that made the home page real, so the number is
  now a real number. `W12-T15` owns it, and the map chunk `W12-T11` defers is the first big lever.

## Human input received

The operator approved the plan and all three attached decisions in one pass ("go!"):

1. **`/:lang/become-a-pro` is in this ticket**, as a real but honest slot, rather than a CTA that
   dead-ends in a 404.
2. **No category counts** rather than a number derived from the mock catalogue.
3. **Prerendering deferred** to `W12-T14`, recorded as an amendment rather than skipped silently.

## Self-assessment

- **Weakest part of this change**: the trust strip's copy. It makes three forward claims —
  verification, reviews, protected payment — about a system where none of the three has been built
  (`W8`, `W8`, `W5`). Nothing there is legally operative and nothing names a number, a guarantee or a
  certification, which was the line I drew and stated in spec §10 Q4. It is still marketing text an
  agent wrote, and it should be reviewed in the same pass as the legal prose (`W10-T07`, `[H]`).
- **What a reviewer should look at hardest**: `features/search/navigation.ts`, and specifically
  whether putting the guard in a hook that both bars call is right, or whether the header's behaviour
  should have stayed as `W12-T09` shipped it and been changed by its own ticket. I think one guard is
  correct and I think the alternative is the drift the last three tickets were about — but it is the
  one change in this diff that touches a page this ticket does not own.
- **What is not proven**: that any of this looks right. There is no screenshot in this run, no axe
  pass over the composition, and no Lighthouse number. The dev server was checked to boot and answer
  200 on `/`, `/es`, `/en` and `/es/become-a-pro`, which proves the routes exist and nothing throws
  on import — and proves nothing at all about a marketing page's job. `W12-T16` (Playwright + axe over
  the real routes) and `W12-T15` (Lighthouse) are where that becomes checkable, and until they run,
  the home page's appearance rests on a human looking at it.
