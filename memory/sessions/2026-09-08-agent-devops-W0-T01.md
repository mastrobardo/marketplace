---
task: W0-T01
agent: agent-devops
session: 2026-09-08
status: open
---

# Session — W0-T01 monorepo skeleton

## Goal

First code in the repo. pnpm workspace + `packages/config` (shared tsconfig/eslint/prettier/vitest,
built with tsup) + thin `apps/api` / `apps/web` members so workspace resolution is testable.

## Starting state

Repo was docs-only: no `package.json` anywhere, `main` at fcb4cf6. Branch
`W0-T01-monorepo-skeleton`. Node v22.22.0, pnpm 10.13.1 on this machine.

## Operator decisions taken at plan time (2026-09-08)

- Turborepo **in**, minimal task graph. Already implied by the charter's `owns:` and `.gitignore`.
- `apps/*` stubs land in this task, not T03/T04 — acceptance criterion 3 needs a member under
  `apps/`. Nothing under `src/modules/**` or `src/features/**`.

## Log
- Red phase: 22 assertions from the spec's acceptance criteria. First run was 19F/3P — the 3 passes
  were vacuous loops over an empty `workspaceDirs()`. Added non-empty guards; 22/22 red.
- TS 7.0.2 is what the registry serves as `latest`. `typescript-eslint` refuses to load under it and
  `rollup-plugin-dts` crashes. Pinned `~5.9.3` everywhere → `memory/repo/gotchas.md` MEM-2026-09-08-01.
- With TS 5.9, `tsup dts: true` works, so the interim `tsconfig.build.json` + `tsc --emitDeclarationOnly`
  was reverted. One tool.
- `pnpm format` over the whole repo rewrote 71 markdown files including generated `.claude/agents/**`.
  Reverted, `**/*.md` prettier-ignored → slice memory MEM-2026-09-08-04.
- `pnpm verify` (typecheck · lint · format:check · test · build) exits 0 from a clean `node_modules`.

## Handoff
`W0-T01` is complete and green; the PR is open and **not merged** (L6 — needs a cross-review by
`agent-contracts` or `agent-qa`).

**What the next agent inherits**
- `pnpm install` alone bootstraps everything. `pnpm verify` is the whole local gate.
- Extend `@marketplace/config/tsconfig/{base,node,react}.json`; call `createEslintConfig()` and
  `defineWorkspaceConfig()`. Do not copy base compiler options — `tests/workspace.test.ts` fails you.
- `apps/api/src/index.ts` and `apps/web/src/index.ts` are placeholders with a comment naming the
  task that replaces them (`W0-T03`, `W0-T04`). Delete them, don't build around them.
- `packages/contracts`, `packages/ui`, `packages/testing` do not exist yet — deliberately, they
  belong to other slices. The workspace globs already cover them.

**Next**: `W0-T02` (docker-compose) and `W0-T03` (Fastify skeleton) are unblocked and independent.
`W0-T06` (CI) should follow soon — nothing here is enforced by CI yet, only by `pnpm verify` locally.

**Open, not blocking**: the ESLint preset is syntactic only (no `projectService`), so type-aware
rules like `no-floating-promises` are absent. Worth a follow-up before S9 money lands.
