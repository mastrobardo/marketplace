# W3-T01 — The category tree

- **Slice**: S3 Providers (`agent-providers`). **No seam edit**: the contract and the schema already
  hold everything this needs (§8.1, §8.2), which is why this ticket touches neither.
- **Decides**: what a provider can say they do, and which of those trades are a legal boundary
  rather than a label.
- **Depends on**: `W3-T02` (#264, merged) — the write path that validates submitted slugs against
  this table; `W3-T10` (#261) for the four demo rows this adopts; `W12-T09` for the frozen wire
  shape (`CategoryListSchema`).
- **Blocks**: `W3-T08` (licence gating reads `requiresLicence`), and a provider picking a real trade
  instead of one of four demo slugs.
- **Operator decisions, 2026-09-18**: the wire contract **stays flat and unchanged** (§3.2);
  **`BD-07` is answered** — five gated trades, the rule that a licence attaches to the trade
  performed rather than to the umbrella above it (§3.5.1), and the correction that the flag marks a
  **verification, not an exclusion** (§3.5.2).
- **`[M]` `[B]` — the human half has landed.** §8.3's column is filled and AC20 names the set.

---

## 1. Purpose

A provider can now describe themselves — `W3-T02` shipped `PUT /api/providers/me`, and it validates
every submitted category slug against the `category` table. That table holds **four rows**:
`fontaneria`, `electricidad`, `cerrajeria`, `climatizacion`, created by `demo-providers.ts` so the
storefront would have something to search. Every one of them says `requiresLicence: false`, with
`BD-07` named in the file beside it as a deferral rather than an answer.

So the write path works and there is nothing real to write. A plumber who does bathrooms, a painter,
a locksmith who also fits windows — none of them can say so, because the vocabulary does not exist.
And `W3-T08` cannot gate anything: the column it reads is uniformly `false` by admission, so
"licensed trades only surface verified pros" is a rule with an empty left-hand side.

This ticket is the vocabulary: a real two-level taxonomy, seeded by a seeder that owns it, served by
`GET /api/categories`, with `requiresLicence` carrying an answer instead of a deferral.

### 1.1 What this is and is not

**In**: the taxonomy seeder and its rows; `GET /api/categories`; the `modules/categories/` module;
`demo-providers.ts` decoupled from category creation; the retirement of the last MSW handler and the
move of `apps/web/mocks/` to `tests/fixtures/`.

**Not in**: any change to `packages/contracts` or `schema.prisma` — both are `forbidden:` for this
slice and, as §8.1 and §8.2 show, neither needs changing. Not the licence *gate* (`W3-T08` owns what
a `requiresLicence` category does to search results). Not an admin UI for editing the tree — the
taxonomy is curated and ships as seed data, and §9 says why. Not the grouped navigation UI that the
`parentId` column makes possible; nothing renders it yet (§3.3).

---

## 2. User stories

- As a **manitas**, I want to pick the trades I actually work in from a real list, so that the jobs
  I am matched to are ones I can do.
- As a **profesional**, I want the trades that require a licence to be marked as such, so that I
  know which of my categories will ask me to prove a certification.
- As a **client**, I want to search by a trade I recognise — *fontanería*, *pintura*, *cerrajería* —
  so that I do not have to describe my problem in someone else's vocabulary.
- As an **admin**, I want the answer to "which categories legally require a licence" to be one
  query, so that a compliance question does not depend on reading application code.
- As a **client**, I want a category that is retired to stop appearing in search, without the
  providers who were in it losing their history.

---

## 3. Design

**There is no state machine, and this is the one place to say so.** A `Category` has no lifecycle:
it is curated seed data with an `isActive` flag, and `true → false` is a single reversible edit with
no guard, no side effect and no terminal state. The prompt's §3 is spent on design instead, in the
house style `W3-T02` set.

### 3.1 `urgencias` is not a category, and seeding it would create a second definition

`TODO.md` §6 describes this ticket as *"Category tree + seed data for reformas/mantenimiento/
urgencias"*. **Two of those three are categories. The third is already something else, twice over.**

`memory/repo/glossary.md` is explicit, and it disagrees with the one-liner:

| Term | Glossary says |
|---|---|
| **reforma** | "Larger multi-day works. **A category**, not a separate flow." |
| **mantenimiento** | "Routine repairs. **A category**." |
| **urgencia** | "Immediate call-out. **Model: `EmergencyRequest`**." |

And the contract has already frozen urgency as a *search dimension*, not a taxonomy node:
`SearchUrgencySchema = ['urgente', 'hoy', 'semana', 'flexible']`
(`packages/contracts/src/search.ts:38`) is the `when` field of `SearchQuerySchema`, which the
storefront renders today. A visitor who needs a plumber tonight sets `when=urgente` on a
`what=fontaneria` search. They do not pick a different trade.

Seeding an `urgencias` category would therefore put a third definition of urgency into the product —
one in `SearchUrgencySchema`, one in the `W6` emergency slice's model, one in the `category` table —
and the third would be the only one a provider could accidentally *be in*. A provider whose
categories are `['fontaneria', 'urgencias']` is making a claim about availability inside a column
that means trade, and nothing in the schema would catch it.

**Recommendation: two roots, `reformas` and `mantenimiento`. Urgency stays the `when` filter.**
This is `ESCALATION` Q1 in §10.1 — it contradicts a `TODO.md` line, so it is the operator's to
reaffirm, and §10.1 states what changes if they do.

### 3.2 Flat on the wire, two levels in the table

`CategoryListSchema` is `{ items: CategorySummarySchema[] }`, and `CategorySummarySchema` is
`{ slug, name, requiresLicence }` — **no parent, no children, no nesting**
(`packages/contracts/src/catalogue.ts`). It is a frozen seam; nesting it costs an ADR and is
`agent-contracts`' edit. The operator settled this on 2026-09-18: **flat, unchanged**.

That is not a compromise, because it lets the endpoint state a rule worth having:

> **A category on the wire is a thing you can pick.**

`items` contains exactly the leaves — the trades a provider can select and a search can filter by.
The two family roots are real rows with real children, and they are **not served**. Nothing on the
client has to know which items are pickable, because they all are; the header search box and the
facet rail get a flat list of nouns, which is what both of them wanted.

The alternative — serving roots and leaves in one flat array — is the shape that actually breaks. It
would offer "Reformas" and "Fontanería" as if they were the same kind of thing, with no field
distinguishing them, and the first client to need the distinction would have to infer it from the
name.

### 3.3 The tree is storage, and it is not speculative

If the roots are never served, why have them? Because the column exists, the grouping is real, and
two named tickets need it:

- **`W3-T08`** gates by trade, and "which family" is how a licence rule generalises — every child of
  a gated parent, if `BD-07`'s answer ever comes back shaped that way.
- **`W12-T13`** (category landing pages, deferred) is grouped navigation by definition.

What this ticket does **not** do is build a UI for it. `parentId` is populated, indexed
(`category_parent_id_position_idx`, already in the schema) and unused on the wire. The day a page
renders the grouping, the contract change is an ADR with a consumer behind it, rather than a shape
invented here for nobody.

### 3.4 A trade has one parent, and the overlap is real

`fontaneria` belongs to *reformas* (a new bathroom) and to *mantenimiento* (a burst pipe).
`parentId` is a single column, so it gets one home.

This is a genuine modelling limit and the spec will not pretend otherwise. Three ways out were
considered:

| Option | Cost |
|---|---|
| Scoped slugs — `reformas-fontaneria`, `mantenimiento-fontaneria` | Doubles the pickable list, breaks the four existing slugs, and asks a plumber which kind of plumber they are |
| Many-to-many category parents | A join table, a recursive read, and an ADR — for a grouping nothing renders |
| **One parent, chosen by where the work usually is** | An arbitrary assignment, invisible on the wire, cheap to change |

**The third**, because §3.2 makes it invisible: no client can observe which family a trade sits in,
so a wrong guess costs a seeder edit and no migration. §8.3's table records the choice per row so it
is reviewable rather than implicit.

### 3.5 `requiresLicence` is per node, explicit, and the operator's to fill

The schema already states the rule, in a comment `W1-T05` wrote:

> The legal flag. NOT inherited from the parent — an explicit true on every node that needs one, so
> `SELECT slug FROM category WHERE requires_licence` answers the compliance question completely
> rather than depending on a recursive walk a query can get wrong.

This ticket honours that and adds the mechanism the `[B]` label requires: **every seeded row
declares the flag explicitly, and the value comes from §10.1's table, which the operator rules on.**
There is no default, no inheritance and no "probably false". A row whose answer has not arrived does
not ship with `false` — it ships with the deferral spelled out the way `W3-T10` spelled it, or it
does not ship.

The reason is `agent-providers`' own charter: *"`requiresLicence` on a category is a legal boundary,
not a UI hint."* `W3-T08` will read this column as fact. A guess here becomes a licensed
electrician's competitor being surfaced without a licence, and nothing downstream can tell it was a
guess.

#### 3.5.1 A licence attaches to the trade performed, not to the umbrella above it

**Operator, 2026-09-18**, ruling on `reforma-integral`:

> *"Reforma integral doesn't need it, depending on the reforma itself: just building stuff — tiles,
> changes in the walls, fixing things — doesn't need any licence. If a reforma integral touches
> anything like plumbing or electricity, yes. But reforma integral is a wide category, I would not
> put any hard blocker there."*

This is the rule, and it is why `reforma-integral` is `false` despite being the largest thing on the
list. **A wide category is gated through its parts.** A provider who rewires a flat during a
renovation needs the electrical authorisation because the *work* is `electricidad`, not because the
job was filed under `reforma-integral`. Marking the umbrella `true` would demand a licence from a
tiler and teach the column to mean "this job might involve something regulated" — which is not a
legal boundary, it is a guess about scope.

It also vindicates `W1-T05`'s no-inheritance comment from the other direction. The flag does not
propagate **down** (a gated parent must not gate its children), and §3.4's arbitrary parent
assignment is safe for the same reason — a trade's legal status is its own, never its family's.

See §3.5.2 for what "gated" actually costs a provider — which is less than this section's first
draft assumed, and changes how the umbrella reads.

#### 3.5.2 The flag marks a verification, not an exclusion

**Operator, 2026-09-18**, and it corrects a rule three other artefacts state:

> *"My idea was verification, not hard block. While you can be listed as a pro, you will get a
> 'verified' badge once documents are uploaded and verified by me."*

So `requiresLicence: true` means: **this trade's claim is checkable, and a provider who proves it
earns a badge.** It does not mean the trade is hidden from unverified providers. An electrician with
no uploaded documents is listed, searchable and bookable; what they do not have is the badge, and
the client sees its absence.

This is not the rule the repo has been carrying, and the disagreement is worth naming because it is
now settled:

| Artefact | Says | Status |
|---|---|---|
| `packages/contracts/src/catalogue.ts` | *"cannot render the **badge** that makes `requiresLicence` mean anything to a visitor"* | **agrees** — the frozen contract already modelled it this way |
| `memory/repo/glossary.md`, *manitas* | *"**Cannot be surfaced** for `requiresLicence` categories"* | **corrected in this PR** |
| `memory/repo/glossary.md`, *profesional* | *"Needs an approved `Certification` for **gated** categories"* | **corrected** — needed for the badge, not for being listed |
| `TODO.md` §6, `W3-T08` | *"`requiresLicence` categories **only surface verified pros**"* | **corrected in this PR** |

The contract getting there first is the useful part: `W12-T09` froze `requiresLicence` onto
`CategorySummarySchema` precisely so a storefront could render a badge, which means **§4's response
shape needs no change** and the storefront work this enables is already possible. `W8-T01`
(licence upload), `W8-T02` (verification queue and admin review — the operator is the reviewer) and
`W8-T04` (the `VERIFIED_LICENCE` badge) are the tickets that build it; this one supplies the five
rows that make any of them apply to something.

**What this ticket does with that**: nothing to the data. The column is filled identically either
way. What changes is the meaning handed downstream, and §10.3, which was written against the wrong
rule and is now a much smaller thing.

### 3.6 The four demo slugs are adopted, not replaced

`demo-providers.ts` creates its four categories with fixed uuids (`aaaa…0001`–`0004`) and five
providers whose `provider_category` rows point at them. `MEM-2026-09-18-1` records why the uuids are
fixed: *"a uuid in a screenshot still resolves"* after `db:reset && db:seed`.

So the taxonomy seeder **adopts** `fontaneria`, `electricidad`, `cerrajeria` and `climatizacion` —
same slugs, same four uuids — and `demo-providers.ts` stops creating them, resolving each slug
instead. Anything else either duplicates a unique slug (Postgres refuses) or orphans the demo
world's category links.

This makes the pipeline order load-bearing for the first time: `categories.taxonomy` must run
**before** `providers.demo-world`. §8.4 states how that is enforced rather than hoped for.

### 3.7 `GET /api/categories` — public, and a read of a curated list

Public, like `GET /api/search` and `GET /api/providers/:id`: the category list is what the header
renders before anyone signs in, and there is nothing private in a trade name. No guard, therefore no
row in `permissions.ts` — §5 is a table with one public row, and it says so.

`routes.ts` + `repository.ts`, the split this slice has used since `W3-T05`, so the HTTP boundary is
asserted without a database. The repository uses an explicit Prisma `select`, per `MEM-2026-09-17-13`
— not because a trade name is sensitive, but because the rule in this slice is that the columns
*not* named are the projection, and `include` is a review failure.

Locale resolution reuses `localeOf(request)` from `modules/providers/routes.ts:42` — `accept-language`
starting with `en` gives `en`, everything else gives `es`, because the market is Spain. The client
receives `name`, never the pair.

### 3.8 Ordering, and what "active" means

`ORDER BY parent.position, position, slug`. `position` is the curated order (the trades a
marketplace wants first are not alphabetical); `slug` breaks ties deterministically, so two rows
sharing a position never swap between requests and a paging-free list is still stable in a snapshot
test.

**The first key was added in review, and its absence was a real defect.** This section originally
read `ORDER BY position, slug`, which is incompatible with §8.3's *"`position` is per sibling set"*
once §3.2 flattens the tree to leaves: both families start at 1, so the served list interleaved them
— `fontaneria, reforma-integral, albanileria, electricidad, …` — and the "curated order" reached the
client as a shuffle whose only real signal was the tie-break. Neither AC9 nor AC10 could see it,
because both were written against a single family. A leaf's own position orders it *within* its
family; where the family sits is the parent's, which is the one thing a root contributes to the wire
despite never appearing on it.

`isActive: false` removes a category from the wire and from nothing else. Existing
`provider_category` rows survive — the `Category` foreign key is `onDelete: Restrict` precisely so a
retired trade cannot take a provider's history with it. A provider in a retired category keeps it
until they next save a profile, at which point `W3-T02`'s slug resolution will reject it. That is
correct and deliberate: retirement is a decision to stop offering the trade, not to rewrite who did
it. §7 AC12 pins it.

---

## 4. API surface

### `GET /api/categories` → `200 CategoryList` · `406` · `500`

| | |
|---|---|
| **Auth** | None. Public. |
| **Request** | No path or query parameters. `accept-language` optionally selects `en`; anything else is `es`. |
| **Response** | `CategoryListSchema` — `{ items: CategorySummary[] }`, every item a leaf, `isActive`, ordered by §3.8. |
| **`400`** | **Not reachable.** There is nothing to parse — no params, no query, no body. Stated so a reviewer does not look for the missing criterion. |
| **`404`** | **Not reachable.** An empty taxonomy answers `200 { items: [] }`; a collection that exists and is empty is not a missing resource. |
| **`406`/`500`** | From `app.ts`'s envelope, unchanged by this route. |

No paging, and `catalogue.ts`'s comment already argued it: the taxonomy is a closed curated list of
tens of rows, `W1-T02`'s cursors exist for lists that grow without bound, and a cursor over a
navigation menu is ceremony every caller unwraps. §7 AC13 pins the full list arriving in one
response.

---

## 5. Permissions matrix

Rows are roles; the column is the one operation this ticket adds.

| Role | `GET /api/categories` |
|---|---|
| Anonymous | **allow** — the header renders it before sign-in |
| `CLIENT` | allow |
| `PROVIDER` | allow |
| `ADMIN` | allow |

**No deny cell, and therefore no permission.** `W2-T03`'s growth rule is that a permission enters
`permissions.ts` in the same PR as the route that guards with it; this route guards nothing, so
adding a row would put an unused key in the matrix and imply a boundary that does not exist. AC14
asserts the route answers without a cookie — the criterion that would fail if a guard were ever
attached by accident.

Editing the taxonomy has no row here because it has no endpoint (§9).

---

## 6. Error cases

| Code | HTTP | Fires when | UI shows |
|---|---|---|---|
| `NOT_ACCEPTABLE` | 406 | Client demands a media type the app cannot serve | Generic failure; not category-specific |
| `INTERNAL_ERROR` | 500 | Database unreachable or the outbound parse throws | `errors.categoriesUnavailable` (ES: *No hemos podido cargar las categorías.* / EN: *We could not load the categories.*) |

**The outbound parse is the interesting one.** `CategoryListSchema.parse` runs on the way out, as
every route in this slice does it. A row whose `nameEs` is empty, or whose slug violates
`CATEGORY_SLUG`, fails the parse and the request becomes a `500` — loudly, rather than shipping a
malformed menu item. Seed data is the input here, so this is the assertion that a bad seeder edit
cannot reach a client. AC11 covers it.

No `VALIDATION_FAILED`: §4 states there is nothing to validate.

---

## 7. Acceptance criteria

Given/When/Then, each testable as written. The endpoint criteria (AC1–AC14) run against a stub
repository except where marked **live**.

1. **Given** a seeded taxonomy, **when** `GET /api/categories` is called with no headers, **then**
   the response is `200` and parses as `CategoryListSchema`.
2. **Given** the seeded taxonomy, **when** the list is fetched, **then** every item's `slug` matches
   `CATEGORY_SLUG` and no item's `name` is empty.
3. **Given** a taxonomy with two family roots, **when** the list is fetched, **then** neither root
   slug appears in `items` — **only leaves are served** (§3.2).
4. **Given** a root and its children, **when** the list is fetched, **then** every child appears.
5. **Given** `accept-language: en-GB`, **when** the list is fetched, **then** each `name` is the
   row's `nameEn`.
6. **Given** no `accept-language` header, **when** the list is fetched, **then** each `name` is the
   row's `nameEs`.
7. **Given** `accept-language: fr`, **when** the list is fetched, **then** each `name` is the row's
   `nameEs` — Spanish is the fallback, not an error.
8. **Given** a leaf with `isActive: false`, **when** the list is fetched, **then** it does not
   appear.
9. **Given** leaves with positions 2, 1, 3, **when** the list is fetched, **then** `items` is
   ordered 1, 2, 3.
10. **Given** two leaves sharing a position, **when** the list is fetched twice, **then** the two
    responses are byte-identical — the `slug` tie-break (§3.8).
11. **Given** a repository that returns a row with an empty `nameEs`, **when** the list is fetched,
    **then** the response is `500` in the error envelope and no malformed item reaches the client.
12. **Given** a provider whose `provider_category` references a leaf later set `isActive: false`,
    **when** that row is retired, **then** the `provider_category` row still exists — **live**
    (§3.8).
13. **Given** the full seeded taxonomy, **when** the list is fetched, **then** every active leaf
    arrives in one response, with no cursor and no `next` field (§4).
14. **Given** no session cookie, **when** the list is fetched, **then** the response is `200` — the
    route is public and no guard is attached (§5).

**Seed and integration — live.**

15. **Given** an empty database, **when** `pnpm db:seed` runs, **then** `categories.taxonomy` creates
    the tree and the four adopted slugs carry their original uuids (§3.6).
16. **Given** a database already seeded, **when** `pnpm db:seed` runs again, **then** it is
    idempotent — the same row count, and no unique-violation on `category_slug_key`.
17. **Given** the seeded taxonomy, **when** `providers.demo-world` runs, **then** it resolves the
    four slugs and creates **no** category rows (§3.6).
18. **Given** the seed pipeline, **when** the seeders are ordered, **then** `categories.taxonomy`
    runs before `providers.demo-world`, asserted rather than assumed (§8.4).
19. **Given** the seeded taxonomy, **when** every leaf slug is submitted to
    `PUT /api/providers/me`, **then** each is accepted — the write path's slug resolution and this
    table agree (§8.5).
20. **Given** the seeded taxonomy, **when** `SELECT slug FROM category WHERE requires_licence` runs,
    **then** the result is exactly `{electricidad, gas, climatizacion, telecomunicaciones,
    placas-solares}` — five rows, no more and no fewer (§8.3).
21. **Given** the seeded taxonomy, **when** `reforma-integral` is read, **then** `requiresLicence`
    is `false`, and **no** root or parent row carries `true` — the flag never gates an umbrella
    (§3.5.1).

**Storefront.**

22. **Given** `apps/web` with no MSW handlers, **when** `tests/mocks.test.ts` runs, **then** the
    suite reflects an empty handler list rather than asserting the deleted `GET /categories`.
23. **Given** the mock directory moved to `tests/fixtures/`, **when** `pnpm typecheck` runs, **then**
    every importer — `tests/app-harness.tsx` above all — resolves (§8.6).

---

## 8. Data

### 8.1 No migration

`Category` already carries every column this ticket needs — `slug` (unique), `nameEs`, `nameEn`,
`parentId` (self-relation, `onDelete: Restrict`), `requiresLicence` (default `false`), `position`,
`isActive`, and the `category_parent_id_position_idx` index. It shipped in `W1-T05` and has not been
touched since.

**So `schema.prisma` is not edited, which is what keeps this ticket inside its charter.**
`agent-providers` has `apps/api/prisma/schema.prisma` under `forbidden:`, and the fact that no edit
is needed is a design finding worth stating rather than a coincidence: `W1-T05` modelled the
taxonomy before anyone filled it.

### 8.2 No contract change

`CategorySummarySchema` and `CategoryListSchema` exist and are frozen (`W12-T09`). §3.2 is the
argument for serving them unchanged. `packages/contracts/**` is likewise `forbidden:` for this
slice, and likewise needs nothing.

### 8.3 The taxonomy

Two roots, twenty leaves. `position` is per sibling set. The `requiresLicence` column carries the
operator's ruling of 2026-09-18 (§10.1): **five `true`, fifteen `false`**, every one declared
explicitly on the row, none defaulted.

**Root `reformas`** — *Reformas* / *Renovations* (§3.1)

| slug | nameEs | nameEn | pos | `requiresLicence` |
|---|---|---|---|---|
| `reforma-integral` | Reforma integral | Full renovation | 1 | `false` — §3.5.1 |
| `albanileria` | Albañilería | Masonry | 2 | `false` |
| `alicatado-solados` | Alicatado y solados | Tiling & flooring | 3 | `false` |
| `pintura` | Pintura | Painting | 4 | `false` |
| `carpinteria` | Carpintería | Carpentry | 5 | `false` |
| `escayola-pladur` | Escayola y pladur | Plasterboard | 6 | `false` |
| `ventanas-cerramientos` | Ventanas y cerramientos | Windows & glazing | 7 | `false` |
| `aislamiento` | Aislamiento | Insulation | 8 | `false` |

Every row in this family is `false`, which is the shape §3.5.1 predicts: *reformas* is where the
wide, unregulated build work lives, and the regulated parts of a renovation are gated through
`mantenimiento`'s trades when the provider claims them.

**Root `mantenimiento`** — *Mantenimiento* / *Maintenance*

| slug | nameEs | nameEn | pos | `requiresLicence` | note |
|---|---|---|---|---|---|
| `fontaneria` | Fontanería | Plumbing | 1 | `false` | **adopted** — uuid `aaaa…0001` |
| `electricidad` | Electricidad | Electrical | 2 | **`true`** | **adopted** — uuid `aaaa…0002` |
| `cerrajeria` | Cerrajería | Locksmith | 3 | `false` | **adopted** — uuid `aaaa…0003` |
| `climatizacion` | Climatización | Heating & cooling | 4 | **`true`** | **adopted** — uuid `aaaa…0004` |
| `gas` | Instalaciones de gas | Gas installations | 5 | **`true`** | |
| `electrodomesticos` | Electrodomésticos | Appliance repair | 6 | `false` | |
| `telecomunicaciones` | Telecomunicaciones y antenas | Telecoms & aerials | 7 | **`true`** | |
| `placas-solares` | Placas solares | Solar panels | 8 | **`true`** | |
| `desatascos` | Desatascos | Drain unblocking | 9 | `false` | **provisional** — §10.1 |
| `limpieza` | Limpieza | Cleaning | 10 | `false` | |
| `jardineria` | Jardinería | Gardening | 11 | `false` | |
| `mudanzas` | Mudanzas y montaje | Removals & assembly | 12 | `false` | |

**`fontaneria` is `false` and sits beside three `true` rows, which is worth reading twice.** Plumbing
as a trade carries no national authorisation; the moment the work touches a gas appliance it is
`gas`, which does. The pair is the clearest instance of §3.5.1 in the taxonomy, and a reviewer who
expects plumbing to be regulated should find the reason here rather than filing a bug.

Every slug matches `CATEGORY_SLUG` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) — note `albanileria` and
`carpinteria` are unaccented in the slug and accented in `nameEs`, which is the split the column
pair exists for.

**Twenty leaves is also the bound `W3-T02` left open.** Its spec flagged "the 20-category bound is
mechanical" as a non-blocking question; with exactly twenty leaves a provider can now select the
entire taxonomy and still pass. Worth knowing, not worth changing — a provider who claims all twenty
is a trust problem (`agent-trust`), not a validation one.

### 8.4 The seed pipeline

A new seeder, `apps/api/prisma/seed/categories.ts`, registered as `categories.taxonomy`.

**Not `localOnly`**, by `W3-T10`'s test: no credential, no personal data, nothing about a real
person. A preview database should hold the real taxonomy — it is the vocabulary the product is
written in, not demo content.

**Idempotent by `upsert` on `slug`**, not `create`. `run.ts` runs each seeder once per database via
its ledger row, but `db:seed` after a partial failure must not collide with
`category_slug_key`; AC16 pins it.

**Order is asserted, not assumed.** `providers.demo-world` now depends on rows another seeder
creates (§3.6), which is a first for this pipeline. The seeder list in `run.ts` is ordered, and AC18
asserts the index of `categories.taxonomy` is lower than that of `providers.demo-world` — a test
that fails on reorder, rather than a comment asking future editors to be careful.

### 8.5 `demo-providers.ts` loses its categories

The `CATEGORIES` constant and the `db.category.create` loop are deleted. The `categoryIds` map is
built by **reading** the four slugs; a missing slug throws with the slug named, which is the same
failure mode the existing `No seeded category "…"` guard has for providers.

The file's long comment explaining `requiresLicence: false` as a `BD-07` deferral goes with the
rows. Its replacement points here: the flag is the taxonomy's, and this file no longer has an
opinion.

### 8.6 The last MSW handler, and the directory move

`apps/web/mocks/handlers.ts` states the plan itself: *"`GET /categories` goes with `W3-T01` … When
it does, this directory has no handlers left and should move to `tests/fixtures/` in one step."*

So: the handler is deleted, `handlers.ts` and `browser.ts` go with it, and `catalogue.ts`,
`search.ts` and `provider.ts` move to `apps/web/tests/fixtures/`. Those three survive because
`tests/app-harness.tsx` stubs `ApiClient` from them for component tests, and `W12-T11` split them out
precisely so the stub and the handler could not disagree — the operator reaffirmed this on
2026-09-18 when `W3-T10` proposed deleting them.

`catalogue.ts` keeps `electricidad`'s deliberate `requiresLicence: true`, which is what keeps the
storefront's licence badge exercised in component tests regardless of what §10.1 decides.

---

## 9. Out of scope

- **The verification itself, and the badge.** `W3-T08` owns what `requiresLicence: true` *does*;
  after §3.5.2 that is *"offer to verify, and badge the proof"*, not *"hide the unverified"*. The
  machinery is `W8-T01` (upload), `W8-T02` (review queue) and `W8-T04` (the `VERIFIED_LICENCE`
  badge). This ticket fills the column all of them read. Note `Certification` **does not exist yet**
  — `schema.prisma` holds eleven models and it is not among them.
- **An admin CRUD for categories.** The taxonomy is curated seed data. An endpoint that lets a row
  be created at runtime makes `BD-07`'s answer editable by whoever holds an admin session, which is
  the opposite of a legal boundary. If it is ever wanted it is `agent-admin`'s, with an audit trail.
- **Grouped navigation.** §3.3 — `parentId` is populated and unrendered.
- **Category landing pages** — `W12-T13`, deferred by ADR-011 Amendment 1.
- **`Job.urgency`** — §3.1 leaves urgency where it is. `W4-T01` still owns reconciling
  `SearchUrgencySchema` with the Prisma enum it will add.
- **Facet counts.** `GET /api/search` already returns per-category counts; this endpoint is the
  vocabulary, not the statistics.
- **Moving the names into i18n.** `nameEs`/`nameEn` are columns, and the operator noted on
  2026-09-18 that they should eventually be **keys** resolved by the i18n layer — with the English
  key being the short noun (`drain`), not the current label (`Drain unblocking`). Deliberately not
  done here, and cheap to defer: §3.7 resolves the locale server-side and the contract carries one
  `name`, so this is a storage-and-seeder change with **no contract change and no consumer change**.
  Two things to settle before it is attempted, recorded in `MEM-2026-09-18-13`: the **slug is an
  identifier and the names are labels** — slugs are Spanish, appear in URLs and in `W3-T02`'s write
  path, and an English key namespace does not imply renaming them; and it is **mutually exclusive
  with an admin-authored taxonomy**, because a category created at runtime cannot have a
  compile-checked catalogue key, which is the only thing the move would buy over the outbound parse
  in §6.
- **Provider migration.** No seeded provider changes categories. The five demo providers keep the
  four adopted slugs.

---

## 10. Open questions

### 10.1 `BD-07` — the licence column ✅ *resolved by the operator, 2026-09-18*

**Answer: five gated trades** — `electricidad`, `gas`, `climatizacion`, `telecomunicaciones`,
`placas-solares`. The candidate list's "likely true" set was confirmed whole; both "unsure" rows came
back `false`; the remaining thirteen stay `false`. §8.3 carries the column and AC20 pins the set.

**`reforma-integral` is `false`, with a rule attached.** The operator's reasoning became §3.5.1 —
a licence attaches to the trade actually performed, not to the umbrella above it — and is the more
valuable half of this answer, because it tells `W3-T08` how to read every future wide category
rather than just this one. *"I would not put any hard blocker there"* is the instruction, and the
spec follows it; the evasion it permits is named in §3.5.1 and carried to §10.3 rather than
quietly closed here.

**`desatascos` is `false` and provisional.** The operator's words: *"no they don't need it, but I
still need to check with the gremio — although some friends working in the field told me not."*
Recorded as provisional rather than settled because the direction of the risk is asymmetric: `false`
is the permissive answer, so being wrong here surfaces an unlicensed provider, while being wrong the
other way only asks for a certificate nobody needed. It is one seeder edit and one AC20 line if the
gremio says otherwise — **and it is the operator's to chase, not an agent's.**

**The gremio may yet make this authoritative.** The operator is seeking a meeting with the
professional body and asking whether it exposes an API or equivalent for checking a registration.
That would change `W8-T02` from a human document review into a lookup, and would settle `desatascos`
as a side effect. It is `[H]` and nobody's to chase but the operator's; noted here because it is the
only path by which this column stops being a judgement call.

**The two sub-questions were not answered, and neither blocks.** Whether the flag varies by comunidad
autónoma, and whether "licence" means the provider's authorisation or the job's permit. All five
`true` rows are national installer authorisations held by the *provider*, which is what
`Certification` models and what `W3-T08` gates on, so the column is coherent under either reading.
If a regional divergence turns up, §9 gains a note and the column stays the strictest reading —
there is no region dimension on `Category` and this ticket does not add one.

### 10.2 `urgencias` *(non-blocking — §3.1)*

```
ESCALATION
Task:      W3-T01
Question:  TODO.md §6 lists `urgencias` as a seeded branch; the glossary calls it
           EmergencyRequest and SearchUrgencySchema already owns it as `when`.
           Seed it as a category anyway?
Options:   A) No — two roots, urgency stays the `when` filter and the W6 model.
           B) Yes — three roots, and `urgencias` becomes a third definition of
              urgency that a provider can be *in*.
Recommend: A, and correct TODO.md §6's line in this PR.
Blocked:   Nothing. A is built; B is an additive seeder edit if reaffirmed.
```

### 10.3 The umbrella, after §3.5.2 *(recorded — much smaller than it first looked)*

This section was written against the assumption that `requiresLicence` **excludes** unverified
providers. Under that rule, `reforma-integral` being ungated was a hole: list only the umbrella,
never claim `electricidad`, and dodge a gate. §3.5.2 removes the gate, so most of the hole goes with
it — there was never an exclusion to evade, and an unverified electrician is listed whether they
claim `electricidad` or not.

**What remains is an information asymmetry, not an evasion.** A provider in `electricidad` with no
documents shows a *missing* badge against a trade the client can see is checkable. A provider in
`reforma-integral` alone shows nothing at all, because the category carries no expectation — so the
client has no signal that the renovation they are buying includes regulated work. The difference is
what the client can tell, not what the provider is allowed to do.

That is a storefront and job-flow concern, and every place it could be addressed is downstream of
this table: the job's category at posting (`W4-T01`), the quote (`W4-T03`), or a prompt when a
provider adds `reforma-integral` with no gated trade beside it. **Nothing here needs to change** —
recorded so `W3-T08` and `W4-T01` inherit the observation rather than re-deriving it.

### 10.4 The single parent *(non-blocking — §3.4)*

Recorded, not asked. `fontaneria` under `mantenimiento` is an arbitrary assignment that no client
can observe (§3.2). §3.5.1 makes it safer than it looked when §3.4 was written: since the legal flag
is never inherited in either direction, a trade in the "wrong" family carries no legal consequence
at all. If `W12-T13` ever renders the grouping, that is the ticket that discovers whether one parent
per trade survives a real navigation design.

### 10.5 Retired categories and existing providers *(recorded — §3.8)*

A provider sitting in a retired category keeps it until their next profile save, which will reject
it. Nothing cleans this up, and nothing should until someone retires a category in anger. If it
becomes real, it is a backfill and it belongs to whoever retires the row.
