# W4-T01 — Posting a job, and the smallest thing that can be published

- **Slice**: S4 Jobs & presupuestos (`agent-jobs`)
- **Decides**: what a `Job` is in this schema, how little a client has to type, and where the line
  between a draft and a published job falls.
- **Unblocks**: `W4-T02` (the rest of the machine), `W4-T03` (quotes), `W4-T07` (the provider feed).
  Everything in `W4` needs a row to point at.

---

## 1. Purpose

`W4` is the presupuestos funnel and nothing in it exists — **there is no `Job` model in
`schema.prisma` at all**. This ticket is the first half of the posting flow: the table, the
contract, and the two states a job can be in before anybody quotes on it.

It is first because the operator reset the ordering on 2026-09-20: *"Fully funtional: the feature of
the websites (presupuestos, auctions, search) should be fully developed […] before getting a designer
on board"*. Search shipped in `W3-T05`. This is the start of the other two.

### 1.1 The governing instruction

> *"The fields reqiured are minimal, as more info could be asked / posted later. A user should be
> able to complete a minimal flow even with missing parameters. I dont want to policy the users."*
> — operator, 2026-09-20

and, on where the floor is:

> *"no, at least category need to be there. and might be multiple category: a reformation of a
> bathroom, might need tiles, plumbing, and electricity"*

Those two sentences decide most of this spec. **One required field, and it is a set.**

## 2. Design

### 2.1 Two states, not six

`W4-T02` owns `DRAFT → OPEN → AWARDED → IN_PROGRESS → COMPLETED / CANCELLED`. This ticket declares
**`DRAFT` and `OPEN` only**, and the one transition between them.

Shipping four states nothing can reach would be the same empty promise this repository already
refuses elsewhere: `permissions.ts` will not hold a row for a route that does not exist, and
`W3-T01` declared every `requiresLicence` value rather than defaulting one. Adding enum values later
is `ALTER TYPE … ADD VALUE`, which is cheap; a state machine that lies about what it supports is not.

The mechanism is **not** built here. `packages/contracts/src/state-machine.ts` already exists and
says of itself: *"This module owns no states of its own."* `Job`'s states are declared through it,
so the transition is guarded and recorded the same way every other lifecycle in this product will be.

**`OPEN` is declared terminal, and that is a statement about this ticket rather than the product.**
`defineMachine` refuses a state with no outgoing transition that is not declared terminal — correctly,
because an undeclared dead end is usually a forgotten rule. Within `W4-T01` there is genuinely no way
out of `OPEN`; `W4-T02` removes it from that list in the same change that gives it an exit. This was
found by the machine rejecting the first draft of the declaration, which is the contract doing its job.

### 2.2 A draft asks for nothing

A `DRAFT` row requires **nothing but an owner**. Every other column is nullable, and `PUT` accepts a
partial document. Somebody who opens the form, types four words and closes the tab has a job they
can come back to.

This is the operator's instruction taken literally, and it costs nothing: a draft is visible to its
owner and to no one else, so an empty one harms nobody.

### 2.3 Publishing requires one thing: at least one category

`DRAFT → OPEN` is guarded by exactly one rule — **the job has at least one category**.

Not because a form should be complete, but because `OPEN` means *providers can find this*, and
matching is by category (`W4-T07`: *"matched by category + radius + licence status"*). A job with no
category reaches nobody. That is not a user being policed; that is the feature silently failing, and
the user discovering it as silence.

**Everything else is optional, including the description.** A job with no description is harder to
quote, and that is the client's problem to solve — *"more info could be asked / posted later"* is
the product answer, and `W4-T06`'s thread is where it gets asked.

### 2.4 Many categories, because a bathroom is not one trade

`Job` ↔ `Category` is **many-to-many**, through `JobCategory`. The operator's example is the whole
argument: *"a reformation of a bathroom, might need tiles, plumbing, and electricity"*.

The join table mirrors `ProviderCategory` exactly — composite primary key, `Cascade` from the owner,
`Restrict` to the category, an index on the category for the reverse lookup `W4-T07` will need. The
shape is already proven in this schema; copying it is cheaper than inventing a second convention.

Two consequences, both deliberately left to later tickets but recorded here so they are not
discovered as surprises:

- **Licence.** A job naming `electricidad` names a gated trade. `W3-T01` §3.5.2 is the governing
  rule — *the flag marks a verification, not an exclusion* — so this does **not** restrict who may
  see or quote the job. `W4-T07` decides what the feed surfaces.
- **Whose quote is it?** A three-trade job invites an obvious question: does one provider quote the
  whole thing, or three quote their parts? **`W4-T03` owns this and it is not decided here.** The
  data model does not prejudge it: nothing in `JobCategory` says a quote must cover every category.
  Flagged because choosing wrong in `W4-T03` is expensive and choosing now would be guessing.

### 2.5 Location is inferred, never demanded

`Job.addressId` is a nullable reference to `Address`, the same model `ProviderProfile.baseAddressId`
uses. A draft may have none.

**At publish, if the job has no address, it takes the client's `defaultAddressId`.** Asking for an
address the system already holds is exactly the kind of policing the operator ruled out. If the
client has no default either, the job publishes anyway **without a location** — it simply will not
match a radius query until one is added. `W4-T07` is where that becomes visible; refusing to publish
over it would be this ticket inventing a requirement §2.3 just decided against.

