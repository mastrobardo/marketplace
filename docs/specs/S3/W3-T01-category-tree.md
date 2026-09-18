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
- **Operator decisions, 2026-09-18**: the wire contract **stays flat and unchanged** (§3.2); the
  `BD-07` licence column is answered from §10's table, not invented here (§3.5).
- **`[M]` `[B]`** — `BD-07` is the human half. §3.5 is the mechanism; §10.1 is the question.

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

`ORDER BY position, slug`. `position` is the curated order (the trades a marketplace wants first are
not alphabetical); `slug` breaks ties deterministically, so two rows sharing a position never swap
between requests and a paging-free list is still stable in a snapshot test.

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
    **then** the result is exactly the set §10.1 settles, and no row was defaulted into it.

**Storefront.**

21. **Given** `apps/web` with no MSW handlers, **when** `tests/mocks.test.ts` runs, **then** the
    suite reflects an empty handler list rather than asserting the deleted `GET /categories`.
22. **Given** the mock directory moved to `tests/fixtures/`, **when** `pnpm typecheck` runs, **then**
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

Two roots, twenty leaves. `position` is per sibling set. The `requiresLicence` column is **left
unresolved here on purpose** — it is filled from §10.1 and this table is what the operator is ruling
on.

**Root `reformas`** — *Reformas* / *Renovations* (§3.1)

| slug | nameEs | nameEn | pos | licence? |
|---|---|---|---|---|
| `reforma-integral` | Reforma integral | Full renovation | 1 | §10.1 |
| `albanileria` | Albañilería | Masonry | 2 | §10.1 |
| `alicatado-solados` | Alicatado y solados | Tiling & flooring | 3 | §10.1 |
| `pintura` | Pintura | Painting | 4 | §10.1 |
| `carpinteria` | Carpintería | Carpentry | 5 | §10.1 |
| `escayola-pladur` | Escayola y pladur | Plasterboard | 6 | §10.1 |
| `ventanas-cerramientos` | Ventanas y cerramientos | Windows & glazing | 7 | §10.1 |
| `aislamiento` | Aislamiento | Insulation | 8 | §10.1 |

**Root `mantenimiento`** — *Mantenimiento* / *Maintenance*

| slug | nameEs | nameEn | pos | licence? | note |
|---|---|---|---|---|---|
| `fontaneria` | Fontanería | Plumbing | 1 | §10.1 | **adopted** — uuid `aaaa…0001` |
| `electricidad` | Electricidad | Electrical | 2 | §10.1 | **adopted** — uuid `aaaa…0002` |
| `cerrajeria` | Cerrajería | Locksmith | 3 | §10.1 | **adopted** — uuid `aaaa…0003` |
| `climatizacion` | Climatización | Heating & cooling | 4 | §10.1 | **adopted** — uuid `aaaa…0004` |
| `gas` | Instalaciones de gas | Gas installations | 5 | §10.1 | |
| `electrodomesticos` | Electrodomésticos | Appliance repair | 6 | §10.1 | |
| `telecomunicaciones` | Telecomunicaciones y antenas | Telecoms & aerials | 7 | §10.1 | |
| `placas-solares` | Placas solares | Solar panels | 8 | §10.1 | |
| `desatascos` | Desatascos | Drain unblocking | 9 | §10.1 | |
| `limpieza` | Limpieza | Cleaning | 10 | §10.1 | |
| `jardineria` | Jardinería | Gardening | 11 | §10.1 | |
| `mudanzas` | Mudanzas y montaje | Removals & assembly | 12 | §10.1 | |

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

- **A licence gate.** `W3-T08` owns what `requiresLicence: true` *does* — surfacing only verified
  pros. This ticket fills the column it reads.
- **An admin CRUD for categories.** The taxonomy is curated seed data. An endpoint that lets a row
  be created at runtime makes `BD-07`'s answer editable by whoever holds an admin session, which is
  the opposite of a legal boundary. If it is ever wanted it is `agent-admin`'s, with an audit trail.
- **Grouped navigation.** §3.3 — `parentId` is populated and unrendered.
- **Category landing pages** — `W12-T13`, deferred by ADR-011 Amendment 1.
- **`Job.urgency`** — §3.1 leaves urgency where it is. `W4-T01` still owns reconciling
  `SearchUrgencySchema` with the Prisma enum it will add.
- **Facet counts.** `GET /api/search` already returns per-category counts; this endpoint is the
  vocabulary, not the statistics.
- **Provider migration.** No seeded provider changes categories. The five demo providers keep the
  four adopted slugs.

---

## 10. Open questions

### 10.1 `BD-07` — the licence column *(blocking §8.3, and the reason this ticket is `[B]`)*

```
ESCALATION
Task:      W3-T01
Question:  Which of the twenty leaf categories in §8.3 legally require a licence,
           registration or certification to perform for hire in Spain?
Options:   A) Rule on the table below, cell by cell.
           B) Ship the tree with the flag deferred the way W3-T10 deferred it —
              names and structure land now, the legal column later.
Recommend: A. The tree is most of this ticket's value either way, but B leaves
           W3-T08 with the same empty left-hand side it has today, and a second
           ticket has to revisit twenty rows.
Blocked:   §8.3's licence column; AC20.
Not blocked: everything else — the endpoint, the module, the seeder mechanism,
           the demo decoupling, the mocks move, and AC1–AC19, AC21, AC22.
```

**Candidates, with the reason to suspect regulation.** This is a prompt for your decision, not
legal research — an agent must not be the source of a legal boundary (charter; `policies/
human-boundaries.md`).

| slug | Why it might be gated | My read |
|---|---|---|
| `electricidad` | Instalador eléctrico autorizado under the REBT | likely **true** |
| `gas` | Instalador de gas, categories A/B/C | likely **true** |
| `climatizacion` | RITE, plus F-gas handling for refrigerants | likely **true** |
| `telecomunicaciones` | Registro de instaladores de telecomunicación | likely **true** |
| `placas-solares` | Usually performed under the electrical authorisation | likely **true** |
| `reforma-integral` | Project/visado obligations at some scopes; the *trade* may not be gated | **unsure — your call** |
| `desatascos` | Waste handling rules in some CCAA | **unsure — your call** |
| the remaining thirteen | No trade-level authorisation known | likely **false** |

Two things worth your attention while ruling: **whether the answer varies by comunidad autónoma**,
because the column is national and has no region dimension — if it varies, the honest column is the
strictest reading and §9 gains a note; and **whether "licence" here means the provider's
authorisation or the specific job's permit**, because `Certification` models the former and
`W3-T08` gates on it.

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

### 10.3 The single parent *(non-blocking — §3.4)*

Recorded, not asked. `fontaneria` under `mantenimiento` is an arbitrary assignment that no client
can observe (§3.2). If `W12-T13` ever renders the grouping, it is the ticket that discovers whether
one parent per trade survives contact with a real navigation design — and by then the change is a
seeder edit plus whatever contract change that page needs anyway.

### 10.4 Retired categories and existing providers *(recorded — §3.8)*

A provider sitting in a retired category keeps it until their next profile save, which will reject
it. Nothing cleans this up, and nothing should until someone retires a category in anger. If it
becomes real, it is a backfill and it belongs to whoever retires the row.
