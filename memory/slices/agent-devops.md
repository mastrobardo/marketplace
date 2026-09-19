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

### `prisma migrate diff` rejects `--schema`
- **id**: MEM-2026-09-09-16
- **scope**: slice:S0
- **fact**: `--schema` is accepted by `prisma generate`, `migrate deploy`, `migrate dev` and
  `migrate status`, but **not** by `migrate diff`, which takes `--from-*`/`--to-*` instead. Passing
  it makes the CLI print its help text and exit 1 — which reads exactly like a failing drift check.
- **why**: A test helper that appends `--schema` to every invocation looks right and is wrong for
  one subcommand only. The failure mode is a *false positive* on the drift assertion, which is the
  most expensive kind: it says the schema and migrations disagree when they do not.
- **apply**: In a helper that shells out to the Prisma CLI, let the caller pass `--schema`. When a
  drift check fails, read the captured output before believing it — usage text is not a diff.
- **evidence**: `apps/api/tests/db.test.ts`; `docs/specs/S0/W0-T05-database-toolchain.run.md`
- **status**: active

### `pnpm stack:logs` follows — never put it in a CI failure step
- **id**: MEM-2026-09-09-18
- **scope**: slice:S0
- **fact**: `stack:logs` is `docker compose logs --follow`. In an `if: failure()` step it never
  returns, so the job runs to its `timeout-minutes` and the diagnostic step becomes the reason the
  build takes fifteen minutes to report a failure it already knew about.
- **why**: The convenience scripts are written for a terminal a human interrupts with Ctrl-C. CI
  has no such human, and a script name gives no hint that it blocks.
- **apply**: In CI call `docker compose logs --no-color --tail=200` directly. Before using any
  `pnpm <convenience>` script in a workflow, read what it actually runs — `stack:up` is safe
  because of `--wait`; `stack:logs` is not.
- **evidence**: `.github/workflows/ci.yml`; `docs/specs/S0/W0-T06-ci-pull-request-checks.run.md`
- **status**: active

### `docker://` actions are pinned by tag, not by `@ref`
- **id**: MEM-2026-09-09-19
- **scope**: slice:S0
- **fact**: A workflow step may use `owner/repo@ref` or `docker://image:tag`. Both forms must name
  a fixed version, but only the first has an `@`. A "pin every action" check that looks for `@`
  rejects the container form, which is the documented way to run `actionlint`.
- **why**: The naive check produced a failure that looked like a security finding and was a parsing
  bug — the reference *was* pinned, to `1.7.7`.
- **apply**: When asserting over `uses:`, branch on the `docker://` prefix and take the tag after
  the last `:`. Reject `main`, `master` and `latest` in both shapes.
- **evidence**: `tests/ci-workflow.test.ts` AC13
- **status**: active

### `pull_request: branches: [main]` gives a stacked PR no checks at all
- **id**: MEM-2026-09-09-20
- **scope**: slice:S0
- **fact**: A `pull_request` trigger filtered by `branches:` matches the PR's **base**, not its
  head. A PR from `B` into `A` (both feature branches) does not match `branches: [main]`, so it
  runs nothing — and reports nothing, which reads as "no checks configured" rather than as a
  failure. Observed the moment the first stacked PR was opened: `gh run list` returned `[]`.
- **why**: The filter is near-universal boilerplate and looks like a safety measure. It is really a
  scope restriction, and its blind spot is the review situation with the *most* moving parts.
  Restricting `push` to `main` is correct and separate — it stops a branch push being checked
  twice, once by the push and once by its PR.
- **apply**: Leave `pull_request:` unfiltered. Filter `push:` to `main`. After opening a PR that
  adds or changes a workflow, run `gh run list --branch <branch>` and confirm it is not empty — an
  empty list is the failure mode, and it is invisible in the PR UI.
- **evidence**: PR #155; `docs/specs/S0/W0-T06-ci-pull-request-checks.run.md` (deviation 5)
- **status**: active

### `secrets` is unavailable in a job-level `if:` — the guard has to be a job
- **id**: MEM-2026-09-09-23
- **scope**: slice:S0
- **fact**: GitHub's `secrets` context cannot be read from `jobs.<id>.if` or from a step `if:`.
  Gating a deploy on "is this configured?" therefore needs a **preflight job** that reads the
  secrets into `outputs`, with the real jobs on `needs: preflight` +
  `if: needs.preflight.outputs.configured == 'true'`.
