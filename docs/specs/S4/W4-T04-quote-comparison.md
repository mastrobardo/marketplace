# W4-T04 — Comparing quotes, and the first answer a client gives

- **Slice**: S4 Jobs & presupuestos (`agent-jobs`)
- **Decides**: what a client *does* with the quotes on their job, and what `ACCEPTED` and `REJECTED`
  mean when accepting is not yet awarding.
- **Answers**: the two questions `W4-T03` handed forward — does a rejected quote free the slot, and
  what is the page size.
- **Unblocks**: `W4-T05` (award → booking, itself blocked on `W5-T02`).

---

## 1. Purpose

`W4-T03` shipped both halves of the presupuesto except the last one: a client can receive quotes and
cannot answer them. The states that would let them — `ACCEPTED`, `REJECTED` — were deliberately not
declared, because the rule `W4-T02` set is that **a state arrives with the route that can produce
it**.

This ticket produces them, and builds the screen that reads them.

### 1.1 What "accepting" is, and what it is not

**Accepting is not awarding.** ADR-013 §4 made awarding a payment — the client pays the call-out fee,
captured at award — so the award lives in `W4-T05` and is blocked on `W5-T02`. What a client does
here is **say yes to one offer**, in a system where no money has moved and nothing has been promised
to Stripe.

That distinction is the source of nearly every decision below. An acceptance that cannot take money
must not behave as though it had: it must not close the job, must not discard the alternatives, and
must not tell the other providers they lost.

## 2. Design

### 2.1 Four states now, and `EXPIRED` still is not one of them

`quote_status` gains `ACCEPTED` and `REJECTED`. It does not gain `EXPIRED`, for the reason
`W4-T03` §2.6 gave and this ticket does not revisit: expiry is arithmetic over `valid_until`, always
right, and costs nothing between the sweeps a scheduler would run.

`quoteStatusOf` therefore gains one line, not one branch:

```
WITHDRAWN | ACCEPTED | REJECTED  →  itself, whatever the date says
PENDING                          →  EXPIRED if valid_until has passed, else PENDING
```

**A decision by a person outranks the calendar.** A quote accepted on Monday and read on Friday says
`ACCEPTED`, not `EXPIRED` — the validity window governs whether an offer may still be taken up, and
once it has been taken up the window has done its work. The same rule already applied to `WITHDRAWN`;
this generalises it rather than inventing it.

### 2.2 Accepting does not touch the siblings, and does not touch the job

> BOTH. Booking and job should reflect the same state.
> — operator, 2026-09-20 *(on the separate seam question; see §4)*

When a client accepts quote **A** on a job with quotes **B** and **C**:

| | After accept |
|---|---|
| Quote A | `ACCEPTED` |
| Quotes B, C | **`PENDING`, untouched** |
| The job | **`OPEN`, untouched** |

Auto-rejecting the losers was considered and rejected by the operator. The reason is §1.1: the award
can still fail. `W4-T05` takes a payment, and a payment declines — if accepting had already rejected
B and C, a failed award leaves a job with nothing live on it and three providers who have all been
answered. Keeping them `PENDING` costs a little ambiguity for the providers and keeps every
alternative available until money has actually moved.

**The job stays `OPEN` for the same reason**, and because `AWARDED` is `W4-T05`'s state: a job whose
status changed on acceptance would be claiming an engagement the platform cannot yet back.

### 2.3 One accepted quote per job, enforced in the database

A second partial unique index, alongside the one `0012` wrote:

```sql
CREATE UNIQUE INDEX "quote_one_accepted_per_job_idx" ON "quote"("job_id")
    WHERE "status" = 'ACCEPTED';
```

In the database rather than only in the service, for the reason `W4-T03` §2.4 gave: two clicks that
arrive together are a race the service loses and the index does not. *"Enforced in the DB, not only
in the service"* is the slice's own non-negotiable and it applies to the second rule as much as the
first.

### 2.4 Rejection frees the slot; acceptance takes it

