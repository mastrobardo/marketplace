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

## The local stack

Postgres + PostGIS, a mail catcher and S3-compatible object storage, all on localhost, all free,
all offline. Nothing here talks to Neon, Cloudflare or a mail provider — those are `W0-T07`.

```bash
pnpm stack:up      # start, wait until healthy, provision the uploads bucket
pnpm stack:down    # stop, keeping data
pnpm stack:reset   # stop and destroy the volumes
pnpm stack:logs    # follow
```

| Service | Default host port | Credentials | Notes |
|---|---|---|---|
| Postgres 17 + PostGIS 3.5 | `127.0.0.1:5432` | `marketplace` / `marketplace_local`, database `marketplace` | `postgis` and `postgis_topology` enabled at init |
| Mail catcher (Mailpit) | SMTP `1025`, UI/API `8025` | none | http://127.0.0.1:8025 — no relay, so nothing can reach a real inbox |
| Object storage (MinIO) | S3 `9000`, console `9001` | `marketplace` / `marketplace_local` | bucket `marketplace-uploads`, private |

Every port is bound to the loopback interface, so the stack is never reachable from the network.

**Already running a Postgres on 5432?** Every host port is overridable. Put the override in a
local `.env` (gitignored) and nothing else changes — the services still reach each other by
container name:

```bash
echo 'POSTGRES_PORT=5433' >> .env
```

`POSTGRES_PORT`, `MAIL_SMTP_PORT`, `MAIL_HTTP_PORT`, `OBJECTS_PORT` and `OBJECTS_CONSOLE_PORT` all
work the same way.

The stack's own tests live in `tests/local-stack.test.ts`. They are static by default — they read
`docker-compose.yml` and need no Docker daemon. To also run the twelve criteria that require a
running stack:

```bash
pnpm stack:up && STACK_LIVE=1 pnpm vitest run tests/local-stack.test.ts
```

> TypeScript is pinned to `~5.9.3` on purpose. TS 7 breaks `typescript-eslint` and declaration
> emit — see `memory/repo/gotchas.md` MEM-2026-09-08-01 for the condition to unpin.

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API. Skeleton — `W0-T03` brings the server, `W0-T05` Prisma. |
| `docker-compose.yml`, `docker/` | The local stack: Postgres + PostGIS, mail catcher, object storage. |
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
