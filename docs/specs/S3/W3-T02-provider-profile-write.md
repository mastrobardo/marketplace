# W3-T02 — The provider profile write path

- **Slice**: S3 Providers (`agent-providers`), with one seam edit made as `agent-contracts` (§8.3)
- **Decides**: how a provider says who they are — and stops `base_address_id` nulls arriving, then
  forbids the ones that could have.
- **Depends on**: `W2-T03` (#263, merged) for the guard; `W3-T07` for the read projection this
  returns; `W3-T10` for the world it is developed against.
- **Operator decisions, 2026-09-18**: the first write **upserts**; the `NOT NULL` migration lands
  **in this PR**; **working hours stay with `W3-T09`**.

---

## 1. Purpose

Everything a provider is, some agent wrote. `W3-T10` seeded five of them because the endpoints were
unusable against an empty table; `W3-T07` serves a profile page; `W3-T05` searches across them. None
of it can be done *by a provider*, because the API has no write path — `apps/api` answers four `GET`s
and better-auth's own routes, and nothing else.

This is that path, and it is also the ticket that closes a hole the schema has carried since
`W1-T05`. `base_address_id` is nullable, and the operator's rule of 2026-09-17 is that a base
address is **required** and is *the centre of the operating radius, not where the provider lives*.
A row without one is not "not finished yet": it is excluded from search entirely (`W3-T05` AC6) and
answered `404` by `W3-T07` — a provider who exists, whose page is gone. `W3-T02` stops new ones
arriving; the migration in §8.1 forbids the old ones, and `W3-T07`'s `404` branch dies with them.

### 1.1 What this is and is not

**In**: `GET /api/providers/me` and `PUT /api/providers/me` — identity, bio, categories, service
radius, hourly rate, and the base address, written as one document; the `NOT NULL` migration; the
write half of the contract.

**Not in**:

- **Working hours** (operator, 2026-09-18). `W3-T09` owns the availability calendar, and no weekly
  hours or blocked-date column exists — `TODO.md`'s line for this ticket names them, and it predates
  the schema that shipped.
- **Portfolio, badges, certifications** — no models (`W12-T12` §1, `W3-T03`, `W3-T08`).
- **The editor UI.** ADR-011 put every storefront page in `W12`. This is the endpoint it will call.
- **Becoming a provider.** `W2-T05` owns the `MANITAS`/`PRO` signup fork and its extra fields. This
  endpoint creates the *profile* for somebody who already holds the `PROVIDER` role; it does not
  grant the role (`roles` is `input: false`, and nothing here changes that).
- **A second address book.** `W2-T04` owns client addresses and saved locations. The row this writes
  is the provider's operating centre, and §3.5 says why it is not shared with one.

## 2. User stories

- As a **manitas**, I want to say what I do, how far I travel and what I charge, so that the search
  that already exists can find me.
- As a **profesional**, I want the same, and to state my kind — knowing (§3.6) that the claim alone
  opens no licensed category.
- As a **provider who moved**, I want to change the centre of my radius without changing where I
  live, because those are two different facts (operator, 2026-09-17).
- As a **visitor**, I want the page never to show me a provider who cannot be served — which is what
  the `NOT NULL` migration buys, one layer below anything I can see.
- As the **next slice**, I want one guarded write to copy: `/me` addressing, one transaction, and the
  public projection as the answer.

## 3. Design

### 3.1 `/me`, not `/:id` — and the guard is `W2-T03`'s

```
GET /api/providers/me    requireSession
PUT /api/providers/me    requirePermission('provider-profile:update-own')
```

The row is resolved **from the principal**, so there is no id in the path to compare against and no
way to address somebody else's profile at all. `W2-T03` §3.6 states the rule and this is its first
consumer: ownership becomes structural rather than checked, and the `403`-vs-`404` question that a
`PUT /api/providers/:id` would force never arises.

**The matrix does not grow.** `provider-profile:update-own` is the one row `W2-T03` shipped, and it
shipped with no consumer precisely so that this ticket would be a `preHandler` and not a design.

`GET /me` is here rather than in `W12` because a `PUT` that replaces the document is unusable
without it: a client that cannot read the current values cannot send them back, and an editor built
on the *public* projection would blank the address lines it never received (§3.4).

### 3.2 The first write creates the row (operator, 2026-09-18)

`PUT` on a user with no `provider_profile` row **creates** it; a second `PUT` replaces it. The
alternative — `404` until `W2-T05` ships the signup fork — was rejected because the endpoint would
then be unreachable by anybody who can actually sign in: `auth-demo-users` seeds `2222…` with a
password, the `PROVIDER` role and **no profile**, while `demo-providers`' five profiles have **no
credentials**. An endpoint whose only users are rows nobody can authenticate as is an endpoint with
no test that resembles its use.

`W2-T05` is unharmed: it owns the *role* grant and the kind-specific required fields, and it will
call this same path or write beside it.

### 3.3 `PUT`, and therefore the whole document

The body is the profile as it should be afterwards — not a patch. Two reasons, and neither is
taste. A partial update of a *set* (categories) has no obvious meaning: `{"categories": ["gas"]}`
is either "add gas" or "only gas", and every client guesses differently. And a provider profile is
small, read in full by the editor that writes it, so the round trip costs nothing while removing a
class of merge bug.

`PATCH` can arrive later as an additive route when something needs it. Nothing does.

### 3.4 The base address is part of the profile, and the response is the public one

The address is a nested object in the body, written in the same transaction as the profile. It is
not a separate resource because a provider without one is a state this ticket exists to delete — two
endpoints would make "profile saved, address failed" reachable, which is precisely the half-built row
the migration forbids.

Two projections, deliberately, and the difference is one caller:

| | `GET /api/providers/me` | `GET /api/providers/:id` (`W3-T07`) |
|---|---|---|
| address | `line1`, `line2`, `postalCode`, precise `latitude`/`longitude` | city and province only, point coarsened to 3 decimals |
| audience | the owner, editing | anybody, including a scraper |

The owner sees their own lines because they typed them and must be able to correct them. Everything
else is unchanged: `ProviderProfileSchema` stays exactly as `W12-T12` froze it, the public endpoint
is untouched, and **`PUT` answers with the public projection** — what you saved is what a visitor
will see, which is the most useful thing a save can tell you.

### 3.5 An address row is replaced, not edited in place

`PUT` with a changed address **creates a new `address` row** and repoints `base_address_id`. It does
not `UPDATE` the row in place, because that row may be somebody's home: the same user can be a
client whose `client_profile.default_address_id` points at it (`W2-T04`), and a provider moving
their operating centre to a city square would silently rewrite where they live.

If the submitted address is **field-for-field identical** to the current base address, nothing is
written and the row is reused — otherwise every save of an unchanged form would leak a row.

Old rows are left where they are. They are referenced by nothing once `base_address_id` moves, and
deleting user data on an edit is `W2-T08`'s decision to make, not a side effect of a save.

### 3.6 `kind` is writable, and the claim buys nothing

`MANITAS` or `PRO` is self-declared here. It is **not** the licence boundary: a category with
`requiresLicence` surfaces only a provider with an approved `Certification` (`W3-T08`, `BD-07`,
`agent-trust`), and that check reads a verified document, not this column.

Stated because the opposite is the obvious mistake: gating the *claim* would look like enforcement,
put a legal decision in an unverified text field, and leave `W3-T08` with nothing to do. `W2-T03`
§3.5.2 already settled the neighbouring half — kind is not a role, and no permission keys on it.

### 3.7 Categories are slugs, and the set is replaced

The body carries category **slugs** (`['fontaneria','gas']`), the same identifiers `GET /api/search`
filters on and `W12-T11` puts in a URL. Ids are uuids nobody types and nobody can check by reading.

Each slug is resolved against `category` in the same transaction; an unknown or inactive slug is a
`400` naming the field and the offending slug, never a silently dropped category. The resulting set
**replaces** `provider_category` for that profile — the composite-keyed table `W3-T10` found the
hard way (`MEM-2026-09-18-1`), so the write is a delete-then-create inside the transaction.

At least one category is required: a provider with none is unsearchable, which is the same
unserviceable state as no base address, reached by a different route. The upper bound is **20** — a
bound on the join `W3-T05` runs, not a product decision about how many trades a person may have; if
it ever refuses somebody real, raise it.

### 3.8 One transaction, and the repository owns it

`routes.ts` parses and answers; `repository.ts` does profile + address + categories in a single
`prisma.$transaction`. The split is `W3-T05`'s and `W3-T07`'s, and the transaction is what makes
§3.4's "no half-built row" claim true rather than aspirational: a bad category slug on the fourth of
five leaves nothing behind.

## 4. API surface

### `GET /api/providers/me` → `200 ProviderProfileOwn` · `401` · `404`

`404` when the caller has no profile yet — a state `PUT` resolves, and the only honest answer for a
`GET`. Guarded by `requireSession`: any signed-in user may ask, and a client simply has no profile.

### `PUT /api/providers/me` → `200 ProviderProfile` · `400` · `401` · `403`

Body: `ProviderProfileWriteSchema` (§8.3). Answers the **public** projection (§3.4).

## 5. Permissions matrix

| Role | `GET /me` | `PUT /me` (`provider-profile:update-own`) |
|---|---|---|
| *no session* | `401` | `401` |
| `CLIENT` | allow — answers `404`, having no profile | **deny**, `403` |
| `PROVIDER` | allow | **allow**, own row only (§3.1) |
| `ADMIN` | allow — `404` | **deny**, `403` (`W2-T03` §3.5: no implicit superuser) |

No new cell: `provider-profile:update-own` already exists. `W2-T03`'s matrix-driven test already
asserts every deny in this column.

## 6. Error cases

| Code | HTTP | When | What the UI shows |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | no session, or a suspended/deleted user (`W2-T03` §3.3) | the sign-in door |
| `FORBIDDEN` | 403 | signed in without the `PROVIDER` role | "your account cannot do this" |
| `VALIDATION_FAILED` | 400 | any body failure: missing address, bad postal code, radius out of range, negative rate, unknown or inactive category slug, empty category list | the field, with `details.issues[].path` |
| `NOT_FOUND` | 404 | `GET /me` before the first `PUT` | the empty-profile state, not an error |

`details.issues` is the envelope's existing shape (`errors.ts`), so the storefront's form errors need
no new branch.

## 7. Acceptance criteria

**The guard**

0. **Given** a build with no `auth` (so no guard), **when** `/providers/me` is called, **then** the
   answer is **never `200`** and no data is served: the `PUT` is a `404` because no route accepts
   that method, and the `GET` is a `400` from the **public** by-id route, because `/me` and `/:id`
   share a path space and `me` is not a uuid. `W2-T03` §3.7 deferred this here; the status depends
   on which route is missing, the refusal does not.
1. **Given** no session, **when** either route is called, **then** `401 UNAUTHENTICATED`, and no
   query is issued.
2. **Given** a `CLIENT`-only session, **when** `PUT /me` is called, **then** `403 FORBIDDEN` and
   nothing is written.
3. **Given** a `PROVIDER` session, **when** `PUT /me` is called with a valid body, **then** `200`.

**Creating**

4. **Given** a `PROVIDER` with no profile, **when** `PUT /me` succeeds, **then** exactly one
   `provider_profile`, one `address` and one `provider_category` row per slug exist, all owned by
   that user. *(live)*
5. **Given** the same, **when** `GET /me` is called first, **then** `404 NOT_FOUND` — and after the
   `PUT`, `200` with what was written. *(live)*

**Replacing**

6. **Given** an existing profile, **when** `PUT /me` sends a different category set, **then** the
   set is replaced exactly — removed slugs are gone, added ones present, and the composite-keyed
   table carries no duplicates. *(live)*
7. **Given** an existing profile, **when** `PUT /me` sends an **identical** address, **then** no new
   `address` row is created and `base_address_id` is unchanged. *(live)*
8. **Given** an existing profile, **when** `PUT /me` sends a **changed** address, **then** a new
   `address` row is created, `base_address_id` points at it, and the previous row still exists and
   is untouched. *(live)*
9. **Given** the same body sent twice, **when** both succeed, **then** the database holds the same
   rows as after the first — idempotent by construction, not by chance. *(live)*

**Refusing**

10. **Given** a body whose `categories` contains an unknown slug, **when** `PUT /me` is called,
    **then** `400 VALIDATION_FAILED` naming `categories` and the slug, **and nothing at all is
    written** — asserted by counting rows before and after, which is what makes §3.8's transaction
    a claim rather than a comment. *(live)*
11. **Given** a slug for a category with `is_active = false`, **then** the same `400`. *(live)*
12. **Given** an empty `categories` array, a `serviceRadiusMetres` of `0` or above
    `SERVICE_RADIUS_MAX_METRES`, a negative `hourlyRateCents`, a postal code that is not five
    digits, or a missing address, **then** `400` with the offending path in `details.issues`.
13. **Given** `hourlyRateCents: null`, **then** `200` — quote-only is a rate, not a missing field
    (`W3-T05` `mode=booking` is what excludes it).

**Projections**

14. **Given** a saved profile, **when** `PUT` answers, **then** the body parses as
    `ProviderProfileSchema`: the point is coarsened to 3 decimals and no address line appears.
15. **Given** the same profile, **when** `GET /me` answers, **then** it carries `line1`,
    `postalCode` and the **precise** point — and `GET /api/providers/:id` for the same id still
    carries none of them.

**The migration**

16. **Given** the migration, **when** it runs against a database holding a profile with a null
    `base_address_id`, **then** it fails loudly rather than deleting or inventing anything.
17. **Given** `down.sql`, **when** the suite rolls every migration back in reverse order, **then**
    it succeeds — `core-schema.test.ts` AC-2, which this migration joins. *(live)*
18. **Given** the schema after the migration, **when** an address referenced as a base address is
    deleted, **then** the delete is **refused** (`ON DELETE RESTRICT`), because "unlist the provider"
    is not an acceptable outcome of deleting a row (§8.1).
19. **Given** `packages/testing`, **when** `createProviderProfile` is called with no overrides,
    **then** it composes an address the way `createProviderCategory` composes its parents, and the
    row inserts. *(live)*

## 8. Data

### 8.1 Migration `0009_provider_base_address_required`

```sql
ALTER TABLE "provider_profile" ALTER COLUMN "base_address_id" SET NOT NULL;

ALTER TABLE "provider_profile" DROP CONSTRAINT "provider_profile_base_address_id_fkey";
ALTER TABLE "provider_profile" ADD CONSTRAINT "provider_profile_base_address_id_fkey"
  FOREIGN KEY ("base_address_id") REFERENCES "address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

**The foreign key has to change with the column, and that is not obvious.** It is
`ON DELETE SET NULL` today, which is no longer a legal outcome: the database would be asked to write
a null into a `NOT NULL` column and the delete would fail with a constraint error naming the wrong
thing. `RESTRICT` says the same intent correctly — you cannot delete the address a provider works
from while they work from it — and it is the honest behaviour anyway, since the alternative was
silently unlisting them.

**No backfill.** `SET NOT NULL` fails if any row has a null, which is the `0008` precedent: *"fails
loudly if any row is mixed-case rather than silently normalising it"*. There are no such rows in any
environment today (every seeded provider has an address), and if one appears, a human should see it
rather than have an agent's `DELETE` decide.

`down.sql` restores the nullable column and the `SET NULL` foreign key, in that order.

### 8.2 `schema.prisma`

`baseAddressId String @map("base_address_id") @db.Uuid` (no `?`), the relation
`baseAddress Address @relation("ProviderBaseAddress", …, onDelete: Restrict)`, and the doc comment
rewritten: *"Where they work from — the centre of their service radius, not where they live"*
(`W3-T07` §5 Q2, the operator's rule). The matching *"usually a home address"* comment in
`packages/contracts/src/search.ts` goes with it: the coarse point and the `line1`/`line2` deny do
not change, but the reason stated for them was wrong.

### 8.3 The contract — `packages/contracts/src/provider.ts`

Additive. Nothing existing changes shape, so this is an amendment rather than a version
(`agents/policies/contract-change.md`): `ProviderProfileSchema` and `ProviderIdSchema` are untouched
and every current consumer keeps compiling.

```ts
export const ProviderAddressWriteSchema = z.strictObject({
  label: z.string().trim().min(1).max(60).nullable(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().min(1).max(200).nullable(),
  city: z.string().trim().min(1).max(100),
  province: z.string().trim().min(1).max(100),
  postalCode: z.string().regex(/^[0-9]{5}$/),      // the column's own CHECK, restated
  latitude: z.number().min(-90).max(90),           // precise: coarsening is an outbound rule
  longitude: z.number().min(-180).max(180),
});

export const ProviderProfileWriteSchema = z.strictObject({
  displayName: z.string().trim().min(2).max(120),
  kind: ProviderKindSchema,
  bio: z.string().trim().max(2_000).nullable(),
  categories: z.array(z.string().regex(CATEGORY_SLUG)).min(1).max(PROVIDER_CATEGORY_MAX),
  serviceRadiusMetres: z.number().int().positive().max(SERVICE_RADIUS_MAX_METRES),
  hourlyRateCents: z.number().int().min(0).nullable(),   // null = quote-only
  baseAddress: ProviderAddressWriteSchema,
});

export const ProviderProfileOwnSchema = ProviderProfileSchema.omit({ point: true }).extend({
  baseAddress: ProviderAddressWriteSchema,   // what the owner typed, back exactly
});
```

Three notes a reader will want. `countryCode` is **not** on the wire: the column defaults to `ES`,
the postal-code CHECK is ES-only, and the market decision is locked — a field whose only legal value
is a constant is a field that will eventually carry a lie. `serviceRadiusMetres` is **required** here
while the read schema makes it nullable, because null means "not set" and this is the act of setting
it; a provider who genuinely does not travel is a product question (`BD`) and not a null. And
`ProviderProfileOwnSchema` drops `point` rather than carrying both: one precise address and one
coarsened copy of it in the same document is two sources of truth for where somebody is.

`strictObject` throughout, so an unknown key is a `400` rather than a silently ignored field — the
failure mode where a client "saves" something the server never stored.

### 8.4 `packages/testing`

`createProviderProfile` composes an address when none is given (AC19), exactly as
`createProviderCategory` composes its profile and category today. Without it every live suite that
builds a provider breaks on the new constraint — `factories-live`, `provider-live`, `search-live` —
and the fix belongs in the factory rather than in three call sites.

### 8.5 Two assertions describe a state that stops existing

`W3-T10` re-homed the deleted handlers' criteria rather than dropping them; the same move here.

| Assertion | Today | After |
|---|---|---|
| `provider-live.test.ts:198` "has nothing to serve for a provider with no base address" (`W3-T07` §2.4) | inserts a null-address profile, expects `404` | the insert is impossible; becomes a schema assertion in `core-schema.test.ts` — the column is `NOT NULL` — and `W3-T07`'s `404` branch is deleted with its dead code |
| `W3-T05` AC6, the *address* half | a provider with no base address is unsearchable | same schema assertion; the **radius** half is unaffected and stays exactly as it is, because a null radius is still legal |

## 9. Out of scope

- Working hours and blocked dates (`W3-T09`), portfolio (`W3-T03`), certifications (`W3-T08`).
- The editor UI (`W12`), and any storefront role gating.
- `PATCH`, and any partial-update semantics (§3.3).
- Deleting a profile, or what happens to one when a user is deleted (`W2-T08`).
- Address autocomplete and geocoding: coordinates arrive from the client, as
  `schema.prisma` has always said. `W3-T06` and `OPS-12` own the lookup.

## 10. Open questions

**Q1 — `kind` is self-declared (§3.6).** Proposed rather than asked, because the enforcement it
looks like belongs to `W3-T08`: a `PRO` claim opens no licensed category on its own. Say so if you
want the field locked after the first write instead.

**Q2 — the 20-category bound (§3.7).** A mechanical bound on `W3-T05`'s join, not a product rule. If
trades turn out to nest more deeply than expected, this is the number to revisit.

**Q3 — orphaned address rows (§3.5).** Every base-address change leaves the previous row in place,
owned by the user and referenced by nothing. That is deliberate here; whether they are ever cleaned
up is `W2-T08`'s (GDPR erasure) and `W2-T04`'s (the address book) to decide together.
