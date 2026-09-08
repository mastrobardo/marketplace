---
task:    planning / bootstrap
agent:   human + assistant (planning session)
session: 2026-09-07 → 2026-09-08
status:  closed
---

# Session — project bootstrap and planning

## Goal
Turn "a Sharetribe-like marketplace for reformations, maintenance and emergency call-outs, built
mainly by AI agents" into a plan, an agent operating model, and a populated board.

## What exists now
- **Repo**: https://github.com/mastrobardo/marketplace — `main`, 6 commits, working tree clean.
  Personal identity only (`mastrobardo@gmail.com`), enforced by `.githooks/pre-commit`.
- **`TODO.md`** — the plan: decisions, architecture, domain model, slice ownership, agent pipeline,
  ~90 tasks (W0–W10), milestones M0–M9, testing strategy, risks R1–R15, business decisions §10.1.
- **`agents/`** — AGENTS.md, 5 policies, 10 prompt templates, 13 role charters. `.claude/agents/` is
  generated from `agents/roles/` by `scripts/generate-claude-agents.ts`.
- **`memory/`** — long-term repo memory, per-slice files, this session directory.
- **`docs/adr/`** — ADR-006 hosting/environments, ADR-007 feature flags.
- **`docs/board/`** — IDENTITY.md, AGENT-CREDENTIALS.md, stories.ts (content for all 135 issues).
- **Board** — 135 issues + 13 epics on GitHub, all linked as native sub-issues, written as user
  stories. `scripts/seed-board.ts` creates them; `scripts/update-issues.ts` rewrites them.

## Decisions locked
Fastify + Prisma + Postgres API · separate Vite/React SPA · Sharetribe as design reference only ·
Spain first, EUR · Stripe Connect · Neon + Fly + Cloudflare + Sentry · Flagsmith behind OpenFeature ·
GitHub + GitHub Actions · strict spec → contract → TDD → review pipeline.

**M0 = four services only**: Fly, Neon, Cloudflare, Sentry. Everything else is `phase:when-needed`.

## Blocked on the human
1. **7 setup tickets**: #7 Neon, #8 Fly, #9 Cloudflare, #11 Sentry, #4 environments,
   #3 branch protection, #5 project board (`gh auth refresh -s project` first).
2. **14 business decisions** (`label:decision:business`). `BD-01` — do we hold client funds until
   completion? — unblocks the most and drives the legal position.

## Next action for a fresh session
Nothing is half-finished. The next piece of work is `W0-T01` (monorepo skeleton) → `W0-T07`
(preview environments), owned by `agent-devops`, but it stalls at deploy time until the four
accounts above exist. Building `W0-T01`–`W0-T06` locally does not need any of them.

## Do not redo
- The board: it is populated and rewritten once already. Use `scripts/update-issues.ts`, do not
  create issues by hand.
- The identity setup: HTTPS remote is deliberate — the SSH key on this machine is the work account.
