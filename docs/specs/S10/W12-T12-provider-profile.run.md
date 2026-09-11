# Run record — W12-T12 provider profile

```
Agent:        agent-ui
Model:        claude-opus-5
Charter rev:  2
Skills used:  spec-driven-development, api-and-interface-design, test-driven-development,
              frontend-ui-engineering, incremental-implementation, code-review-and-quality,
              git-workflow-and-versioning
Started:      2026-09-11
Session file: memory/sessions/2026-09-11-agent-ui-W12-T12.md
```

## Prompts

### 1. Spec authoring
`agents/prompts/00-spec-authoring.md` against `W12-T12`. Four decisions went to the operator **with
the plan** rather than being assumed, because reading `schema.prisma` first showed the ticket's title
naming four things that have no columns. All four confirmed as recommended:

1. Render what exists; state the absences.
2. `:id`, not `:slug`.
3. Drop "listing detail".
4. Propose the contract in this PR.

A fifth surfaced while writing (§10 Q5 — whether the auth wall names a launch date) and did not
block: every acceptance criterion is identical under both answers, only the string differs, and the
recommendation (state-only) is the one an agent may take without inventing a business commitment.

### 2. Contract proposal
`agents/prompts/01-contract-proposal.md`. One new module, `packages/contracts/src/provider.ts`,
additive — no Prisma change, no migration, no new error code (`NOT_FOUND` and `VALIDATION_FAILED`
were already in the `W1-T01` registry).

### 3. TDD / implementation
`02-tdd-red.md` then `03-implement-green.md`, then `04-refactor.md`. Three new suites —
`packages/contracts/tests/provider.test.ts` (26), `apps/web/tests/provider.test.tsx` (14),
`packages/ui/tests/auth-wall.test.tsx` (4) — plus four new assertions in `mocks.test.ts` and one in
`home.test.tsx`.

## Red phase

```
=== apps/web ===
 Test Files  1 failed (1)
      Tests  14 failed (14)
 × AC14 — names the provider in the h1 and states the kind in words
 × AC15 — each category is a link back into search, built by the serializer
 × AC16 — a rated provider shows the average in es-ES with its count
 × AC20 — an id nobody seeded is a not-found page inside the shell
 … 10 more

=== packages/ui ===
 Test Files  1 failed (1)
      Tests  4 failed (4)
Error: Element type is invalid: expected a string (for built-in components) or a class/function …
```

## Green phase

Run with `--force`, because a cached `web:test` log reported a pre-ticket total during `W12-T11` and
the same mistake was available here.

```
@marketplace/testing:   Test Files  1 passed (1)      Tests  29 passed (29)
@marketplace/contracts: Test Files  6 passed (6)      Tests 209 passed (209)
@marketplace/api:       Test Files  4 passed (6)      Tests  52 passed | 32 skipped (84)
@marketplace/ui:        Test Files 24 passed (24)     Tests 182 passed (182)
@marketplace/web:       Test Files 11 passed (11)     Tests 116 passed (116)

pnpm lint       ESLint: No issues found
pnpm typecheck  10 successful, 10 total
```

`packages/ui`'s 182 includes the storybook project, so the three new `AuthWall` stories went through
the real-Chromium axe gate rather than only through jsdom.

## What the tests and the review caught

### 1. The ticket asked for four things that have no columns

The title says *gallery, categories, badges, review summary, and a CTA*, and `TODO.md` §3's domain
sketch lists `PortfolioItem`, `Badge`, `Review` and `Listing` as if they existed. They are in no
migration. `apps/api/prisma/schema.prisma` has seven models and none of them is any of those.

This was the whole shape of the task and it was invisible from the ticket. `W12-T08` had already
written the rule — *"every field is a column that exists today, which is what makes this contract
additive rather than an ADR"* — so the answer was to keep it and state the absences, not to invent
fields. The alternative would have put a placeholder gallery in an M11 demo, which is a claim about
supply that no seeded row supports.

### 2. `.omit().extend()` preserves strictness, and AC9 is what proves the derivation is free

`ProviderProfileSchema` is `SearchResultSchema.omit({ distanceMetres: true }).extend({ … })`. Two
independent strict objects listing the same ten public fields would have been the drift this repo
keeps paying to avoid — and the privacy work would have been duplicated too, since the coarse-point
refinement and the absent `userId` are both inherited rather than restated.

AC9 asserts `SearchResultSchema`'s key set against the literal list `W12-T08` froze, so the
derivation cannot quietly edit its parent.

### 3. React Query retried a 404, and the not-found page never rendered

The first failing run of AC20 sat on `shell-loading` until the test timed out. `retry: 1` was
applied to every failure, including the 404 that *is* the answer — so a visitor following a dead link
waited out a retry delay in front of a blank screen before being told anything.

Fixed in `shared/query.ts`: 4xx is never retried, 5xx still is. That is a fix to the shipped search
page too, where a 400 from a bad query string was being asked again for the same answer.

### 4. The same retry then hid a genuine failure, and the test was passing for the wrong reason

