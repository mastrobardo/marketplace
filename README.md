# marketplace

Marketplace for reformas, mantenimiento and urgencias — Spain first, EUR. A Fastify + Prisma API and
a separate Vite/React SPA in one pnpm workspace, joined only by `packages/contracts`.

The plan lives in [`TODO.md`](TODO.md). Most of the code is written by agents; how they are expected
to work is [`agents/AGENTS.md`](agents/AGENTS.md), and it is worth reading before the code.

## Getting started

```bash
pnpm install
```

That is the whole setup. It links every workspace member, builds `@marketplace/config` — which the
lint and test configs import at load time — and generates the Prisma client.

```bash
cp .env.example .env
```

Optional: every variable in it already carries the default the code uses, and the connection string
already matches the local stack. Edit it when a port on your machine is taken.

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
`process.env` inside a module is a review failure.

Every one of them is in [`.env.example`](.env.example), alongside the local stack's port
overrides — `cp .env.example .env` and the API boots against `pnpm stack:up` unedited.
`tests/env-example.test.ts` fails the build if that file drifts from `EnvSchema` or from the
variables `docker-compose.yml` reads, so the example cannot quietly go stale. Deploy credentials
are **not** in it: they are GitHub Environment secrets, and listing them there would suggest
otherwise — see *What a human has to set*.

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

Every design value is a `--mp-`-namespaced custom property, and they live in `packages/ui` in three
layers (ADR-012 §3). `@marketplace/ui/tokens.css` is the one import a consumer needs; it pulls in:

| Layer | File | What it holds | What may read it |
|---|---|---|---|
| primitive | `styles/scale.css` | the 4px scale, radii, type sizes, border and ring widths | anything |
| primitive | `styles/themes/*.css` | the `--mp-palette-*` ramp | **that theme file only** |
| semantic | `styles/themes/*.css` | the roles over it — `--mp-color-accent`, `--mp-font-family` | anything |
| component | `styles/components.css` | the uses — `--mp-button-bg` | that component |

Two themes ship: `default` and `contrast`. A theme is one file — a ramp, the mapping over it, a font
pairing, and any radius or density override — selected with `[data-theme]` on the root or on any
container. Light and dark are the other axis: `color-scheme` plus `light-dark()`, so each colour is
written once with both values in it, `prefers-color-scheme` is the default, and `[data-scheme]`
overrides it either way.

`packages/ui/tests/tokens.test.ts` resolves the whole graph for all four `theme × scheme`
combinations and fails the build on a colour literal outside a theme file, a component reaching for
a palette value, a `var()` that names nothing, a role one theme has and the other does not, or a
text pair that misses WCAG AA. `Foundations/Themes` in the workbench renders all four at once, and
its `play` function asks a real browser whether anything actually changed.

### Adding a page

Add a route as a **child** of the layout route in `src/app/routes.tsx` so it inherits the shell.
Your page owns its own single `<h1>`; the layout has none.

> TypeScript is pinned to `~5.9.3` on purpose. TS 7 breaks `typescript-eslint` and declaration
> emit — see `memory/repo/gotchas.md` MEM-2026-09-08-01 for the condition to unpin.

## CI

Every pull request runs ten checks. They are separate jobs on purpose: a red PR should say *which*
class of thing broke without anyone opening a log.

| Check | Runs | |
|---|---|---|
| `typecheck` | `pnpm typecheck` | |
| `lint` | `pnpm lint` + `pnpm format:check` | |
| `unit` | `pnpm test` | the daemon-free suite |
| `build` | `pnpm build` | |
| `database` | `pnpm stack:up`, migrations, then every `STACK_LIVE=1` suite | the only job needing Docker |
| `workflows` | `actionlint` | CI that cannot lint itself is CI nobody can change safely |
| `spec-present` | the branch changes its spec **and** its run record | skips a branch with no task ID |
| `intervention-logged` | an `intervention:*` label needs an entry in `docs/interventions/` | `TODO.md` §5.6 |
| `author-identity` | every commit author *and* committer is the personal address | `docs/board/IDENTITY.md` |
| `agents-drift` | `.claude/agents/` still matches `agents/roles/` | generated files, never hand-edited |