- **why**: It is why `scripts/deploy/config.ts` exists instead of a shell condition in YAML. The
  guard is the one part of the pipeline that must already be correct on the day the credentials
  finally arrive, and YAML cannot be unit tested. Booleans derived from a secret are safe as
  outputs; the value itself never is.
- **apply**: Reuse `scripts/deploy/check.ts` for any new deploy target — add the target's required
  names to `REQUIRED` and its tests come free. Also: never interpolate `${{ }}` into a `run:`
  block. Pass it through `env:` — direct interpolation is textual substitution before the shell
  sees it (the Actions injection vector), and actionlint's shellcheck cannot parse the result
  either.
- **evidence**: `.github/workflows/deploy-preview.yml`; `tests/deploy-guard.test.ts`
- **status**: active

### `pnpm <binary>` is a script lookup, not an exec
- **id**: MEM-2026-09-09-24
- **scope**: slice:S0
- **fact**: `pnpm tsx foo.ts` makes pnpm look for a **script** called `tsx` and fail with
  `Command "tsx" not found` / `Did you mean "pnpm test"?`. Running a binary from `node_modules/.bin`
  needs `pnpm exec tsx`. Separately, a binary that is a devDependency of one workspace member is
  not on the root's PATH — `tsx` belonged to `apps/api` and had to be added at the root.
- **why**: The error names a missing command, so it reads as a missing dependency rather than as
  the wrong invocation, and the suggested fix ("did you mean pnpm test") points nowhere useful.
- **apply**: In a workflow or a root script, always `pnpm exec <bin>`. The repo's older root
  scripts use `node --experimental-strip-types`, which does **not** work for a module with
  relative imports: it resolves `./config.js` literally and cannot find the `.ts` file. Use `tsx`
  for anything with imports.
- **evidence**: PR #157 run 34318204023; `docs/specs/S0/W0-T07-deploy-environments.run.md`
- **status**: active

### A secret scanner that greps tracked files will flag its own patterns
- **id**: MEM-2026-09-09-25
- **scope**: slice:S0
- **fact**: `tests/cd-workflows.test.ts` AC22 greps every `git ls-files` entry for provider token
  prefixes. Its own regex contains all four, so it matches itself — but only once it is **tracked**,
  which is why it passed every local `pnpm verify` and failed on CI's first run.
- **why**: The general trap is that `git ls-files` and the working tree disagree about a file you
  have just written. Any test that iterates tracked files behaves differently before and after the
  first commit, so "green locally" is not evidence for that class of test.
- **apply**: When a test reads `git ls-files`, **`git add` first, then run the gate** — an untracked
  or unstaged new file is invisible to it, so a local pass proves nothing. Keep the patterns in
  exactly one file and exclude that file by path; the second time this broke CI it was because the
  same regex had been copied into a new suite, which then matched itself. One copy of a rule.
- **evidence**: PR #157 runs 34318203881 and 34332813834 — the same failure, twice
- **status**: active

### Diff `${{ secrets.* }}` against the guard — the two drift silently
- **id**: MEM-2026-09-09-26
- **scope**: slice:S0
- **fact**: `deploy-preview.yml` read `secrets.PREVIEW_DATABASE_URL` while `REQUIRED.preview` in
  `scripts/deploy/config.ts` did not list it. The preflight guard would have answered
  `configured: true`, the deploy would have created a Fly app and a Neon branch, and only then hit
  an empty `DATABASE_URL` at the migrate step — the half-built state the guard exists to prevent,
  leaking a Fly app per attempt.
- **why**: The guard's list and the workflow's usage are written in different files, in different
  languages, and nothing connected them. Adding a secret to a workflow is a one-line change that
  never touches the guard, so the two drift by default rather than by mistake.
- **apply**: `tests/env-example.test.ts` now asserts three-way equality between every
  `${{ secrets.* }}` any workflow reads, `REQUIRED`, and the inventory in `.env.example`. Adding a
  secret to a workflow fails the build until all three agree. Do not weaken that to a subset check.
- **evidence**: `scripts/deploy/config.ts`; `docs/specs/S0/W0-T07-deploy-environments.run.md` (deviation 8)
- **status**: active

