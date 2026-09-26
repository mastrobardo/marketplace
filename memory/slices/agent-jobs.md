# Slice memory — agent-jobs

Durable knowledge for this slice only. Written and owned by this agent alone. Read it at the start
of every task; add to it at the end of every task that taught you something reusable.

Entry format (see `agents/policies/memory.md`):

```markdown
### <short title>
- **id**: MEM-<date>-<n>
- **scope**: slice:S6
- **fact**:
- **why**:
- **apply**:
- **evidence**: <PR / file:line / ADR / intervention id>
- **status**: active
```

Keep it to facts that changed how you would work. Task-specific detail stays in the session file.

---

### `jobMachine` carries two debts `W4-T02` must pay, and neither fails a test today
- **id**: MEM-2026-09-20-11
- **scope**: slice:S4
- **fact**: `W4-T01` left two things that are correct now and become wrong the moment the job
  lifecycle grows past `DRAFT → OPEN`:
  1. **`jobMachine.terminal` lists `OPEN`.** `defineMachine` refuses a state with no outgoing
     transition unless it is declared terminal, and within `W4-T01` `OPEN` genuinely has no exit.
     The declaration is honest today and a lie the moment `AWARDED` exists.
  2. **"Only a draft may be edited" is a hand-written `if` in `repository.update`**, not a machine
     rule. Nothing ties it to the machine's states.
- **why**: Both keep behaving correctly as more states arrive — the `if` refuses `AWARDED` and
  `CANCELLED` too, but *by accident*, because they are not `DRAFT`. Correct-by-accident is the
  failure mode no test catches: there is nothing red to notice, and the rule silently stops
  expressing what anyone intended.
- **apply**: `W4-T02` removes `OPEN` from `terminal` **in the same change** that gives it an exit,
  and moves the edit rule into the machine — an `EDIT` event guarded on state, or an explicit
  `editableStates` the repository reads. Do not let either survive a lifecycle change. More
  generally in this slice: when a rule about *which states allow an action* is written as an `if`,
  it belongs in the machine, which is the one place that knows what the states are.
- **evidence**: `W4-T01` run record self-assessment; `packages/contracts/src/job.ts` `jobMachine`;
  `apps/api/src/modules/jobs/repository.ts` `update`
- **status**: **paid by `W4-T02`, 2026-09-20.** `terminal` is `['CANCELLED']` and `OPEN` has an exit;
  the `if` is now `canEditJob`, an exhaustive `Record<JobStatus, boolean>` that fails the build when
  a state is added without a decision — generalised to the whole repo as `MEM-2026-09-20-13`. Kept
  rather than deleted because the reasoning is why the next lifecycle should not repeat it.

### The job lifecycle is not this slice's to finish — three of its states are `agent-money`'s

