# Run record — W4-T07 provider job feed

Agent:        agent-jobs (main session)
Model:        claude-opus-5
Skills used:  spec-driven-development, api-and-interface-design, test-driven-development,
              incremental-implementation, frontend-ui-engineering, security-and-hardening
Started:      2026-09-26T10:38Z

## Prompts

### 1. Task selection

> Let's continue with next task in queue. What did we set on the last session?

Answered from `memory/sessions/2026-09-20-agent-jobs-W4-T04.md` and `TODO.md`'s `▶ NEXT` banner —
`W4-T07`, with the two things `W4-T04` said it would need on day one (page it from the start; the
ranking a feed wants is probably not the order that can page). A ten-step plan was put to the
operator with two decisions attached, because both changed what gets built:

1. **Licence status — gate or label?** Recommended *label*, with an opt-in filter, on `W4-T03`'s
   precedent (*"It is up to the professional to decide to apply or not"*) — and on the fact that the
   schema cannot support a gate at all until `W8` exists.
2. **Scope — API + seeder only, or the screen too?** Recommended including the screen, because
   without it the provider side stays uuid-only and the demo cannot show the loop.

### 2. Go-ahead, with a third instruction

> Agree with the labels proposal: in the view will be the client to be able to filter. Yes, include
> the screen as well. Also, WITHOUT COMMITTING IT (u can gitignore), a list of accounts we have in
> the seeder to be able to test it easily ( easier for me to just follow a txt ). Please proceed

Three decisions in three sentences, and each one is visible in the diff:

- **labels, not gates** — §2.2, and the charter line it amends;
- **the filtering is the view's** — so `JobFeedQuerySchema` declares *no filters at all* (§2.6) and
  `features/jobs/feed.ts` is where the product rules live;
- **an untracked account crib** — `demo-accounts.local.txt`, with `*.local.txt` in `.gitignore`.

No corrective re-prompt was needed. The two questions that would have caused one were asked before
the plan, which is the shape this run record exists to make reviewable.

## Red phase

Contracts were frozen first (§5.1 step 2), so `packages/contracts` was green before anything else
ran — the shapes, the sort field and the two invariants exist; **nothing that serves them does.**

```
$ pnpm --filter @marketplace/contracts exec vitest run job-feed
 Test Files  1 passed (1)
      Tests  12 passed (12)

$ pnpm --filter @marketplace/api exec vitest run job-feed

 FAIL  tests/job-feed-live.test.ts [ tests/job-feed-live.test.ts ]
Error: Cannot find module '../src/modules/jobs/feed-repository.js' imported from
  /Users/…/apps/api/tests/job-feed-live.test.ts

 FAIL  tests/job-feed.test.ts [ tests/job-feed.test.ts ]
Error: Cannot find module '../src/modules/jobs/feed-routes.js' imported from
  /Users/…/apps/api/tests/job-feed.test.ts

 Test Files  2 failed (2)
      Tests  no tests

$ pnpm --filter @marketplace/web exec vitest run feed --reporter=dot

 FAIL  tests/feed-filters.test.ts [ tests/feed-filters.test.ts ]
⎯⎯⎯⎯⎯⎯ Failed Tests 12 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/feed.test.tsx > AC19 — the page needs a session > sends a signed-out visitor to the login form
 FAIL  tests/feed.test.tsx > AC19 — what a row says > lists the matched jobs newest first, which is the order the API served
 FAIL  tests/feed.test.tsx > AC19 — what a row says > shows the distance in kilometres, not in metres
 FAIL  tests/feed.test.tsx > AC19 — what a row says > labels a regulated trade the provider does not list
 FAIL  tests/feed.test.tsx > AC19 — what a row says > marks a job it has already quoted rather than hiding it
 FAIL  tests/feed.test.tsx > AC19 — the controls are the provider’s > re-sorts by distance without asking the API again
 FAIL  tests/feed.test.tsx > AC19 — the controls are the provider’s > hides the regulated gap when the switch is on, and says how many are shown
 FAIL  tests/feed.test.tsx > AC19 — the controls are the provider’s > hides what it has already quoted when asked
 FAIL  tests/feed.test.tsx > AC19 — two empty states … > says the market is empty when the feed is
 FAIL  tests/feed.test.tsx > AC19 — two empty states … > says the filters are, when they are the reason, and keeps the controls in view
 FAIL  tests/feed.test.tsx > AC19 — an unfinished profile reads as what to fix > renders the 409 as a sentence, not as an error page
 FAIL  tests/feed.test.tsx > AC19 — the loader follows the cursor, bounded > assembles the pages the API hands back, and says when it stopped early
 Test Files  2 failed (2)
      Tests  12 failed (12)
```

**Two shapes of red, and the difference is the point.** The API files do not import at all: neither
the repository nor the route plugin exists, so there is nothing for Fastify to register or for a
stub to satisfy. The web suite imports the *app* fine and fails inside it — `/es/feed` is not a
route, so every assertion lands on the not-found page the shell renders, which is exactly what a
missing screen should look like from a test's point of view.

`feed-filters.test.ts` is the third shape and the cheapest: a module-not-found on
`features/jobs/feed.js`, twelve assertions that never ran.

## Green, in the order the pipeline asks for

