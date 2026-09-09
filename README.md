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
## Running the API

```bash
DATABASE_URL=postgres://marketplace:marketplace_local@127.0.0.1:5432/marketplace \
  pnpm --filter @marketplace/api dev
```

`DATABASE_URL` is the only required variable, and the process **refuses to start** without it —
exit code 78 (`EX_CONFIG`) and a message naming every variable that is wrong, not just the first.
Booting still opens no connection: `buildApp` does not import the database module, and Prisma
connects lazily on the first query.

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
## The database

Prisma, against the local stack's Postgres. `pnpm install` generates the client, so nothing extra
is needed before `pnpm typecheck`.

```bash
pnpm stack:up
pnpm db:migrate:deploy   # apply pending migrations — what CI and every deploy run
pnpm db:seed             # run every seeder that has not run
pnpm db:reset            # drop, re-migrate, re-seed (refuses when NODE_ENV=production)
```

| Command | |
|---|---|
| `pnpm db:generate` | regenerate the client; needs no database |
| `pnpm db:migrate` | dev loop: diff the schema, write a migration, apply it |
| `pnpm db:migrate:deploy` | apply pending migrations only |
| `pnpm db:migrate:status` | non-zero when the database is behind or failed |
| `pnpm db:seed` | run pending seeders |
| `pnpm db:reset` | drop, re-migrate, re-seed |

`pnpm verify` deliberately calls **none** of them — the local gate stays daemon-free. The tests
that need a real database are skipped unless you opt in, exactly like the stack tests:

```bash
pnpm stack:up && STACK_LIVE=1 pnpm --filter @marketplace/api exec vitest run tests/db.test.ts
```

### Migrations

`apps/api/prisma/schema.prisma` is **the shared seam**: `agent-contracts` owns the models and adds
the first of them in `W1-T05`. Today it holds one infrastructure table and no business meaning.

Every migration folder carries a **`down.sql` as well as `migration.sql`** — Prisma generates no
down migrations, so the rollback is hand-written and a test fails when one is missing. A rollback
that genuinely cannot restore state says so in a comment; it is never simply absent.

Migration `0000_require_postgis` creates nothing. It **asserts** PostGIS is installed and fails the
deploy if it is not — `CREATE EXTENSION` needs rights the application role has in no environment,
so the extension is installed by `docker/postgres/init` locally and by Neon everywhere else. That
turns "somebody enabled PostGIS once" into a precondition every environment re-proves.

Migrations never run on boot. `db:migrate:deploy` is a separate, explicit step, which is what lets
a production release be approved and observed rather than implicit (ADR-006).

### Seeding

A seeder runs **at most once per database, ever**. `_seed_run` records which have run, and the
seeder's work and its ledger row are written in one transaction — so a seeder that throws leaves
neither data nor a record claiming it ran, and re-running repairs it.

Add one to `apps/api/prisma/seed/registry.ts`:

```ts
export const seeders: readonly Seeder[] = [
  {
    id: 'categories.base',       // permanent — renaming it re-runs the seeder everywhere
    description: 'The category tree from TODO.md §3',
    localOnly: false,            // true keeps it off any non-loopback database (W0-T20)
    run: async ({ db }) => { await db.category.createMany({ data: [/* … */] }); },
  },
];
```

Because the ledger decides whether a seeder runs, a seeder may `create` rather than contorting
itself into an `upsert` on a natural key it may not have.

## Running the web app

```bash
pnpm --filter @marketplace/web dev        # http://127.0.0.1:5173
```

### Strings

Spanish is the **source of truth**. Add a key to `src/i18n/locales/es.ts`; `en.ts` then fails to
compile until it is translated, and `t('typo.here')` fails to compile anywhere. That is what
"no hardcoded strings" (`TODO.md` §5.3) is enforced by — not review.

Keys are flat and dotted (`nav.home` is one key, not `home` under `nav`), which is why
`keySeparator` and `nsSeparator` are `false` in `src/i18n/index.ts`. **Do not remove them**: at
i18next's defaults every lookup would miss and render the raw key to the user.

The enforcement itself is tested. `apps/web/tests/fixtures/` holds three tiny TypeScript projects —
one that must compile and two that must not — and `tests/i18n.test.ts` asserts `tsc`'s exit code
for each.

### Colour and spacing

Every design value is a `--mp-`-namespaced custom property in `src/styles/tokens.css`. A colour
literal anywhere else fails the build, and so does a light-theme colour with no dark counterpart.
`agent-ui` owns that file and builds `packages/ui` on top of it.

### Adding a page

Add a route as a **child** of the layout route in `src/app/routes.tsx` so it inherits the shell.
Your page owns its own single `<h1>`; the layout has none.

> TypeScript is pinned to `~5.9.3` on purpose. TS 7 breaks `typescript-eslint` and declaration
> emit — see `memory/repo/gotchas.md` MEM-2026-09-08-01 for the condition to unpin.

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API — health, config, error envelope, request-id, logging, Prisma. |
| `apps/web` | Vite + React SPA — router, layout shell, ES/EN i18n, theme tokens. |
| `packages/config` | The one place TypeScript, ESLint, Prettier and Vitest are configured. |
| `docker-compose.yml`, `docker/` | The local stack: Postgres + PostGIS, mail catcher, object storage. |
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
