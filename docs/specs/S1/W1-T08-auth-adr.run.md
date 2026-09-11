# W1-T08 (auth) — run record

**Branch**: `W1-T08-auth-adr`
**Agent**: Claude Opus 5
**Date**: 2026-09-11
**Spec**: `docs/specs/S1/W1-T08-auth-adr.md`

---

## Prompts

### 1. Spec authoring

The operator asked two questions in one message — *"please continue with next steps. Which ones are
they? Also, at which point do we have Auth? We should start also to choose a service (ie: auth0, or
just google)"*. The first half was answered from the backlog. The second half turned out not to be a
question about a service at all: the blocker was that `W1-T08`'s auth ADR had never been written, and
`docs/adr/` starting at `ADR-006` is what made that invisible.

### 2. Decision

Four options were put to the operator with a recommendation — `better-auth` self-hosted, hand-rolled
per the existing `W2-T01`/`T02` lines, Auth0, or Clerk — alongside a note that "just Google" is a
second method rather than a strategy. The operator chose **`better-auth`, self-hosted**.

### 3. Verification before writing

The library's behaviour was read from its **current published documentation** (AC2) rather than
recalled, because the ADR's whole value is that `W2` can be written against it. Two of the four facts
checked came back different from the shape the decision had assumed, and both changed the document —
see below.

## Red phase

**Not applicable, and worth saying why rather than leaving the heading empty.** This branch adds no
runtime code, so there is no failing test to paste. The substitute discipline is AC2 and AC3: every
claim about the library is sourced, and the schema reconciliation is done column by column so the
ADR can be *wrong* in a way that review can catch. An architecture document that only makes
unfalsifiable claims has skipped the same step a test would have forced.

## Green phase

- `docs/adr/ADR-005-authentication-and-sessions.md` — 6 rules, a column-by-column schema
  reconciliation table, 4 alternatives, 6 consequences, 3 open questions.
- `TODO.md` — 6 edits: the `§1` locked-decisions row (AC7), `W1-T08`'s own line, `W2-T01`,
  `W2-T02` (rewritten — AC5), `W2-T07`, `OPS-14`, and a new `W0-T28` (AC6).
- No file outside `docs/` and `TODO.md` (AC8).

## What the verification caught

### 1. `emailVerified` is a boolean and `emailVerifiedAt` is a timestamp

The decision was written assuming `app_user` could be mapped onto better-auth's `user` model by
renaming columns. It can — `modelName` and `fields` do exactly that — but **`fields` maps names, not
types**, and better-auth's `user.emailVerified` is a boolean where `W1-T05` deliberately stored a
`DateTime?` so the verification event has a *when*. There is no configuration that reconciles those;
one of them has to give. The ADR takes the redundant column rather than throwing away the timestamp,
and says so as a cost rather than hiding it in a mapping table. Had this not been checked, `W2-T01`
would have discovered it at migration time and quietly dropped the audit fact.

### 2. `W2-T02`'s session design contradicts the library — and was already self-contradictory

`W2-T02` says *"httpOnly refresh cookie + short-lived access token, rotation, revoke"*. better-auth
is database sessions behind a signed cookie. The easy reading is that the library forces a
compromise; the correct one is that the backlog line was already inconsistent with itself, because a
short-lived access token makes *revoke* eventually consistent and the same line asks for revoke. The
domain settles it: `UserStatus.SUSPENDED` exists and `BD-11` (support impersonation) is coming, and
both need revocation to mean *now*. So the ADR overrides the line on the merits rather than on the
library's convenience, and `TODO.md` is corrected rather than left disagreeing (AC5).

This also decided rule 4. better-auth's optional cookie cache is documented to leave revoked sessions
live on other devices until the cache expires — reintroducing the exact property rule 3 exists to
remove — so it is off, with the condition for revisiting it written down.

### 3. The cookie decision breaks previews, and only previews

This is the finding that justified checking rather than asserting. A `SameSite=Lax` session cookie is
fine in production: `api.<domain>` and `<domain>` share a registrable domain under `OPS-16`. On a
preview they do not — `<task>.<project>.pages.dev` against `marketplace-api-<task>.fly.dev` are
different registrable domains, so the cookie is simply never sent and login fails. §9's *"every PR
gets a URL"* is the principle that would have broken, and it would have broken **after** production
looked fine, which is the worst order to find it in.

`apps/web/src/shared/api.ts` already defaults `baseUrl()` to `/` — same origin — with a comment
calling `VITE_API_URL` *"the escape hatch for the day the API moves to its own host"*. That default
has been carrying an unstated platform requirement since `W12-T08`. The ADR states it (rule 5) and
files the platform half as `W0-T28` (AC6) rather than leaving it as prose in Consequences.

### 4. `passwordHash` is dead on arrival

`app_user.passwordHash` is nullable with the comment *"so that adding a social login later is not a
migration"*. better-auth puts credentials in an `account` row, which achieves that goal properly — a
user can hold a password *and* a Google identity as two rows. The column would survive as something
that looks like the credential store and is not, so `W2-T01` drops it. The original comment was right
about the intent and is superseded by a better mechanism, which is worth distinguishing from being
wrong.

## Deviations from spec

None. AC1–AC8 are all met on this branch.

## Known gaps, carried deliberately

- **`ADR-001`–`ADR-004` are still missing.** Spec §5 scopes them out and `W1-T08`'s line now says so
  explicitly instead of reading as done. The money ADR is the one that matters next (`W5`), and it is
  `[M]` for the same reason this one was.
- **The ADR has not been executed against.** Every claim is sourced from documentation, and
  documentation is not a running integration. The first real test is `W2-T01` mounting the library on
  Fastify 5 and mapping `app_user`; the reconciliation table is the part most likely to be found
  incomplete there, and it is written as a table so a gap is visible rather than implied.
- **No decision on session lifetime** (`ADR-005` Q3). Inheriting the 7-day default would be a
  coincidence rather than a choice, so `W2-T02` is told to pick.

## Human input received

| Asked | Answered |
|---|---|
| Which auth strategy should `ADR-005` record? | `better-auth`, self-hosted |
| What to start after the ADR? | `W12-T18` visual foundations |

The operator's framing — *"auth0, or just google"* — was answered rather than adopted: the ADR
records why Google alone is a supply-side conversion tax (`R3`) and why it is nonetheless the right
*second* method.

## Self-assessment

The part worth reviewing is rule 3, because it overrules a backlog line that a human wrote and an
agent could have simply obeyed. The argument is that `revoke` and `short-lived access token` were
never compatible and the domain needs revoke — but it is still an agent deciding that a written
instruction was wrong, which is the category of judgement that should get the most scrutiny. If the
reviewer disagrees, the cost is confined: `W2-T02` changes, and nothing in `ADR-005` rules 1, 2, 5 or
6 depends on it.

The second-most reviewable part is that this ADR is confident about a library nobody in this repo has
run. AC2 was the mitigation and it worked — three of the four findings above came from checking — but
verification against documentation has a floor, and `W2-T01` is where it gets tested properly.

`W0-T28` is the piece most likely to be underestimated. It reads like a routing rule and it is one,
but it sits between two deployment platforms, and it is a prerequisite for `W2-T02` rather than a
tidy-up after it.
