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
All gates green. Required approvals present. Squash merge.
Subject: `feat(quotes): submit quote [W4-T03]`.

**Running today**: `typecheck` · `lint` · `unit` · `build` · `database` · `workflows` · `gates`.
The last one is `W0-T12`'s four — `spec-present` · `intervention-logged` · `author-identity` ·
`agents-drift` — in a single job since `W0-T29`, each reported by name in the run summary and
annotated on the check when it fails. Run them locally with `pnpm gates`.

**Still to build**, and listed here so nobody assumes otherwise: `migrate diff` · `contract`
(OpenAPI ⇄ impl) · `e2e smoke` · `secret scan` · `dep audit (high+)`. Each needs machinery this
repo does not have yet. Do not cite one of these as having checked something.

Note that none of the gates is *required* in branch protection until `W0-T13` (#45) lands: they
report on every PR, but GitHub will still let a red one merge.

## Rejection is data
Closing an agent PR without merging requires a ledger entry in `docs/interventions/`. It is the
highest-signal record we get about where prompts and specs are weak. Never close quietly.