API first, then the screen. Three things were found by building rather than by planning, and each
one is in the spec now, not only here:

1. **`text > uuid`, and it only fails on the second page.** The statement selected `j.id::text` in
   the CTE, so the keyset compared a text id against the cursor's `::uuid` and Postgres refused —
   `operator does not exist: text > uuid`. Page one was green throughout. The fix keeps the id a
   `uuid` inside the CTE and casts on the way out, so the keyset and the `ORDER BY` compare it the
   way Postgres orders uuids. **AC10 and AC11 are the only reason this was seen at all**, which is
   the argument for asserting paging over the union of two pages rather than over their lengths.
2. **A backtick inside a `Prisma.sql` template is a parse error, not a comment.** The SQL comment
   explaining the fix above used backticks the way every TypeScript comment in this repo does, and
   the file stopped compiling. SQL comments inside a tagged template use plain words.
3. **The seeded provider is a real provider, and search counts them.** `jobs.demo-feed` gives the
   sign-in-able account a `ProviderProfile`, which makes six in Madrid rather than five — so three
   assertions in `seed-live.test.ts` and one in `categories-live.test.ts` moved. They are another
   slice's tests and the change is deliberate and minimal: the counts are updated with a comment
   naming both sources, except `AC9`'s, which became `toBeGreaterThanOrEqual(5)` because its subject
   is *"whatever is seeded has a profile page that serves"* and a literal was never carrying that.

## Rebased mid-flight

`W12-T21` — *translations are data, not code* — landed on `main` (#285) after this branch was pushed,
turning `es.ts`/`en.ts` into `es.json`/`en.json` and removing the compile-time `TranslationKey` union
on purpose. The rebase conflicted on exactly those two files, modify-against-delete, and the thirty-two
`feed.*` keys moved into the JSON unchanged, ahead of `footer.rights` where both catalogues end.

**Nothing in the screen changed.** The two template-literal keys it builds (`feed.sort.<option>` and
`search.when.<urgency>`) needed the union to typecheck and now need nothing, and what replaced the
union is stricter where it matters at runtime: `missingKeyHandler` throws, so a key this screen uses
and neither catalogue carries fails a test rather than rendering its own name. `MEM-2026-09-20-31`'s
*"ES+EN keys in `es.ts` first"* is corrected in slice memory in this PR — an entry that names a file
which no longer exists is the failure mode that rule exists to prevent.

The web suite reads 294 rather than the 297 quoted below, because that ticket deleted three
compile-guard fixtures.

## Deviations from spec

**One, and it is in the spec now.** `AC1` was written as *"a `distanceMetres` within ±50 m of the
true distance"*, which would have meant a second, hand-rolled geodesic in the test. It is asserted
instead as **equality with what Postgres itself computes** for the same two points — the invariant
worth having (*the API reports the number the database produced*) rather than a tolerance somebody
would have to maintain. The spec's AC1 says so.

Everything else landed as written, including the two refusals (`409` for a missing profile and for a
missing radius) and the disclosure assertion over serialised JSON rather than over the type.

## Self-assessment

**Weakest part of this change.** The screen's filters act on a loaded prefix, not on the feed. With
`MAX_FEED_JOBS = 100` and a seeded world of three rows nothing shows the difference, and the day a
provider's radius holds four hundred open jobs the *hide* switches will quietly mean *hide from the
hundred most recent*. It is rendered when it truncates and §2.6 names the trigger for making the two
filters server-side — but it is the thing most likely to be wrong in front of a real user first.

**What a reviewer should look at hardest**, in this order:

1. **The disclosure rule.** `JobFeedItemSchema` is a `strictObject` and the route parses on the way
   out, so a widened `SELECT` fails rather than leaks — but the projection is written by hand in
   `feed-repository.ts` and the `quotes` include is filtered to the caller's own profile in the
   `where`. If either drifts, the schema is the only thing standing there. AC17 asserts over the
   serialised body and over the values, not just the key names.
2. **`0015`'s index, and whether it earns its place.** With a narrow radius the planner will prefer
   `address_location_gist` and this index does nothing. It is defended as insurance for the wide-radius
   case, where the geo filter is not selective — and its predicate is load-bearing for a second
   reason (it is what makes `published_at` non-null, so the cursor cannot throw). A reviewer who
   thinks that is one argument doing double duty should say so.
3. **Whether the charter amendment is the operator's call to make and mine to write down.** §2.2
   amends *"the job feed must respect licence gating"* in `agents/roles/agent-jobs.md` on two grounds
   — the data for a gate does not exist, and the operator chose labels on 2026-09-26. The role file
   itself is **not edited** in this branch: `agents-drift` compares `.claude/agents/` with
   `agents/roles/`, and rewriting a charter line is a decision for the operator rather than a side
   effect of a feature. The spec carries the amendment; the charter still says what it said.
4. **The seeder's new dependency.** `jobs.demo-feed` is the only seeder that needs `auth.demo-users`
   to have run, which is a property `providers.demo-world` and `quotes.demo-comparison` deliberately
   avoid. It throws with a message naming the seeder rather than half-seeding, and the reason it may
   is that `auth.demo-users` *refuses* rather than skipping on a non-local target — so a run that
   reaches this one has already resolved the password question.