The last four are `W0-T12`. Each had been described as enforced — in `AGENTS.md`, `TODO.md` §5.5
and `IDENTITY.md` — for as long as it did not exist, which is the worst state for a gate to be in:
reviewers stop checking a thing themselves precisely because CI is believed to be checking it.

None of them carries an `if:`. A conditional job reports "skipped", and GitHub counts a skipped
required check as satisfied, so a gate that can vanish is not a gate. On a push to `main` they run
and report "not a pull request" instead of disappearing.

### One job that is not a gate

| Job | Runs | |
|---|---|---|
| `perf` | Lighthouse over the home and results pages | **never a required check** |

`W12-T15`. It writes a route × metric table into the run recap, and uploads a filmstrip as the
`perf-screenshots` artifact when a route falls below a floor. It **reports**: performance is not a
merge gate in the MVP phase, and the script exits 0 on a shortfall by construction rather than by
`continue-on-error`, so the job passes honestly rather than by masking a failure.

**It must never be added to branch protection.** Doing so would turn a reported number into a merge
gate through a repository setting rather than a reviewed change — and no code in this repo can
prevent that, which is why it is written here as well as in the workflow.

**These ten names are the contract.** `W0-T13` requires them in branch protection, GitHub matches
required checks *by name*, and a check that simply never arrives is reported as nothing at all —
so renaming a job silently unblocks merges. Rename one, update branch protection in the same change.

Each gate runs the same `pnpm` script you run locally. A CI-only variant command is how "green on
my laptop" and "green in CI" become two different things to satisfy, and then two things to debug.

The `database` job brings up **this repo's own `docker-compose.yml`** rather than a bespoke service
container, so there is one Postgres definition to keep in step and the compose file is exercised on
every PR. It is also the only place the `STACK_LIVE=1` criteria from `W0-T02` and `W0-T05` actually
run — without it they are skipped everywhere and the suite measures less than it claims.

Superseded PR runs are cancelled; runs on `main` are not, because a cancelled `main` build leaves
`main` unverified. Nothing in the workflow reads a secret, and its token is `contents: read`.

## Deployment

Four workflows, and **none of them has ever run.** Every credential they need is a human task and
none exists yet — see the table below. Until `W0-T24` is closed, this pipeline is code, not
capability, and every deploy job reports what is missing and skips.

| Workflow | Fires | Does |
|---|---|---|
| `deploy-preview.yml` | PR opened / pushed to / reopened | Fly app + Neon branch + Cloudflare Pages preview for that PR, URLs commented on it |
| `deploy-preview-teardown.yml` | PR closed (merged **or** abandoned) | destroys all three |
| `deploy-staging.yml` | push to `main` | builds the image **once**, tags it with the commit SHA, migrates, deploys staging |
| `release-production.yml` | a `v*` tag | promotes that exact image to production, behind an approval |

Three properties are load-bearing and expensive to retrofit, so they are enforced by tests:

- **Production has no build step.** It deploys the image staging already pushed for that commit, so
  "it worked on staging" is a claim about the same bytes (ADR-006). A tag on a commit `main` never
  saw, or one staging never built, fails before anything is touched.
- **Migrations are their own step, before the deploy, never on start-up.** A bad migration should
  be a failed step somebody can see, not a service that will not boot.
- **No `pull_request_target`.** It runs the base branch's workflow with full secrets against
  untrusted code, and it is the only way to deploy a fork's PR. Fork PRs get no preview instead.

A deploy is never a required check. An unconfigured deploy must not block a merge.

### What a human has to set

Each secret goes in **Settings → Environments → *(environment)* → Add secret**. Agents write these
names; no agent may ever create, read or commit a value.