AC21 stubbed one rejection and expected the error boundary. React Query's remaining `retry: 1`
consumed that rejection, the second call succeeded, and the page rendered — the test failed while
asserting the *right* behaviour against a mock that could not produce it. Rejecting twice is what
makes the assertion mean what it says, and the comment in the test now names the policy so the next
reader does not "fix" it by deleting a rejection.

### 5. `aria-labelledby` pointing at an id containing spaces is a section with no role at all

`PendingSection` built its id from the translated heading. A `<section>` is only a `region` when it
has an accessible name, so the three pending sections were plain `div`s to the accessibility tree —
visually identical, and invisible to everything except a screen reader. `useId` fixed it; the test
that caught it asks for the region by name.

This is the second time in this slice that an accessible name has been the thing that was wrong
while the pixels were right.

### 6. Two formatters had been living inside `routes/search.tsx`

`formatDistance` and `formatRate` were private functions in the results route — correct when there
was one page, and two private copies of "how this product writes a price" the moment there were two.
Moved to `shared/format.ts` with `formatRating` and `formatMonthYear`. ES puts the euro after the
number and uses a decimal comma, so every one of them is `Intl`.

### 7. `ApiError`, because a loader should not read `error.response.status`

The loader has to tell a 404 apart from everything else. Doing that against an `AxiosError` would
have made the transport visible to a route module, and every loader would need editing the day
`W1-T03`'s generated client replaces the hand-written one. `shared/api.ts` is now the only module
that knows there is HTTP underneath.

`status` is `undefined` for a request that never got an answer — a network failure is not a 500, and
saying otherwise is claiming to know what the server did.

### 8. A test that asserted the absence of a *forbidden string* would have passed on an empty page

AC22 checks that `userId`, address lines and the stored coordinate never reach the DOM. On its own
that assertion passes just as happily when the page fails to render at all — the failure mode
`W12-T11`'s slice memory recorded. It is paired with `await screen.findByTestId('provider')`, so the
page must exist before its contents are checked.

## Deviations from spec

- **`bio` is carried in `mocks/catalogue.ts`, not in `packages/testing`.** The factory has no `bio`
  field, the column does. This is the third work-around of the same kind (`ratingAvg`,
  `hourlyRateCents`, now `bio`) and it is carried beside the profile rather than cast, so it stays
  visible. Filed as §10 Q3 — a request for `agent-contracts`, not a change this PR makes.
- **`ProviderIdSchema` was added to the contract**, which the spec did not name. It appeared because
  the handler and the loader both need the uuid check and two copies is how a page ends up
  round-tripping `/pro/undefined`. One export, two consumers.
- **The spec's AC19 named `provider-cta` as a testid.** The wall is already a named region, so the
  wrapper `div` was removed in the refactor pass and the test asks for the region instead. A wrapper
  that exists only to be queried is a wrapper that will outlive the query.

## Known gaps, carried deliberately

- **No map on the profile.** §4.4. The published point is coarse, and one coarse pin for one named
  person is a better instrument for finding a house than a results map is. A "works around here"
  affordance is the obvious next thing and should not be built on a precise coordinate.
- **No `meta`, canonical or JSON-LD**, though this is the page where a WhatsApp share preview would
  matter most. Deferred with ADR-011 Amendment 1 and collected by `W12-T14`, deliberately as one
  decision in one ticket rather than one page inventing it.
- **The three pending sections have no automated a11y coverage in the route.** `W12-T04`'s axe gate
  runs against stories, and this page is an application composition. The `AuthWall` stories are
  covered; the composed route is on `W12-T16`'s list, which this ticket extends.
- **`W12-T12` cannot prove it looks right.** Every criterion is a constraint. Whether the page reads
  as finished — three stated absences is a real risk for a demo — is a human on the preview URL
  (§10 Q4).

## Human input received

Four decisions, confirmed with the plan on 2026-09-11 before any file was written:

| Asked | Answered |
|---|---|
| Gallery/badges/reviews have no columns — fake them or state them? | Render what exists |
| Route key `:id` or `:slug`? | `:id` |
| "Listing detail" as a second page? | Drop it for now |
| Propose `ProviderProfileSchema` into the frozen seam from a page ticket? | Yes |

§10 Q5 (does the auth wall name a launch date?) is open and does not block: the recommendation —
state-only — is implemented, and the answer is a one-line copy change over the same component.

## Self-assessment

The contract is the part worth reviewing. Deriving from `SearchResultSchema` is a claim that a
profile and a search result are the same public object seen from two places, and it is right today
because the profile has no field a search result could not also carry. The day a profile gains
something private-ish — a phone number behind an auth wall, a portfolio — the derivation stops being
free and the base should be extracted properly. AC9 is what will fail first.

The page itself is simple by construction, which is the outcome of the operator's first decision
rather than of any work here. The two behavioural findings — the retried 404 and the retry that hid
a real failure — both came from the same default, and both are fixes to the already-shipped search
page as much as to this one.
