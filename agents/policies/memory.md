# Policy — memory

Two layers with different lifetimes. Confusing them is the failure mode: session noise pollutes
long-term memory, or hard-won knowledge dies when a session ends.

## Layout

```
memory/
├─ LONG_TERM.md          # index — the entrypoint every agent loads
├─ repo/
│  ├─ decisions.md       # non-obvious constraints + pointers to ADRs
│  ├─ conventions.md     # how we do things here, beyond what lint enforces
│  ├─ gotchas.md         # traps found the hard way (each with the evidence)
│  └─ glossary.md        # ES/EN domain terms — manitas, presupuesto, colegio, autónomo
├─ slices/<agent>.md     # durable knowledge owned by one agent
└─ sessions/
   ├─ <YYYY-MM-DD>-<agent>-<TASK-ID>.md
   └─ ARCHIVE/           # closed sessions, moved here after merge
```

## Long-term memory

**Committed. Reviewed in PRs. Written for an agent who has never seen this repo.**

Entry format — one fact per entry, never a diary:

```markdown
### <short title>
- **id**: MEM-2026-09-14-01
- **scope**: repo | slice:S9 | flow:auctions
- **fact**: <the durable thing that is true>
- **why**: <why it is true / what forced it>
- **apply**: <what a future agent should do differently because of it>
- **evidence**: <PR, file:line, ADR, intervention id>
- **status**: active | superseded-by MEM-…
```

Rules:
- **Write it only if it survives this task.** Anything task-scoped belongs in the session file.
- **Don't record what the repo already says.** Code structure, git history, anything in `TODO.md`
  or an ADR — link to it instead of copying it.
- **Supersede, don't delete.** Mark `status: superseded-by` so the reasoning trail survives.
- **Verify before trusting.** Memory records what was true when written. If an entry names a file,
  function or flag, check it still exists before acting on it.
- Only the owning agent writes `slices/<agent>.md`. `memory/repo/**` is open to all, via PR.

## Session memory

**One file per (agent, task, session). Assume you will be cut off mid-task.**

```markdown
---
task:    W6-T03
agent:   agent-auctions
session: 2026-09-14T09:12Z
status:  open | handed-off | closed
---
## Goal
## Current state
<what exists right now, what passes, what doesn't>
## Log
- 09:20 chose X over Y because …
- 09:48 dead end: Z fails under concurrency — don't retry it
## Open questions
## Handoff
<the exact next action a fresh agent should take, and what NOT to redo>
```

Rules:
- Append as you go, not at the end. A file written only at the end is useless when you're cut off.
- **Before starting any task, check `memory/sessions/` for an open file with your task ID.** If one
  exists, continue it — do not start over.
- Close with a `## Handoff` block and `status: closed`, then promote durable learnings.
- After the PR merges, move the file to `sessions/ARCHIVE/`.
- Session files are committed with the branch. They are evidence, like the run record.

## Promotion — the only path from session to long-term

At the end of a task ask: *would this have saved me time if I'd known it at the start, on a
different task?* If yes, promote it into `memory/repo/` or `memory/slices/<you>.md` using
`prompts/09-memory-write.md`. If no, leave it in the session file and let it archive.

Promotion happens **in the same PR** as the work. A separate "memory PR" never gets written.

## Hygiene

- Never write secrets, tokens, credentials, personal data or customer content into memory.
- Keep `LONG_TERM.md` an index of one-line pointers, never a dumping ground.
- `agent-qa` prunes quarterly: mark stale entries superseded, archive dead sessions.
