# `memory/` — what agents know

Agents run in **different sessions**, often in parallel, often days apart. This folder is how
knowledge survives that. Contract: `agents/policies/memory.md`. Writing guide:
`agents/prompts/09-memory-write.md`.

| Layer | Path | Lifetime | Writer |
|---|---|---|---|
| Index | `LONG_TERM.md` | forever | anyone (one-line pointers only) |
| Repo-wide | `repo/*.md` | forever | anyone, via PR |
| Per-slice | `slices/<agent>.md` | forever | only the owning agent |
| Per-session | `sessions/<date>-<agent>-<TASK-ID>.md` | one task, then archived | that session's agent |

**Every agent reads** `LONG_TERM.md` + its own slice file + any open session file for its task ID,
before doing anything. **Every agent writes** its session file as it works, and promotes durable
learnings before the PR merges.

Never commit secrets, tokens, personal data or customer content here.
