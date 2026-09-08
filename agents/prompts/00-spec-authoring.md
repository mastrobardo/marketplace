# Prompt 00 — spec authoring

**Input**: a task ID from `TODO.md` §6.
**Output**: `docs/specs/<slice>/<TASK-ID>-<slug>.md` on the feature branch — same `<TASK-ID>-<slug>`
as the branch name, e.g. `docs/specs/S6/W4-T03-quote-submission.md`.
**Next step**: `01-contract-proposal.md`.

---

Write the spec for **<TASK-ID>**. Before writing, read: your charter, `memory/LONG_TERM.md`,
`memory/slices/<you>.md`, the domain model in `TODO.md` §3, and any adjacent existing spec.

Produce exactly these sections:

1. **Purpose** — one paragraph. Who needs this and why. If you cannot say who suffers without it,
   escalate rather than invent a justification.
2. **User stories** — `As a <role>, I want <x>, so that <y>.` Cover client, manitas, pro and admin
   where relevant.
3. **State machine** — table of `from → event → to`, with guards and side effects. Mermaid diagram.
   Every terminal and error state included. Omit only if the feature genuinely has no state.
4. **API surface** — every endpoint: method, path, auth, request shape, response shape, status
   codes. Reference `packages/contracts` types by name; do not inline JSON schemas.
5. **Permissions matrix** — rows = roles, columns = operations, cells = allow/deny + condition.
   Every deny becomes a test.
6. **Error cases** — machine-readable code, HTTP status, when it fires, what the UI shows.
7. **Acceptance criteria** — numbered Given/When/Then. **Each one must be testable as written.**
   This list is the test plan; `02-tdd-red.md` consumes it directly.
8. **Data** — new/changed Prisma models, indexes, migration notes.
9. **Out of scope** — what a reader might reasonably assume is included but is not.
10. **Open questions** — anything needing a human decision, in the `ESCALATION` shape from
    `policies/escalation.md`.

## Self-check before handing off
- [ ] Every acceptance criterion is testable without inventing missing detail
- [ ] Every permission deny has a criterion
- [ ] Every error code has a criterion
- [ ] Concurrency addressed if two actors can act at once (auctions, emergency, quote accept)
- [ ] Money paths state who is charged, how much, when captured, when released
- [ ] i18n: no UI copy hardcoded in the spec without an ES and EN key
- [ ] Nothing here requires `[H]` work from you
