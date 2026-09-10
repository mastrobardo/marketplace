---
task: W1-T06
agent: agent-contracts
session: 2026-09-10T09:05Z
status: open
---

# Session — W1-T06

## Goal

Land the money value object in `packages/contracts`: integer cents, and an explicit rule for what
happens when money is divided. First of five tasks the operator picked off a next-steps map that
excluded everything needing a third-party account.

## Current state

Merged into the branch and green: spec, red-phase commit, implementation, run record. `pnpm verify`
clean — typecheck, lint, format, 224 tests / 10 files, both builds. 47 money tests, two type-level
fixtures, nothing touched outside `packages/contracts`.

## Log

- 09:05 Mapped the tasks with no third-party dependency and ranked them. W1-T06 first because it is
  self-contained and every later money path depends on its rounding rule. W0-T20 (seed
  sanitisation) and W1-T09 (test factories) were deliberately deferred: both want a domain schema
  that `W1-T05` has not written, so they would be building against nothing.
- 09:10 Claimed `main` did not have `packages/contracts` and that W1-T01 had no PR. Wrong on both:
  the local `origin/main` ref was stale because I had not fetched, and #164 had merged. `git fetch`
  before reasoning about what is on `main` — a `git ls-tree origin/main` is only as fresh as the
  last fetch. Cost one exchange with the operator, who supplied the PR link.
- 09:15 Put decisions A/B/C to the operator with recommendations (currency literal, half-away-from-
  zero rounding in two named functions, negative amounts legal). Reply: "let's start". Treated as
  proceed-on-recommendations; recorded in spec §2 as standing and in §10 as an open ESCALATION
  until merge, so a wrong one is still a spec edit today rather than an ADR tomorrow.
- 09:30 Red phase: stubs that throw, per `MEM-2026-09-09-06`. 42 failed / 4 passed. Wrote the four
  passes and their excuses into the run record rather than quietly shipping a partial red — AC21
  genuinely never went red, because decision A is carried by a type alias the stub had to contain.
- 09:45 Green, then two defects the tests found: `negate(zero())` returning `-0`, and `prorate`
  computing `amountCents × numerator` past 2^53 and rounding *before* dividing. The second was
  found by reading why a property-test assertion failed rather than fixing the assertion — the
  assertion was also wrong (it demanded a ratio above 1 scale down), and both were fixed separately.
- 10:00 `pnpm verify` clean from cold. Run record written with §5 explaining the changed assertion,
  since editing a test after watching it fail is the thing a reviewer should distrust.

## Blocked / escalations

```
ESCALATION
Task:      W1-T06
Question:  Do decisions A, B and C (spec §2) stand as recorded?
Options:   A) they stand — merge as specced
           B) one changes — a spec edit now, an ADR after merge
Recommend: A. Each is the conservative reading of a constraint already committed to (EUR-only in
           TODO.md §1, integer cents in MEM-2026-09-07-03, refunds in W5-T06), and all three widen
           additively.
Blocked:   nothing
Not blocked: the whole task shipped on the recommendations.
```

Deferred to `W5-T02`, recorded in spec §10 so it is not lost: `allocate` guarantees the leftover
cent lands at the lowest index, but **which party sits at index 0** in a platform/provider/promotion
split is a commercial decision, not a rounding one.

## Handoff

Next action: the operator reviews and merges the PR — L6, I do not merge my own work. Then
**W1-T02 pagination** is the next task in the agreed sequence (then W1-T07, W1-T05, W1-T03), each
branched fresh off `main` after the previous merges so that `packages/contracts/src/index.ts` never
conflicts between them.

Do **not** redo: the spec, the red-phase evidence, or the two defect fixes in §4 of the run record.
Do **not** reopen decisions A/B/C without an ADR once this merges.