The predicate on `quote_one_active_per_provider_idx` changes from `status = 'PENDING'` to
`status IN ('PENDING', 'ACCEPTED')`. `MEM-2026-09-20-22` asked for this decision to be made
explicitly rather than inherited, and it is three decisions, not one:

| After | May the provider quote this job again? | Why |
|---|---|---|
| `WITHDRAWN` | **yes** — unchanged | `W4-T03` §2.4: revising is withdraw-then-resubmit |
| `REJECTED` | **yes** | operator, 2026-09-20 |
| `ACCEPTED` | **no** — new | you already have the live offer on this job |

**The memory entry states its own consequence backwards and is corrected in this PR.** It warns that
a rejected quote *would* block a resubmission under the current predicate. It would not: a `REJECTED`
row is not `PENDING`, so it falls out of a partial index that names `PENDING` and the slot is free
already. The decision still had to be made — the default simply ran the other way from the warning.

The operator's call was to leave it free:

- A rejection here is *"not this offer"*, not *"not you"*. A provider who was too expensive may come
  back cheaper, and that is the competition the client opened the job for.
- The cost is real and is recorded: **nothing rate-limits resubmission**, so a client who says no can
  be pitched again immediately. No mechanism in this repo can fix that today — `W5-T08`'s allowance
  metering is the one that eventually will, since a quote that arrives consumes an allowance.

`ACCEPTED` joining the predicate is not a second product decision, it is what "one active quote"
already meant: an accepted quote is the most active a quote gets. Without it a provider could hold an
accepted offer and submit a competing `PENDING` one on the same job.

### 2.5 Accepting is refused on an expired quote, and the guard is in the machine

Expiry being arithmetic has a consequence the accept route must handle: a quote past `valid_until`
still **stores** `PENDING`, so a machine that only looked at the stored status would happily accept
an offer that has lapsed.

So `quoteMachine` gains a context — it was `void` — and the `ACCEPT` transition gains a guard:

```ts
guard: (ctx) => ctx.validUntil.getTime() > ctx.now.getTime()
  || { reason: 'this quote has expired', code: 'CONFLICT' }
```

Guards are pure and synchronous (`W1-T07` Decision D), so the repository loads `validUntil` and
passes it in. The rule lives in the contract next to the states rather than as an `if` in the
repository, which is `MEM-2026-09-20-13` applied to a guard rather than to a `Record`.

**`REJECT` carries no such guard.** Rejecting a lapsed offer is a client tidying their screen, and
refusing it would leave a row nobody can clear.

### 2.6 `ACCEPTED` is terminal today, and that is a debt with a written rule for paying it

Nothing can move a quote out of `ACCEPTED`. There is no un-accept route, because `W4-T05` does not
exist and inventing a reversal for an award that cannot happen is the empty promise this repo keeps
refusing (`MEM-2026-09-20-29`).

**This is `MEM-2026-09-20-11`'s trap, entered deliberately and with its exit written down.**
`W4-T01` declared `OPEN` terminal, which was honest then and a lie the moment `AWARDED` arrived. The
same is true here, so the same rule applies, stated in advance: **`ACCEPTED` leaves `terminal` in the
same change that gives it an exit** — `W4-T05`'s award, or an un-accept, whichever comes first.

What it costs today is a one-way door: a client who accepts the wrong quote cannot take it back, and
their only remedy is cancelling the job (`W4-T02`), which is terminal and means reposting. §3.3
mitigates that in the only place it can be mitigated without inventing a state — the screen asks for
confirmation before it sends.

### 2.7 The page size stops being a guess, and stops being the same question for both lists

`GET /api/jobs/:id/quotes` returns `{ items, page }` — the `pageEnvelope` every other list in this
repo returns — with `limit` defaulting to `PAGE_LIMIT_DEFAULT` (20), capped at `PAGE_LIMIT_MAX`
(100), and a real keyset cursor.

**Paging order is `created_at DESC, id DESC`, and the ranking the client cares about is not it.**
The slice rule is *sort by rating then price, the client can re-sort, do not hide the cheapest* —
and that ordering cannot be the paging order, for a reason that is a property of the frozen
pagination contract rather than a preference:

