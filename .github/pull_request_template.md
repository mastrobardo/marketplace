<!--
The pipeline is spec → contract freeze → failing test → implementation → review
(`agents/AGENTS.md`). This template is the reviewer's entry point, not paperwork.
-->

## What this changes

<!-- One paragraph. What a reviewer needs before reading the diff. -->

## Task

<!-- The task ID, e.g. W0-T12. CI gate `spec-present` requires the branch to change both
     docs/specs/<slice>/<TASK-ID>-<slug>.md and <TASK-ID>-<slug>.run.md. -->

- Task ID:
- Spec:
- Run record:

## Did a human change anything on this branch?

<!-- MANDATORY (TODO.md §5.6). "Anything" includes hand-editing a file the agent wrote, waiving a
     review finding, or changing the requirement mid-task. -->

- [ ] **No** — this branch is the agent's work as produced.
- [ ] **Yes** — label the PR `intervention:*` and link the ledger entry below.
      CI gate `intervention-logged` fails a labelled PR with no entry in `docs/interventions/`.

Ledger entry:

## Definition of Done

<!-- TODO.md §5.3. Delete the lines that genuinely do not apply; do not delete the ones that were
     skipped — say so instead, that is what the run record is for. -->

- [ ] Acceptance criteria all covered by a test
- [ ] Run record includes the failing-test paste from the red phase
- [ ] No `any`, no `@ts-expect-error` without a linked issue
- [ ] Errors use the shared envelope + machine-readable code
- [ ] i18n keys added for ES and EN, no hardcoded strings
- [ ] Migration is reversible and tested
- [ ] Session memory closed with a `## Handoff`; durable learnings promoted (§5.8)

## Self-assessment

- Weakest part of this change:
- What a reviewer should look at hardest:
