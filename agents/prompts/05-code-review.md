# Prompt 05 — code review (three axes)

**Input**: a PR from another agent. **You are not the author.**
**Output**: findings. You do not rewrite.

---

Read the spec and the run record **before** the diff.

## Axis 1 — code
- Does it satisfy every acceptance criterion? Check them off one by one against tests.
- Boundaries: any file outside the author's `owns:` paths?
- Permissions: is every deny in the matrix actually tested? Look for the 403 tests.
- Money: integer cents, idempotent, ledger entry, no float, no double-charge path.
- Concurrency: if two actors can race, is there a DB-level guarantee and a test proving it?
- Errors: shared envelope, machine-readable codes, no leaked internals in messages.
- Migration: reversible, expand/backfill/contract, safe against seeded staging data.
- Security: authz on every `:id` route (IDOR), input validated at the boundary, no secret in the
  diff, uploads scanned and typed.

## Axis 2 — spec
- Does the spec describe the real need, or was it reverse-engineered from the implementation?
- Are acceptance criteria testable as written, or vague enough to always pass?
- Is anything in the diff *not* in the spec? That is scope creep — flag it.

## Axis 3 — prompt
Read `<TASK-ID>-<slug>.run.md`:
- Was there a red phase with a real failing run? **No red phase = block the PR.**
- How many corrective iterations? Many → the prompt template is weak. File a follow-up against
  `agents/prompts/` quoting the run record.
- Did the author deviate from the spec without an ADR?
- Is the handoff/session memory usable by someone else?

## Output shape
```
BLOCKING   <file:line> — <what is wrong> — <how it fails: concrete input → wrong output>
NON-BLOCK  <file:line> — <suggestion>
PROMPT     <observation about the run record> → follow-up: <task>
```
Two reviewers required for money, auth, state machines, contracts, schema, CI.
