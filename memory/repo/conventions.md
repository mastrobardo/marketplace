# Repo memory — conventions

How we do things here, beyond what lint and CI enforce automatically.

### Branch, spec and run record travel together
- **id**: MEM-2026-09-07-04
- **scope**: repo
- **fact**: Branch `<TASK-ID>-<slug>` must contain `docs/specs/<slice>/<feature>.md` and
  `<feature>.run.md`. Gate `spec-present` enforces it.
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
