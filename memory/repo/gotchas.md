# Repo memory — gotchas

Traps found the hard way. Each entry must carry evidence — a PR, a failing test, an incident, an
intervention id. **No speculation.** If it has not actually bitten us, it belongs in a spec's risk
section, not here.

Seed entries below are known-in-advance traps carried from planning; everything after them should
come from real experience.

### Google Maps is for display, PostGIS is for geography
- **id**: MEM-2026-09-07-07
- **scope**: repo
- **fact**: Radius and proximity queries run in PostGIS (`ST_DWithin` + GiST index). Maps is used
  for rendering and address autocomplete only, with geocoding results cached.
- **why**: Per-request Maps calls for search would dominate infrastructure cost at any real volume
  (`TODO.md` R9).
- **apply**: Never geocode inside a search request path. Never geocode the same address twice.
- **evidence**: `TODO.md` R9, `agents/roles/agent-discovery.md`
- **status**: active

### Photos of homes carry GPS coordinates
- **id**: MEM-2026-09-07-08
- **scope**: repo
- **fact**: Every uploaded image is EXIF-stripped before storage.
- **why**: Portfolio and job photos are taken inside people's homes. Publishing EXIF publishes
  their address.
- **apply**: Strip on the server, not the client. Applies to portfolio, job photos and message
  attachments alike.
- **evidence**: `agents/roles/agent-providers.md`, `agent-jobs.md`
- **status**: active

### Stripe webhooks arrive late, twice, and out of order
- **id**: MEM-2026-09-07-09
- **scope**: slice:S9
- **fact**: Handlers must be idempotent and order-independent, keyed on a stable idempotency key,
  with a dead-letter path.
- **why**: It is the default behaviour of the platform, not an edge case.
- **apply**: Every money handler has a replay test asserting the second delivery is a no-op.
- **evidence**: `TODO.md` W5-T03, `agents/roles/agent-money.md`
- **status**: active

### TypeScript is pinned to 5.9 — typescript-eslint cannot load under TS 7
- **id**: MEM-2026-09-08-01
- **scope**: repo
- **fact**: `typescript` is pinned `~5.9.3` in every `package.json`. Installing TS 7 (the native
  port, which the registry now serves as `latest`) breaks the `lint` gate with
  `Error: typescript-eslint does not support TS 7.0`, and breaks `tsup`'s `dts: true` with
  `TypeError: Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')` from
  `rollup-plugin-dts`.
- **why**: The lint gate is not optional (`agents/roles/agent-devops.md`). A caret range on
  `typescript` silently upgrades the whole workspace into a broken toolchain.
- **apply**: Do not widen the range. **Unpin when** `typescript-eslint` declares TS 7 support *and*
  `tsup`/`rollup-plugin-dts` builds declarations under it — verify with `pnpm verify` from a clean
  `node_modules`, not from cache. If only the dts half is still broken, the fallback is
  `tsup && tsc -p tsconfig.build.json --emitDeclarationOnly`.
- **evidence**: `docs/specs/S0/W0-T01-monorepo-skeleton.run.md` (deviations 1 and 2)
- **status**: active

### The canonical PostGIS and MailHog images are amd64-only
- **id**: MEM-2026-09-09-01
- **scope**: repo
- **fact**: `postgis/postgis` (all tags checked: `17-3.5`, `18-3.6`, and the `-alpine` variants)
  and `mailhog/mailhog:v1.0.1` publish `linux/amd64` only. `docker-compose.yml` therefore uses
  `imresamu/postgis` — the multi-architecture build from the same maintainer, linked from
  `postgis/docker-postgis` as the arm64 source — and `axllent/mailpit`, MailHog's maintained
  successor, in place of the images `TODO.md` §6 names.
- **why**: On an arm64 machine the canonical images run under emulation: slow, and for Postgres
  specifically not something to trust for anything timing- or concurrency-shaped.
- **apply**: Before adding any image to the stack, run
  `docker manifest inspect <image> | grep -A3 '"platform"'` and check `arm64` is listed. **Switch
  back when** `postgis/postgis` publishes arm64 itself.
