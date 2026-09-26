# W4-T07 — The job feed, and the half of the funnel a provider could not reach

- **Task**: `W4-T07`
- **Slice**: S4 — Jobs & presupuestos (`agent-jobs`)
- **Status**: implemented on `W4-T07-provider-job-feed`
- **Depends on**: `W4-T01` (the `Job`), `W4-T02` (`CANCELLED`), `W4-T03` (`POST /api/jobs/:id/quotes`,
  coverage), `W4-T04` (the paging rule for a list strangers write), `W3-T05` (the radius statement),
  `W3-T01` (the taxonomy and `requiresLicence`)
- **Reviewers**: `agent-contracts` (spec + contract), `agent-providers` (the radius is their column)

---

## 1. Purpose

`W4-T03` shipped the route a provider sends a quote to. `W4-T04` shipped the screen a client chooses
on. Between them the funnel has a hole big enough to make both pointless: **nothing lists the jobs**.
Every quote in this system today was written by somebody who was handed a job's uuid, which is not a
marketplace — it is a database with two web pages attached.

This ticket closes the loop with one read: *the open jobs I could plausibly do, nearest first in the
sense that they are all within a distance I said I would travel.*

### 1.1 What the feed is, and what it is not

It **is** a list of `OPEN` jobs matched on three predicates — the job is open, its address is inside
the provider's own service radius, and it names at least one trade the provider lists.

It is **not**:

- **a gate.** It does not decide who may quote. `W4-T03` settled that and the operator's words are
  the reason: *"It is up to the professional to decide to apply or not."* §2.2 carries what that
  costs and which charter line it amends.
- **a ranking.** There is no "best match" score, no boost, no paid placement. ADR-014 is explicit
  that the queue is never for sale, and inventing a relevance score here would be the first place
  it could be.
- **a notification.** Nothing is pushed. A provider reads the feed when they open it; `OPS-14`/`W11`
  own telling them something arrived.

---

## 2. Design

### 2.1 Three predicates, and only two of them are the provider's own

```
status = 'OPEN'                                   -- the job's state
AND ST_DWithin(job_address.location, my_base.location, my_service_radius_metres)
AND EXISTS (job_category ∩ my_provider_category)  -- at least one shared trade
```

The middle one is `W3-T05`'s rule with the operands swapped, and it keeps that rule's meaning
exactly: **the radius is the provider's own**, so the question is *"which jobs will I travel to"*,
never *"which jobs are near me"*. A provider who covers 50 km sees a job 30 km out; their neighbour
who covers 15 km does not see the same job. `providers.demo-world` already contains that contrast
(`Clima Costa`, 50 km, in Alcalá de Henares) and §3.4 makes it visible from this end too.

**The category test is an intersection, not containment.** A job asking for tiles, plumbing and
electricity reaches a provider who lists only plumbing, because `W4-T03` decided one quote covers
the whole job and subcontracting is normal and invisible. Requiring containment would hide exactly
the jobs the product wants a plumber to see — and §2.2 is what we do instead of hiding them.

**A job with no address is in nobody's feed.** That is not an omission: `W4-T01` §2.5 made the
address nullable on an `OPEN` job on purpose — *"a client with no saved address still gets to post"*
— and wrote down the consequence, *"the job just will not match a radius query until one exists,
which `W4-T07` surfaces"*. This is the ticket that surfaces it, and it surfaces it as data rather
than as a claim: `jobs.demo-feed` seeds such a job (§3.4) and AC7 asserts its absence. Giving it a
default centre would be worse than dropping it, because a job pinned to Puerta del Sol by the
software is a job somebody travels to for nothing.

`DRAFT` is invisible to everyone but its owner (`W4-T01` §3) and `CANCELLED` is over. Both are
excluded by the same `status = 'OPEN'` and neither needs its own rule.

### 2.2 Licence status is a label, not a gate — and the charter line this amends

`agents/roles/agent-jobs.md` says, under *slice-specific rules*:

