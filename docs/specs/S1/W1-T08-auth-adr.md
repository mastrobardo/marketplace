# W1-T08 (auth) — Authentication and sessions ADR

**Task**: `W1-T08` `[M]` — ADR template + first 5 ADRs (stack, contracts seam, money, geo, auth).
**Scope of this branch**: the **auth** ADR only. The other four remain outstanding.
**Owner**: `agent-contracts`
**Issue**: `W1-T08`

---

## 1. Purpose

`W2` cannot start. Every ticket in it — signup, sessions, role guards, provider signup, lockout —
inherits its shape from one decision nobody has made in writing: *do we own authentication, or buy
it?* `W1-T08` listed that ADR eight months ago and `docs/adr/` still starts at `ADR-006`.

The trigger is `M11`. `W12-T12` merged the `AuthWall`, so the storefront now stops, deliberately and
visibly, at a boundary with nothing behind it. `M11`'s exit criterion is that stop; `M1`'s is what
happens next. This ADR is the seam between them.

**This branch is documentation.** No runtime code changes, no migration, no dependency added. The
output is a decision the `W2` tickets can be written against, plus the corrections to `TODO.md` that
the decision forces.

## 2. What the ADR must decide

| # | Question | Why it cannot be deferred |
|---|---|---|
| D1 | Own it or buy it — and if buy, which service | `W2-T01` is a different ticket under each answer |
| D2 | Where the user record lives | `W1-T05` already put it in `app_user`; a hosted IdP would make that a second copy, and `W2-T08` (GDPR erasure) a two-system problem |
| D3 | The session mechanism | `W2-T02` states one today; it must be right or rewritten |
| D4 | Which methods at launch | Supply-side conversion (`R3`) turns on this |

## 3. Constraints the decision must respect

1. **`app_user` exists and is load-bearing.** `roles`, `status`, `locale`, `deletedAt`, both
   profiles, `address`, `AuditRecord`. Any answer that makes this a mirror of someone else's record
   is answering a different question than the one the schema already answered.
2. **`W12-T15` is over its ≤170 KB initial-JS budget.** A client SDK on the storefront is a cost
   against a budget that is already failing.
3. **`ADR-006` is on the record** rejecting Supabase in part for bundling *"auth and APIs we are
   deliberately building"*.
4. **The API and the web are separate deployments** (Fly, Cloudflare Pages). Any cookie-based answer
   has to survive that, including on previews.
5. **`OPS-14` does not exist yet.** The decision may not assume a live email provider.

## 4. Acceptance criteria

- **AC1** — `docs/adr/ADR-005-authentication-and-sessions.md` exists, `Status: Accepted`, and answers
  D1–D4 explicitly.
- **AC2** — Every claim about the chosen library's behaviour is taken from its **current published
  documentation**, not from recall, and the ADR states the behaviour concretely enough to be wrong.
- **AC3** — The ADR reconciles the chosen library's required schema against `app_user` **column by
  column**, naming every mismatch rather than asserting compatibility.
- **AC4** — At least three alternatives are recorded with the reason each was rejected, and the
  reasons are specific to this repo rather than generic trade-offs.
- **AC5** — Any `TODO.md` §6 line the decision **contradicts** is corrected on this branch. An ADR
  that silently disagrees with the backlog is worse than no ADR.
- **AC6** — Any new work the decision creates is filed as a backlog ticket with an ID, not left as a
  sentence in the Consequences section.
- **AC7** — `§1` locked-decisions table carries the decision, so it is visible without reading
  `docs/adr/`.
- **AC8** — No file outside `docs/` and `TODO.md` changes.

## 5. Out of scope

- **The other four ADRs** (stack, contracts seam, money, geo). Their decisions are live in `§1` and
  in the code; writing them is not what `W2` is blocked on, and bundling five documents into one
  review is how none of them get read.
- **Implementation.** No dependency, no migration, no route. `W2-T01` and `W2-T02` own that.
- **`BD-06`** (do manitas need ID verification) and **`BD-14`** (retention periods). Both are
  business decisions that gate `W2` tickets and neither is an auth-architecture question.
- **Authorisation.** `roles` is our column and the permissions matrix is `W2-T03`, unchanged under
  every option considered.

## 6. Open questions

Carried into the ADR itself rather than resolved here — see `ADR-005` §Open questions: the
MANITAS/PRO signup split (`W2-T05`), `BD-06`, and session lifetime.
