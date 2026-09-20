# Run record — W4-T03 quote submission

```
Agent:        agent-jobs
Model:        claude-opus-5
Skills used:  test-driven-development, api-and-interface-design, documentation-and-adrs
Started:      2026-09-20T16:20Z
Finished:     2026-09-20T17:30Z
```

## Prompts

### 1. The question `W4-T01` left open, answered

> 1 quote for everything. Usually, a plumber knows an electirician wich works with him already, or
> has a small comapny with all profiles. It would be also too chaotic for a user accepting X
> presupuestos: i look to remodel a bathroom, i want a quick way to get the job done. It is up to
> the professional to decide to apply or not.

Three decisions, and the third was the one that shaped the code most: **the platform does not gate
who may quote.** A plumber may quote a job naming electrical work. §2.2.

### 2. The consequence, raised and answered

Building it surfaced a sharper version of a gap `W3-T01` §10.3 already knew about: with one quote
covering three trades, *"quoting a gated trade you are not verified for"* stops being an edge case
and becomes the normal case. Proposed showing coverage rather than restricting it. The answer:

> i might not be verified as an electrician, but given my rates and past jobs recorded is up to the
> client to pick me or not. **Nothing enforces, but stated clearly.**

That sentence is now the rule in three places — the spec, the contract, and
`memory/repo/decisions.md`, where it is recorded as the repo-wide principle it evidently already
was (`MEM-2026-09-20-20`).

### 3. Corrections

**None from the operator.** Two self-corrections, both below.

## Red phase

The first failure was `tsc`, on a branch that was based on the wrong thing:

```
src/quote.ts(93,3): error TS2353: Object literal may only specify known properties,
  and 'CANCELLED' does not exist in type 'Record<"DRAFT" | "OPEN", boolean>'.
```

`canQuoteOn` is a `Record<JobStatus, boolean>`, and `JobStatus` on `main` has no `CANCELLED` —
`W4-T02` is still on PR #277. **The mechanism `W4-T02` introduced caught a mistake in the next
ticket within minutes of it being made**, which is a better demonstration than the one its own run
record could give. The branch was rebased onto `W4-T02-job-state-machine`; the dependency is real
rather than a preference.

Then the ordinary reds — the testing factory's field is `providerProfileId`, not `providerId`, which
the type checker said before any test ran.

And `pnpm verify` found the one I would have missed entirely:

```
FAIL tests/factories.test.ts > AC10 — every model in the schema has a factory
     > Quote — has a builder and a factory
AssertionError: no buildQuote() — add one, or allowlist the model with a reason
```

**`packages/testing`'s own gate reads `schema.prisma` and fails when a model has no factory.** It is
the kind of test that looks like ceremony until it catches something, and the omission was real:
`W4-T04` would have written fixtures by hand against a table with no builder. `buildQuote`,
`createQuote` and the `Quote` id prefix are added here.

**Final:** contracts 21/21 (suite 283) · api routes 17/17 · api live 20/20 · whole api suite
**480/480** under `STACK_LIVE=1` (430 before) · testing 36/36 · `pnpm verify` 10/10.

## Deviations from spec

1. **`DRAFT` answers `404`, not the `CONFLICT` the first draft of §5 said.** Both are "you cannot
   quote this", but a draft is *invisible* — `W4-T01` §3's rule is that the existence of somebody
   else's job is not information this API gives away, and a `409` saying "this job is DRAFT"
   confirms a private row exists. A cancelled job is different: the provider legitimately saw it in
   the feed, so `409` tells them they were slow rather than telling them a secret.

   So visibility is a query concern (the repository returns `null`) and quotability is a state rule
   (`canQuoteOn`), and they deliberately live in different places. §2.7 and AC2 were rewritten.

2. **Coverage carries no `verified` field, which the operator's instruction seemed to ask for.**
   Checking the schema before designing it changed the design: *nothing in this system knows whether
   a provider is verified for anything.* `Category.requiresLicence` marks the trade; provider-side
   verification is `W8-T01`/`W8-T02`, unbuilt. A nullable `verified` would have been the empty
   promise `W4-T01` refused for photos.

   What ships says only true things — *this job needs `electricidad`, that trade is licensed, this
   provider does not list it* — which is the signal that was actually asked for. `W8` makes the
   sentence stronger without changing the shape.

3. **The testing builder is `QuoteRowInput`, not `QuoteInput`**, breaking that file's
   `<Model>Input` convention. `@marketplace/contracts` already exports a `QuoteInput` — the wire
   shape a provider submits — and both packages are routinely imported into the same test file. Two
   different `QuoteInput`s one import line apart is a trap worth one inconsistent name. `JobInput`
   was collision-free by luck; this is the first clash and it will not be the last, so the reason is
   written at the declaration.

   `buildJob`'s `status` was also widened to include `CANCELLED`, which `W4-T02` should have done
   and did not — the factory had drifted from the schema it claims to mirror.

## Self-assessment

**Weakest part of this change.** `listForJob` returns every quote on a job with no limit and no
cursor. `GET /api/me/quotes` is capped at 50; this is not capped at all, on the assumption that a
job attracts a handful of quotes. That assumption is untested and will hold right up until somebody
posts a job that attracts two hundred — at which point a client's first page becomes a full table
scan serialised into one response. `W4-T04` builds the screen that reads this and should fix it
there, where the page size is a design decision rather than a guess.

**What a reviewer should look at hardest:**

1. **The partial unique index is load-bearing and subtle.** `WHERE status = 'PENDING'` is what lets
   a withdrawn quote coexist with its replacement. If `W4-T04` adds `ACCEPTED` and `REJECTED`, this
   predicate silently changes meaning — a rejected quote would then block a resubmission, which may
   or may not be wanted. It is asserted by a test that goes around the repository entirely, but the
   *predicate* is the thing to think about, not the test.
2. **Expiry is computed, so "now" is a parameter.** `listForJob` and `listOwn` take an injectable
   clock and `create` does not. That asymmetry is deliberate but it is the kind of thing that grows
   a bug when a caller forgets the argument exists.
3. **`quote:create` requires both the role and a profile**, and the failure modes differ: no role is
   `403` from the guard, no profile is `409` from the repository. A provider who has signed up but
   never filled in a profile meets the second, and the message has to be good because nothing else
   explains it. `W2-T05`'s pro signup fork is where that stops happening.
4. **Coverage is computed per read**, so a quote list of *n* quotes carries *n* copies of the job's
   category list. Correct, and wasteful in a way that only matters at a page size this ticket does
   not have.

**Not built, and named in §6:** accept and reject (`W4-T04`), notifications (`W11`, and there is no
mail provider), verification (`W8`), subcontractors as entities — ADR-013 §4.1 says the platform
does not see what happens between the two parties, and the review, flag and ban attach to whoever
quoted.
