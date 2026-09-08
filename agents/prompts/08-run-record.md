# Prompt 08 — run record

**Output**: `docs/specs/<slice>/<TASK-ID>-<slug>.run.md`, on the branch, required by CI
(`spec-present`). Same `<TASK-ID>-<slug>` as the branch and the spec.

The run record is how prompt quality becomes reviewable. Write it **as you go**, not afterwards
from memory.

```markdown
# Run record — <TASK-ID> <slug>

Agent:        agent-<slice>
Model:        <model id>
Charter rev:  <revision: from agents/roles/<agent>.md>
Skills used:  test-driven-development, <others>
Started:      <ISO>   Finished: <ISO>
Session file: memory/sessions/<file>.md

## Prompts
### 1. Spec authoring
<verbatim prompt>
### 2. Contract proposal
<verbatim prompt>
### 3. TDD red
<verbatim prompt>
### 4. Implementation
<verbatim prompt>
### 5+. Corrections
<verbatim prompt> — **why a re-prompt was needed**: <what the previous output got wrong>

## Red phase
<paste of the failing test run, before any implementation existed>

## Green phase
<paste of the passing run>

## Deviations from spec
- none / <what changed, why, ADR link if the seam moved>

## Human input received
- none / <what a human supplied or decided, and where it is recorded>

## Self-assessment
- Weakest part of this change:
- What a reviewer should look at hardest:
- What I would tell the next agent working in this slice:
```

Verbatim means verbatim. A paraphrased prompt cannot be re-run, which defeats the purpose. If a
prompt contained something sensitive, redact the value and keep the structure — but nothing
sensitive should have been in a prompt in the first place.
