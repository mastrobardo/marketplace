# W4-T03 — One quote for the whole job

- **Slice**: S4 Jobs & presupuestos (`agent-jobs`)
- **Decides**: what a *presupuesto* is here, who may write one, and what the client sees when
  choosing between them.
- **Answers**: the question `W4-T01` §2.4 refused to prejudge — *a three-trade job: one quote
  covering everything, or three covering parts?*
- **Unblocks**: `W4-T04` (comparison and accept), `W4-T05` (award).

---

## 1. Purpose

`W4-T01` built the job. `W4-T02` gave it a way to end. Neither could model a quote, because the
shape of a quote depends on a product question nobody had answered.

### 1.1 The answer

> 1 quote for everything. Usually, a plumber knows an electirician wich works with him already, or
> has a small comapny with all profiles. It would be also too chaotic for a user accepting X
> presupuestos: i look to remodel a bathroom, i want a quick way to get the job done. It is up to
> the professional to decide to apply or not.
> — operator, 2026-09-20

Three decisions in one paragraph, and §2 is each of them:

1. **A quote covers the whole job.** Not a category, not a part.
2. **A client compares whole offers**, never assembles one from pieces.
3. **The platform does not decide who is allowed to quote.** The professional does.

## 2. Design

### 2.1 One quote, one job, one price

`Quote` references a `Job`, not a `JobCategory`. There is no per-category price and no line
covering part of the work.

The alternative — three trades, three quotes, the client assembling a team — was rejected on the
operator's own grounds, and the reason is worth keeping because it is about the product rather than
the model: **a client who wants a bathroom does not want to become a general contractor.** Somebody
has to coordinate three trades onto one site in the right order, and it should not be the person who
has never done it. In this market that coordination already exists — the plumber has an electrician
they work with, or the firm has both.

The cost is recorded honestly in §5: the platform cannot see the subcontractor.

### 2.2 The platform does not gate who may quote

A job naming `alicatado`, `fontaneria` and `electricidad` may be quoted by a provider who lists only
`fontaneria`. **This is allowed, deliberately.**

*"It is up to the professional to decide to apply or not."* A plumber who knows an electrician can
cover the job; a plumber who cannot will not bid, and the ones who bid badly are answered by
`W8-T05`'s reviews rather than by a rule that also blocks the ones who can.

This is the same principle `W3-T01` §3.5.2 already applies to licences — *the flag marks a
verification, not an exclusion* — and the same one `W4-T01` applied to required fields. §6 records
it as the repo-wide rule it has evidently become.

### 2.3 Coverage is shown, and it is built only from facts that exist

A quote carries **coverage**: for each of the job's categories, whether the quoting provider lists
it, and whether the trade requires a licence.

> i might not be verified as an electrician, but given my rates and past jobs recorded is up to the
> client to pick me or not. **Nothing enforces, but stated clearly.**
> — operator, 2026-09-20

**What coverage does not contain is the point.** There is no `verified` field, because *nothing in
this schema knows whether a provider is verified for anything.* `Category.requiresLicence` marks a
trade as regulated (`W3-T01`, `BD-07`); provider-side verification is `W8-T01`/`W8-T02` and does not
exist. A nullable `verified` that is always null would be the empty promise `W4-T01` refused when it
declined a photos column — a shape implying a capability nothing can deliver.

So today the client sees, truthfully: *this job needs `electricidad`, which is a licensed trade, and
this provider does not list it.* That is a real signal and it is the one the operator asked for.
When `W8` lands, coverage gains a verification field and the sentence gets stronger; the shape is
ready for it and does not pretend to it.

This also sharpens a known gap rather than creating it: `W3-T01` §10.3 already noted that a client
cannot tell an ungated `reforma-integral` includes regulated work. One-quote-for-everything makes
that the **normal** case, which is why the coverage list is per *job category* and not per provider
category — it is answering "what does this job need, and who is standing in front of me", not
"what does this provider claim".

### 2.4 One active quote per provider per job, enforced in the database

The slice's own non-negotiable: *"One active quote per provider per job. Enforced in the DB, not
only in the service."*

A **partial unique index** on `(job_id, provider_id) WHERE status = 'PENDING'`. Partial, because a
withdrawn quote must not block a replacement — the provider revises by withdrawing and submitting
again, which is what "one active" already implies and avoids an edit path with its own audit
question.

A plain unique constraint would have made a withdrawn quote a permanent bar. That is the kind of
rule that is discovered by a support ticket.

### 2.5 The amount is information, not an instruction

`amountCents`, integer, EUR, required — a quote without a price is not a quote.

**It is not a payment.** ADR-013 §4.1: the job's own price never passes through this platform, and
*"a quote is a number two people agreed on here; it is not a receipt, and nothing reconciles against
it."* Nothing charges this figure, and `W5` must not grow a path that does.

A single total, with an optional free-text `breakdown`. Structured line items were considered and
rejected for `W4-T01`'s reason: the fields required are minimal, and a professional who wants to
itemise can, in prose, without the schema demanding it of everyone.

### 2.6 A quote expires by arithmetic, not by a worker

