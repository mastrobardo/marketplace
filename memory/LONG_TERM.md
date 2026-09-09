# Long-term memory — index

One line per record. **Pointers only — never content.** Content lives in one file per record under
`repo/` and `slices/`, so writing a new record can never conflict with another agent writing one
(`W0-T23`). This index is **generated** from those files — do not hand-edit the block below.

Read this first, every task. Then `slices/<you>/`. Then check `sessions/` for an open file with
your task ID.

Also: [Glossary](repo/glossary.md) — ES/EN domain vocabulary; use these words in code. It is a
table of terms rather than a record per file, because a term is one line and coining one is rare.

<!-- BEGIN GENERATED — scripts/render-memory.ts. Do not hand-edit. -->

### Decisions — non-obvious constraints and why they exist

- [Sharetribe is a reference, not a dependency](repo/decisions/MEM-2026-09-07-01.md) — We do not use Sharetribe's backend and do not fork their web template.
- [Stack is Fastify + Prisma API with a separate Vite/React SPA](repo/decisions/MEM-2026-09-07-02.md) — No Next.js.
- [Money is integer cents, everywhere](repo/decisions/MEM-2026-09-07-03.md) — Amounts are `Int` cents plus a currency code, in the DB, the API and the UI state.
- [The deploy pipeline exists but has never run](repo/decisions/MEM-2026-09-09-21.md) — `.github/workflows/deploy-{preview,preview-teardown,staging}.yml` and `release-production.yml` are complete and merged, and **not one of them has ever executed**.

### Conventions — how we do things beyond what lint enforces

- [Branch, spec and run record travel together](repo/conventions/MEM-2026-09-07-04.md) — Branch `<TASK-ID>-<slug>` must contain `docs/specs/<slice>/<TASK-ID>-<slug>.md` and `<TASK-ID>-<slug>.run.md`.
- [The seam is written by one agent only](repo/conventions/MEM-2026-09-07-05.md) — `packages/contracts/**` and `schema.prisma` are edited only by `agent-contracts`.
- [Test data comes from `packages/testing`](repo/conventions/MEM-2026-09-07-06.md) — One deterministic seed and one set of shared factories.
- [Tooling config lives in `packages/config`, nowhere else](repo/conventions/MEM-2026-09-08-02.md) — TypeScript, ESLint, Prettier and Vitest are configured once in `@marketplace/config` and consumed by every workspace member through its `exports` map.
- [Every migration carries a hand-written `down.sql`](repo/conventions/MEM-2026-09-09-14.md) — Prisma generates no down migrations, so each folder in `apps/api/prisma/migrations/` holds `migration.sql` **and** `down.sql`, and `apps/api/tests/db.test.ts` fails when one is missing or empty.
- [A seeder runs at most once per database, and the ledger decides](repo/conventions/MEM-2026-09-09-15.md) — `pnpm db:seed` runs each entry of `apps/api/prisma/seed/registry.ts` whose `id` is not already in the `_seed_run` table.
- [The six CI check names are a contract with branch protection](repo/conventions/MEM-2026-09-09-17.md) — `.github/workflows/ci.yml` declares six jobs — `typecheck`, `lint`, `unit`, `build`, `database`, `workflows` — and no aggregate `ci` job.

### Gotchas — traps found the hard way, with evidence