- **evidence**: `docs/specs/S0/W0-T02-local-stack.run.md` (deviations 1 and 2)
- **status**: active

### Vitest 5 ignores the trailing-number test timeout
- **id**: MEM-2026-09-09-02
- **scope**: repo
- **fact**: `it('…', fn, 30_000)` is accepted and silently has no effect; the test still times out
  at the configured default and the failure still reports that default. Only the options-object
  form works: `it('…', { timeout: 30_000 }, fn)`.
- **why**: The old form is what most examples and muscle memory produce, and the failure message
  names the default timeout — so it reads as "the test really is hanging" rather than "your
  override was dropped", which is an expensive way to lose half an hour.
- **apply**: Any test that shells out, polls, or touches the network gets
  `{ timeout: <ms> }` as the **second** argument.
- **evidence**: `docs/specs/S0/W0-T02-local-stack.run.md` (AC10 test-side correction)
### `app.register` encapsulates — a hook added inside one covers only that context
- **id**: MEM-2026-09-09-05
- **scope**: repo
- **fact**: In Fastify, `register` creates a new encapsulation context. A hook added inside a
  registered plugin does **not** apply to routes registered in a sibling context. Wrapping the
  request-id `onRequest` hook in a plugin produced an app where `/health` had no `x-request-id`
  header at all, while a test of the plugin in isolation would have passed.
- **why**: The failure mode is silent partial coverage, which is worse than a crash: a correlation
  header, an auth guard or a rate limiter that covers *some* routes looks like it works.
- **apply**: Anything that must apply to every route goes on the root instance with `app.addHook`,
  or through `fastify-plugin`, which breaks encapsulation deliberately. Use `register` only when
  you actually want the scoping. Assert cross-cutting behaviour on a route registered **elsewhere**
  than the thing under test.
- **evidence**: `docs/specs/S0/W0-T03-api-skeleton.run.md` (deviation 3)
- **status**: active

### A module-resolution failure is not a red phase
- **id**: MEM-2026-09-09-06
- **scope**: repo
- **fact**: `Cannot find module '../src/app.js'` with `Tests  no tests` means no assertion ran. It
  is the inverse of `W0-T01`'s vacuously-passing loops: a failure that is not evidence.
- **why**: L1 requires the red phase as proof the test can distinguish a working implementation
  from a missing one. A collection error proves only that a file is absent.
- **apply**: Create the module surface first as stubs that `throw new Error('not implemented')`,
  then observe red. Never build a `Config` or any other module-level value at import scope in a
  test file — it takes the whole file out of collection when it throws.
- **evidence**: `docs/specs/S0/W0-T03-api-skeleton.run.md` red phase
### A `@ts-expect-error` comment is a directive even when the rest of it is prose
- **id**: MEM-2026-09-09-09
- **scope**: repo
- **fact**: TypeScript treats any single-line comment **beginning** with the `@ts-expect-error`
  directive as a suppression, whatever follows it. A fixture written to prove that an unknown
  translation key fails the build carried the comment
  `// @ts-expect-error is deliberately NOT used: the point is that tsc fails.` — which suppressed
  the error it was describing. Because a real error was present, there was no "unused directive"
  warning either: the file compiled clean and the test that asserted the failure failed instead.
- **why**: The comment reads like documentation and behaves like code. It fails **open** — the
  check silently stops checking.
- **apply**: Never begin a comment with `@ts-expect-error` or `@ts-ignore` unless you mean the
  directive. Any test asserting that something *fails* to compile needs a sibling fixture asserting
  something *does* compile; without it, a check that always fails and a check that always passes are
  indistinguishable.
- **evidence**: `docs/specs/S0/W0-T04-web-skeleton.run.md` (test-side correction)
- **status**: active

### i18next's default separators break dotted keys
- **id**: MEM-2026-09-09-10
- **scope**: repo
- **fact**: Our translation keys are flat and dotted (`nav.home` is one key). i18next treats `.` as
  a path separator into nested resources and `:` as a namespace separator by default, so every
  lookup misses and it falls back to rendering **the key itself**. `apps/web/src/i18n/index.ts`
  sets `keySeparator: false` and `nsSeparator: false`.
