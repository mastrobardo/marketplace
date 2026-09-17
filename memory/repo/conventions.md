# Repo memory — conventions

How we do things here, beyond what lint and CI enforce automatically.

### Branch, spec and run record travel together
- **id**: MEM-2026-09-07-04
- **scope**: repo
- **fact**: Branch `<TASK-ID>-<slug>` must contain `docs/specs/<slice>/<TASK-ID>-<slug>.md` and
  `<TASK-ID>-<slug>.run.md`. The branch, the spec and the run record all carry the same task ID,
  so a task is greppable by ID across git and the tree. Gate `spec-present` enforces it.
- **why**: Prompt quality has to be reviewable in the diff, not reconstructed later from chat logs.
- **apply**: Create both files before writing code. Write the run record as you go, not afterwards.
- **evidence**: `TODO.md` §5.2
- **status**: active

### The seam is written by one agent only
- **id**: MEM-2026-09-07-05
- **scope**: repo
- **fact**: `packages/contracts/**` and `schema.prisma` are edited only by `agent-contracts`.
  Everyone else proposes.
- **why**: A dozen agents building against a shifting seam is the main collision risk in this repo
  (`TODO.md` R8).
- **apply**: Use `agents/prompts/01-contract-proposal.md`; post-freeze changes need an ADR.
- **evidence**: `agents/policies/contract-change.md`
- **status**: active

### Test data comes from `packages/testing`
- **id**: MEM-2026-09-07-06
- **scope**: repo
- **fact**: One deterministic seed and one set of shared factories. No ad-hoc fixtures in tests.
- **why**: Agents inventing their own fixtures makes failures non-reproducible across slices.
- **apply**: Need data that doesn't exist? Add a factory, don't inline an object.
- **evidence**: `TODO.md` §7
- **status**: active

### Tooling config lives in `packages/config`, nowhere else
- **id**: MEM-2026-09-08-02
- **scope**: repo
- **fact**: TypeScript, ESLint, Prettier and Vitest are configured once in `@marketplace/config`
  and consumed by every workspace member through its `exports` map. A package's own
  `tsconfig.json` extends a preset and adds only what is genuinely local (`outDir`, `include`);
  its `eslint.config.js` calls `createEslintConfig()`; its `vitest.config.ts` calls
  `defineWorkspaceConfig()`.
- **why**: Thirteen agents each bringing their own toolchain is how the first cross-slice PR turns
  into a merge conflict in `tsconfig.json`. Tests in `tests/workspace.test.ts` fail the build if a
  member re-declares `strict`, `target`, `module` or `moduleResolution`.
- **apply**: Need a different rule? Change the preset in `packages/config` (an S0 change, proposed
  to `agent-devops`), or layer an override in your own package with a comment saying why. Never
  copy the base options.
- **evidence**: `docs/specs/S0/W0-T01-monorepo-skeleton.md`
- **status**: active

### Every migration carries a hand-written `down.sql`
- **id**: MEM-2026-09-09-14
- **scope**: repo
- **fact**: Prisma generates no down migrations, so each folder in `apps/api/prisma/migrations/`
  holds `migration.sql` **and** `down.sql`, and `apps/api/tests/db.test.ts` fails when one is
  missing or empty. Folders are `NNNN_snake_case`, contiguous from `0000`. Migration `0000`
  creates nothing — it *asserts* PostGIS is installed and raises `POSTGIS_MISSING` if not, because
  `CREATE EXTENSION` needs rights the application role has in no environment.
- **why**: "Reversible" has to be a file a reviewer can read, not a claim in a PR description. And
  a precondition that is only established once, by hand, is a precondition that is eventually not
  established — asserting it per deploy fails the deploy instead of the first geo query.
