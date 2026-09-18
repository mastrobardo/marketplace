---
task:    W3-T01
agent:   agent-providers
session: 2026-09-18
status:  open
---

# Session — W3-T01

## Goal

The real category tree. `W3-T02` validates submitted slugs against `category`, and that table holds
the four demo rows `W3-T10` seeded, all saying `requiresLicence: false` as an admitted deferral. This
ticket is the vocabulary a provider picks from, and the legal column `W3-T08` will read as fact.

## Current state

- Branch `W3-T01-category-tree`, cut from `origin/main` at `7ade5cd` (after `W3-T02` merged as #264
  and the docs branch as #265).
- **The spec is written** — `docs/specs/S3/W3-T01-category-tree.md`, all ten sections. No code yet.
- `Category` in `schema.prisma` already carries `parentId`, `position`, `isActive`,
  `requiresLicence` and the `category_parent_id_position_idx` index, from `W1-T05`. **No migration
  is needed**, which is what keeps this ticket inside a charter that forbids `schema.prisma`.
- `CategorySummarySchema` / `CategoryListSchema` exist and are frozen (`W12-T09`,
  `packages/contracts/src/catalogue.ts`). **No contract change is needed** either — `packages/
  contracts/**` is likewise `forbidden:` for this slice.
- `apps/api/src/modules/` holds `auth/`, `providers/`, `search/`. There is no `categories/` module
  and no `GET /categories` route; the storefront is still answered by the last MSW handler.

## Log

- Boot: charter (`agents/roles/agent-providers.md`), `agents/prompts/00-spec-authoring.md`,
  `agents/policies/escalation.md`, `LONG_TERM.md`, `slices/agent-providers.md`, `repo/glossary.md`,
  `TODO.md` §3 and §6, and the four artefacts that already touch categories.
- Started from a wrong premise and corrected it before any work: the operator asked to branch
  `W3-T02`, which had already merged as #264. The board's `▶ NEXT` had moved to `W3-T01`, and
  `W3-T02`'s own handoff names it. Confirmed with the operator before cutting a branch.
- **Operator decision A, 2026-09-18: the wire contract stays flat and unchanged.** The alternative
  was nesting `CategorySummarySchema` to carry children — an ADR, a change in another agent's slice,
  and a shape no current consumer reads. Flat gave the endpoint a rule worth having instead: *a
  category on the wire is a thing you can pick*, so `items` is leaves only and the two family roots
  are storage (spec §3.2).
- **Operator decision B, 2026-09-18:** draft the candidate taxonomy first and put `BD-07` to them as
  a table to rule on, rather than asking them to invent a taxonomy from nothing. That table is spec
  §10.1, twenty rows with the reason to suspect regulation beside each.
- Found while writing §3.1: **`urgencias` is not a category**, and `TODO.md` §6's one-liner is the
  only artefact that says it is. `glossary.md` calls *urgencia* `EmergencyRequest`;
  `SearchUrgencySchema = ['urgente','hoy','semana','flexible']` has been the frozen `when` dimension
  since `W12-T08`. Seeding it would make a third definition of urgency, and the only one a provider
  could accidentally *be in* — categories `['fontaneria','urgencias']` is an availability claim
  inside a column that means trade. Raised as §10.2, recommendation A (two roots), non-blocking.
- Found while writing §3.6: **the four demo slugs must be adopted, not replaced.**
  `demo-providers.ts` creates them with fixed uuids `aaaa…0001`–`0004` and `MEM-2026-09-18-1` says
  why they are fixed. Anything else duplicates a unique slug or orphans the demo world. This makes
  seeder *order* load-bearing for the first time in the pipeline — AC18 asserts the index rather
  than leaving a comment asking future editors to be careful.
- §3.4 records a modelling limit rather than hiding it: `fontaneria` belongs to both families and
  `parentId` is one column. Chose one-parent-by-usual-home because §3.2 makes the choice
  unobservable — a wrong guess costs a seeder edit and no migration.

## Blocked / escalations

`BD-07` is the `[B]` half and it is open. Verbatim block in spec §10.1; the short form:

```
ESCALATION
Task:      W3-T01
Question:  Which of the twenty leaf categories in §8.3 legally require a licence,
           registration or certification to perform for hire in Spain?
Options:   A) Rule on the table, cell by cell.
           B) Ship the tree with the flag deferred the way W3-T10 deferred it.
Recommend: A. B leaves W3-T08 with the same empty left-hand side it has today,
           and a second ticket has to revisit twenty rows.
Blocked:   §8.3's licence column; AC20.
Not blocked: the endpoint, the module, the seeder mechanism, the demo decoupling,
           the mocks move, and AC1–AC19, AC21, AC22.
```

Two sub-questions put to the operator with it: whether the answer varies by comunidad autónoma (the
column is national and has no region dimension), and whether "licence" means the provider's
authorisation or the job's permit — `Certification` models the former and `W3-T08` gates on it.

## Handoff

**The spec is done and awaiting operator review.** Nothing is implemented.

**Next action**: operator reviews `docs/specs/S3/W3-T01-category-tree.md`, rules on §10.1's licence
table and confirms §10.2. Then `02-tdd-red.md` against §7's twenty-two criteria, in this order —
`modules/categories/` (routes + repository, the `W3-T05` split), then
`apps/api/prisma/seed/categories.ts`, then `demo-providers.ts`'s decoupling, then the mocks move.

**Do not redo:**
- Looking for a migration or a contract change. Neither is needed and §8.1/§8.2 say why. Both paths
  are `forbidden:` for this slice, so finding that they need no edit is the finding.
- Proposing a nested `CategorySummarySchema`. Operator settled it flat on 2026-09-18 (§3.2).
- Seeding an `urgencias` category without reading §3.1 first.
- Deleting `apps/web/mocks/catalogue.ts`, `search.ts` or `provider.ts`. They **move** to
  `tests/fixtures/`; `tests/app-harness.tsx` stubs `ApiClient` from them, and the operator
  reaffirmed this on 2026-09-18 when `W3-T10` proposed deleting them.
- Adding a row to `permissions.ts`. The route is public; `W2-T03`'s growth rule is that a permission
  enters with the route that guards with it, and this one guards nothing (§5).

**Carry forward:** `packages/testing`'s `ProviderProfileInput` still has no `ratingAvg` — the fourth
ticket to route around it (`agent-qa`, from `W3-T10`). And with exactly twenty leaves, a provider can
now select the entire taxonomy and still pass `W3-T02`'s bound; §8.3 argues that is a trust problem,
not a validation one.

**Skills used so far**: `spec-driven-development` (the deliverable), `api-and-interface-design`
(§3.2's flat-wire rule and §4's unreachable `400`/`404`), `security-and-hardening` (§3.5 — why a
guessed `requiresLicence` is worse than an absent one, and §9's refusal to add an admin CRUD that
would make a legal boundary runtime-editable).