- **why**: Rendering a raw key to a user is the exact failure `W0-T04` exists to prevent, and it is
  a silent one — no error, no warning, just `nav.home` on the page.
- **apply**: Do not remove those two options. If nested catalogues are ever wanted, that is a
  deliberate change to the key type in `es.ts` and to the parity test, not a config tweak.
- **evidence**: `docs/specs/S0/W0-T04-web-skeleton.run.md` (deviation 1)
- **status**: active

### Parallel branches collide on shared append-only files, not on the seam
- **id**: MEM-2026-09-09-12
- **scope**: repo
- **fact**: Three branches from the same `main`, touching three different slices and sharing **no**
  source file, still conflicted three times — on `README.md`, `memory/repo/gotchas.md`,
  `memory/slices/agent-devops.md` and `pnpm-lock.yaml`. Every merge to `main` invalidates every
  other open branch, so the cost grows as O(n²) in open branches. `TODO.md` R8 predicted this for
  `schema.prisma` and `packages/contracts`; it arrived first in documentation and memory.
- **why**: For a human team this is a shrug. For an agent it is a **stop**: the task is finished,
  the PR is green, and it waits for a human. `AGENTS.md` L8 makes every agent write to
  `memory/repo/**` on every task, so every task is exposed.
- **apply**: Until `W0-T23` lands, expect to re-merge `main` after each other PR merges, and resolve
  by keeping both sides **only after checking the hunk is genuinely an addition**. Worst pending
  case is `apps/web/src/i18n/locales/{es,en}.ts` — seven user-facing slices will all append keys to
  those two files, where a dropped key is a missing translation rather than a cosmetic duplicate.
- **evidence**: PRs #150, #151, #152; issue #153
- **status**: active

### "Keep both sides" is wrong whenever a hunk is a modification
- **id**: MEM-2026-09-09-13
- **scope**: repo
- **fact**: Resolving the conflicts above with a keep-both script was right on five hunks and wrong
  on two. The `README.md` Layout table *looks* append-shaped — one row per path — but each branch
  **edits the row for its own app**. Keeping both sides produced a duplicate row carrying the stale
  pre-task description, and nothing failed: not the build, not lint, not the tests.