> The job feed must respect licence gating and radius — a pro seeing jobs they cannot legally do is
> a trust failure.

**Half of that line is implemented here and half of it is amended, deliberately, on two grounds.**

The first is that **the data for a gate does not exist.** `requiresLicence` is a flag on a
*category* (`W3-T01`, `BD-07`). Nothing in this schema knows whether a *provider* holds a licence:
`Certification` is `W8-T01`/`W8-T02` and neither has been built. So the strongest true sentence
available today is *this job needs a regulated trade, and you do not list it* — and a gate built on
that sentence would be gating on profile completeness while calling it compliance. `W4-T03` refused
a nullable `verified` field for this exact reason, and a filter is a worse place to put the same
lie, because a lie in a `WHERE` clause is invisible.

The second is the operator's decision, **2026-09-26**: *"Agree with the labels proposal: in the view
will be the client to be able to filter."* Which is also `W4-T03`'s settled rule seen from the other
side — *"Nothing enforces, but stated clearly."*

So the feed carries `coverage`: every category the **job** asks for, each with `requiresLicence` from
the taxonomy and `listedByProvider` computed at read time. That is the same shape and the same fact
as `QuoteCoverageSchema`, read from the other end of the same two tables, so the contract **reuses
that schema** rather than declaring a parallel one (§3.1).

**What replaces the gate is a control the provider operates** (§3.3): *hide jobs needing a regulated
trade I do not list*. The provider decides, the platform states the fact, and when `W8` can prove a
licence the label becomes stronger without this shape changing — which is what `W4-T03` predicted
would happen.

**The cost, recorded honestly:** until `W8` lands, an unlicensed provider can quote a gated job and
nothing stops them. That was already true of `POST /api/jobs/:id/quotes` before this ticket existed;
the feed makes it easier to reach. `W8-T01` is the mechanism, and `W9`'s moderation is the backstop.

### 2.3 What the feed discloses, and what it must never

A feed row is read by **strangers**, and the row is about somebody's home. `W3-T05` §2.7 coarsens a
provider's published point because *"a provider's base is usually their home"*; a job's address is
the client's home with no "usually" about it.

| Disclosed | Why |
|---|---|
| `title`, `description` | What the client wrote to be read by providers |
| `categories`, `urgency`, `budget` | The basis for deciding whether to quote |
| `location.city`, `location.province`, `location.postalCode` | A provider has to know the zone; a Spanish postal code covers thousands of homes |
| `distanceMetres`, rounded | How far they would travel, which is the whole point of the radius |
| `publishedAt` | "New since I last looked" |

| Never disclosed | Why |
|---|---|
| `latitude` / `longitude`, coarsened or not | A point plus a postal code is a house. There is no map on this screen and no reason to ship coordinates for one |
| `line1`, `line2` | The address itself. It is not needed until there is a booking, and `W5` owns that moment |
| The client's name, id, or any contact detail | A feed is not an introduction (`W4-T08`), and nothing here needs it |
| Anything about the other quotes on the job | *"Can a provider see a competitor's price?"* is a permission question (`W4-T03`), and a count is the first inch of the same slope |

The projection is written out field by field in the repository, not spread — `W3-T05` §2.7's rule:
*the fields that are absent are the ones doing the work*, and a `row_to_json` would make "absent"
depend on what a `SELECT` happened to name.

### 2.4 The paging order is `publishedAt`, and the partial index is the same predicate that makes the key non-null

`W4-T04`'s first lesson to this ticket: *a list written by other people is the one that must be
bounded*. A job feed is that list more than the quote list was — the quotes on one job are a handful,
the open jobs in Madrid are not — so it is paged from the first commit: `{ items, page }`, 20 by
default, 100 at most, one real keyset cursor.

