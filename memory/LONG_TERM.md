# Long-term memory — index

One line per entry. **Pointers only — never content.** Content lives in `repo/` and `slices/`.

Read this first, every task. Then your slice file. Then check `sessions/` for an open file with
your task ID.

## Repo-wide
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
