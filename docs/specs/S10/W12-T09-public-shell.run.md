# Run record — W12-T09 public shell

Agent:        agent-ui
Model:        claude-opus-5
Charter rev:  2
Skills used:  spec-driven-development, api-and-interface-design, frontend-ui-engineering,
              test-driven-development, documentation-and-adrs, git-workflow-and-versioning
Started:      2026-09-11
Session file: memory/sessions/2026-09-11-agent-ui-W12-T09.md

## Prompts

### 1. Spec authoring
`agents/prompts/00-spec-authoring.md` against `W12-T09`. A numbered plan went back to the operator
first and was revised **twice** before any file was touched — see "Human input received". That is the
whole value of the plan gate on this task: both revisions removed work rather than adding it.

### 2. Contract proposal
`agents/prompts/01-contract-proposal.md`. `CategorySummarySchema` / `CategoryListSchema` are new and
additive, so this is a pre-freeze proposal per `policies/contract-change.md`, not an amendment.

### 3. TDD / implementation
`02-tdd-red.md` then `03-implement-green.md`. The existing `shell.test.tsx` was the red phase for
free: six of its assertions failed the moment the shell gained an async loader, which is exactly what
a suite is for.

## Red phase

```
 Test Files  1 failed | 6 passed (7)
      Tests  6 failed | 39 passed (45)
  × renders the home page with exactly one h1
  → Unable to find an accessible element with the role "heading"   (the router was still loading)
```

## Green phase

```
apps/web            Test Files  8 passed (8)   Tests  56 passed (56)
packages/contracts  tests/search.test.ts       Tests  22 passed (22)
turbo typecheck lint test                      Tasks: 22 successful, 22 total
```

## Four things the tests and the environment caught

### 1. `/nope` rendered the Spanish home page

`/:lang` matches *any* single segment, so an unknown language was not a 404 — it was the home page
served at someone else's URL, returning 200. Fixed by throwing a 404 `Response` from the shell's
loader. The first draft of `routes.tsx` had also added a trailing `path: '*'` to catch this, which is
unreachable underneath `/:lang` — removed, because an unreachable route reads as handled.

### 2. Throwing a 404 during render is not a 404

`legal.tsx` first validated `:doc` in the component and threw a `Response`. React treats that as a
component error, not a route error response: the tree unmounted and the 404 never rendered. Moved to
a `loader`, where a thrown `Response` is what the router is built to catch. Route-param validation
belonged there anyway.

### 3. A 404 at the root costs the visitor the whole shell

Once the legal 404 worked, it rendered at the *root* boundary — so a mistyped `/es/legal/nonsense`
lost the header, the search box and the footer, despite the shell having loaded perfectly. Fixed by
giving the legal route its own `ErrorBoundary` (re-exporting the not-found component), so it renders
inside the outlet. **A boundary belongs at the level that actually failed**, and the root one is
reserved for the case where the shell itself is what broke.

### 4. Every path returns HTTP 200, including the 404

Smoke-tested against the dev server rather than assumed:

```
/                  200
/es                200
/en/legal/terms    200
/nope              200
```

Correct for an SPA and still a soft 404. Escalated as `Q2`, recommended to wait for `W12-T14` (which
is where a route can set a status at all), and written into that ticket in `TODO.md` so it is not
rediscovered.

## Deviations from spec

- **ADR-011 amended.** Not a deviation from the spec so much as the spec's precondition: the operator
  reversed localised URL segments and deferred SEO, and both contradicted the merged ADR. Recorded as
  "Amendment 1" with the cost stated, the §2 route table respelled, and `W12-T13`/`T14`/`T15` in
  `TODO.md` marked accordingly. Leaving the ADR unchanged would have had the next agent rebuild
  `/es/buscar` in good faith.
- `@testing-library/user-event` added as a devDependency — the switcher and the search bar are
  interaction tests and `fireEvent` cannot open a React Aria combobox.
- The 500 page gained a real retry button (`useRevalidator`). The `error.retry` key existed with
  nothing rendering it, which is how a translation catalogue starts lying.

## Known gaps, carried deliberately

- **The header search links to a 404** until `W12-T11`. Deliberate, argued in spec §10 Q1: a disabled
  control would hide whether the schema, the query string, the router and the locale segment agree.
- **The i18n singleton stands** (`W12-T14`). It is now strictly smaller: the URL is the source of
  truth and i18next follows it in an effect, so the conversion has one writer to replace.
- **React Query's `retry: 1`** means a failed shell loader takes ~1 s to reach the error page. That
  cost one test a timeout before it was understood — the boundary was fine, the wait was too short.
  Kept, because a transient blip recovering silently is worth more than a second, and the 500 page
  now has an explicit retry for everything else.

## Human input received

The operator's plan review changed the task three times, and every change is load-bearing:

1. Chose `/:lang` routing now over deferring it, and the thin typed fetch over blocking on `W1-T03`.
2. **"Endpoints are NOT to be translated"** — reversing ADR-011 §5. Removed the path-segment map
   entirely.
3. **"Let's not worry about SEO … record the decision"** — removed `hreflang`, and re-opened the
   priority of `W12-T13`/`T15`.
4. **"Use React Query for the web part. The wrapper can be axios."** — replaced the plain `fetch`
   helper, and brought R3/R5/R6 into scope as a design constraint rather than a checklist item.

## Self-assessment

- **Weakest part of this change**: `src/shared/api.ts`. It is a hand-written client pretending to be
  a generated one, and the only thing keeping it honest is that it parses responses through the
  contract schemas. If someone adds a call that skips the `.parse`, the seam quietly becomes a second
  definition of the API and nothing fails.
- **What a reviewer should look at hardest**: `App.tsx`'s `getContext`, and whether the `QueryClient`
  can reach a module scope by any route. That is the R5 data-leak class, it is invisible in a
  browser-only SPA, and it will only ever bite after `W12-T14`.
- **What is not proven**: no axe assertion runs against the new shell. `W12-T04`'s gate covers
  Storybook stories, and the shell is not a story — `shell.test.tsx` asserts landmark presence and
  uniqueness by hand, which is a weaker check than axe. Worth a story or a Playwright pass in
  `W12-T16`.
