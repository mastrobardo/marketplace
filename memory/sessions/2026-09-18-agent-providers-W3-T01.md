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
- **Operator answered `BD-07`, 2026-09-18.** The "likely true" set confirmed whole —
  `electricidad`, `gas`, `climatizacion`, `telecomunicaciones`, `placas-solares` — and both "unsure"
  rows came back `false`. Five `true`, fifteen `false`.
- **The reforma-integral answer was worth more than the cell**, and became spec §3.5.1: *a licence
  attaches to the trade performed, not to the umbrella above it*. Tiling and wall work need nothing;
  rewiring during a renovation is gated as `electricidad` because the **work** is electrical, not
  because the job was filed under `reforma-integral`. Marking the umbrella `true` would demand a
  licence from a tiler and teach the column to mean "this job might involve something regulated" —
  a guess about scope, not a legal boundary.
  - It also vindicates `W1-T05`'s no-inheritance comment from the other direction: the flag must not
    propagate **down** either, which retroactively makes §3.4's arbitrary parent assignment safe —
    a trade's legal status is its own, never its family's.
  - The gap it leaves is real and **the operator chose it knowingly** (*"I would not put any hard
    blocker there"*): a provider listing only `reforma-integral` can be surfaced for work needing a
    gated trade by simply never claiming it. No taxonomy can close that — the table cannot know what
    a job turns out to involve. Stated in §3.5.1 and carried to §10.3 so `W3-T08` inherits it.
- `fontaneria` is `false` beside three `true` rows, and §8.3 says why out loud: plumbing carries no
  national authorisation, and the moment the work touches a gas appliance it is `gas`, which does.
  A reviewer expecting plumbing to be regulated should find the reason rather than file a bug.

## Blocked / escalations

**None. `BD-07` was answered by the operator on 2026-09-18** — see the Log. `TODO.md` §10.1's row is
struck through and carries the answer, so `W3-T08` does not have to find it in a spec.

One item is **provisional rather than settled**: `desatascos` is `false`, and the operator is
checking with the gremio. Recorded as provisional because the risk is asymmetric — `false` is the
permissive answer, so being wrong surfaces an unlicensed provider, while being wrong the other way
only asks for a certificate nobody needed. **It is the operator's to chase, not an agent's**; the fix
if it flips is one seeder row and one AC20 line.

## Handoff

**The spec is done, `BD-07` is answered, and nothing is implemented.**

**Next action**: `02-tdd-red.md` against §7's **twenty-three** criteria, in this order —
`modules/categories/` (routes + repository, the `W3-T05` split), then
`apps/api/prisma/seed/categories.ts`, then `demo-providers.ts`'s decoupling, then the mocks move.
§10.2 (`urgencias`) is the one thing still unconfirmed; it is non-blocking and the spec builds
option A (two roots), which is an additive seeder edit to reverse.

**Do not redo:**
- Re-asking `BD-07`, or defaulting any row's flag. Five `true`, fifteen `false`, every one explicit
  on the row (§8.3). `desatascos` is the only provisional cell and the operator owns the re-check.
- Gating a parent or a wide category. §3.5.1 is an operator rule, and AC21 fails if any root or
  parent row carries `true`.
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
guessed `requiresLicence` is worse than an absent one, §3.5.1's evasion, and §9's refusal to add an
admin CRUD that would make a legal boundary runtime-editable).
