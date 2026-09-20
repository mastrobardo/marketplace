# Long-term memory — index

One line per entry. **Pointers only — never content.** Content lives in `repo/` and `slices/`.

Read this first, every task. Then your slice file. Then check `sessions/` for an open file with
your task ID.

## Repo-wide
- **The product's shape, decided 2026-09-20**: [ADR-013](../docs/adr/ADR-013-engagement-reconciliation.md)
  (an engagement has three sources of truth; the handshake attests the start) ·
  [ADR-014](../docs/adr/ADR-014-who-pays.md) (the demand side pays; the queue is never for sale) ·
  [ADR-015](../docs/adr/ADR-015-reputation.md) (satisfaction and per-trade competence, allowed to
  disagree). Read these before touching `W4`, `W5`, `W6`, `W8` or `W13` — they rewrote several
  backlog rows out from under their own descriptions.
- [Decisions](repo/decisions.md) — non-obvious constraints and why they exist
- [Conventions](repo/conventions.md) — how we do things beyond what lint enforces
- [Gotchas](repo/gotchas.md) — traps found the hard way, with evidence
- [Glossary](repo/glossary.md) — ES/EN domain vocabulary; use these words in code

## Per-slice
- `slices/agent-<name>.md` — one per agent in `agents/roles/`

## Rules
- One fact per entry, with `why` and `apply`. A diary is not memory.
- Don't record what the repo already states — link to the ADR, spec or code.
- Supersede, never delete: `status: superseded-by MEM-…`.
- **Verify before trusting.** An entry records what was true when written; if it names a file,
  function or flag, check it still exists.
