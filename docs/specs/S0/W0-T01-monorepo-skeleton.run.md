# Run record — W0-T01 monorepo skeleton

| | |
|---|---|
| **Agent** | `agent-devops` |
| **Model** | `claude-opus-5` |
| **Skills used** | `test-driven-development`, `ci-cd-and-automation`, `incremental-implementation`, `git-workflow-and-versioning` |
| **Started** | 2026-09-08T23:30Z |
| **Branch** | `W0-T01-monorepo-skeleton` |
| **Issue** | https://github.com/mastrobardo/marketplace/issues/33 |
| **Spec** | [`W0-T01-monorepo-skeleton.md`](W0-T01-monorepo-skeleton.md) |

---

## Prompts

### 1. Task assignment (operator, verbatim)

> start with https://github.com/mastrobardo/marketplace/issues/33. tsup is a nice way to share configs

The second sentence is the only design steer given, and it decided the shape of `packages/config`:
presets authored in TypeScript under `src/`, built to dual ESM/CJS with declarations, consumed
through an `exports` map. The tsconfig presets stayed plain JSON because `extends` cannot read a
bundle — that is the one place the steer does not apply.

### 2. Plan confirmation (operator, verbatim)

A numbered plan was presented before any file was written, per the repo's workflow rule. Two calls
were flagged as needing a veto:

> **Turborepo included** at minimal scope … say the word and I'll drop it
> **`apps/api` / `apps/web` stubs created here** rather than in T03/T04, because "workspaces
> resolve across apps and packages" isn't testable without at least one member under `apps/`

Operator reply, verbatim:

> I confirm both points

### 3. Corrections

No corrective re-prompt was needed. Three implementation reversals happened inside the green phase,
all driven by tool output rather than by a human telling the agent it was wrong — see *Deviations*.

---

## Red phase

Harness only (`vitest`, `yaml`, `eslint`, `prettier`, `typescript` at the root) — no
`pnpm-workspace.yaml`, no `packages/config`, no apps. 22 assertions derived one-for-one from the
spec's acceptance criteria.

The first run was **19 failed / 3 passed**, and the 3 passes were the bug: they iterated
`workspaceDirs()`, which was empty, so `for (const dir of [])` asserted nothing. A vacuous pass is
worse than a failure because it stays green forever. Each looping test got an explicit
`expect(dirs.length).toBeGreaterThan(0)` guard, after which the suite was honestly red:

```
⎯⎯⎯⎯⎯⎯ Failed Tests 22 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/config-package.test.ts > AC3 — apps resolve the shared config through a workspace link > resolves @marketplace/config from apps/api to packages/config
 FAIL  tests/config-package.test.ts > AC3 — apps resolve the shared config through a workspace link > resolves @marketplace/config from apps/web to packages/config
 FAIL  tests/config-package.test.ts > AC9 — every documented subpath is exported and typed > exports ./eslint
 FAIL  tests/config-package.test.ts > AC9 — every documented subpath is exported and typed > exports ./prettier
 FAIL  tests/config-package.test.ts > AC9 — every documented subpath is exported and typed > exports ./vitest
 FAIL  tests/config-package.test.ts > AC9 — every documented subpath is exported and typed > exports ./tsconfig/base.json
 FAIL  tests/config-package.test.ts > AC9 — every documented subpath is exported and typed > ships built ESM, CJS and declarations for ./eslint
 FAIL  tests/config-package.test.ts > AC9 — every documented subpath is exported and typed > ships built ESM, CJS and declarations for ./prettier
 FAIL  tests/config-package.test.ts > AC9 — every documented subpath is exported and typed > ships built ESM, CJS and declarations for ./vitest
 FAIL  tests/config-package.test.ts > AC6/AC7 — the shared ESLint config catches real problems and defers formatting > reports an explicit any
 FAIL  tests/config-package.test.ts > AC6/AC7 — the shared ESLint config catches real problems and defers formatting > reports an unused variable
 FAIL  tests/config-package.test.ts > AC6/AC7 — the shared ESLint config catches real problems and defers formatting > reports nothing about formatting Prettier owns
 FAIL  tests/config-package.test.ts > AC8 — the shared Prettier config is loadable and idempotent > exports a config object
 FAIL  tests/config-package.test.ts > AC8 — the shared Prettier config is loadable and idempotent > formats idempotently
 FAIL  tests/config-package.test.ts > AC10 — the shared Vitest preset is usable > exports a base config with the workspace defaults
 FAIL  tests/workspace.test.ts > AC1/AC2 — pnpm workspace resolves across apps and packages > declares workspace globs covering apps and packages
 FAIL  tests/workspace.test.ts > AC1/AC2 — pnpm workspace resolves across apps and packages > matches every package.json in the repo with a workspace glob
 FAIL  tests/workspace.test.ts > AC1/AC2 — pnpm workspace resolves across apps and packages > names every workspace member @marketplace/<dir>
 FAIL  tests/workspace.test.ts > AC1/AC2 — pnpm workspace resolves across apps and packages > pins the package manager and the node engine at the root
 FAIL  tests/workspace.test.ts > AC4/AC5 — one shared TypeScript base, extended not copied > has every workspace member extend a shared preset
 FAIL  tests/workspace.test.ts > AC4/AC5 — one shared TypeScript base, extended not copied > lets no workspace member re-declare an option the base already sets
 FAIL  tests/workspace.test.ts > AC4/AC5 — one shared TypeScript base, extended not copied > makes the base strict

 Test Files  2 failed (2)
      Tests  22 failed (22)
```

