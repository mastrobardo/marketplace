# W4-T02 — The exit from `OPEN`, and an edit rule that stops being an accident

- **Slice**: S4 Jobs & presupuestos (`agent-jobs`)
- **Decides**: how a job ends when nobody is going to do it, where the "only a draft may be edited"
  rule lives, and which of the six lifecycle states this ticket can honestly produce.
- **Unblocks**: `W4-T03` (quotes) — which needs a job that can be closed without being awarded.
- **Pays**: `MEM-2026-09-20-11`, both debts, in the change that makes them wrong.

---

## 1. Purpose

`W4-T01` shipped two states and said so in three places: the enum has two values, `OPEN` is declared
terminal, and the migration comment names this ticket as the owner of the other four.

It also left two things that are **correct today and become wrong the moment the lifecycle grows**,
and named them itself in its run record's self-assessment:

> The `DRAFT`-only edit rule lives in the repository as an `if`, not in the machine. […] When
> `W4-T02` adds four more states, that `if` will be wrong in a way no test currently notices —
> `AWARDED` and `CANCELLED` are not `DRAFT` either, so it will keep refusing correctly *by accident*
> rather than by design.

Correct-by-accident is the failure mode with nothing red to notice. This ticket's real subject is
not cancellation; it is making both rules fail loudly the next time somebody adds a state.

### 1.1 The governing decision

The board line reads `DRAFT → OPEN → AWARDED → IN_PROGRESS → COMPLETED / CANCELLED`, and this
ticket ships **`CANCELLED` only**. Operator, 2026-09-20, choosing between the whole lifecycle and
the reachable part of it:

> *cancel now, award with quotes*

and on whether a published job can still be edited:

> *no — drafts only, expressed in the machine*

§2.1 is why the first is not a shortcut, and §6.1 is where the other three states went.

## 2. Design

### 2.1 `CANCELLED` is the only state this ticket can produce

`W4-T01` §2.1 set the rule and this ticket is its first test: *"a state machine that lies about what
it supports"* is worse than a cheap `ALTER TYPE`. Applied honestly, the remaining four states are
not one ticket's work and not even one slice's:

- **`AWARDED`** needs somebody to award *to*. That is an accepted quote (`W4-T03`) reaching an award
  (`W4-T05`). A `POST /award` taking a bare `providerId` would produce the state today, at the cost
  of inventing award semantics that `W4-T05` then has to rewrite — and of an `awarded_provider_id`
  column chosen by the ticket least qualified to choose it.
- **`IN_PROGRESS`** and **`COMPLETED`** are facts about an *engagement*, not a posting, and the
  engagement is a `Booking`. Completion is what triggers capture and payout (`W5-T04`).
- **`CANCELLED` after an award** is a refund decision (`W5-T05`), not a status change.

`CANCELLED` from `DRAFT` or `OPEN` needs none of that. A client who changes their mind — or fixed
the tap themselves — is the whole feature, and it is reachable with what exists today.

**This is what gives `OPEN` its exit**, which is the point: the `terminal: ['OPEN']` declaration and
its removal happen in the same change, exactly as `W4-T01` promised, rather than `OPEN` sitting
declared-terminal for another three tickets while everyone reads it as product truth.

### 2.2 A cancelled draft is still cancelled, not deleted

`CANCEL` is one rule from two states (`from: ['DRAFT', 'OPEN']`), not two rules.

The alternative was `DELETE` for a draft nobody ever saw, and it was rejected: a draft that
disappears leaves no `audit_record` row, and *"why is there no job here?"* then has the same answer
as *"there never was one"*. A cancelled draft costs a row and keeps the question answerable. It also
keeps one refusal message instead of two — a client cancelling an already-cancelled job is told the
same thing whatever it was before.

`CANCELLED` is **terminal, and this time permanently**: reopening a cancelled job is a new job. That
is not a limitation to work around later — a job whose history restarts is a job whose audit trail
has to be read backwards to be understood.

### 2.3 The edit rule moves where a new state cannot miss it

The debt is not that the `if` is in the wrong file. It is that **nothing connects it to the set of
states**, so adding one does not make it wrong in any way a compiler or a test can see.

What replaces it is an exhaustive map in the contract, beside the states themselves:

```ts
const EDITABLE_IN: Record<JobStatus, boolean> = { DRAFT: true, OPEN: false, CANCELLED: false };
```

