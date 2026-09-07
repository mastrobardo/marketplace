# `agents/` — system-wide agent configuration

Single source of truth for how AI agents work in this repo. Nothing here is decorative:
`AGENTS.md` is loaded by every agent on every task, and `.claude/agents/` is **generated** from
`roles/` — never hand-edited.

```
agents/
├─ AGENTS.md      # loaded first, always. The law.
├─ roles/         # one charter per agent (frontmatter + body). Source for .claude/agents/
├─ prompts/       # one template per pipeline step (00 → 09)
└─ policies/      # contract-change, escalation, human boundaries, review/merge, memory
```

Related, outside this folder:
- `memory/` — long-term repo memory + per-session memory (see `policies/memory.md`)
- `docs/specs/` — spec + run record, carried on the feature branch
- `docs/interventions/` — human intervention ledger
- `docs/adr/` — architecture decisions

## Regenerating Claude Code subagents
```bash
pnpm tsx scripts/generate-claude-agents.ts        # writes .claude/agents/*.md
pnpm tsx scripts/generate-claude-agents.ts --check # CI: fails on drift
```

## Changing anything here
A prompt or charter change is a PR like any other. Justify it with evidence from
`docs/interventions/ROLLUP.md` where possible — that ledger exists to tell us which prompts are
weak. Bump `revision:` in the file's frontmatter so run records pin what they were built with.
