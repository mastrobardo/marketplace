# Run record — W4-T04 quote comparison

Agent:        agent-jobs
Model:        claude-opus-5
Skills used:  test-driven-development, spec-driven-development, api-and-interface-design,
              frontend-ui-engineering, git-workflow-and-versioning
Started:      2026-09-20T18:05Z

## Prompts

### 1. Task selection

> Please,  W4-T04 or whatever is next ;)

Open-ended. The agent read `memory/LONG_TERM.md`, `memory/slices/agent-jobs.md`, the `W4-T03`
session file and `TODO.md`'s `▶ NEXT` banner, and checked `gh pr list` first — `MEM-2026-09-20`
records that the banner on `main` is only true when nothing is open. Nothing was, so the banner was
trustworthy and `W4-T04` was next.

### 2. Three scoping decisions put to the operator

Asked before any file was written, because each one changes what gets built rather than how:

1. **UI scope** — API only, API + screen + seeder, or API + screen + job-posting form?
2. **After a rejection** — does the provider get to quote again?
3. **On acceptance** — do the sibling quotes stay `PENDING` or get auto-rejected?

All three came back as the recommended option: **API + comparison screen + seeder**, **rejection
frees the slot**, **siblings stay `PENDING`**.

### 3. The seam question, answered from a lost session

> I did answer on this, but probably we lost it: BOTH. Booking and job should reflect the same
> state. THis will be also a way to check if smtg is going badly

This answered `MEM-2026-09-20-14`'s open question — does a job track `IN_PROGRESS`/`COMPLETED`, or
read them off its `Booking`? **Not a correction and not an intervention**: it answered a question the
agent had surfaced as open, which `ADR-010` and `W11-T19` explicitly exclude from the intervention
ledger.

The agent checked before recording it and found ADR-013 §1/§2 **already said exactly this** —
reconciled, not coupled, with a reconciler writing a finding on divergence. So the answer needed no
new decision; three stale references to the question did need correcting (`MEM-2026-09-20-14`,
`TODO.md`'s banner, `W4-T05`'s row). Recorded in the spec §4, and it changes no code here.

### 4. Go-ahead

> COnfirmed

## Red phase

Contracts were frozen first (§5.1 step 2), so `packages/contracts` was green before these ran —
the states, the guard and the list schema exist; **nothing that serves them does.**

```
$ STACK_LIVE=1 DATABASE_URL=... pnpm --filter @marketplace/api exec vitest run quote-decision

 FAIL  tests/quote-decision-live.test.ts [ tests/quote-decision-live.test.ts ]
TypeError: Cannot read properties of undefined (reading 'parse')

⎯⎯⎯⎯⎯⎯ Failed Tests 11 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/quote-decision.test.ts > AC1/AC2 — the client decides > accepts, and reports the new state
AssertionError: expected 404 to be 200 // Object.is equality
 FAIL  tests/quote-decision.test.ts > AC1/AC2 — the client decides > rejects, and reports the new state
AssertionError: expected 404 to be 200 // Object.is equality
 FAIL  tests/quote-decision.test.ts > AC12 — a provider cannot answer a quote, including their own > refuses accept to a PROVIDER
 FAIL  tests/quote-decision.test.ts > AC12 — a provider cannot answer a quote, including their own > refuses reject to a PROVIDER
AssertionError: expected 404 to be 403 // Object.is equality
 FAIL  tests/quote-decision.test.ts > AC13 — every decision needs a principal > refuses accept to an anonymous caller
 FAIL  tests/quote-decision.test.ts > AC13 — every decision needs a principal > refuses reject to an anonymous caller
AssertionError: expected 404 to be 401 // Object.is equality
 FAIL  tests/quote-decision.test.ts > AC11 — somebody else s quote is not found, not forbidden > answers 404 for a malformed id without telling the caller it was malformed
AssertionError: expected 'Route POST /api/quotes/not-a-uuid/acc…' not to match /uuid/i
 FAIL  tests/quote-decision.test.ts > AC16 — the quotes list speaks the page envelope > returns items and a page
AssertionError: expected 500 to be 200 // Object.is equality
 FAIL  tests/quote-decision.test.ts > AC16 — the quotes list speaks the page envelope > refuses a limit above the maximum rather than quietly clamping it
AssertionError: expected 500 to be 400 // Object.is equality
 FAIL  tests/quote-decision.test.ts > AC16 — the quotes list speaks the page envelope > refuses an unknown query parameter rather than paging in a circle
AssertionError: expected 500 to be 400 // Object.is equality
 FAIL  tests/quote-decision.test.ts > AC16 — the quotes list speaks the page envelope > answers an empty page for a job with no quotes, never a 404
AssertionError: expected 500 to be 200 // Object.is equality

 Test Files  2 failed (2)
      Tests  11 failed | 1 passed (12)
```