**The key is `publishedAt`, not `createdAt`, and the difference is not cosmetic.** A draft created in
June and published this morning is *new to a provider* and old to the table. Ordering a feed by
`createdAt` would bury today's job under six weeks of nothing, which is a wrong list rather than a
differently-sorted one. `job_status_created_idx` — `(status, created_at DESC, id DESC)` — therefore
does not serve this query, and `0015` adds one that does:

```sql
CREATE INDEX job_feed_open_published_idx ON job (published_at DESC, id DESC) WHERE status = 'OPEN';
```

**Partial, and the predicate is doing three jobs at once.** It is the feed's own filter, so the index
is exactly the rows the feed reads. It keeps the index off every `DRAFT` row, which is most of them
in a healthy product. And — the part worth writing down — **it is the same predicate that makes the
sort key non-null**: `published_at` is nullable on the model, `encodeCursor` throws on a null sort
value by design (`pagination.ts`), and `status = 'OPEN'` is precisely the condition under which
`published_at` is guaranteed set, because `publish()` writes both in one transaction. The index's
`WHERE` and the cursor's safety are one fact, stated once.

Prisma cannot express a partial index, so it is hand-written SQL like `0012`'s and `0014`'s, and —
for the same reason — invisible to `prisma migrate diff`, which is why the schema comment on `Job`
names it. `0015/down.sql` drops it; `db.test.ts` AC10's reverse-order run is what proves that.

### 2.5 Distance is a presentation order, not a second sort key

`W4-T04`'s second lesson was that *the ranking a screen wants is often not the order that can page*,
and it predicted "best match" would hit the wall `ratingAvg` hit.

It does not hit that wall — `distanceMetres` is a non-null integer computed in the statement, and
`search.ts` pages on exactly that, so a keyset over it would work. It is still **not** a sortable
field here, for a different and simpler reason: everything in the feed is already inside a distance
the provider chose to travel, so *nearest first* sorts a set whose members are all acceptable. What a
provider actually asks of a feed is *what is new*. One paging order means one index and one keyset,
and the screen re-sorts by distance over the set it has loaded (§3.3) — the same split `W4-T04` made
between `QUOTE_SORTABLE` and `rankQuotes`.

`JOB_FEED_SORTABLE` is therefore `['publishedAt']`, default `-publishedAt`. Adding `distanceMetres`
later is a query parameter and a second index, not a redesign.

### 2.6 Filtering happens in the view, and that costs something worth naming

Operator, 2026-09-26: *"in the view will be the client to be able to filter."* So the query schema
declares **no filters at all** and the screen filters what it has loaded (§3.3). One place filters
exist, and it is the place the person choosing is looking at.

**What it costs:** a filter over a loaded prefix is a filter over a prefix. The screen follows the
cursor to `MAX_FEED_JOBS = 100` and then stops, so a provider whose radius holds four hundred open
jobs is filtering the hundred most recent, not all four hundred. That is honest and it is rendered —
the screen says so when it truncates — and it is the same bound `W4-T04`'s job screen carries for the
same reason. The day a provider's feed genuinely overflows, the filters that matter become query
parameters (`categorySlug`, `hideLicensedGaps`), server-side, over the whole matched set. That is a
follow-up with a trigger, not a debt with no owner.

### 2.7 A profile that cannot be served is refused, not answered with an empty list

Two states produce an empty feed for reasons that are not *"there are no jobs"*:

1. **No `ProviderProfile`.** The role grant says `PROVIDER`; the profile is what `W3-T02` writes. A
   principal with the role and no profile is a signup half-finished — `409 CONFLICT`, *"create your
   provider profile before you can see jobs"*, which is the answer `quote:create` already gives in
   the same situation (`quotes/repository.ts`).
2. **No `service_radius_metres`.** `W3-T05` excludes such a provider from search and `W3-T02` calls
   the state *unserviceable rather than merely unset*. There is no distance at which they will work,
   so every job is out of range — `409 CONFLICT`, *"set how far you will travel before you can see
   jobs"*.

