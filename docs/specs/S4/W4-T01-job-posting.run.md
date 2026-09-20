# Run record — W4-T01 job posting

```
Agent:        agent-jobs
Model:        claude-opus-5
Skills used:  test-driven-development, api-and-interface-design, incremental-implementation
Started:      2026-09-20T09:05Z
Finished:     2026-09-20T09:35Z
```

## Prompts

### 1. Scope, settled before anything was written

> object storage will come later, fine to have a full reduced flow for now (ie: the verified badge
> can come later) but we will dedfinitely add it later. A posted job starts as a draft till iit is
> published. The fields reqiured are minimal, as more info could be asked / posted later. A user
> should be able to complete a minimal flow even with missing parameters. I dont want to policy the
> users.

Four decisions in one message: no photos, draft-then-publish, minimal required fields, and the
governing principle. §2.2 and §2.3 are that last sentence turned into a rule.

### 2. Where the floor is

Asked whether publishing should be permissive too, accepting that a category-less job matches no
provider:

> no, at least category need to be there. and might be multiple category: a reformation of a
> bathroom, might need tiles, plumbing, and electricity

**Two answers, and the second was not in the ticket.** "At least category" set the publish floor at
one field. "Might be multiple" changed the data model from a `categoryId` column to a join table —
`JobCategory`, mirroring `ProviderCategory`.

Read as: category required at publish, **everything else optional, description included**. That
reading was stated back before building rather than assumed, because it is the aggressive
interpretation and the one that matters.

### 3. Corrections

**None from the operator.** Three self-corrections, all below.

## Red phase

`packages/contracts/tests/job.test.ts` first, against a contract that did not exist:

```
 FAIL  tests/job.test.ts [ tests/job.test.ts ]
 StateMachineDefinitionError: job: state "OPEN" has no outgoing transition but is not
 declared terminal. Add it to `terminal`, or add the rule that is missing.
  ❯ defineMachine src/state-machine.ts:252:7
  ❯ src/job.ts:88:27

 Test Files  1 failed (1)
      Tests  no tests
```

**The first red was the contract refusing my design, not a missing function** — see deviation 1.

Then, once the machine was declared honestly, 23/23 on the contract. The live suite followed and
found the second defect on its first run:

```
 FAIL  tests/job-live.test.ts > AC8 — a bathroom is not one trade
       > holds several categories and round-trips them in a stable order
 - Expected                     + Received
   [                              [
 -   "w4t01-alicatado",               "w4t01-fontaneria",
     "w4t01-fontaneria",              "w4t01-electricidad",
     "w4t01-electricidad",        +   "w4t01-alicatado",
   ]                              ]

 Test Files  1 failed (1)
      Tests  1 failed | 17 passed (18)
```

And the route suite found the third:

```
 FAIL  tests/job.test.ts > AC1 — an empty body is a valid draft
       > still refuses a body that is nonsense
 AssertionError: expected 500 to be 400
```

**Final:** contracts 23/23 · api routes 18/18 · api live 18/18 · whole api suite **405/405** under
`STACK_LIVE=1` · `pnpm verify` 10/10 turbo tasks.

The migration was applied and **rolled back on a scratch database** to prove AC15, then the drift
check run again: `migrate diff` reports an empty migration, so the schema and the database agree.

## Deviations from spec

1. **`OPEN` had to be declared terminal, and the spec said it would not be.** §2.1 originally
   argued that listing `OPEN` as terminal would be "a claim about the lifecycle this ticket does not
   own". `defineMachine` rejected that outright: a state with no outgoing transition must be
   declared terminal, or it is an undeclared dead end — which is usually a forgotten rule.

   The contract was right and the spec was wrong. Within `W4-T01` there genuinely is no way out of
   `OPEN`; `W4-T02` removes it from the list in the same change that gives it an exit. §2.1 now says
   so. **This is the shared seam doing exactly what it exists for** — catching an incoherent
   declaration at the point of declaration.

2. **Category order is taxonomy order, not insertion order.** The first implementation ordered
   `JobCategory` by `createdAt` and claimed in a comment that insertion order "is the only one that
   means anything". That order does not exist: Postgres gives every row written in one transaction
   the same `CURRENT_TIMESTAMP`, so the tiebreak fell through to a random uuid and the set shuffled
   between reads.

   Now ordered by the category's own `position` then `slug` — the order the rest of the product
   already uses (`W3-T01` §3.8), so a job's categories read the way the picker showed them. A job's
   categories are a **set**; there was never an order inherent in the choice. `createMany` replaced
   the sequential inserts, which only existed to manufacture the ordering that turned out to be
   fiction.

3. **The routes used bare `.parse()` and returned 500 for a bad body.** `modules/providers/routes.ts`
   established `safeParse` plus an explicit `AppError` with the issues named; a `ZodError` escaping a
   handler is mapped by nothing, so a caller's typo became a server error. Now a shared `parseBody`
   helper in this module. Caught by the one route test that sent deliberate nonsense.

4. **`GET /api/jobs/me` returns an unpaginated `{ items }` capped at 50.** §3 said "paginated" and
   `pagination.ts` exists, but cursor pagination on a list nobody can yet reach from a UI would be
   shape without a consumer. AC13 asserts ordering and ownership, not a cursor. `W4-T02` should add
   it with the screen that needs it.

## Self-assessment

**Weakest part of this change.** The `DRAFT`-only edit rule lives in the repository as an `if`, not
in the machine. `jobMachine` knows that `PUBLISH` moves `DRAFT → OPEN`, but "only a draft may be
edited" is a separate hand-written check that nothing ties to the machine's own states. When
`W4-T02` adds four more states, that `if` will be wrong in a way no test currently notices —
`AWARDED` and `CANCELLED` are not `DRAFT` either, so it will keep refusing correctly by accident
rather than by design.

**What a reviewer should look at hardest:**

1. **Whether the publish floor is right.** One field. A job can go `OPEN` with no description, no
   title, no budget and no location — and a provider seeing it has a category and nothing else.
   That follows the operator's instruction faithfully, and it is the decision most likely to be
   revisited once anyone looks at a real feed (`W4-T07`).
2. **The `404`-for-everything refusal.** A stranger's job, a malformed id and a job that never
   existed are indistinguishable. Deliberate, and it makes debugging a genuine client bug harder.
3. **Deviation 2's ordering choice.** Taxonomy order is defensible; so is "the order the client
   picked them", which would need a `position` column on `JobCategory`. I chose the one that needs
   no extra column and matches the picker, but it is a product call as much as a technical one.
4. **`publish()` reads `clientProfile` inside the transaction** to find the fallback address. A
   client with no `ClientProfile` row at all (which `W2-T04` has not shipped) publishes with a null
   location rather than failing — intended, per AC7, but worth confirming that is what "don't police
   the user" means here.

**Not built, and named in §6:** photos, the rest of the machine, quotes, the provider feed. The
question `W4-T03` inherits is in §2.4 — *a three-trade job: one quote or three?* The data model
does not prejudge it.