- `provider.rating_avg` is **nullable by design** — null is *"no reviews yet"*, which is not `0.00`
  (`W3-T05`, and `W3-T10` seeds an unrated provider precisely to keep that case visible).
- `CursorValue` is `string | number | boolean`. **A cursor cannot carry a null**, so a keyset over a
  nullable column cannot express its own position, and `NULLS LAST` against a cursor comparison is
  exactly where a predicate silently skips rows rather than erroring (`pagination.ts`'s own warning
  at `keysetPredicate`).
- It is also a joined column, so the order would depend on a table the tiebreaker does not live in.

So the total order that pages is stable, non-null and single-table, and **the ranking is applied by
the screen over the set it has loaded** (§3.3). That is honest about what it is: a presentation
order over a complete set, not a database sort anyone can page through.

**`GET /api/me/jobs` and `GET /api/me/quotes` keep their uncursored cap of 50**, and the difference
is not arbitrary. The quotes on your job are written by **other people**, in numbers you do not
control; your own jobs and your own quotes are written by **you**. An unbounded list fed by strangers
is a different risk from one fed by yourself, and only the first one needed solving before a screen
could read it.

### 2.8 One permission, because it is one capability

`quote:decide-for-own-job`, held by `CLIENT`. Not `quote:accept-*` plus `quote:reject-*`: nothing in
this product grants the power to say yes without the power to say no, and two rows for one capability
is a permissions matrix that drifts.

It joins `quote:read-for-own-job` as the second `CLIENT` row in the quote family — the split
`W4-T03` §3 built, where a client reading their job's quotes and a provider reading their own are
different capabilities on purpose.

### 2.9 Which job states allow a decision

`canDecideOn`, an exhaustive `Record<JobStatus, boolean>` in the contract, for the reason
`MEM-2026-09-20-13` gives: when `AWARDED` arrives this **fails the build** until somebody decides
whether a quote may still be accepted on an awarded job, rather than refusing it correctly by
accident because `AWARDED` is not `OPEN`.

| State | Decide? | Why |
|---|---|---|
| `DRAFT` | no | a draft has no quotes — nothing may quote one (`W4-T03` §2.7) |
| `OPEN` | **yes** | the only state whose purpose is being answered |
| `CANCELLED` | no | over |

## 3. API surface and the screen

### 3.1 Routes

| Route | Permission | Does |
|---|---|---|
| `POST /api/quotes/:id/accept` | `quote:decide-for-own-job` | The **job's owner** accepts one quote |
| `POST /api/quotes/:id/reject` | `quote:decide-for-own-job` | The job's owner rejects one quote |
| `GET /api/jobs/:id/quotes` | `quote:read-for-own-job` | **changed** — now paged (§2.7) |

`/quotes/:id/accept` rather than `/jobs/:id/quotes/:qid/accept`: a quote id is unique and already
carries its job, and the shorter path is the one `POST /api/quotes/:id/withdraw` established.

**The refusal shape is `W4-T01` §3's, unchanged.** A quote on somebody else's job is `404`, not
`403` — the existence of a stranger's job is not information this API gives away. A quote that is
`WITHDRAWN`, `REJECTED`, `ACCEPTED` or expired is `409`: the caller is entitled to know the row
exists, because it is on their own job.

Every decision writes an `audit_record` in the **same transaction** as the status change, through
`transition()` — `W4-T01`'s rule, and the reason `SELECT * FROM audit_record WHERE entity = 'quote'`
is every quote that ever moved.

### 3.2 The screen — two routes, and the first job pages in `apps/web`

| Route | Loader reads | Renders |
|---|---|---|
| `/:lang/jobs` | `GET /api/me/jobs` | the client's own jobs, newest first |
| `/:lang/jobs/:id` | `GET /api/jobs/:id` + `GET /api/jobs/:id/quotes` | the job, and its quotes to compare |

**This is `W4`'s UI, not `W12`'s, and the precedent is `W2`'s.** ADR-011 gives `agent-ui` the
**storefront** — the public, indexable pages a visitor reaches without an account. An authenticated
area over a slice's own data is built by the slice that owns the data, which is what `W2-T09`/`W2-T10`
did with `/account`. A quote comparison screen behind a session is that, not a storefront page.