Both are `409` with a message naming the fix rather than `200 { items: [] }`, because an empty list
is a claim about the world and neither of these is. The alternative — answering empty — sends a
provider looking for jobs that are there.

### 2.8 The feed says what you have already answered

Every row carries `myQuote`: `{ id, status }` for the caller's own quote on that job, or `null`.

It is the provider's own data, so no disclosure question arises — and without it the feed is a list
where some rows' *Send a quote* button answers `409` from the partial unique index
(`quote_one_active_per_provider_idx`, `WHERE status IN ('PENDING','ACCEPTED')`). Labelling is the
same answer §2.2 gives: a job you have already quoted stays in the feed, marked, because that is how
a provider finds their way back to it. `status` runs through `quoteStatusOf`, so a lapsed offer reads
`EXPIRED` here exactly as it does on the client's screen, and a provider can see that re-quoting is
open to them again.

An accepted quote is not hidden either. It is the most interesting row in the feed to the person who
wrote it.

### 2.9 One permission, and the role that carries it

`job:read-feed`, `['PROVIDER']`.

Not `job:read-own` widened: that guards `GET /api/me/jobs`, where the principal *is* the scope and the
capacity is **client**. Reading the market and reading your own postings are different capabilities
held by different capacities of the same person, and a subscription tier that wanted to meter one of
them (`W13`) needs a name for it. `/me/job-feed` makes "own" structural in the same way `/me/jobs`
does — the feed is computed *from the principal's profile* and there is no id in the path to scope.

---

## 3. API surface and the screen

### 3.1 The contract and the route

`packages/contracts/src/job-feed.ts`, and one route:

```
GET /api/me/job-feed?limit=&cursor=&sort=      job:read-feed        → { items, page }
```

| Shape | Notes |
|---|---|
| `JobFeedItemSchema` | `id`, `title`, `description`, `categories`, `urgency`, `budget`, `location` (**non-null**), `distanceMetres`, `coverage`, `myQuote`, `publishedAt` (**non-null**), `createdAt` |
| `JobFeedCoverageSchema` | `= QuoteCoverageSchema`, re-exported under a name that says what it means here (§2.2) |
| `JobFeedMyQuoteSchema` | `{ id, status: QuoteStateSchema }`, nullable on the item |
| `JobFeedQuerySchema` | `listQuery({ sortable: ['publishedAt'], defaultSort: '-publishedAt' })` — no filters (§2.6) |
| `JobFeedPageSchema` | `pageEnvelope(JobFeedItemSchema)` |

**`location` and `publishedAt` are non-nullable on the feed item although both are nullable on
`JobSchema`.** Not a redefinition of a job — a statement of what this list contains: a row with no
address cannot have matched the radius (§2.1) and a row that is `OPEN` was published. The schema is
where that invariant is asserted rather than assumed, and `JobFeedPageSchema.parse` on the way out is
what makes it a gate.

`JobFeedCoverageSchema` being an alias rather than a copy is deliberate and is the one place this
contract leans on another slice file: coverage is a fact about *a job and a provider*, it is
identical in both directions, and moving it out of `quote.ts` would be a frozen-seam change needing
an ADR to buy nothing (`agents/policies/contract-change.md`).

**Errors** are the envelope's, unchanged: `401` with no session, `403` for a `CLIENT`-only principal,
`409 CONFLICT` for the two unserviceable states (§2.7), `400 VALIDATION_FAILED` with the offending
path for a bad `limit`, `cursor` or `sort`.

### 3.2 The screen — `/:lang/feed`

`apps/web/src/routes/feed.tsx`, behind the session guard `/account` established, owned by this slice
on `MEM-2026-09-20-31`'s rule: ADR-011 gives `agent-ui` the *storefront*, and a page behind a session
rendering one slice's own shapes is not that.

The pure filter-and-sort logic is `apps/web/src/features/jobs/feed.ts`, testable without a DOM, the
way `features/quotes/ranking.ts` is.

