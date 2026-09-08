# Slice memory — agent-devops

Durable knowledge for this slice only. Written and owned by this agent alone. Read it at the start
of every task; add to it at the end of every task that taught you something reusable.

Entry format (see `agents/policies/memory.md`):

```markdown
### <short title>
- **id**: MEM-<date>-<n>
- **scope**: slice:S0
- **fact**:
- **why**:
- **apply**:
- **evidence**: <PR / file:line / ADR / intervention id>
- **status**: active
```

Keep it to facts that changed how you would work. Task-specific detail stays in the session file.

---

### `pnpm install` must be sufficient on its own
- **id**: MEM-2026-09-08-03
- **scope**: slice:S0
- **fact**: The root `prepare` script runs `pnpm --filter @marketplace/config build`. Without it a
  fresh clone cannot lint or typecheck, because every `eslint.config.js` imports
  `@marketplace/config/eslint` from `dist/`, which does not exist until tsup has run.
- **why**: "A single command installs everything" is an acceptance criterion of `W0-T01`, and CI
  (`W0-T06`) will run `pnpm install --frozen-lockfile` with no build step before the gates.
- **apply**: Any future package that other packages import at *config load* time needs the same
  treatment. Verify by deleting `node_modules` and `dist` and running `pnpm install` alone — cache
  hides this failure completely.
- **evidence**: `docs/specs/S0/W0-T01-monorepo-skeleton.run.md` green-phase transcript
- **status**: active

### Prettier over this repo is destructive by default
- **id**: MEM-2026-09-08-04
- **scope**: slice:S0
- **fact**: `**/*.md` is in `.prettierignore`. A plain `prettier --write .` rewrote 71 markdown
  files, including all of `.claude/agents/**`, which `scripts/generate-claude-agents.ts` generates.
- **why**: Reformatting generated agent files breaks the `agents-drift` gate (`W0-T15`), and the
  prose in `TODO.md` and `agents/` is hand-wrapped at 100 columns on purpose.
- **apply**: Before widening any formatter or linter scope, run it and read `git diff --stat` first.
  If it touches generated output or prose, scope it down rather than accepting the churn.
- **evidence**: `docs/specs/S0/W0-T01-monorepo-skeleton.run.md` scope notes
- **status**: active

### `docker compose up --wait` fails on any container that exits, even at 0
- **id**: MEM-2026-09-09-03
- **scope**: slice:S0
- **fact**: `docker compose up --detach --wait` returns exit 1 when a one-shot service completes —
  `container marketplace-objects-init-1 exited (0)` and then a non-zero exit. `--wait` has no
  per-service "expected to exit" flag. `pnpm stack:up` therefore waits on the long-running services
  by name and runs the provisioner as a separate `docker compose run --rm` step.
- **why**: Provisioning containers (bucket creation, migrations, seeding) are the normal way to
  bring a stack to a usable state, and the naive `up --wait` makes every one of them look like a
  failure.
- **apply**: `up --detach --wait <long-running services>` then `run --rm <provisioner>`. The split
  also surfaces the provisioner's own exit code instead of folding it into `--wait`'s verdict.
- **evidence**: `docs/specs/S0/W0-T02-local-stack.run.md` (deviation 4)
- **status**: active

### Never hardcode a host port in a compose file or a test
- **id**: MEM-2026-09-09-04
- **scope**: slice:S0
- **fact**: Every published port in `docker-compose.yml` is `127.0.0.1:${VAR:-<default>}:<port>`,
  and every live test asks `docker compose port <service> <port>` for the address rather than
  assuming one. A developer machine very often already has a Postgres on 5432 — one did here, from
  an unrelated project, and it stopped the stack from starting at all.
- **why**: The alternative is telling a developer to shut down their other work, which is not a fix.
- **apply**: Loopback bind + `${VAR:-default}` for every new port. In tests, resolve the address at
  runtime. Overrides go in a gitignored `.env`, never in the committed compose file.
- **evidence**: `docs/specs/S0/W0-T02-local-stack.run.md` (deviation 3)
### Fastify's own `logger` option, not a pino instance
- **id**: MEM-2026-09-09-07
- **scope**: slice:S0
- **fact**: Passing a constructed pino logger as Fastify's `loggerInstance` makes the instance's
  `Logger` generic concrete, and every function typed against `FastifyInstance` then fails with
  `Type 'FastifyBaseLogger' is not assignable to type 'Logger<never, boolean>'`. Fastify's
  `logger: { level, redact, base, stream }` takes the same pino options, keeps the default
  generics, and removes the direct `pino` dependency entirely.
- **why**: The type error appears in unrelated files and reads like a Fastify bug rather than a
  consequence of one option.
- **apply**: Configure logging through `logger`. Inject a `stream` when a test needs to assert on
  log output — that is how `apps/api/tests/app.test.ts` proves redaction and correlation.
- **evidence**: `docs/specs/S0/W0-T03-api-skeleton.run.md` (deviation 1)
- **status**: active

### Build apps with tsup so tests are typechecked
- **id**: MEM-2026-09-09-08
- **scope**: slice:S0
- **fact**: Building with `tsc` forces `tsconfig.json` to `include` only `src/` (otherwise tests are
  emitted into `dist/`), so test files are never typechecked. With tsup owning the build, the
  tsconfig covers `src`, `tests` and `*.config.ts` under `noEmit` and the gate catches type errors
  in tests too — there were some.
- **why**: Untypechecked tests are where `any` and stale imports accumulate, in the exact files
  meant to be the safety net.
- **apply**: New app packages: `build: tsup`, tsconfig includes `src` **and** `tests`. Preset
  packages that other packages `extends` still need real JSON on disk (`W0-T01`).
- **evidence**: `docs/specs/S0/W0-T03-api-skeleton.run.md` (deviation 5)
### `setupFiles` runs for every suite, including the ones pinned to another environment
- **id**: MEM-2026-09-09-11
- **scope**: slice:S0
- **fact**: A vitest `setupFiles` entry runs for **all** suites in the package, so a setup file that
  touches `document` fails every suite carrying `// @vitest-environment node` — at collection, with
  an error pointing at the setup file and saying nothing about the environment.
- **why**: A repo will always mix DOM component tests with filesystem/compiler tests in one package;
  `apps/web` has both.
- **apply**: Guard environment-specific work in setup files (`typeof document !== 'undefined'`).
  Pin filesystem tests to `node` — under jsdom `import.meta.url` is an `http:` URL and
  `fileURLToPath` throws `ERR_INVALID_URL_SCHEME`.
- **evidence**: `docs/specs/S0/W0-T04-web-skeleton.run.md` (deviations 2 and 3)
- **status**: active