`Record<JobStatus, …>` is the whole mechanism: **adding `AWARDED` to `JobStatus` stops the package
compiling until somebody says whether an awarded job can be edited.** The decision cannot be
deferred by silence, which is precisely how the `if` would have handled it — by continuing to
refuse, correctly, for the wrong reason.

Two alternatives were considered and rejected:

- **An `EDIT` self-transition** (`DRAFT --EDIT--> DRAFT`) guarded by the machine. Rejected because
  `transition()` cannot be called for it: every call writes an `audit_record` row, and an audit row
  per keystroke-save is not history, it is noise. An event in the table that nothing ever transitions
  with is the same lie this ticket is trying to remove.
- **`editableStates` as a new field on `MachineDefinition`.** Rejected because it puts a
  job-shaped concept into the shared seam (`agents/policies/contract-change.md`), and "which states
  allow an edit" is not a question every machine has. `Booking` would want a different one.

The repository keeps the refusal — it is still the thing that talks to rows — but it now *asks*
rather than *decides*, and the answer arrives in the machine's own `GuardResult` shape, so the
message and the `409` come from one place.

### 2.4 `GET /api/jobs/me` becomes `GET /api/me/jobs`

`W2-T03` §3.6 settled `/me` addressing as the rule for own-scoped routes, and §3.7 wrote **both**
spellings into one code block without naming the difference between them:

```ts
app.put('/providers/me', …)   // a singleton — the profile IS the resource, `me` says which one
app.get('/me/addresses',  …)  // a collection owned by the principal
```

The difference is singular versus plural, and `W4-T01` picked the wrong half: `jobs` is a
collection, so `me` was reading as an id in a path space it had to be defended from. That defence is
real code — a comment about registration order, and a test asserting `/jobs/me` is not swallowed by
`/jobs/:id`. **`/me/jobs` shares no path space with `/jobs/:id`, so the hazard stops existing**
rather than being documented.

Done now because it is free now: `grep` finds no caller in `apps/web`, the route is one day old, and
`W4-T03`, `W4-T06` and `W6` all have own-scoped collections that will copy whichever spelling is
here when they arrive. `PUT /api/providers/me` does **not** move — it is the singleton half of the
same rule, and it is right.

The rule itself is written into `W2-T03` §3.6 as an amendment, because that section says it is
*"enforced by whichever ticket writes such a route"* and a convention that lives only in this spec
is not a convention.

### 2.5 The reason is audit metadata, not a column

`POST /me/jobs/:id/cancel` accepts an optional `reason`, and it is written to
`audit_record.metadata` — the column whose own schema comment says it holds *"whatever makes the row
legible for its machine"*.

No `cancellation_reason` column, because the audit row already holds who cancelled it, when, and
from which state; a column would be a second home for one fact, and the two would drift the moment
anything edited one of them. Optional, because *"I don't want to policy the users"* applies to the
way out as much as to the way in.

`cancelled_at` **is** a column, mirroring `published_at`, and for the same reason `W4-T01` gave it:
it is the one timestamp a list screen needs without joining the audit table.

## 3. API surface

| Route | Permission | Does |
|---|---|---|
| `POST /api/jobs` | `job:create` | unchanged |
| `GET /api/me/jobs` | `job:read-own` | **moved** from `GET /api/jobs/me` (§2.4) |
| `GET /api/jobs/:id` | `job:read-own` | unchanged |
| `PUT /api/jobs/:id` | `job:update-own` | unchanged behaviour, rule relocated (§2.3) |
| `POST /api/jobs/:id/publish` | `job:publish-own` | unchanged |
| `POST /api/jobs/:id/cancel` | `job:cancel-own` | `DRAFT`/`OPEN` → `CANCELLED` through `transition()` |

`job:cancel-own` enters `PERMISSIONS` in this pull request, with the route that guards it —
`permissions.ts`'s rule about itself. `['CLIENT']`, like the other four.

A stranger's job stays `404` on every route including `cancel`: `W4-T01` §3's refusal shape is not
revisited here.

## 4. What does not change

- `transition()`, `AuditRecord`, `defineMachine`. This declares states through the existing seam.
- The publish floor. One category, and `hasAnyCategory` is untouched (`MEM-2026-09-20-4`).
- `PUT /api/providers/me` — the singleton half of §2.4's rule.
- `GET /api/me/jobs` pagination. Still capped at 50 and uncursored; `W4-T01`'s run record asks for a
  cursor *with the screen that needs one*, and there is still no screen.
