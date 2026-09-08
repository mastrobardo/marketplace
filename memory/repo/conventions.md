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