`validUntil`, required, and **expiry is evaluated when the quote is read** — a quote whose
`validUntil` has passed is reported as `EXPIRED` and cannot be accepted.

No `EXPIRED` row state and no scheduled job, for two reasons. There is no scheduler in this codebase
(`W6-T03` is where one arrives). And a status column that only becomes true once something sweeps it
is a column that is wrong between the sweeps — the arithmetic is always right and costs nothing.

### 2.7 Quoting is only possible on an `OPEN` job — and the two refusals differ

The slice's rule is *"quotes on a closed job return `409 JOB_CLOSED`"*, expressed through
`canQuoteOn`, an exhaustive `Record<JobStatus, boolean>` in the contract — so that when `AWARDED`
arrives this **fails the build** rather than keep refusing correctly by accident
(`MEM-2026-09-20-13`).

**But `DRAFT` and `CANCELLED` are not refused the same way, and the difference is deliberate.**

- A **draft** is invisible to everyone but its owner (`W4-T01` §3). A provider who names one gets
  the same `404` a job that never existed gets — telling them it is a draft would confirm the
  existence of somebody's private row.
- A **cancelled** job was legitimately visible in the feed. A provider quoting one late is answered
  `409`: they are not being told a secret, they are being told they were too slow.

So visibility is a query concern and quotability is a state rule, and they live in different places
on purpose. `canQuoteOn` still answers for `DRAFT` — the rule is complete even where the repository
never asks it.

## 3. API surface

| Route | Permission | Does |
|---|---|---|
| `POST /api/jobs/:id/quotes` | `quote:create` | A provider quotes an `OPEN` job |
| `GET /api/jobs/:id/quotes` | `quote:read-for-own-job` | The job's **owner** sees every quote on it |
| `GET /api/me/quotes` | `quote:read-own` | A provider's own quotes, newest first |
| `POST /api/quotes/:id/withdraw` | `quote:withdraw-own` | The quoting provider withdraws |

`/me/quotes` follows `MEM-2026-09-20-12` — a collection the principal owns is `/me/<collection>`.

**Two different readers, two different permissions.** A client reading quotes on their job and a
provider reading their own quotes are not the same capability, and collapsing them into
`quote:read` would make "can a provider see a competitor's quote?" a question about a `WHERE`
clause instead of about a permission.

**A stranger's job is `404` on the quote routes too** — `W4-T01` §3's refusal shape is not revisited.

## 4. What does not change

- `Job`, `JobCategory`, `jobMachine`. This reads them and adds nothing.
- The publish floor, the cancel rule, `canEditJob`.
- `ProviderProfile` and `ProviderCategory`. Read, never written.
- Accepting or rejecting a quote — `W4-T04`. Award — `W4-T05`, itself now blocked on `W5-T02`.
- Any money movement. ADR-013 §4: nothing here charges anything.

## 5. Acceptance criteria

- **AC1** — A provider may quote an `OPEN` job with a total and a validity date; nothing else is required.
- **AC2** — A quote on a `CANCELLED` job is refused with `CONFLICT` through `canQuoteOn`; a quote on
  a `DRAFT` job is `404`, because a draft's existence is not information this API gives away (§2.7).
- **AC3** — A second quote by the same provider on the same job is refused **by the database**, not
  only by the service.
- **AC4** — After withdrawing, the same provider may quote again, and both rows survive.
- **AC5** — A provider who lists none of the job's categories may still quote (§2.2).
- **AC6** — Coverage names every one of the job's categories, says whether the provider lists each,
  and carries `requiresLicence` from the category.
- **AC7** — Coverage carries **no** verification field, and `QuoteSchema` has no key implying one.
- **AC8** — A quote past `validUntil` reads as `EXPIRED` without any job having run.
- **AC9** — The job's owner sees every quote on their job; a provider sees only their own, and never
  a competitor's.
- **AC10** — A stranger is `404` on every route, and an unauthenticated caller is `401`.
- **AC11** — `amountCents` is a non-negative integer; a float or a negative is `VALIDATION_FAILED`.
- **AC12** — The four permissions exist and each is denied to a role that should not hold it.
- **AC13** — The migration is reversible and `prisma migrate diff` reports no drift.

## 6. Out of scope

- **Accept / reject** — `W4-T04`. `quoteMachine` therefore declares only the states this ticket can
  produce, the discipline `W4-T02` established.
- **Any notification** that a quote arrived. No mail provider (`OPS-14`), and `W11` owns it.
- **Provider-side verification** — `W8`, and §2.3 explains why coverage is shaped to wait for it.
- **Subcontractors as entities.** §2.1 makes subcontracting normal and the platform does not see it:
  the review, the flag and the ban from ADR-013 attach to the professional who quoted. They chose
  the subcontractor; they carry it. Do not build sub-profiles without revisiting ADR-013 §4.1.
- **Ranking or sorting quotes.** `W4-T04`, and the slice rule stands: *sorts by rating then price,
  the client can re-sort, do not hide the cheapest.*
- **Any storefront UI** — ADR-011 gives pages to `W12`.