Referencing rather than copying is safe here because of `W3-T02`'s convention: a changed address is
a **new** `Address` row, never an `UPDATE`, so a job's location cannot drift under it.

`onDelete: SetNull` — deleting an address must not delete the job.

### 2.6 Budget is a range, and both ends are optional

`budgetMinCents` / `budgetMaxCents`, both nullable `Int`, with `currency` fixed to EUR by
`money.ts`'s existing rule. *"I don't know"* is the honest answer for most first-time clients and the
model should be able to hold it.

A range rather than a number because a client thinking *"somewhere between 2 and 4 thousand"* should
not have to pick one, and a provider reading a single figure treats it as a target.

### 2.7 Urgency reuses the vocabulary that exists

`SearchUrgencySchema` already defines `when` (`W3-T01` §3.1 is explicit that *urgencia* is
`EmergencyRequest` and that field, and **not** a category). `Job.urgency` takes the same values and
defaults, so a client's job and their search speak one language.

An urgent job is **not** an `EmergencyRequest`. That model is `W7`'s, has its own broadcast and
first-accept-wins flow, and a job marked urgent stays an ordinary job.

## 3. API surface

| Route | Permission | Does |
|---|---|---|
| `POST /api/jobs` | `job:create` | Creates a `DRAFT`. Body may be `{}` |
| `GET /api/jobs/me` | `job:read-own` | The caller's jobs, newest first, paginated |
| `GET /api/jobs/:id` | `job:read-own` | One job, owner only while `DRAFT` |
| `PUT /api/jobs/:id` | `job:update-own` | Partial update. Refused once not `DRAFT` |
| `POST /api/jobs/:id/publish` | `job:publish-own` | `DRAFT → OPEN` through `transition()` |

**Ownership is structural where it can be** — `/me` resolves from the principal, as `W3-T02`
established. `/:id` cannot, so it is an explicit owner check, and a job belonging to someone else is
**`404`, not `403`**: the existence of a stranger's draft is not information this API gives away.

Permissions enter `PERMISSIONS` **in this pull request**, with the routes that guard them — the rule
`permissions.ts` states about itself. All four are `['CLIENT']`; a provider posting a job is a
client doing it, and `roles` is a set, so that is not a restriction on people, only on capacity.

## 4. What does not change

- `AuditRecord` and `transition()`. This declares states through the existing seam and adds no
  mechanism.
- `Category`, `Address`, `ClientProfile`. Read, never modified.
- `EmergencyRequest`, which does not exist and is not this ticket's urgency.
- `W4-T02`'s states, `W4-T03`'s quote shape, `W4-T07`'s matching.
- Photos. Object storage is not built (MinIO is in the local stack, `W3-T03` never ran), and the
  operator deferred it explicitly: *"object storage will come later, fine to have a full reduced
  flow for now"*. No column, no relation — a nullable column nothing writes is the empty promise
  again. It returns as its own migration.

## 5. Acceptance criteria

- **AC1** — `POST /api/jobs` with an empty body creates a `DRAFT` owned by the caller and returns it.
- **AC2** — A `DRAFT` may be saved with any subset of fields; `PUT` merges and never requires one.
- **AC3** — `POST /api/jobs/:id/publish` on a job with **no** category is refused with `CONFLICT`,
  naming the reason, and the job stays `DRAFT`.
- **AC4** — With one or more categories it becomes `OPEN`, and the transition is recorded through
  `transition()` with `fromState: DRAFT`, `toState: OPEN`.
- **AC5** — Publishing succeeds with **no description, no budget and no title**. Only the category
  set is required.
- **AC6** — A job with no address takes the client's `defaultAddressId` at publish.
- **AC7** — A job with no address and a client with no default address still publishes, with a null
  address.
- **AC8** — A job may hold several categories, and they round-trip in a stable order.
- **AC9** — A category that is `isActive: false` cannot be added; an unknown slug is `VALIDATION_FAILED`.
- **AC10** — `PUT` on a job that is not `DRAFT` is refused with `CONFLICT`.
- **AC11** — Every route refuses an unauthenticated caller, and a job belonging to another user is
  `404` on `GET`, `PUT` and `publish`.
- **AC12** — Publishing an already-`OPEN` job is refused and does not write a second audit row.
- **AC13** — `GET /api/jobs/me` paginates per `pagination.ts` and is ordered newest first.
- **AC14** — The four permissions exist in `PERMISSIONS` and each is asserted denied for a role
  that should not have it.
- **AC15** — The migration is reversible, and `prisma migrate diff` reports no drift.

## 6. Out of scope

- **Photos and any object storage** — §4, deferred by the operator.
- **The rest of the state machine** — `W4-T02`.
- **Quotes, and whether one covers every category** — `W4-T03`, flagged in §2.4.
- **The provider feed and radius matching** — `W4-T07`.
- **Job messaging** — `W4-T06`, and note `W13` may reframe it.
- **Contact masking** — `W4-T08` is `[SUPERSEDED-PENDING]`; `W13` owns it.
- **Any storefront UI.** ADR-011 gives pages to `W12`; this is the API only.
