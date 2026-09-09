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