- **why**: It is the argument against a blanket "append" git merge driver for these files. An
  automatic driver would have committed the duplicate silently. The fix is to remove the shared
  files (issue #153), not to automate merging them.
- **apply**: After any bulk conflict resolution, **read the resolved region**, do not just check
  that the markers are gone. A markdown table, a config block and an import list all look additive
  and are not. `pnpm-lock.yaml` is never hand-merged: take `main`'s copy and re-run `pnpm install`.
- **evidence**: PR #152 merge commits; `docs/specs/S0/W0-T04-web-skeleton.run.md`
- **status**: active

### `pnpm deploy --prod` discards the generated Prisma client
- **id**: MEM-2026-09-09-22
- **scope**: repo
- **fact**: `pnpm deploy` rebuilds `node_modules` from the store, and the store holds the
  **published** `@prisma/client` — a shell whose real code `prisma generate` writes *into the
  installed package*. A Dockerfile that generates before pruning ships a client that throws
  `MODULE_NOT_FOUND` on first import. Confirmed by running the built image:
  `require('@prisma/client')` failed while `GET /health` returned 200.
- **why**: Nothing catches it. The image builds, boots and serves — because no route touches the
  database *yet*. The first slice to run a query would have found it in production, on a deploy
  that passed every gate. `pnpm deploy` also needs `--legacy` from pnpm 10 unless the workspace
  sets `inject-workspace-packages=true`.
- **apply**: In `infra/docker/api.Dockerfile`, `prisma generate` runs **after**
  `pnpm deploy --legacy` and targets the pruned tree. `tests/cd-workflows.test.ts` AC27 asserts
  that ordering. A static test cannot prove the image works — build it and
  `docker run … node -e "require('@prisma/client')"` after any change to that file.
- **evidence**: `infra/docker/api.Dockerfile`; `docs/specs/S0/W0-T07-deploy-environments.md` §7b
- **status**: active

### A CI gate on a shallow clone reports green because it cannot see
- **id**: MEM-2026-09-09-23
- **scope**: repo
- **fact**: `actions/checkout` defaults to `fetch-depth: 1`. Any gate that diffs against the base
  branch or walks a commit range has no base commit in that clone: `git diff origin/main...HEAD`
  aborts with "unknown revision". The obvious repair — catch the error, treat it as "no changed
  files" — makes the gate **pass every branch** while reporting green.
- **why**: Found while writing `spec-present` and `author-identity` (`W0-T12`). A gate that fails
  open is worse than no gate: reviewers stop checking the thing themselves precisely because CI is
  believed to have checked it.
- **apply**: Any job diffing or walking history sets `fetch-depth: 0`. `scripts/gates/run.ts`
  asserts `git rev-parse --verify origin/<base>` first and exits **2** — distinct from a gate
  failure (1) — with the `fetch-depth: 0` fix in the message. `tests/ci-gates.test.ts` AC6 asserts
  the depth in the YAML and AC7 drives the CLI end-to-end.
- **evidence**: `.github/workflows/ci.yml`; `docs/specs/S0/W0-T12-ci-gates.run.md` §3
- **status**: active

### A vitest JSON report file can be stale, and a stale report is indistinguishable from no change
- **id**: MEM-2026-09-09-24
- **scope**: repo
- **fact**: Re-reading `.vitest/json/output.json` after a second run returned byte-identical
  results — including assertions that had just been made to pass — so a fixed suite still read as
  25 failures.
- **why**: The comparison "did my change fix anything?" is exactly the moment a stale file lies,
  and it lies in the direction of more work rather than less: the fix looks ineffective.
- **apply**: Write the report somewhere fresh per run (`vitest run --reporter=json
  --outputFile=<new path>`) before comparing two runs. Never diff two reads of the same default
  report path.
- **evidence**: `docs/specs/S0/W0-T12-ci-gates.run.md` §5
- **status**: active

### Turbo's `^build` is upstream-only, so a package that consumes its own `dist/` is unordered
- **id**: MEM-2026-09-09-27
- **scope**: repo
- **fact**: `"dependsOn": ["^build"]` orders a task after the builds of a package's
  **dependencies**, never after its own. `packages/config/eslint.config.js` imports
  `./dist/eslint.js` and `@marketplace/config` has no upstream, so nothing ordered its lint after
  its own build. Fixed with `"@marketplace/config#lint": { "dependsOn": ["build"] }` — no caret.
- **why**: It only fails on a **cold** cache, and the cache is warm almost always. Any edit to the
  root `package.json` invalidates turbo's global hash, so an unrelated change to a `scripts` entry
  is what surfaced it — green locally, red in CI, with a stack trace naming `dist/eslint.js` and
  nothing about task ordering.
- **apply**: Reproduce a suspected turbo ordering bug with `rm -rf packages/*/dist .turbo` before
  believing a green local run. Any config file loaded as JavaScript that imports its own build
  output needs a self-referential `dependsOn` — the caret is the bug.
- **evidence**: PR #161 lint job; `turbo.json`, `tests/config-package.test.ts`
- **status**: active


### `origin/main` is only as fresh as your last fetch
- **id**: MEM-2026-09-10-04
- **scope**: repo
- **fact**: `git ls-tree origin/main`, `git log origin/main` and `git status -sb` all read a
  **local** ref. In a repo where PRs merge on GitHub, that ref is stale from the moment someone
  else merges — including the human operator merging the branch you just handed over.
- **why**: `W1-T06` opened by reporting that `packages/contracts` was missing from `main` and that
  `W1-T01` had no PR. Both were false: #164 had merged, and `gh pr list` returned empty for the
  same reason a stale ref did — the state had moved and nothing local had noticed. The report was
  confident and wrong, and the operator had to supply the PR link to correct it.
- **apply**: `git fetch origin --prune` **before** any claim about what is on `main`, and before
  branching off it. In a repo where an agent's work is merged by a human between sessions, treat
  every un-fetched ref as unknown rather than as absent.
- **evidence**: `docs/specs/S1/W1-T06-money-value-object.run.md`;
  `memory/sessions/2026-09-10-agent-contracts-W1-T06.md` log 09:10
- **status**: active

### Turbo runs package test tasks in parallel, so a slow test is a shared resource
- **id**: MEM-2026-09-10-05
- **scope**: repo
- **fact**: `turbo run test` executes every package's suite concurrently. A test that spawns a
  compiler or another heavy process therefore competes with the other packages' suites, and on a
  two-core GitHub runner that contention is enough to push a *different* slice's test past Vitest's
  5s default. `pnpm verify` on a developer machine cannot reproduce it — there are cores to spare.
- **why**: `W1-T06` added two `tsc` fixture compilations to `packages/contracts` and CI failed on
  `apps/web`'s i18n fixture test, which the branch never touched. It reads as an unrelated flake
  and is not one: `main` was green, and the new processes are the cause.
- **apply**: Any test that shells out gets the package-local binary (`node_modules/.bin/<tool>`,
  never `npx <tool>`, which re-resolves per call) **and** an explicit
  `it('…', { timeout: 120_000 }, fn)` — see `MEM-2026-09-09-02` for why the options-object form is
  the only one that works. When CI fails on a suite your branch did not touch, check whether your
  branch added a heavy process before calling it flaky.
- **evidence**: PR #165 run 34450639354 (`unit`);
  `packages/contracts/tests/money.test.ts`, `apps/web/tests/i18n.test.ts`
- **status**: active

### zod 4 accepts a function as `.refine`'s second argument and ignores it
- **id**: MEM-2026-09-10-06
- **scope**: repo
- **fact**: `.refine(pred, (value) => ({ message: … }))` is accepted by the types and by the
  runtime, and the resulting issue carries the generic `"Invalid input"` — the function is never
  called. Only two forms produce a dynamic message: `.transform((v, ctx) => { ctx.addIssue({ code:
  'custom', message }); return z.NEVER; })` and `.superRefine((v, ctx) => …)`.
- **why**: The function form is what zod 3 habits and most examples produce, and it fails **open**:
  validation still rejects the value, so every test asserting `success === false` passes. What is
  lost is the reason, on every error the endpoint returns — `"sort" is not sortable here; allowed:
  createdAt, priceCents` becomes `Invalid input`, and the client cannot tell the caller what to fix.
- **apply**: Any zod issue whose message depends on the value goes through the `ctx` form. Assert on
  `error.issues[0].message`, not only on `success`, or the regression is invisible.
- **evidence**: probed against `zod@4.5.4` in `packages/contracts`;
  `docs/specs/S1/W1-T02-list-conventions.run.md` §4
- **status**: active

### A convention that is not a gate decays silently, and the better the writing gets the faster
- **id**: MEM-2026-09-11-04
- **scope**: repo
- **fact**: `agents/prompts/08-run-record.md` requires a `## Prompts` section carrying verbatim
  prompts and a corrections block. All eight `S0` run records carry it. **None of the five `S1`
  records does** — `W1-T01`, `T02`, `T05`, `T06` are careful narrative essays about the code and
  contain not one re-runnable prompt. The `spec-present` gate only ever checked that the file
  exists, so nothing failed.
- **why**: The decay was not laziness — each record was better *written* than the one before, and
  the section was crowded out by prose that read as more valuable. That is the dangerous shape: a
  format degrades fastest when the work is going well, and the verbatim prompts are the one part
  that cannot be reconstructed afterwards. It cost the corpus its only prompt-tuning input across
  the whole of `S1`.
- **apply**: If a required artifact section is not asserted by a gate, assume it is already gone and
  go and look. When adding a required section to any template, add the check in the same PR — see
  `docs/adr/ADR-010-agent-telemetry.md` and `W11-T19`. The same reasoning is why `W0-T26` exists.
- **evidence**: audit 2026-09-11 across 13 tasks; `docs/adr/ADR-010-agent-telemetry.md` §Context;
  `docs/specs/S0/W0-T01-monorepo-skeleton.run.md` §Prompts vs
  `docs/specs/S1/W1-T06-money-value-object.run.md` (no such section)
### `prisma migrate diff` with a shadow database cannot get past migration `0000`
- **id**: MEM-2026-09-10-12
- **scope**: repo
- **fact**: `prisma migrate diff --from-migrations … --shadow-database-url …` **resets** the shadow
  database before replaying, which drops the PostGIS extension installed in `public`. Migration
  `0000_require_postgis` then does its job and refuses with `POSTGIS_MISSING`, and the whole diff
  fails with `P3006`. Creating the extension on the shadow database first does not help — the reset
  happens after. Use `--from-url <a migrated database>` instead; that is also how `0006` was
  generated.
- **why**: The failure reads exactly like schema drift or a broken migration, and the obvious fix
  (create the extension) appears to do nothing, so the trap costs the same twenty minutes every
  time somebody meets it.
- **apply**: Drift-checking locally: `prisma migrate diff --from-url $DATABASE_URL
  --to-schema-datamodel ./prisma/schema.prisma --exit-code` against a database that is up to date
  on migrations. Also note the local `POSTGRES_PORT` override in `.env` — the compose stack is not
  necessarily on 5432, and `docker compose port db 5432` is the reliable way to find it.
- **evidence**: `docs/specs/S1/W1-T07-state-machine.run.md` §Green phase; `apps/api/prisma/migrations/0000_require_postgis`
- **status**: active

### A turbo-cached test hides a failure when its real input is outside the package
- **id**: MEM-2026-09-11-16
- **scope**: repo
- **fact**: `@marketplace/testing`'s AC10 gate reads `apps/api/prisma/schema.prisma`, which is not
  part of the input hash turbo computes for `@marketplace/testing#test`. When `W1-T07` added the
  `AuditRecord` model, the gate started failing — and locally kept replaying a **cached pass** from
  before the model existed. It surfaced only when an unrelated `pnpm install` invalidated the cache.
  CI has no shared cache, so CI has been red on `main` since (`unit`, run 34573704861), and the
  local signal said green the whole time.
- **why**: The point of a cache is to skip work whose inputs have not changed, and turbo can only
  know the inputs it is told about. A test that reaches outside its own package is invisible to it,
  so the cache is not wrong — the task declaration is incomplete.
- **apply**: A test that reads a file from another package needs that file in the task's `inputs`
  in `turbo.json`, or the task needs `"cache": false`. And when a local run and CI disagree, run
  the failing task with `--force` before believing the local one.
- **evidence**: `docs/specs/S10/W12-T03-storybook-workbench.run.md` §Human input received;
  `packages/testing/tests/factories.test.ts` AC10; CI run 34573704861 on `main`
- **status**: active

### `light-dark()` survives the build, but not in a form you can grep for
- **id**: MEM-2026-09-11-17
- **scope**: repo
- **fact**: `packages/ui/src/styles/themes/*.css` write every colour once as
  `light-dark(var(--light), var(--dark))`. Vite's Lightning CSS lowers this to a custom-property
  space-toggle — `--lightningcss-light` / `--lightningcss-dark` — emitted under
  `@media (prefers-color-scheme: dark)` **and** under every rule that declares `color-scheme`,
  which includes `[data-scheme='light']` and `[data-scheme='dark']`. So the behaviour is intact and
  `light-dark(` appears **zero times** in `apps/web/dist/assets/*.css`.
- **why**: Someone debugging a theme will grep the built CSS, find no `light-dark(`, and conclude
  the mechanism was dropped or the browser target is too old. It was neither.
- **apply**: Debug themes against the source, not `dist`. If you must check `dist`, grep for
  `--lightningcss-` and read which selectors set the toggle — that list is the answer to "does the
  explicit scheme override still work". And do not "fix" the source by hand-writing the toggle:
  the lowering is the build's job and it tracks the browser target.
- **evidence**: `docs/specs/S10/W12-T05-token-layers-and-themes.run.md` §Findings;
  `apps/web/dist/assets/index-*.css`
- **status**: active

### A comment inside a folded `run: >` block is not a comment
- **id**: MEM-2026-09-14-1
- **scope**: repo
- **fact**: YAML's folded scalar joins every line into one string, and `#` has no special meaning
  inside it. A note written in the middle of a folded `flyctl secrets set` is handed to `flyctl` as
  arguments. It looks correct in the diff, parses as valid YAML, and breaks the deploy.
- **why**: Every other block in these workflows is `run: |`, where `#` really is a shell comment, so
  the habit transfers and the failure mode does not. It was caught by a rebase conflict rather than
  by a test, which means it could equally well have been caught by neither.
- **apply**: Put the explanation **above the step**, outside the scalar. `cd-workflows.test.ts`
  ("a folded run: block carries no prose") now fails any `run` that arrives as a single line
  containing ` # `.
- **evidence**: `docs/specs/S2/W2-T10-account-page.run.md`; `.github/workflows/deploy-preview.yml`
  "Give the preview API its own database and auth secret"
- **status**: active

### A squash-merge takes the branch at that instant — later pushes are lost silently
- **id**: MEM-2026-09-14-2
- **scope**: repo
- **fact**: `W2-T09`'s "login is one API call" commit was pushed at 17:37:43; #247 was
  squash-merged at 17:35:26. `main` received the account pages **without** it. No warning, no
  conflict, no red check: the commit stays on the merged branch and nothing looks at it again. It
  surfaced an hour later as a compile error in unrelated work (`seedSession` missing).
- **why**: A human reviews and merges while an agent is still pushing to the same PR. Between "it is
  ready" and a follow-up improvement there is no signal to either side that the two crossed.
- **apply**: After pushing to a PR that has been announced as ready, check it is still open
  (`gh pr view <n> --json state,mergedAt`). Before starting new work off `main`, grep `main` for a
  symbol the last commit added rather than trusting the merge commit's subject. Recovery is a
  cherry-pick onto the next branch, declared in that PR's description.
- **evidence**: commit `fd578c2`; PR #247 merged 2026-09-14T15:35:26Z;
  `docs/specs/S2/W2-T10-account-page.run.md` §1
- **status**: active

### Deployed, an endpoint that does not start with `/api` is answered by the storefront
- **id**: MEM-2026-09-14-3
- **scope**: repo
- **fact**: `W0-T28` puts the web app and the API on one origin by splitting traffic **at the edge,
  by path**: a Pages `_worker.js` forwards `/api/*` to Fly and hands everything else to the static
  site. A request to `/categories` therefore gets `index.html` — a `200` full of HTML that fails as
  a JSON parse error a long way from its cause, and only in a deployed environment.
- **why**: It cannot be reproduced locally. The dev server proxies `/api` and MSW answers the rest
  on a wildcard, so a rootless path works on a laptop and breaks on a preview.
- **apply**: Every endpoint the browser calls lives under `/api` — on both sides. `W3-T01`,
  `W3-T05` and `W3-T07` must mount their routes there; `apps/web/tests/api-proxy.test.ts` (AC7)
  derives the client half from the source and fails a call without the prefix. `/health` stays at
  the API's root for Fly's own checks and is *not* reachable through the edge.
- **evidence**: `docs/specs/S0/W0-T28-one-origin.run.md` §2.1–§2.2; PR #248
- **status**: active

### A CSS Modules class name is in the JS bundle whether or not the stylesheet ever loaded
- **id**: MEM-2026-09-17-1
- **scope**: repo
- **fact**: `W12-T20` asserts that a production build of `apps/web` contains the design system's
  component rules, with the needles derived from `packages/ui/dist/ui.css`. The first version
  searched for the bare hash (`_button_u46b4_1`) and reported **8 of 67 missing** on a build with no
  component CSS in it at all. CSS Modules compile to a JS object mapping each name to its hash, so
  `dist/index.js` carries every class name of every component the app renders. The eight it found
  were `Dialog` and `Popover` — unused by the storefront, so tree-shaken out of the JS. The gate was
  measuring tree-shaking.
- **why**: A class name is a string in the JS and a selector in the CSS. Searching a whole bundle
  for the string finds the JS copy first, and the result looks *more* credible than a pass — a
  specific count of specific missing components reads as a gate that is working.
- **apply**: When asserting that a stylesheet reached a build, search for `.<name>` — the leading
  dot appears in a rule and never in a `className` string. More generally: before trusting a new
  gate, run it against a build you know is broken and check the number it reports is the number you
  expect, not merely non-zero.
- **evidence**: `docs/specs/S10/W12-T20-design-system-stylesheet.run.md` Finding 1;
  `apps/web/tests/ui-package.test.ts` AC3
- **status**: active

### The storefront rendered no component CSS for seven tickets, and five suites could not see it
- **id**: MEM-2026-09-17-2
- **scope**: repo
- **fact**: `apps/web` imported `@marketplace/ui/tokens.css` and never `@marketplace/ui/styles.css`,
  so every React Aria control in the product was a raw browser widget from `W12-T01` until `W2-T09`
  noticed. Axe was green on every route throughout — roles, names and landmarks do not depend on
  CSS. The story screenshots were green because Storybook's preview always loaded the stylesheet.
  `ui-package.test.ts` read `main.tsx`'s imports and was satisfied by the tokens line.
- **why**: Every gate was working. Between them they had no assertion about *appearance* on a
  **route**, and the only test looking at the entry point checked for the import that was there.
- **apply**: A page's appearance needs an observer that looks at a page. The route screenshots in
  `packages/ui/visual/routes.spec.ts` are it — the same list axe walks, so the two cannot drift.
  When adding a route, `visual-routes.test.ts` fails until the baseline exists; regenerate with
  `visual-baselines.yml` against the branch (`ref: <branch>`, `subjects: routes`), never locally.
- **evidence**: `docs/specs/S10/W12-T20-design-system-stylesheet.md` §1;
  `docs/specs/S10/W12-T20-design-system-stylesheet.run.md`
- **status**: active

### `create-pull-request` commits as a bot, and `author-identity` fails a bot
- **id**: MEM-2026-09-17-3
- **scope**: repo
- **fact**: `peter-evans/create-pull-request` defaults to `github-actions[bot]` for both author and
  committer. The `author-identity` gate fails any commit whose author *or* committer is not
  `mastrobardo@gmail.com`. `visual-baselines.yml` has never tripped this only because its commit
  carries `[skip ci]`, so the gate never runs on that pull request.
- **why**: A workflow that writes commits inherits the runner's identity, not the repo's rule. The
  `[skip ci]` that makes a baselines-only PR cheap is also what hid the mismatch.
- **apply**: Any workflow that commits sets `user.name`/`user.email` (or the action's
  `committer`/`author` inputs) to the personal identity. A workflow commit onto a *feature* branch
  must not carry `[skip ci]` — the checks it skips are the ones it exists to turn green.
- **evidence**: `.github/workflows/visual-baselines.yml`; `tests/cd-workflows.test.ts` (W12-T20);
  `scripts/gates/author-identity.ts`
- **status**: active

### A workflow that pushes with `GITHUB_TOKEN` cannot start the checks on what it pushed
- **id**: MEM-2026-09-17-4
- **scope**: repo
- **fact**: `visual-baselines.yml` committed the route baselines to `W12-T20`'s branch as
  `mastrobardo@gmail.com`. `CI` and `Deploy preview` were created on the new head with status
  `action_required` and never started: GitHub does not run workflows for a push made with
  `GITHUB_TOKEN`. They ran after `gh api -X POST repos/:owner/:repo/actions/runs/:id/approve`.
- **why**: The recursion guard is unconditional, and a pull request whose required checks have not
  started looks exactly like one whose checks are queued — there is no red, no message, nothing to
  notice.
- **apply**: After any workflow pushes to a branch, look at the run list for the new head and
  approve the runs, or push a commit yourself. Do not wait for checks that will never start. A PAT
  or the `OPS-19` GitHub App would remove the step; neither is worth it for baselines.
- **evidence**: runs 35248674237 / 35248674485 on `W12-T20-design-system-stylesheet`;
  `docs/specs/S10/W12-T20-design-system-stylesheet.run.md` Finding 5
- **status**: active