**No job-posting form.** A client still cannot create a job from the browser; that stays `W4-T01`'s
tail. The seeder (§3.4) is what makes these screens reachable in a preview.

### 3.3 What the comparison screen does

- **Sorted by rating, then price**, over the whole loaded set. Unrated providers sort last — *no
  reviews yet* is not a bad rating, and putting them at the bottom of a comparison is the honest
  place for an unknown rather than a zero.
- **The client can re-sort** — by price, or by when the quote arrived.
- **The cheapest is never hidden.** It is marked, whatever the sort, because the slice rule exists to
  stop a ranking quietly burying the number the client came for.
- **Coverage is rendered per quote**: every category the job asked for, whether this provider lists
  it, and whether it is a licensed trade. `W4-T03` §2.3 built this to be *shown*; this is the screen
  that shows it, and it carries no verification claim because nothing in the schema knows one.
- **Accept asks for confirmation** (§2.6). One dialog, naming the provider and the amount, because
  the action has no undo until `W4-T05` gives it one.
- **An expired quote renders as expired and cannot be accepted** — the button is gone, not disabled
  and failing at the API.
- **The loader assembles the whole set**, following the cursor until the API says there is no more,
  bounded at 100 quotes. There is no *load more* button, and that is a change from this spec's first
  draft: a ranking applied to the first 20 of 40 quotes is not a partial comparison, it is a **wrong**
  one, so the set the screen sorts has to be the set the job has. A job that exceeds the bound says
  so rather than silently ranking a prefix.

### 3.4 Seed data

`quotes.demo-comparison` — a demo client with one `OPEN` job across three trades, and four quotes on
it from the providers `W3-T10` seeded. DoD §5.3 requires it: *seed data exists for anything this
feature adds to a funnel*, registered in `registry.ts` and named in both deploy workflows' `--only`
lists, so a preview can exercise the screen.

