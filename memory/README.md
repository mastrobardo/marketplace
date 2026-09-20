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

## Checking the format

`pnpm memory:check` reads every entry in `repo/` and `slices/` and reports missing fields, a
malformed id, or two entries sharing an id **in the same file**. The same id in two files is left
alone: that is almost always a slice fact promoted into `repo/` keeping its id, which is the trail
the doctrine asks for.

**It is advisory, and deliberately not a gate.** It is not in CI, not in `pnpm gates` and not in
`pnpm verify`; it exits 0 unless you pass `--strict`. Operator, 2026-09-20: *"better to have a
format, but should not be a blocker. And ABSOLUTELY not a CI gate."* The reasoning, and why this
does not contradict `MEM-2026-09-11-04`, is in the header of `scripts/memory/check.ts` and in
`MEM-2026-09-20-28`.

Run it when you have just written memory, or when something reads oddly. Not otherwise.