**There is no navigation to this page.** The shell's header is `W12`'s and this ticket does not edit
it, exactly as `W4-T04` did not for `/jobs`. A provider reaches `/es/feed` by URL until `agent-ui`
gives the signed-in header a place for slice entry points, which is named here as the follow-up it is.

### 3.3 What the screen does

- **Loads the whole bounded set, then filters and sorts it.** The loader follows the cursor to
  `MAX_FEED_JOBS = 100` — five pages of the contract's default — and stops, bounded by the page count
  as well as the row count so a cursor the API kept handing back unchanged ends the loop. Truncation
  is **rendered, never hidden** (§2.6). This is `job.tsx`'s pattern and the reasoning is the same:
  the API pages because strangers write the list, the screen assembles because it sorts.
- **Three controls, all of them the provider's:**
  - *sort*: newest (the API's own order) · nearest (over the loaded set, §2.5);
  - *trade*: one of the categories actually present in the loaded set, or all;
  - *hide jobs needing a regulated trade I do not list* — the charter's "licence gating" as a switch
    the professional flips (§2.2);
  - *hide jobs I have already quoted* — reading `myQuote` (§2.8).
- **Each row shows** the title, the trades with their coverage labels, the distance in km, the city,
  the urgency and the budget when the client gave one, and the age of the posting. The quote form is
  **not** here: `POST /api/jobs/:id/quotes` exists, a provider-side quote form does not, and this
  ticket does not take it (§6). A row links to nothing it cannot deliver.
- **Two empty states, because they are two different facts.** *No open jobs match your trades and
  radius* is the world; *no jobs match these filters* is the screen, and it keeps the control that
  caused it in view so it can be undone. Conflating them tells a provider the market is empty when
  their own checkbox emptied it.
- **`409` is rendered as what to do**, not as an error: the two conflict states from §2.7 become a
  sentence pointing at the profile, because a provider who lands here from a half-finished signup is
  the most likely first reader of this page.

### 3.4 Seed data, and the accounts a person can actually sign in as

DoD §5.3: *seed data exists for anything this feature adds to a funnel*. This feature adds the half
of the funnel nobody could reach, and as `main` stands **no account that can sign in can read a feed
at all**: `provider@marketplace.local` has no `ProviderProfile`, and `quotes.demo-comparison`'s job
has no address, so it could not appear in a feed even if one could be read.

`jobs.demo-feed` fixes both and is the one seeder in this repo whose **purpose** is that a human can
walk the funnel, which is why — unlike `providers.demo-world` and `quotes.demo-comparison` — it
depends on `auth.demo-users` and says so by throwing when those rows are absent:

1. **A profile for the sign-in-able provider.** `provider@marketplace.local` (*Paco Fontanero*) gets
   a `ProviderProfile` — Madrid centre, 15 km, `fontaneria` + `electricidad`, an hourly rate and no
   rating at all (the cold-start case, which is also the truthful one for an account nobody has
   hired).
2. **A default address for the sign-in-able client.** `client@marketplace.local` (*Ana Cliente*) gets
   one, so `W4-T01`'s publish-time inference has something to infer.
3. **Six jobs owned by Ana**, each a branch of the feed rather than decoration:

   | Job | Where | Trades | In Paco's feed? |
   |---|---|---|---|
   | Cambiar el termo eléctrico | Madrid centre | `fontaneria` | **yes** — the plain match |
   | Cuadro eléctrico y diferencial | Madrid centre | `electricidad` | **yes**, labelled *regulated trade* — and he lists it |
   | Radiadores y caldera | Madrid centre | `fontaneria`, `gas` | **yes**, and `gas` is a **regulated trade he does not list** — the label the *hide* switch acts on |
   | Aire acondicionado en el salón | Alcalá de Henares, ~30 km | `climatizacion` | **no** — outside his 15 km, inside `Clima Costa`'s 50 km (`W3-T05`'s rule from the other end) |
   | Cerradura forzada | Madrid centre | `cerrajeria` | **no** — a trade he does not list; it is `Manitas Rivas`' and `Cerrajería 24h`'s |
   | Pintar el pasillo | **no address** | `pintura` | **no** — in nobody's feed, ever (§2.1) |

   Plus **one already-quoted job**: Paco's own `PENDING` quote sits on *Cambiar el termo eléctrico*,
   so the `myQuote` label and the switch that hides it have something to act on, and the client
   screen has a quote to answer from the account that can answer it.

   And **one `CANCELLED` job** in range and in trade, which must never appear (AC8).