It must carry the rows the screen has branches for, the way `W3-T10` did for search: **an unrated
provider** (the cold-start sort), **the cheapest quote not being the best-rated one** (or the
"never hidden" rule demonstrates nothing), **a quote whose coverage is incomplete** (a provider who
does not list one of the job's trades), and **one already past `valid_until`**.

Not `localOnly`, for `W3-T10`'s reason: no credential, no real person. And it creates its own client
user, because in every environment where `auth.demo-users` correctly refuses, its rows are absent.

## 4. What does not change

- **`jobMachine`, and the job's states.** This ticket adds none. The operator settled the seam
  question `MEM-2026-09-20-14` left open — *"BOTH. Booking and job should reflect the same state.
  This will be also a way to check if smtg is going badly"* — which is ADR-013 §1 and §2 already:
  two of the three sources of truth, **reconciled rather than coupled**, with a reconciler writing a
  *finding* when they disagree (`W5-T11`, gaining a second dimension). `IN_PROGRESS` and `COMPLETED`
  still have nothing that can produce them, so they arrive with `W5`. The stale question is corrected
  in `MEM-2026-09-20-14`, in `TODO.md`'s banner and in `W4-T05`'s row.
- **`Quote`'s shape.** One quote, one job, one price; coverage computed at read time with no
  `verified` field (`W4-T03` §2.1, §2.3).
- **Who may quote.** The platform still does not gate it.
- **Any money.** ADR-013 §4: nothing here charges anything, and `amountCents` remains information.
- **`GET /api/me/quotes`, `GET /api/me/jobs`** — §2.7.

**One contract change worth a reviewer's attention:** `GET /api/jobs/:id/quotes` changes its response
shape from `{ items }` to `{ items, page }`. `packages/contracts` is a frozen seam, and the rule is
that a merged shape moves only by ADR. This is not treated as one, because the change was **specified
in advance by the ticket that shipped the interim shape** — `W4-T03`'s run record names the missing
cursor as its weakest part and `TODO.md`'s `▶ NEXT` banner assigns it here. `agent-contracts` reviews
this spec (§5.4 axis 2) and can still call for an ADR; flagged rather than assumed.

## 5. Acceptance criteria

- **AC1** — The job's owner accepts a `PENDING` quote; it reads `ACCEPTED`.
- **AC2** — The job's owner rejects a `PENDING` quote; it reads `REJECTED`.
- **AC3** — Accepting leaves every sibling quote `PENDING` and the job `OPEN` (§2.2).
- **AC4** — A second acceptance on the same job is refused **by the database**, not only the service.
- **AC5** — After a rejection, the same provider may submit a new quote on that job (§2.4).
- **AC6** — After an acceptance, the same provider may **not** submit another quote on that job.
- **AC7** — Accepting a quote past `valid_until` is `CONFLICT`, through the machine's guard (§2.5).
- **AC8** — Rejecting a quote past `valid_until` succeeds (§2.5).
- **AC9** — Accepting or rejecting an already-decided or withdrawn quote is `CONFLICT`.
- **AC10** — A quote on a `CANCELLED` job cannot be decided, through `canDecideOn` (§2.9).
- **AC11** — A stranger decides nothing: `404`, the same answer a non-existent quote gets.
- **AC12** — A `PROVIDER` cannot accept a quote on a job — including their own quote (`403`).
- **AC13** — An unauthenticated caller is `401`.
- **AC14** — Every accept and reject writes an `audit_record` in the same transaction, with
  `entity = 'quote'` and the actor's id.
- **AC15** — An accepted quote reads `ACCEPTED` after `valid_until` passes, not `EXPIRED` (§2.1).
- **AC16** — `GET /api/jobs/:id/quotes` returns `{ items, page }`, defaults to 20, refuses a limit
  above 100, and its cursor walks the whole set exactly once with no row repeated or skipped.
- **AC17** — The comparison screen sorts by rating then price, places unrated providers last, sinks
  every quote nobody can act on below every quote they can, and marks the cheapest **live** quote
  under every sort order (§3.3). The mark is absent when fewer than two quotes are live: *cheapest*
  is a comparison, and a badge on the only option would read as an endorsement.
- **AC18** — The screen renders an expired quote as expired with no accept control.
- **AC19** — Accepting from the screen requires confirmation; dismissing the dialog sends nothing.
- **AC20** — Both screens redirect to the login form without a session, as `/account` does.
- **AC21** — Every string on both screens exists in ES and EN; no hardcoded copy.
- **AC22** — Both screens are built to `W12`'s accessibility rules — a labelled sort control, one
  `h1`, a named dialog, and no disabled control standing in for an absent one. **They are not
  covered by an automated axe pass, and that is a gap this ticket does not close**: `W12-T04`'s gate
  runs over Storybook stories and `W12-T16`'s nightly runs axe over *public* routes, and neither can
  reach a page behind a session. Closing it means either a story per state or a signed-in nightly,
  and both are `agent-ui`'s call rather than this slice's. Filed in §6.
- **AC23** — The seeder produces the four load-bearing rows §3.4 names, and is registered in
  `registry.ts` and in both deploy workflows' `--only` lists.
- **AC24** — The migration is reversible and `prisma migrate diff` reports no drift.

## 6. Out of scope

- **The award** — `W4-T05`, blocked on `W5-T02`. Accepting is not awarding (§1.1), and `AWARDED` is
  not declared here.
- **Un-accepting.** §2.6 — no route, `ACCEPTED` terminal, and the rule for when that changes.
- **Telling the other providers anything.** No notification of any kind: `OPS-14` has not happened
  and `W11` owns it. A provider learns the outcome by reading `/me/quotes`.
- **Rate-limiting resubmission after a rejection** (§2.4). `W5-T08`'s allowance metering is the
  mechanism, and it is `[B]`.
- **A job-posting form** (§3.2), and any change to `GET /api/me/jobs` (§2.7).
- **Provider-side verification** on coverage — still `W8`.
- **An automated axe pass over an authenticated route** (AC22). No harness in this repo can reach
  one today. `agent-ui` owns the choice between a story per state and a signed-in nightly; until
  then these two screens are reviewed by hand against the same rules.