The same list is inventoried in [`.env.example`](.env.example), commented out and empty.
`tests/env-example.test.ts` cross-checks three places against each other — every
`${{ secrets.* }}` the workflows read, `REQUIRED` in `scripts/deploy/config.ts`, and that file —
and fails if any of them disagree, so a credential cannot be consumed without the guard checking
for it first.

| Environment | Secrets | Blocked on |
|---|---|---|
| `preview` | `FLY_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY`, `NEON_PROJECT_ID` | `OPS-07`, `OPS-08`, `OPS-09` |
| `staging` | `FLY_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `STAGING_DATABASE_URL` | `OPS-07`, `OPS-08`, `OPS-09` |
| `production` | `FLY_API_TOKEN`, `PRODUCTION_DATABASE_URL` | `OPS-07`, `OPS-08` |

`production` deliberately holds the shortest list: no Cloudflare or Neon API key, so a release
cannot create or destroy a database branch. Blast radius is a function of what the token can reach.

The `production` environment also needs a **required reviewer** and a branch/tag rule limiting it to
`v*`. That is a GitHub settings change, not a file in this repo — `W0-T24` again.

A preview's database URL is **not** in that table. It comes back from `neonctl` at deploy time, so
each pull request gets its own branch instead of every open PR sharing one static database.

### What a human has to provision

Secrets are not enough. These are the account-side preconditions `W0-T24` found by running the
pipeline until it stopped, each of which fails a deploy in a way no unit test can predict.

| What | Why | Where |
|---|---|---|
| **PostGIS on every Neon branch** | Migration `0000_require_postgis` asserts the extension and refuses to create a single table without it. It is a precondition the environment provides, never something a migration establishes — locally that is `docker/postgres/init`, on Neon it is one statement per project. A preview inherits it from `sanitised-staging`, so enabling it on the parent covers every PR. | `CREATE EXTENSION IF NOT EXISTS postgis;` on `sanitised-staging`, and on the staging and production databases |
| **A Fly *org* token** | A deploy token is scoped to one app that already exists. Previews create an app per pull request, which a deploy token cannot do — it fails with `unauthorized`. | `fly tokens create org <org>` |
| **No expiry on `sanitised-staging`** | Neon refuses to create a child branch of an expiring branch, so no PR can get a preview database. | `neonctl branches set-expiration sanitised-staging --project-id <id>` (omitting `--expires-at` clears it) |
| **A Cloudflare Pages project** | `wrangler pages deploy --project-name` does not create the project. | Cloudflare → Workers & Pages → Create → Pages, named `marketplace-web` |
| **A Cloudflare token with `Account · Cloudflare Pages · Edit`** | Without it every deploy fails `Authentication error [code: 10000]`. Add `User · User Details · Read` too — optional, but it is what makes wrangler's auth errors legible rather than ambiguous. Scope **Account Resources** to the account in `CLOUDFLARE_ACCOUNT_ID`: a token scoped elsewhere fails identically, and the message cannot tell you which of the two it was. | Cloudflare → Profile → API Tokens → Create Token → Custom token |

Order matters for the first one: a preview branch created *before* the parent had PostGIS does not
gain it retroactively. Delete the stale branch and let the next run recreate it.

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API — health, config, error envelope, request-id, logging, Prisma. |
| `apps/web` | Vite + React SPA — router, layout shell, ES/EN i18n, theme tokens. |
| `packages/contracts` | The shared seam — zod schemas and the types both apps build against. Only `agent-contracts` writes here. |
| `packages/config` | The one place TypeScript, ESLint, Prettier and Vitest are configured. |
| `docker-compose.yml`, `docker/` | The local stack: Postgres + PostGIS, mail catcher, object storage. |
| `.github/workflows` | The CI gates every pull request passes, and the deploy pipeline. |
| `infra/` | Fly app configuration and the API image definition. |
| `scripts/deploy` | The deploy guard — which credentials a target needs, and the names of its per-PR resources. |
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