Registered in `registry.ts` after `demoQuotes`, and named in both deploy workflows' `--only` lists,
without which a preview exercises none of it (`W0-T30` §3.6).

**The credentials file is untracked, by the operator's instruction** (2026-09-26): `demo-accounts.local.txt`
at the repo root, with a `*.local.txt` entry in `.gitignore`. It is a convenience for manual testing,
it carries only the password that is already committed in `auth-demo-users.ts` for local use, and it
is regenerated by hand from these seeders — so it is written to say which file it came from, and the
gitignore entry is what stops the day somebody puts a real `SEED_DEMO_PASSWORD` in it.

---

## 4. What does not change

- **No new job state, and no change to `jobMachine`.** A feed reads; nothing here transitions
  anything. `AWARDED` is still `W4-T05`'s and still blocked on `W5-T02`.
- **`ACCEPTED` is still terminal**, and `W4-T05` still takes it out of `terminal` in the change that
  gives it an exit (`MEM-2026-09-20-11`'s rule, written into `quoteMachine`).
- **`canQuoteOn` is untouched.** The feed lists `OPEN` jobs and `canQuoteOn` allows `OPEN` jobs, and
  they agree today by construction rather than by one importing the other. They are two questions —
  *what do I show* and *what do I accept* — and `W4-T04` §2.9 already refused to collapse the pair of
  `Record<JobStatus, boolean>`s for the same reason.
- **No contact detail is exposed**, so `W4-T08` is not pre-empted in either of its two possible
  shapes (it is `[SUPERSEDED-PENDING]` until `W13`'s ADR lands).
- **`GET /api/jobs/:id`** stays the owner's route: a provider reading a feed row gets the row, and
  there is no provider-facing job detail endpoint in this ticket (§6).
- **The quote routes, the quote contract and `0012`–`0014`** are untouched. Nothing here widens a
  predicate or adds a state.

---

## 5. Acceptance criteria

**Given** a provider whose profile lists `fontaneria` with a 15 km radius from Madrid centre:

- **AC1** — **When** an `OPEN` job naming `fontaneria` exists 2 km away, **then** `GET /api/me/job-feed`
  returns it with a `distanceMetres` within ±50 m of the true distance, its `coverage` naming
  `fontaneria` with `listedByProvider: true`, and `myQuote: null`.
- **AC2** — **When** an `OPEN` job naming `fontaneria` exists 40 km away, **then** it is absent; **and
  when** the provider's radius is raised to 50 km, **then** the same job is present. One assertion,
  two runs, because the radius is the provider's and nothing else changed.
- **AC3** — **When** an `OPEN` job names only `cerrajeria`, **then** it is absent, however close it is.
- **AC4** — **When** an `OPEN` job names `fontaneria` **and** `gas`, **then** it is present and its
  `coverage` carries `gas` with `requiresLicence: true` and `listedByProvider: false` — the label
  §2.2 replaces the gate with.
- **AC5** — **When** the job has no `addressId`, **then** it is absent.
- **AC6** — **When** the job is `DRAFT`, **then** it is absent.
- **AC7** — **When** the job is `CANCELLED`, **then** it is absent, even in range and in trade.
- **AC8** — **When** the caller has already written a `PENDING` quote on a matching job, **then** the
  row carries `myQuote.status === 'PENDING'` and the job is **still in the feed**.
- **AC9** — **When** that quote's `validUntil` has passed, **then** `myQuote.status` reads `EXPIRED`
  (`quoteStatusOf`, not the stored column).
- **AC10** — **When** twenty-five matching jobs exist, **then** the first page holds 20 with
  `hasMore: true`, the cursor returns the remaining 5 with `hasMore: false`, and **no job appears on
  both pages and none is skipped** — asserted over the union, not over the counts.
- **AC11** — **When** two matching jobs share a `publishedAt` to the millisecond, **then** paging with
  `limit=1` still returns each exactly once (the `id` tiebreaker, Decision F).
- **AC12** — **When** `?sort=distanceMetres` is requested, **then** `400 VALIDATION_FAILED` naming
  `sort` — the field is real in the row and deliberately not sortable (§2.5).
- **AC13** — **When** `?limit=101`, **then** `400`, never a clamp (Decision G).
- **AC14** — **When** the feed is read by a principal with a `PROVIDER` role and **no**
  `ProviderProfile`, **then** `409 CONFLICT` naming the profile.
- **AC15** — **When** the profile exists with `service_radius_metres` null, **then** `409 CONFLICT`
  naming the radius — not an empty page.
- **AC16** — **When** the caller's roles are `['CLIENT']` only, **then** `403`; **when** there is no
  session, **then** `401`. `permissions.test.ts`'s matrix covers the pairing.
- **AC17** — **Then** no response body ever carries `latitude`, `longitude`, `line1`, `line2`, a
  client id or a client name — asserted over the serialised JSON, not over the type (§2.3).
- **AC18** — **Then** `job_feed_open_published_idx` exists after `0015` and is gone after its
  `down.sql`, and the migration set still leaves no drift (`db.test.ts` AC10/AC12).
- **AC19** — The screen at `/:lang/feed`: **when** signed out, **then** it redirects to the login
  form; **when** signed in as a provider with matches, **then** it lists them with distance in km and
  the coverage labels; **when** the *hide regulated trades I do not list* switch is on, **then** the
  `gas` row goes and the count says so; **when** a filter empties the list, **then** the empty state
  is the filter's, not the market's; **when** the API answers `409`, **then** the screen says what to
  fix.
- **AC20** — `feed.ts`'s sort and filter functions are asserted directly, without a DOM: nearest-first
  over a mixed set, the licence-gap predicate over a job with no gap, and the already-quoted
  predicate over `myQuote: null`.
- **AC21** — `jobs.demo-feed` seeds the six jobs, the quote and the two profile rows; reading the
  feed as `provider@marketplace.local` returns exactly the three jobs §3.4's table marks **yes**, in
  `publishedAt` order. Asserted against a real database, not against the seeder's own intent.
- **AC22** — ES and EN carry every key the screen uses, and `i18n.test.ts`'s parity check passes.

---

## 6. Out of scope

- **A provider-side quote form.** `POST /api/jobs/:id/quotes` is `W4-T03`'s and has no UI; this
  ticket lists jobs and does not take the form. Naming it here rather than shipping half of it is
  `W4-T01`'s rule about empty promises.
- **A provider-facing job detail page or endpoint.** The feed row carries what the decision needs.
- **Notifications.** `OPS-14`, `W11`.
- **Saved searches, alerts, "jobs like this".** Every one of them is a ranking, and ADR-014 says the
  queue is never for sale — a relevance score is where that starts.
- **Server-side filters.** §2.6 names the trigger.
- **`distanceMetres` as a sort key.** §2.5 names what it would cost.
- **Licence *verification*.** `W8-T01`/`W8-T02`. §2.2 is explicit that this ticket labels what the
  schema knows and no more.
- **An axe pass on `/feed`.** No harness in this repo reaches a page behind a session — `W12-T04`
  runs over Storybook stories and `W12-T16` over public routes — so this page is covered by neither,
  exactly as `W4-T04`'s two screens are not (`MEM-2026-09-20-31`). `agent-ui` owns closing that.
- **Navigation to the page.** §3.2.