- **apply**: Adding a migration? Write its `down.sql` in the same commit. A rollback that genuinely
  cannot restore state (a dropped column's data) says so in a comment — it is never absent. Never
  add `CREATE EXTENSION` to a migration; it belongs in `docker/postgres/init` and to Neon.
- **evidence**: `docs/specs/S0/W0-T05-database-toolchain.md` §8; PR #154
- **status**: active

### A seeder runs at most once per database, and the ledger decides
- **id**: MEM-2026-09-09-15
- **scope**: repo
- **fact**: `pnpm db:seed` runs each entry of `apps/api/prisma/seed/registry.ts` whose `id` is not
  already in the `_seed_run` table. The seeder's work and its ledger row are written **in one
  transaction**, so a seeder that throws leaves neither data nor a row claiming it ran. Ids are
  permanent: renaming one makes it run again on every existing database.
- **why**: It is what makes re-running the seed safe, and it means a seeder can `create` rather
  than contorting itself into an `upsert` on a natural key it may not have. Recording *after* the
  run instead would turn any crash into a permanently half-seeded database.
- **apply**: Append to the registry; do not write a standalone seed script. Set `localOnly: true`
  on anything that must never reach a non-loopback database — the guard runs before connecting and
  is the hook `W0-T20` grows into. Order in the array is execution order.
- **evidence**: `apps/api/prisma/seed/run.ts`; `docs/specs/S0/W0-T05-database-toolchain.md` §7
- **status**: active

### The six CI check names are a contract with branch protection
- **id**: MEM-2026-09-09-17
- **scope**: repo
- **fact**: `.github/workflows/ci.yml` declares six jobs — `typecheck`, `lint`, `unit`, `build`,
  `database`, `workflows` — and no aggregate `ci` job. `W0-T13` requires those exact names in
  branch protection, and GitHub matches required checks **by name**: a required check that simply
  never arrives is reported as nothing at all, so renaming a job silently unblocks merges instead
  of failing loudly.
- **why**: An aggregate job also hides which class of thing broke, which is the whole reason the
  gates are separate. Each job runs the *same* `pnpm` script an agent runs locally — a CI-only
  variant command is how "green locally" and "green in CI" become two things to satisfy.
- **apply**: Renaming or removing a job means updating branch protection in the same change. Adding
  a gate means adding a job, not a step inside one. Never add `continue-on-error` or an `if:` to a
  gate job — `tests/ci-workflow.test.ts` fails the build for both.
- **evidence**: `docs/specs/S0/W0-T06-ci-pull-request-checks.md` §4; PR #155
- **status**: active

### Every pull request targets `main` — there is no stacked cadence
- **id**: MEM-2026-09-17-5
- **scope**: repo
- **fact**: No PR is ever opened against another feature branch, for any reason — not for a queued
  series, not for review order. Operator, 2026-09-11: *"There should never a stacked PR setup. this
  already happened another time. All PRs goes against main. always."*
- **why**: A PR merges into the branch named in its `base`. On 2026-09-11 three reviewed and
  approved PRs (#220, #221, #222 — `W12-T03`/`T04`/`T06`) merged into branches `main` had already
  moved past. GitHub showed **MERGED**, `main` had none of the code, and nothing warned — caught
  only by reading `main`'s tree by hand. Recovery was a combined PR (#224). Stacking also imposes a
  merge order on the operator, and a squash of any link strands every branch above it.
- **apply**: When a task depends on an unmerged one, wait for the merge and branch from `main`, or
  branch from `main` and accept the overlap — never chain, and never offer stacking as the fast
  path. If a stack exists, land it as one PR against `main`
  (`git rebase --onto origin/main <old-base> --update-refs`), do not retarget bases. Verify a
  "merged" PR actually reached `main`: `git merge-base --is-ancestor <mergeCommit> origin/main`.
- **evidence**: PRs #220, #221, #222, #224; `memory/slices/agent-devops.md`
- **status**: active

### A docs-only pull request carries `[skip ci]` — it is never a cancelled run
- **id**: MEM-2026-09-17-6
- **scope**: repo
- **fact**: When a PR touches only docs, `TODO.md` or board scripts, `[skip ci]` goes in the commit
  subject **and** in the squash-merge subject. Runs are not allowed to start and then be cancelled.
- **why**: `deploy-preview.yml` fires on every `pull_request` and creates a **real Fly app and a
  real Neon branch** before a `gh run cancel` could land. The merge-commit copy is what governs `CI`
  and `Deploy staging` on the push to `main`, so skipping only the branch commit still fires both.
- **apply**: `gh pr merge --squash --subject "… [skip ci]"` — the default squash subject comes from
  the PR title and will not carry it. Run the gates locally instead and say so in the PR body.
  Never use this to dodge a red gate on a code change.
- **evidence**: PRs #169, #193 (zero runs on either); `.github/workflows/deploy-preview.yml`
- **status**: active

### An endpoint parses the response it serves, not just the request it receives

- **id**: MEM-2026-09-17-11
- **scope**: repo
- **fact**: `GET /api/search` ends with `SearchResponseSchema.parse(...)` before returning. The
  outbound parse is what makes a `strictObject` projection and a refinement like the coarse-point
  rule enforceable at runtime; types are erased, so a handler that spreads a database row into a
  typed return value satisfies the compiler and ships the extra columns.
- **why**: The exclusions in these schemas are doing security work — no `userId`, no
  `baseAddressId`, and above all no `line1`/`line2`, because a provider's base address is usually
  their home. "We return the right fields" is a convention until something fails on the wrong ones.
  It paid for itself on the first ticket that used it, by turning a latent contract defect into a
  failing test rather than a wrong map pin nobody would have noticed.
- **apply**: Parse on the way out at every endpoint boundary, and be suspicious of a mock that does
  not — `apps/web/mocks/handlers.ts` returns its search body unparsed, which is precisely why
  `MEM-2026-09-17-9` survived four storefront tickets that were all "tested against the contract".
- **evidence**: `apps/api/src/modules/search/routes.ts`; `docs/specs/S5/W3-T05-geo-search.md` §2.7
- **status**: active
