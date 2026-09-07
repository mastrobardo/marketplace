# Prompt 04 — refactor

**Input**: green tests.
**Output**: the same behaviour, clearly expressed.
**Next step**: `05-code-review.md` (self-review first).

---

Tests stay green and **unchanged**. If you need to change a test, you are changing behaviour —
go back to step 2.

Look for:
- Duplication with existing code in your slice — and with `packages/ui` / shared helpers before
  you write a new one. Reuse beats reinvention; check first.
- Logic that belongs in a service but sits in a handler or component.
- Names that don't match the spec's vocabulary. Align to the glossary (`memory/repo/glossary.md`).
- Missing early returns, deep nesting, boolean parameters, magic numbers (→ named config).
- Anything that would surprise the next agent. Add a comment only where the *why* isn't obvious;
  match the comment density of the surrounding code.

Do not: rename things outside your slice, "improve" adjacent code, add abstractions for a second
use case that does not exist yet.

## Self-check
- [ ] Tests unchanged and green
- [ ] No new public surface that the spec did not call for
- [ ] Reads like the rest of the codebase, not like a different author