### One origin is a Pages `_worker.js`, and `BETTER_AUTH_URL` is half of it
- **id**: MEM-2026-09-14-1
- **scope**: slice:S0
- **fact**: `*.pages.dev` cannot carry a Worker route and `_redirects` cannot rewrite to another
  host with a `200`, so the only mechanism is advanced mode: a `_worker.js` at the root of the
  deployed directory, which takes over every request and gets the static site as `env.ASSETS`. The
  API origin has to be baked in at build time — `wrangler pages deploy` cannot set a variable for
  the deployment it is creating, and a project-level variable is one value shared by every preview
  while each preview has its own API.
- **why**: two failures, not one, and fixing only the first leaves it broken: no
  `Access-Control-Allow-Origin` (better-auth trusts only `BETTER_AUTH_URL`'s origin), and then a
  `SameSite=Lax` cookie that is never sent because `pages.dev` and `fly.dev` are different
  registrable domains. `ADR-005` rule 3 chose one origin over credentialed CORS for this reason.
- **apply**: `BETTER_AUTH_URL` must be the **web** URL — it is both what the emailed links are built
  from and what `trustedOrigins` defaults to. It is known only after `wrangler pages deploy` prints
  it, so the web deploys before the API's secrets are set. Never construct a `*.pages.dev` name.
- **evidence**: `docs/specs/S0/W0-T28-one-origin.run.md` §3, driven through `wrangler pages dev`
- **status**: active

### A deployed path only reaches the API if it starts with `/api`
- **id**: MEM-2026-09-14-2
- **scope**: slice:S0
- **fact**: with one origin the edge splits traffic by path. `/health` is at the API's **root** and
  is not reachable through the edge at all (`/api/health` is a 404), and the storefront's
  `categories`/`search`/`providers/:id` were rootless too — the edge would have answered each with
  the SPA's `index.html`: a `200` full of HTML that fails as a JSON parse error far from its cause.
- **why**: nothing catches it locally (the dev proxy forwards `/api`, and MSW used to answer the
  rest on a wildcard) and nothing catches it in a unit test. It appears only on a deploy.

  *(Corrected by `W3-T01` #266, 2026-09-19 — `agent-providers`. The lesson stands; the example changed.)* MSW is gone, so the wildcard
  safety net is gone with it — a rootless call now fails in **development** too, which makes this
  trap louder and easier to catch rather than quieter. All three endpoints named below are live and
  mounted under `/api`.
- **apply**: every endpoint the browser calls lives under `/api`; `W3-T01`/`W3-T05`/`W3-T07` must
  mount their routes there. Probe the seam with `/api/auth/get-session`, never `/api/health`.
- **evidence**: `W0-T28` run record §2.1–§2.2; `apps/web/tests/api-proxy.test.ts` AC7
- **status**: active

### The gates are one job, and a fifth gate is three edits
- **id**: MEM-2026-09-17-1
- **scope**: slice:S0
- **fact**: since `W0-T29` the four agent-process gates run as one `gates` job.
  `scripts/gates/run.ts --all` judges every gate in one process, writes a table to
  `$GITHUB_STEP_SUMMARY`, emits an `::error title=gate: <name>::` annotation per failure and only
  then decides the exit code (1 failed, 2 could not see its inputs). Adding a gate is: a pure
  `check…()` in `scripts/gates/<name>.ts`, a code in `types.ts`, an arm in `run.ts`'s `GATES` and
  `run()`. No workflow change, no new check name, no extra billed minute.
- **why**: the four jobs were the same script with a different argument and each paid ~30s of
  `checkout` + `setup-node` + `pnpm install` for ~2s of work — then billed a whole minute
  (`MEM-2026-09-17-18`). What the job names bought was a red *name*; the annotation buys it back.
- **apply**: run `pnpm gates` before pushing — it is the command CI runs. Locally the three
  pull-request gates report "not a pull request" (no `GITHUB_BASE_REF`) and only `agents-drift`
  actually judges anything; to rehearse a PR, set `GITHUB_BASE_REF=main`,
  `GITHUB_HEAD_REF=<branch>` and `PR_LABELS='[]'`. `agents-drift` resolves this repository from
  `import.meta.url`, not from the working directory — do not "fix" that to a relative path.
- **evidence**: `scripts/gates/run.ts`; `tests/ci-gates.test.ts` AC3–AC6, AC8;
  `docs/specs/S0/W0-T29-gate-consolidation.md`
- **status**: active
