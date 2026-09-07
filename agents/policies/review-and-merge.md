# Policy — review and merge

## Three axes (all three, every PR)

| Axis | Question | Who |
|---|---|---|
| Code | Correct, safe, inside boundaries, tested? | peer slice agent |
| Spec | Does the spec describe the real need, and does the code satisfy *it*? | `agent-contracts` |
| Prompt | Reproducible, or six corrective rounds? Read `.run.md`. | the reviewing agent |

A run record showing many corrective iterations is a **defect in the prompt template**, not just in
the code. File a follow-up against `agents/prompts/` and cite the run record.

## Two reviewers required for
`apps/api/src/modules/{payments,bookings,subscriptions,auth}/**` · anything touching the ledger ·
any state machine · `packages/contracts/**` · `schema.prisma` · CI workflow changes.
Second reviewer is `agent-money` (money) or `agent-qa` (everything else).

## Reviewers do not rewrite
File findings, hand back. You are reviewing, not taking over. If you catch yourself fixing it
yourself, that is a `MANUAL_FIX` intervention and needs a ledger entry.

## Merge requirements
All gates green: `spec-present` · `intervention-logged` · `typecheck` · `lint` · `migrate diff` ·
`unit` · `contract` · `e2e smoke` · `build` · `secret scan` · `dep audit` · `agents-drift`.
Required approvals present. Squash merge. Subject: `feat(quotes): submit quote [W4-T03]`.

## Rejection is data
Closing an agent PR without merging requires a ledger entry in `docs/interventions/`. It is the
highest-signal record we get about where prompts and specs are weak. Never close quietly.
