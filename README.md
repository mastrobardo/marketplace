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

## Running the API

```bash
DATABASE_URL=postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace \
  pnpm --filter @marketplace/api dev
```

`DATABASE_URL` is the only required variable, and the process **refuses to start** without it —
exit code 78 (`EX_CONFIG`) and a message naming every variable that is wrong, not just the first.
Nothing connects to the database yet (`W0-T05`); the variable is required from the first commit so
that the day a module needs one is not also the day the deployment discovers it has none.

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | — | **required** |
| `HOST` | `127.0.0.1` | |
| `PORT` | `3000` | |
| `LOG_LEVEL` | `info` | `fatal`…`trace`, `silent` |
| `NODE_ENV` | `development` | `development` · `test` · `production` |
| `APP_VERSION` | `0.0.0-dev` | set by the deploy pipeline; surfaced by `/health` |

Every variable lives in `EnvSchema` in `apps/api/src/config.ts` or it does not exist. Reaching for
`process.env` inside a module is a review failure. (`.env.example` itself is `W0-T09`.)

`GET /health` answers from process state alone and opens no connection. Every response carries an
`x-request-id`, and every error — including 404 — arrives in one shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "…", "requestId": "…", "details": {} } }
```

`code` is the only field a client may branch on. Throw `new AppError('FORBIDDEN', '…')` from a
route rather than building a reply by hand. The registry is
`apps/api/src/lib/errors.ts` — **a pre-freeze proposal**; `W1-T01` (`agent-contracts`) moves it
into `packages/contracts` and owns it from then on.

> TypeScript is pinned to `~5.9.3` on purpose. TS 7 breaks `typescript-eslint` and declaration
> emit — see `memory/repo/gotchas.md` MEM-2026-09-08-01 for the condition to unpin.

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API — health, config, error envelope, request-id, logging. `W0-T05` brings Prisma. |
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
