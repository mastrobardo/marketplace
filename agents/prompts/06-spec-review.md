# Prompt 06 — spec review

**Input**: `docs/specs/<slice>/<feature>.md` before implementation starts.
**Output**: approve, or findings. Owned by `agent-contracts`.

---

This is the cheapest place to catch a mistake. A vague spec becomes an untestable acceptance
criterion, which becomes a PR that passes CI and is still wrong.

Check:
- [ ] **Testability** — could you write the test from the criterion alone, with no guessing?
- [ ] **Completeness** — every role, every error, every terminal state, every deny.
- [ ] **Consistency** — names match `TODO.md` §3 and the glossary. No synonyms for existing concepts.
- [ ] **Seam impact** — what does this add to `packages/contracts`? Additive or breaking?
- [ ] **Overlap** — does another slice already do this, or is about to? Check open branches.
- [ ] **Concurrency** — if two actors can act simultaneously, does the spec say who wins?
- [ ] **Money** — who pays, how much, when captured, when released, what happens on failure.
- [ ] **Scope** — is "out of scope" honest, or is it hiding work that will surface mid-PR?
- [ ] **`[H]` dependencies** — does this need a human decision that has not been made? Say so now.

Reject a spec that says "handle errors appropriately". Name the errors.
