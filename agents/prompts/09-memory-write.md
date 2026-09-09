# Prompt 09 — write memory

**When**: continuously into the session file; at task end, promote what outlives the task.
**Policy**: `agents/policies/memory.md`.

---

## During the task — session file
`memory/sessions/<YYYY-MM-DD>-<agent>-<TASK-ID>.md`. Append as you learn. Assume you get cut off
mid-sentence: the file must let a fresh agent in a new session resume without redoing work.

Log a line whenever you: choose between options, hit a dead end, discover something surprising
about the codebase, get blocked, or receive human input.

## At task end — promote

Ask of each thing you learned: **would this have saved me time if I'd known it at the start, on a
different task?**

| Answer | Where it goes |
|---|---|
| Yes, and it affects everyone | `memory/repo/{decisions,conventions,gotchas,glossary}.md` |
| Yes, but only my slice | `memory/slices/<you>.md` |
| No — task-specific | leave it in the session file; it archives |

Entry format:
```markdown
### <short title>
- **id**: MEM-<date>-<n>
- **scope**: repo | slice:S9 | flow:auctions
- **fact**:
- **why**:
- **apply**:
- **evidence**: <PR / file:line / ADR / intervention id>
- **status**: active
```

Then add a one-line pointer in `memory/LONG_TERM.md`. Never put content in the index.

## Rules
- One fact per entry. A diary is not memory.
- Don't duplicate what the repo already states — link to the ADR, spec or code instead.
- Superseding an entry: set the old one to `superseded-by`, don't delete it.
- **Never** write secrets, tokens, personal data or customer content. Memory is committed.
- Close the session file with `## Handoff` and `status: closed`; move it to `sessions/ARCHIVE/`
  after merge.
