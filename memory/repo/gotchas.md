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