- **id**: MEM-2026-09-20-14
- **scope**: slice:S4
- **fact**: `TODO.md`'s `W4-T02` row reads `DRAFT → OPEN → AWARDED → IN_PROGRESS → COMPLETED /
  CANCELLED` as though it were one ticket. It is not. Each state belongs to whatever can **produce**
  it: `AWARDED` to `W4-T05` (an accepted quote from `W4-T03` to award to), `IN_PROGRESS` to the
  booking lifecycle in `W5`, `COMPLETED` to `W5-T04` (completion is what triggers capture), and
  cancelling *after* an award to `W5-T05`, because by then it is a refund decision. `W4-T02` shipped
  `CANCELLED` from `DRAFT`/`OPEN` and nothing else.
- **why**: a state nothing can write is the empty promise this repo keeps refusing — the same rule
  that stops `permissions.ts` holding a row for a route that does not exist. Shipping four enum
  values to satisfy a board line would have made the machine read as finished while three of its
  states were unreachable, and would have had this slice invent award semantics that `W4-T05` then
  rewrites.
- **apply**: when a ticket's title describes a whole lifecycle, list what produces each arrow before
  estimating it.

  **The question this entry left open is answered, and was already answered when it was written.**
  Operator, 2026-09-20: *"BOTH. Booking and job should reflect the same state. This will be also a
  way to check if smtg is going badly"* — which is ADR-013 §1 and §2 verbatim in substance: `Job`
  and `Booking` are two of the three sources of truth, **reconciled rather than coupled**, and a
  reconciler writes a **finding** when they disagree (`W5-T11`, gaining a second dimension —
  lifecycle against money, not only ledger against Stripe). A job does *not* need its booking's
  permission to change state; coupling them would punish a professional whose webhook is late.
  ADR-013 §2 adds the caveat to carry forward: **most divergence is a defect in our own plumbing
  rather than a person behaving badly**, and a reconciler that cannot tell those apart becomes noise
  and stops being read.

  What does **not** follow from "both" is building the states now: `IN_PROGRESS` and `COMPLETED`
  still have nothing that can produce them, so they arrive with `W5` (`MEM-2026-09-20-29`).
- **evidence**: `docs/specs/S4/W4-T02-job-state-machine.md` §6.1;
  `apps/api/prisma/migrations/0011_job_cancellation/migration.sql`; ADR-013 §1, §2; operator,
  2026-09-20
- **status**: **answered 2026-09-20.** Kept because the *reasoning* — two machines over one
  engagement can disagree, and the disagreement costs a refund — is what makes the reconciler
  necessary rather than optional.

### A cancellation reason is audit metadata, not a column

- **id**: MEM-2026-09-20-15
- **scope**: slice:S4
- **fact**: `POST /api/jobs/:id/cancel` takes an optional `reason` and writes it to
  `audit_record.metadata`. There is no `cancellation_reason` column and `JobSchema` has no field for
  it. `cancelled_at` **is** a column, mirroring `published_at`.
- **why**: the audit row already records who ended the job, when, and from which state. A column
  would be a second home for one fact, and two homes drift as soon as anything writes one of them.
  The timestamp is different: a list screen needs it without joining `audit_record`.
- **apply**: reuse this split for every lifecycle reason in this slice — *why* it happened goes to
  `metadata`, *when* it happened earns a column only if a screen needs it without a join. If a
  reason ever has to be shown in a list, read it from `audit_record` before adding a column; and
  note `W4-T02`'s own run record flags the two-timestamp pattern as not scaling past a few states.
- **evidence**: `packages/contracts/src/job.ts` `JobCancelInputSchema`;
  `docs/specs/S4/W4-T02-job-state-machine.md` §2.5; `apps/api/tests/job-live.test.ts` AC5
- **status**: active

### One quote covers the whole job, and nothing checks whether the provider can do all of it

- **id**: MEM-2026-09-20-21
- **scope**: slice:S4
- **fact**: A `Quote` references a `Job`, never a `JobCategory`. There is no per-trade price and no
  rule requiring the quoting provider to list the job's categories — a plumber may quote a bathroom
  that also needs electrical work. What the client sees instead is **coverage**: every category the
  *job* names, whether the provider lists it, and whether it requires a licence.
- **why**: operator, 2026-09-20 — *"Usually, a plumber knows an electirician wich works with him
  already, or has a small comapny with all profiles. It would be also too chaotic for a user
  accepting X presupuestos."* Splitting a job into per-trade quotes makes the client the general
  contractor, coordinating three trades onto one site in the right order. That coordination already
  exists in this market, and it is not the client's job.
- **apply**: subcontracting is therefore **normal and invisible to this platform** — the review, the
  no-show flag and the ban from ADR-013 all attach to whoever quoted, because they chose the
  subcontractor. Do not build sub-profiles or per-category quote rows without reopening ADR-013
  §4.1. And note what coverage does *not* carry: no `verified` field, because `W8` is unbuilt and
  nothing in the schema knows it — see `MEM-2026-09-20-20`'s last line.
- **evidence**: `docs/specs/S4/W4-T03-quote-submission.md` §2.1, §2.3;
  `packages/contracts/src/quote.ts`
- **status**: active

### A withdrawn quote must not block the next one — the index is partial

- **id**: MEM-2026-09-20-22
- **scope**: slice:S4
- **fact**: `quote_one_active_per_provider_idx` is `UNIQUE (job_id, provider_id) WHERE status =
  'PENDING'`. Partial, hand-written in `0012` because Prisma cannot express it. A provider revises a
  quote by withdrawing and submitting again; both rows survive.
- **why**: a plain `UNIQUE (job_id, provider_id)` would make a withdrawn quote a **permanent** bar
  on ever quoting that job again — a rule nobody intended, invisible in review, and discovered by a
  support ticket months later.
- **apply**: **the predicate is load-bearing and changes meaning when states are added.** A partial
  index is a rule written in a `WHERE` clause, so it deserves the same scrutiny as a rule written in
  code.
- **evidence**: `apps/api/prisma/migrations/0012_quote_submission/migration.sql`;
  `apps/api/tests/quote-live.test.ts` AC3/AC4
- **status**: **amended by `W4-T04`, 2026-09-20.** This entry used to end *"decide explicitly whether
  a rejected quote should block a resubmission — under the current predicate it would, silently"*,
  and **that stated the consequence backwards**: a `REJECTED` row is not `PENDING`, so it falls out
  of a predicate naming `PENDING` and the slot was already free. The decision still had to be made;
  the default simply ran the opposite way from the warning. `0014` now reads
  `WHERE status IN ('PENDING', 'ACCEPTED')` — see `MEM-2026-09-20-30`. Kept rather than corrected in
  place, because *"a warning that points the wrong way is worse than no warning"* is the lesson.

### A decision by a person outranks the calendar, and the index says which decisions are live

- **id**: MEM-2026-09-20-30
- **scope**: slice:S4
- **fact**: `quote_status` is `PENDING | WITHDRAWN | ACCEPTED | REJECTED`, and two rules about it
  live in partial indexes rather than in the service:
  `quote_one_active_per_provider_idx` is now `WHERE status IN ('PENDING', 'ACCEPTED')`, and
  `quote_one_accepted_per_job_idx` is `UNIQUE (job_id) WHERE status = 'ACCEPTED'`.
  Separately, `quoteStatusOf` returns the **stored** status for anything but `PENDING`: an accepted
  quote reads `ACCEPTED` after `validUntil` passes, never `EXPIRED`.
- **why**: three product decisions, two of them the operator's (2026-09-20). A **rejection frees the
  slot** — it means *"not this offer"*, not *"not you"*, so a provider who was too expensive may come
  back cheaper. **Acceptance takes it**, which is not a second decision but what *"one active quote"*
  already meant: without it a provider could hold the live offer and submit a competing `PENDING` one
  alongside it. And **accepting does not touch the siblings or the job** — the award is a payment
  `W5-T02` has not built, so burning the alternatives before money moves would leave a job with
  nothing live on it when an award fails.
- **apply**: **the expiry rule generalises — arithmetic only ever overrides a state nobody has
  answered.** Reuse it for any lifecycle in this slice where a deadline and a decision can both be
  true. And when adding a state, check both predicates: a partial index is a rule in a `WHERE`
  clause, and `MEM-2026-09-20-22` is the standing proof that such a rule can be *documented*
  backwards without anything failing. The cost carried knowingly: **nothing rate-limits resubmission
  after a rejection**, and `W5-T08`'s per-quote allowance is the mechanism that will.
- **evidence**: `apps/api/prisma/migrations/0014_quote_decision_indexes/migration.sql`;
  `packages/contracts/src/quote.ts` `quoteStatusOf`; `apps/api/tests/quote-decision-live.test.ts`
  AC5/AC6/AC15; `docs/specs/S4/W4-T04-quote-comparison.md` §2.1, §2.4
- **status**: active

### An authenticated page over this slice's data is this slice's to build, not `W12`'s

- **id**: MEM-2026-09-20-31
- **scope**: slice:S4
- **fact**: `/:lang/jobs` and `/:lang/jobs/:id` live in `apps/web/src/routes/` and were built by
  `agent-jobs`. ADR-011 gives `agent-ui` the **storefront** — the public, indexable pages a visitor
  reaches without an account — and that is not the same thing as "every page".
- **why**: the precedent is `W2`'s, not an exception invented here: `/account` is `W2-T09`/`W2-T10`'s,
  built by `agent-identity` in the same tree. A page behind a session, rendering one slice's own
  shapes, has no storefront concerns (no SEO, no prerender, no anonymous empty state) and every
  slice concern. Routing it through `W12` would mean the agent who owns neither the contract nor the
  endpoint decides how its rules are shown.
- **apply**: build the authenticated screens for your own slice, in `src/routes/`, following `W12`'s
  rules — loader-driven (ADR-011 R3), primitives from `@marketplace/ui`, ES+EN keys in **`es.json`**
  first (it was `es.ts` when this was written; `W12-T21` made the catalogues data, 2026-09-20).
  **What you cannot do today is prove them accessible automatically**: `W12-T04`'s axe gate runs over
  Storybook stories and `W12-T16`'s nightly over *public* routes, so a signed-in page is covered by
  neither. Say so in the spec rather than claiming an axe pass.
- **evidence**: `apps/web/src/routes/job.tsx`; `apps/web/src/app/routes.tsx`;
  `docs/specs/S4/W4-T04-quote-comparison.md` §3.2, §6; ADR-011 §2
- **status**: active

### The feed labels what it cannot gate, and the charter asked for the opposite

- **id**: MEM-2026-09-26-1
- **scope**: slice:S4
- **fact**: `agents/roles/agent-jobs.md` says *"the job feed must respect licence gating and radius —
  a pro seeing jobs they cannot legally do is a trust failure."* `W4-T07` implements the radius and
  **amends the licence half**: `GET /api/me/job-feed` returns a job whose trades include a regulated
  one the provider does not list, carrying `coverage` with `requiresLicence` and `listedByProvider`,
  and the screen offers *hide these* as a switch the provider flips.
- **why**: two independent reasons, and either would be enough. **The data for a gate does not
  exist** — `requiresLicence` is a flag on a *category* (`W3-T01`, `BD-07`) and nothing in this schema
  knows whether a **provider** holds a licence, because `Certification` is `W8-T01`/`W8-T02` and
  unbuilt; a filter built on the flag would be gating on profile completeness while calling it
  compliance, which is `W4-T03`'s refused `verified` field moved into a `WHERE` clause where nobody
  can see it. And the operator chose labels, 2026-09-26: *"Agree with the labels proposal: in the
  view will be the client to be able to filter."*
- **apply**: **when a charter line asks for a rule the schema cannot express, implement the half that
  is true and write the amendment into the spec — do not edit the role file.** `agents-drift` compares
  `.claude/agents/` with `agents/roles/`, and rewriting a charter is the operator's decision rather
  than a side effect of a feature. More generally in this slice: the pattern is now three for three —
  `W4-T03`'s coverage, `W4-T04`'s sibling quotes, this — **state the fact, leave the choice.** The
  cost is carried knowingly and named: nothing stops an unlicensed provider quoting a gated job, and
  `W8-T01` is the mechanism that will.
- **evidence**: `docs/specs/S4/W4-T07-provider-job-feed.md` §2.2; `packages/contracts/src/job-feed.ts`
  `JobFeedCoverageSchema`; `apps/web/src/features/jobs/feed.ts` `hasLicenceGap`;
  `apps/api/tests/job-feed-live.test.ts` AC4
- **status**: active

### A partial index's predicate can be the same fact as a cursor's safety

- **id**: MEM-2026-09-26-2
- **scope**: slice:S4
- **fact**: the feed pages by `published_at`, not `created_at`, and `0015` adds
  `job_feed_open_published_idx` — `(published_at DESC, id DESC) WHERE status = 'OPEN'`. The predicate
  is the feed's own filter **and** the condition under which `published_at` is guaranteed non-null,
  because `publish()` writes the status and the timestamp in one transaction.
- **why**: `job_status_created_idx` does not serve this query. A draft created in June and published
  this morning is new to a provider and old to the table, so paging a feed by creation time is a
  *wrong* list rather than a differently sorted one. And `encodeCursor` throws on a null sort value by
  design (`pagination.ts`), so a nullable sort key is normally disqualified — `ratingAvg` was, twice
  (`search.ts`, `W4-T04` §2.7). This one is not, and the reason is exactly the index's `WHERE`.
- **apply**: **before ruling out a nullable column as a sort key, check whether the endpoint's own
  filter already guarantees it is set.** If it does, say so in one place — the index's predicate — and
  reference it from the contract, instead of asserting non-nullness twice. Two practical notes that
  cost time here: Prisma cannot express a partial index, so it is hand-written SQL **and invisible to
  `prisma migrate diff`** (which is why the `Job` model carries a comment naming it, like `Quote`
  does); and a **backtick inside a `Prisma.sql` template is a parse error**, so SQL comments in a
  tagged template use plain words.
- **evidence**: `apps/api/prisma/migrations/0015_job_feed_index/migration.sql`;
  `packages/contracts/src/job-feed.ts` `JOB_FEED_SORTABLE`; `apps/api/prisma/schema.prisma` `Job`
- **status**: active

### A keyset over an id cast to text is no query at all, and only page two says so

- **id**: MEM-2026-09-26-3
- **scope**: slice:S4
- **fact**: `feed-repository.ts`'s statement kept `id` as a `uuid` inside its CTE and casts to text
  only in the final `SELECT`. The first draft did `j.id::text AS id` in the CTE, and the keyset —
  `m.id > ${cursor.id}::uuid` — failed with `operator does not exist: text > uuid`.
- **why**: the first page never touches the keyset, so the whole feature looked finished. It failed
  only when a cursor existed, which in a hand-test means scrolling past twenty rows that a seeded
  demo world does not have. The tests that caught it were the two paging ones, and they caught it
  because they assert over the **union** of two pages rather than over their lengths.
- **apply**: in any raw-SQL keyset here, **the column the cursor compares and the column the ORDER BY
  names must be the same type as the value being interpolated** — cast on the way out, never in the
  CTE. And keep asserting paging the way `W4-T07` AC10/AC11 do: every row served exactly once over
  the union, plus a run where two rows share a sort value to the millisecond. A length assertion
  would have passed on the broken version of the second page, because there was no second page.
- **evidence**: `apps/api/src/modules/jobs/feed-repository.ts`;
  `apps/api/tests/job-feed-live.test.ts` AC10, AC11
- **status**: active

### A seeder may depend on `auth.demo-users` when signing in *is* the point

- **id**: MEM-2026-09-26-4
- **scope**: slice:S4
- **fact**: `jobs.demo-feed` resolves `provider@marketplace.local` and `client@marketplace.local` by
  email and **throws** when they are absent, naming `auth.demo-users`. It is the only seeder in the
  registry that does; `providers.demo-world` and `quotes.demo-comparison` deliberately create their
  own credential-less users so they keep working where the credentialed seeder refuses.
- **why**: before it, **no account anybody could sign in as could read a job feed**:
  `provider@marketplace.local` had no `ProviderProfile`, so `GET /api/me/job-feed` answered `409`, and
  `quotes.demo-comparison`'s job has no address, so it could not appear in a feed either. A fixture
  whose purpose is *a person walks the funnel* cannot invent its own users without inventing
  credentials, which is what `localOnly` exists to stop from travelling.
- **apply**: the dependency is safe **because `auth.demo-users` refuses rather than skips** on a
  non-local target without `SEED_DEMO_PASSWORD` — so a run that reaches a later seeder has already
  answered the password question. Do not copy this to a fixture that only needs *rows*; copy
  `demo-quotes`' self-sufficiency instead. Two consequences worth knowing before adding any provider
  to a seeder: it becomes a **real row in `/api/search`**, so `seed-live.test.ts` and
  `categories-live.test.ts` count it; and every such seeder must stay out of the `localOnly` list,
  which `seed-filter.test.ts` AC11 asserts over the whole registry.
- **evidence**: `apps/api/prisma/seed/demo-feed.ts`; `apps/api/tests/demo-feed.test.ts`;
  `apps/api/tests/job-feed-live.test.ts` (the seeded-feed block)
- **status**: active