- Photos, quotes, the provider feed, any storefront UI.

## 5. Acceptance criteria

- **AC1** — `jobMachine.terminal` is `['CANCELLED']`. `OPEN` is not terminal and has an exit.
- **AC2** — `POST /api/jobs/:id/cancel` moves a `DRAFT` to `CANCELLED` and writes one
  `audit_record` with `action: CANCEL`, `fromState: DRAFT`, `toState: CANCELLED`.
- **AC3** — The same route moves an `OPEN` job to `CANCELLED`, recorded the same way.
- **AC4** — Cancelling a `CANCELLED` job is refused with `CONFLICT`, names the state as final, and
  **writes no second audit row**.
- **AC5** — An optional `reason` reaches `audit_record.metadata`; omitting it writes no metadata key
  rather than a null one.
- **AC6** — `cancelled_at` is set on the transition and null everywhere else.
- **AC7** — `PUT /api/jobs/:id` on a `CANCELLED` job is refused with `CONFLICT`, through
  `canEditJob`, not a status comparison in the repository.
- **AC8** — `canEditJob` is exhaustive over `JobStatus`: a new state cannot be added without a
  decision. Asserted by iterating `jobMachine.states` rather than a hand-written list.
- **AC9** — `POST /api/jobs/:id/publish` on a `CANCELLED` job is refused (no `DRAFT → OPEN` rule
  applies) and the job stays `CANCELLED`.
- **AC10** — `GET /api/me/jobs` serves the caller's jobs, newest first, and `GET /api/jobs/me` no
  longer exists — it answers `404` as a malformed id, proving the path spaces are now separate.
- **AC11** — `job:cancel-own` exists in `PERMISSIONS` and is denied to a role that should not hold it.
- **AC12** — Every new route refuses an unauthenticated caller, and a stranger's job is `404`.
- **AC13** — The migration is reversible and `prisma migrate diff` reports no drift. The rollback
  **fails loudly** if a `CANCELLED` row exists rather than rewriting it to another state.

## 6. Out of scope

- **`AWARDED`, `IN_PROGRESS`, `COMPLETED`** — §6.1.
- **Amendment of a published job.** Decided against (§1.1); it is a feature that must invalidate
  quotes, and quotes do not exist. It returns with `W4-T03` at the earliest.
- **Cursor pagination on `GET /api/me/jobs`** — §4.
- **Cancelling on the client's behalf** (admin, or a job nobody quoted in 90 days). `W10`'s, and it
  would be a `SYSTEM` actor — which `transition()` already supports and this ticket does not use.
- **Any storefront UI.** ADR-011 gives pages to `W12`.

### 6.1 Where the other three states went, and the question they carry

Each missing state is owned by the ticket that gives it a **producer**. "Later" is how a deferral
becomes a lie, so they are named:

| State | Lands with | Because it needs |
|---|---|---|
| `AWARDED` | `W4-T05` (award) | an accepted quote from `W4-T03` to award *to* |
| `IN_PROGRESS` | `W5` booking lifecycle | a `Booking` — "started" is a fact about an engagement |
| `COMPLETED` | `W5-T04` (completion → capture) | completion is what triggers capture and payout |
| `CANCELLED` from `AWARDED`/`IN_PROGRESS` | `W5-T05` (refund policy) | money has moved; this is a refund |

Three of the four are `agent-money`'s, which is the finding: **`W4-T02` was never able to ship the
board line on its own**, and the row's wording — *"Job state machine: DRAFT → OPEN → AWARDED → …"* —
reads like one ticket's work only until somebody asks what produces each arrow.

**The question `W4-T05` inherits, flagged here rather than discovered there:** does a job track
`IN_PROGRESS` and `COMPLETED` at all, or read them off its `Booking`? Two state machines over one
engagement can disagree, and a job that says `COMPLETED` while its booking says `DISPUTED` is a
contradiction that costs a refund. The cheap answer — a job has no states after `AWARDED`, and the
booking owns the rest — is not obviously right either: a job awarded and then abandoned before any
booking exists has nowhere to go. It is a seam question between `agent-jobs` and `agent-money`, and
choosing it here would be guessing, the same way `W4-T01` §2.4 declined to choose the quote shape.