**Three different shapes of red, and each one is the absence of a different thing.** `404` is a route
that does not exist. `403`/`401` arriving *as* `404` is the same absence seen through the guard —
Fastify has nothing to guard. `500` on the list is the route that does exist, handed a query schema
it has never parsed. The live file does not even import: its repository methods are not on the
interface yet.

The one test that passed is the malformed-id case, and it passed **for the wrong reason** — Fastify's
own *"Route POST /api/quotes/not-a-uuid/accept not found"* is a 404 that happens to match. It is
kept because it stops matching the moment the route exists, which is when the assertion starts doing
its job.

## Deviations from spec

**Three, all found while building, all written back into the spec rather than left in the diff.**

1. **The migration is two migrations.** The spec assumed one. Postgres refuses to *use* a new enum
   value in the transaction that added it, and Prisma runs one migration per transaction — so the
   two partial indexes that name `ACCEPTED` cannot be created until `0013` has committed. Verified
   against a real Postgres before writing it that way, rather than reasoned about. `0014` carries
   the indexes, and `0013`'s rollback additionally has to drop and restore **`0012`'s** index,
   because its `WHERE status = 'PENDING'` predicate is typed by the enum being rebuilt
   (`operator does not exist: quote_status = quote_status_old`). Found by running the rollback,
   which `db.test.ts` does.

2. **No *load more* button; the loader follows the cursor and assembles the whole set** (spec §3.3,
   rewritten). The first draft had the screen page and append. That is wrong for this screen: the
   ranking is *rating, then price* over every offer, and ranking the first page of two is not a
   partial comparison but a wrong one. It also makes the cursor's purpose honest — the API needed
   one because the list is written by strangers, the screen needs one because it sorts, and those
   are the same requirement from two ends.

3. **AC22 weakened, deliberately and visibly.** It asked for an axe pass; there is no harness in
   this repo that can run axe over a page behind a session — `W12-T04` covers stories, `W12-T16`
   covers public routes. Rather than delete the criterion or claim it, it now states what was built
   to and names the gap as out of scope with an owner (`agent-ui`).

**One test was wrong rather than the code**: `cheapestOf` returning `null` for a single live quote
failed a test asserting it should pick that quote. The rule is right — *cheapest* is a comparison,
and marking the only option is an endorsement — so the test was rewritten to state the real case
(two live quotes and a cheaper withdrawn one).

## Self-assessment

- **Weakest part of this change**: **`ACCEPTED` is a one-way door.** A client who accepts the wrong
  quote cannot take it back — the only exit is cancelling the job, which is terminal and means
  reposting. A confirmation dialog is the whole mitigation, and a dialog is not an undo. The spec
  argues the alternative is worse (inventing a reversal for an award that cannot yet happen), and
  the rule for paying the debt is written down in the machine itself. But it ships as a real sharp
  edge, and if `W5-T02` slips, it stays sharp for as long as that takes.

- **What a reviewer should look at hardest**:
  1. **The index predicate change in `0014`.** `PENDING` → `PENDING, ACCEPTED` is three separate
     product decisions compressed into one `WHERE` clause, and the operator made two of them. If
     the reading of *"a rejection frees the slot"* is wrong, nothing fails — a rejected provider
     simply re-quotes, which is the outcome the operator asked for and also what a bug would look
     like. `quote-decision-live.test.ts` AC5/AC6 is where that is pinned.
  2. **The ordering of the audit write and the status update** in `decide()`. The audit row is
     written *first*, inside the transaction, so a unique-index violation on the update rolls both
     back. Swap them and a refused second acceptance leaves an ACCEPT in `audit_record` for a quote
     that was never accepted. Asserted by AC14's second case, which is easy to read past.
  3. **`GET /api/jobs/:id/quotes` changing response shape** without an ADR. Argued in spec §4: the
     change was specified in advance by `W4-T03`, which shipped the interim shape and named this
     ticket. `agent-contracts` can still call for one.