- [Google Maps is for display, PostGIS is for geography](repo/gotchas/MEM-2026-09-07-07.md) — Radius and proximity queries run in PostGIS (`ST_DWithin` + GiST index).
- [Photos of homes carry GPS coordinates](repo/gotchas/MEM-2026-09-07-08.md) — Every uploaded image is EXIF-stripped before storage.
- [Stripe webhooks arrive late, twice, and out of order](repo/gotchas/MEM-2026-09-07-09.md) — Handlers must be idempotent and order-independent, keyed on a stable idempotency key, with a dead-letter path.
- [TypeScript is pinned to 5.9 — typescript-eslint cannot load under TS 7](repo/gotchas/MEM-2026-09-08-01.md) — `typescript` is pinned `~5.9.3` in every `package.json`.
- [The canonical PostGIS and MailHog images are amd64-only](repo/gotchas/MEM-2026-09-09-01.md) — `postgis/postgis` (all tags checked: `17-3.5`, `18-3.6`, and the `-alpine` variants) and `mailhog/mailhog:v1.0.1` publish `linux/amd64` only.
- [Vitest 5 ignores the trailing-number test timeout](repo/gotchas/MEM-2026-09-09-02.md) — `it('…', fn, 30_000)` is accepted and silently has no effect; the test still times out at the configured default and the failure still reports that default.
- [`app.register` encapsulates — a hook added inside one covers only that context](repo/gotchas/MEM-2026-09-09-05.md) — In Fastify, `register` creates a new encapsulation context.
- [A module-resolution failure is not a red phase](repo/gotchas/MEM-2026-09-09-06.md) — `Cannot find module '../src/app.js'` with `Tests no tests` means no assertion ran.
- [A `@ts-expect-error` comment is a directive even when the rest of it is prose](repo/gotchas/MEM-2026-09-09-09.md) — TypeScript treats any single-line comment **beginning** with the `@ts-expect-error` directive as a suppression, whatever follows it.
- [i18next's default separators break dotted keys](repo/gotchas/MEM-2026-09-09-10.md) — Our translation keys are flat and dotted (`nav.home` is one key).
- [Parallel branches collide on shared append-only files, not on the seam](repo/gotchas/MEM-2026-09-09-12.md) — Three branches from the same `main`, touching three different slices and sharing **no** source file, still conflicted three times — on `README.md`, `memory/repo/gotchas.md`, `memory/slices/agent-devops.md` and `pnpm-lock.yaml`.
- ["Keep both sides" is wrong whenever a hunk is a modification](repo/gotchas/MEM-2026-09-09-13.md) — Resolving the conflicts above with a keep-both script was right on five hunks and wrong on two.
- [`pnpm deploy --prod` discards the generated Prisma client](repo/gotchas/MEM-2026-09-09-22.md) — `pnpm deploy` rebuilds `node_modules` from the store, and the store holds the **published** `@prisma/client` — a shell whose real code `prisma generate` writes *into the installed package*.
- [A CI gate on a shallow clone reports green because it cannot see](repo/gotchas/MEM-2026-09-09-27.md) — `actions/checkout` defaults to `fetch-depth: 1`.
- [A vitest JSON report file can be stale, and a stale report is indistinguishable from no change](repo/gotchas/MEM-2026-09-09-28.md) — Re-reading `.vitest/json/output.json` after a second run returned byte-identical results — including assertions that had just been made to pass — so a fixed suite still read as 25 failures.

### Per-slice

- [`pnpm install` must be sufficient on its own](slices/agent-devops/MEM-2026-09-08-03.md) — The root `prepare` script runs `pnpm --filter @marketplace/config build`.
- [Prettier over this repo is destructive by default](slices/agent-devops/MEM-2026-09-08-04.md) — `**/*.md` is in `.prettierignore`.
- [`docker compose up --wait` fails on any container that exits, even at 0](slices/agent-devops/MEM-2026-09-09-03.md) — `docker compose up --detach --wait` returns exit 1 when a one-shot service completes — `container marketplace-objects-init-1 exited (0)` and then a non-zero exit.
- [Never hardcode a host port in a compose file or a test](slices/agent-devops/MEM-2026-09-09-04.md) — Every published port in `docker-compose.yml` is `127.0.0.1:${VAR:-<default>}:<port>`, and every live test asks `docker compose port <service> <port>` for the address rather than assuming one.
- [Fastify's own `logger` option, not a pino instance](slices/agent-devops/MEM-2026-09-09-07.md) — Passing a constructed pino logger as Fastify's `loggerInstance` makes the instance's `Logger` generic concrete, and every function typed against `FastifyInstance` then fails with `Type 'FastifyBaseLogger' is not assignable to type 'Logger<never, boolean>'`.
- [Build apps with tsup so tests are typechecked](slices/agent-devops/MEM-2026-09-09-08.md) — Building with `tsc` forces `tsconfig.json` to `include` only `src/` (otherwise tests are emitted into `dist/`), so test files are never typechecked.
- [`setupFiles` runs for every suite, including the ones pinned to another environment](slices/agent-devops/MEM-2026-09-09-11.md) — A vitest `setupFiles` entry runs for **all** suites in the package, so a setup file that touches `document` fails every suite carrying `// @vitest-environment node` — at collection, with an error pointing at the setup file and saying nothing about the environment.
- [`prisma migrate diff` rejects `--schema`](slices/agent-devops/MEM-2026-09-09-16.md) — `--schema` is accepted by `prisma generate`, `migrate deploy`, `migrate dev` and `migrate status`, but **not** by `migrate diff`, which takes `--from-*`/`--to-*` instead.
- [`pnpm stack:logs` follows — never put it in a CI failure step](slices/agent-devops/MEM-2026-09-09-18.md) — `stack:logs` is `docker compose logs --follow`.
- [`docker://` actions are pinned by tag, not by `@ref`](slices/agent-devops/MEM-2026-09-09-19.md) — A workflow step may use `owner/repo@ref` or `docker://image:tag`.
- [`pull_request: branches: [main]` gives a stacked PR no checks at all](slices/agent-devops/MEM-2026-09-09-20.md) — A `pull_request` trigger filtered by `branches:` matches the PR's **base**, not its head.
- [`secrets` is unavailable in a job-level `if:` — the guard has to be a job](slices/agent-devops/MEM-2026-09-09-23.md) — GitHub's `secrets` context cannot be read from `jobs.<id>.if` or from a step `if:`.
- [`pnpm <binary>` is a script lookup, not an exec](slices/agent-devops/MEM-2026-09-09-24.md) — `pnpm tsx foo.ts` makes pnpm look for a **script** called `tsx` and fail with `Command "tsx" not found` / `Did you mean "pnpm test"?`.
- [A secret scanner that greps tracked files will flag its own patterns](slices/agent-devops/MEM-2026-09-09-25.md) — `tests/cd-workflows.test.ts` AC22 greps every `git ls-files` entry for provider token prefixes.
- [Diff `${{ secrets.* }}` against the guard — the two drift silently](slices/agent-devops/MEM-2026-09-09-26.md) — `deploy-preview.yml` read `secrets.PREVIEW_DATABASE_URL` while `REQUIRED.preview` in `scripts/deploy/config.ts` did not list it.

### Superseded

_None._

_41 records. Generated — run `pnpm memory:render`._
<!-- END GENERATED -->

## Rules
- One fact per record, in its own file named for its id. See `_RECORD_TEMPLATE.md`.
- Every record carries `why` and `apply`. A diary is not memory.
- Don't record what the repo already states — link to the ADR, spec or code.
- Supersede, never delete: `status: superseded-by MEM-…`. The file stays; the index lists it apart.
- **Verify before trusting.** An entry records what was true when written; if it names a file,
  function or flag, check it still exists.