## Green phase

```
$ rm -rf node_modules */*/node_modules packages/config/dist .turbo
$ pnpm install          # nothing else — AC1
Done in 2.3s using pnpm v10.13.1
$ pnpm verify           # typecheck && lint && format:check && test && build
 Tasks:    4 successful, 4 total     (typecheck)
 Tasks:    4 successful, 4 total     (lint)
 Test Files  2 passed (2)
      Tests  22 passed (22)
 Tasks:    3 successful, 3 total     (build)
verify -> 0
```

`pnpm install` alone is sufficient because the root `prepare` script builds `@marketplace/config`
after linking. Without it, the root `eslint.config.js` would import a `dist/` that does not exist
yet on a fresh clone.

## Deviations from spec

Three, all forced by tool behaviour discovered during the green phase, none changing the
acceptance criteria:

1. **TypeScript is pinned to `~5.9.3`, not the latest `7.0.2`.** The registry now serves TS 7 (the
   native port). `typescript-eslint@8` refuses to load under it — `Error: typescript-eslint does not
   support TS 7.0` — which takes out the `lint` gate entirely. The lint gate is not optional
   (`agents/roles/agent-devops.md`: "a gate that is flaky gets fixed, never skipped"), so the
   compiler is pinned until typescript-eslint ships TS 7 support. Recorded as a gotcha in
   `memory/repo/gotchas.md` with the removal condition, so this is revisited rather than inherited.
2. **`rollup-plugin-dts` (tsup's `dts: true`) also broke under TS 7** with
   `TypeError: Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')`. The
   interim fix was emitting declarations with `tsc -p tsconfig.build.json` alongside the tsup
   bundles. Once TypeScript was pinned to 5.9 for reason (1), `dts: true` worked, so the extra
   tsconfig and the two-step build script were **reverted** — one tool, as the operator's steer
   intended. Noted here because the reverted approach is the fallback if TS is unpinned later.
3. **`export default` was removed from `eslint.ts` and `vitest.ts`, and the named export from
   `prettier.ts`.** Rollup warns that mixing named and default exports forces CJS consumers to reach
   for `chunk.default`. One export shape per module: named factories for eslint/vitest, a bare
   default for prettier (which is how `prettier.config.js` consumes it).

Two test-side corrections, both fixing an assertion that encoded a wrong guess rather than the
requirement:

- **AC3** stripped a `/node_modules/…` suffix that never appears — pnpm resolves the workspace
  symlink to its realpath. The assertion now checks the resolved path is *under* `packages/config`
  **and** contains no `node_modules` segment, which is the stronger claim: a hoisted copy would fail
  both halves.
- **AC9** asserted a flat `{types, import, require}` export entry. That would hand CJS consumers the
  ESM `.d.ts`. Corrected to the nested per-condition form so `require` resolves `.d.cts`.

## Scope notes

- **The spec and run record carry the task ID** (`W0-T01-monorepo-skeleton.md`, not
  `monorepo-skeleton.md`). Operator convention, set during this task: branch, spec and run record
  share one `<TASK-ID>-<slug>` name, so a task is greppable by ID across git and the tree. The
  places that define the naming were updated to match — `TODO.md` §5.1/§5.2, `agents/AGENTS.md` L2,
  prompts `00`, `02`, `05`, `06`, `08`, and `memory/repo/conventions.md` MEM-2026-09-07-04.

- **`.prettierignore` excludes `**/*.md`.** Running the formatter over the repo rewrote 71 markdown
  files — `TODO.md` alone churned 399 lines — and reformatted `.claude/agents/**`, which is
  generated by `scripts/generate-claude-agents.ts` and would have broken the future `agents-drift`
  gate. Prose here is hand-wrapped at 100 columns on purpose.
- **`docs/board/stories.ts` and `scripts/*.ts` were formatted** and are in a **separate commit**.
  `stories.ts` churns ~1200 lines; keeping it out of the feature commit keeps the diff reviewable.
- **One pre-existing lint error fixed**: `scripts/update-issues.ts:72` `let missing` → `const`.
  In-bounds (`scripts/**` is in this agent's `owns:`) and necessary for the new gate to pass.
- **`no-console` is off for `scripts/**` only**, scoped in the root config rather than weakened in
  the shared preset. Operator CLIs print; application code should not.

## Self-assessment

- **Weakest part of this change**: the ESLint preset is syntactic only — no `projectService`, so no
  type-aware rules. That was a deliberate trade for the ~10 minute PR budget in the charter, but it
  means rules like `no-floating-promises` are absent exactly where they will matter most (S9 money,
  S8 emergency). A follow-up task should add an opt-in type-aware layer for the API package.
- **Second weakest**: the `no-restricted-syntax` rule guarding "money is integer cents" pattern-matches
  property names ending in `amount`. It will catch the obvious cases and miss `price`, `total`, `fee`.
  It is a nudge, not a gate — the real enforcement is the Money value object in `W1-T06`.
- **What a reviewer should look at hardest**: the TypeScript pin. It is the one decision here that
  every other agent inherits silently and that will rot if nobody revisits it. Second: whether
  `prepare` is the right hook for building `packages/config` on install — it makes `pnpm install`
  self-sufficient, but it also means every install pays a tsup build.
- **Not verified**: nothing runs in CI yet (`W0-T06`). `pnpm verify` passing on this machine is the
  only evidence, and it was run from a clean `node_modules` to make that evidence worth something.
