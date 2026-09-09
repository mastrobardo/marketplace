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
| Yes, and it affects everyone | `memory/repo/{decisions,conventions,gotchas}/MEM-….md` |
| Yes, but only my slice | `memory/slices/<you>/MEM-….md` |
| A domain term | a row in `memory/repo/glossary.md` |
| No — task-specific | leave it in the session file; it archives |

**One record per file.** Copy `memory/_RECORD_TEMPLATE.md` and name the file for its id — that is
what lets you and twelve other agents each write a record today without anyone waiting on a merge.

```markdown
---
id: MEM-<date>-<nn>
kind: gotcha | convention | decision | slice
scope: repo | slice:S9 | flow:auctions
status: active
evidence: <PR / file:line / ADR / intervention id — one line, never empty>
---

# <short title — the claim, not the topic>

**Fact.** …

**Why.** …

**Apply.** …
```

Pick an id nobody has used — ids are **global**, so check `memory/LONG_TERM.md` before claiming one.
Then run `pnpm memory:render` to update the index. **Never edit the index by hand**: it is generated
from the records, and CI fails when it is stale.

## Rules
- One fact per record, one record per file. A diary is not memory.
- Don't duplicate what the repo already states — link to the ADR, spec or code instead.
- Superseding a record: set the old one's `status` to `superseded-by MEM-…`, don't delete the file.
- **Never** write secrets, tokens, personal data or customer content. Memory is committed.
- Close the session file with `## Handoff` and `status: closed`; move it to `sessions/ARCHIVE/`
  after merge.
