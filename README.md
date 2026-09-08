# marketplace

Marketplace for reformas, mantenimiento and urgencias — Spain first, EUR. A Fastify + Prisma API and
a separate Vite/React SPA in one pnpm workspace, joined only by `packages/contracts`.

The plan lives in [`TODO.md`](TODO.md). Most of the code is written by agents; how they are expected
to work is [`agents/AGENTS.md`](agents/AGENTS.md), and it is worth reading before the code.

## Getting started

```bash
pnpm install
```

That is the whole setup. It links every workspace member and builds `@marketplace/config`, which the
lint and test configs import at load time.

```bash
pnpm verify   # typecheck · lint · format:check · test · build — the local gate
pnpm test     # vitest across the workspace
pnpm format   # prettier --write
```

Requires Node ≥ 22.11 (`.nvmrc` pins 22.22.0) and pnpm ≥ 10.13.

> TypeScript is pinned to `~5.9.3` on purpose. TS 7 breaks `typescript-eslint` and declaration
> emit — see `memory/repo/gotchas.md` MEM-2026-09-08-01 for the condition to unpin.

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API. Skeleton — `W0-T03` brings the server, `W0-T05` Prisma. |
| `apps/web` | Vite + React SPA. Skeleton — `W0-T04` brings router, layout, i18n. |
| `packages/config` | The one place TypeScript, ESLint, Prettier and Vitest are configured. |
| `agents/` | Charters, prompt templates and policies for the agents building this. |
| `memory/` | What agents know across sessions. |
| `docs/adr`, `docs/specs` | Decisions, and one spec + run record per feature. |

## Adding a workspace package

`apps/*` and `packages/*` are picked up automatically. A new member needs four things, and
`tests/workspace.test.ts` fails the build if it is missing any of them:

1. `package.json` named `@marketplace/<dir>`, with `@marketplace/config` as a dev dependency.
2. `tsconfig.json` extending `@marketplace/config/tsconfig/node.json` or `/react.json` — and
   **not** re-declaring `strict`, `target`, `module` or `moduleResolution`.
3. `eslint.config.js` exporting `createEslintConfig()`.
4. `vitest.config.ts` exporting `defineWorkspaceConfig()`.

Copy `apps/api` — it is the smallest complete example.
