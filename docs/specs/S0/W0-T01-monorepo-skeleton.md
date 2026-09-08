# Spec — W0-T01 monorepo skeleton

|               |                                                      |
| ------------- | ---------------------------------------------------- |
| **Task**      | `W0-T01` `[A]`                                       |
| **Slice**     | S0 Platform                                          |
| **Owner**     | `agent-devops`                                       |
| **Reviewers** | `agent-contracts`, `agent-qa`                        |
| **Issue**     | https://github.com/mastrobardo/marketplace/issues/33 |
| **Status**    | draft                                                |

---

## 1. Purpose

Every other task in `TODO.md` §6 is blocked on this one. Thirteen slice agents are about to write
code in parallel across two apps and four shared packages; without a workspace that resolves and a
single place that defines TypeScript, lint and format rules, each of them will bring its own
toolchain and the first cross-slice PR will be a merge conflict in `tsconfig.json`.

The people who suffer without it are the slice agents (`agent-identity` cannot start `W2-T01` until
`apps/api` is a resolvable workspace member) and the human operator, who otherwise reviews thirteen
subtly different lint configurations instead of thirteen features.

## 2. User stories

- **As a developer**, I want one repo holding the API, the web app and the shared packages, so that
  agents can work on different parts without fighting over tooling.
- **As a slice agent**, I want to add a package and inherit TypeScript, ESLint, Prettier and Vitest
  settings by extending one preset, so that I never make a toolchain decision that belongs to S0.
- **As a reviewer**, I want tooling config to live in exactly one package, so that a diff touching
  lint rules is obviously an S0 change and obviously out of bounds for anyone else.
- **As a new contributor (human or agent)**, I want one command to install everything, so that
  onboarding is not a sequence of undocumented steps.

## 3. State machine

Not applicable — build configuration has no runtime state.

## 4. API surface

No HTTP surface. The package's public surface is the export map of `@marketplace/config`, which is
consumed at build time:

| Import specifier                          | Kind                | Consumed by                                   |
| ----------------------------------------- | ------------------- | --------------------------------------------- |
| `@marketplace/config/tsconfig/base.json`  | JSON                | every package's `tsconfig.json` via `extends` |
| `@marketplace/config/tsconfig/node.json`  | JSON                | `apps/api`, node-target packages              |
| `@marketplace/config/tsconfig/react.json` | JSON                | `apps/web`, `packages/ui`                     |
| `@marketplace/config/eslint`              | ESM + CJS + `.d.ts` | every `eslint.config.js`                      |
| `@marketplace/config/prettier`            | ESM + CJS + `.d.ts` | root `prettier.config.js`                     |
| `@marketplace/config/vitest`              | ESM + CJS + `.d.ts` | every `vitest.config.ts`                      |

The three JS entry points are authored in TypeScript under `src/` and **built with tsup** to dual
ESM/CJS plus declarations. The tsconfig presets stay plain JSON: `extends` cannot consume a bundle.

## 5. Permissions matrix

Not a runtime feature; the equivalent constraint is charter ownership, which CI enforces later
(`W0-T15` `agents-drift`) and review enforces now:

| Actor             | `packages/config/**` | `pnpm-workspace.yaml`, root `package.json`, `turbo.json` | `apps/*/package.json`        |
| ----------------- | -------------------- | -------------------------------------------------------- | ---------------------------- |
| `agent-devops`    | write                | write                                                    | write                        |
| every other agent | propose only         | propose only                                             | write (their own app's deps) |

## 6. Error cases

| Condition                                                                  | Surfaces as                                            | Expected behaviour                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| A workspace member is missing from the `pnpm-workspace.yaml` globs         | `pnpm install` does not link it; imports fail at build | test `workspace globs cover every package.json` fails                 |
| A package re-declares a compiler option already set in the base            | silent drift between packages                          | test `no package overrides base compiler options` fails               |
| `@marketplace/config` is resolved by hoisting rather than a workspace link | works locally, breaks in CI with an isolated store     | test asserts the resolved path is inside `packages/config`            |
| A lint violation is not reported                                           | bad code merges                                        | test lints a fixture with a known violation and asserts it is flagged |

## 7. Acceptance criteria

1. **Given** a clean checkout, **when** I run `pnpm install` and nothing else, **then** every
   workspace member's dependencies are installed and workspace links are created.
2. **Given** the workspace globs in `pnpm-workspace.yaml`, **when** I enumerate every directory
   containing a `package.json` under `apps/` and `packages/`, **then** every one of them is matched
   by a glob and is named `@marketplace/<dir>`.
3. **Given** `apps/api` and `apps/web`, **when** each resolves `@marketplace/config`, **then** the
   resolved path is inside `packages/config` — proving a workspace link, not a hoisted copy.
4. **Given** the shared TypeScript base, **when** any workspace package's `tsconfig.json` is read,
   **then** it extends a `@marketplace/config/tsconfig/*` preset and re-declares none of the
   options the base already sets (`strict`, `target`, `module`, `moduleResolution`).
5. **Given** the base preset, **when** it is inspected, **then** `strict` is `true` and
   `noUncheckedIndexedAccess` is `true`.
6. **Given** the shared ESLint flat config, **when** it lints a fixture containing an explicit
   `any` and an unused variable, **then** both are reported as errors.
7. **Given** the shared ESLint config, **when** it lints a file that Prettier would reformat,
   **then** no formatting rule fires — formatting is Prettier's job alone, and the two do not
   contradict each other.
8. **Given** the shared Prettier config, **when** it is loaded, **then** it exports a config object
   and formatting a fixture with it is idempotent.
9. **Given** `packages/config` has been built, **when** each documented subpath in §4 is imported,
   **then** it resolves and its `.d.ts` exists.
10. **Given** the repo root, **when** I run `pnpm typecheck`, `pnpm lint`, `pnpm test` and
    `pnpm build`, **then** each completes successfully across every workspace member.

## 8. Data

No Prisma models, no migrations. `W0-T05` owns the first schema.

## 9. Out of scope

- **docker-compose** (Postgres/PostGIS, MailHog, MinIO) — `W0-T02`.
- **The Fastify application** — health route, config loading, error envelope, pino — `W0-T03`.
  `apps/api` exists here only as a resolvable workspace member with a placeholder entry point.
- **The Vite/React application** — router, layout, i18n, theme — `W0-T04`. Same caveat for
  `apps/web`.
- **Prisma** — `W0-T05`.
- **GitHub Actions workflows and the CI gates** — `W0-T06`, `W0-T12`, `W0-T15`, `W0-T21`. This task
  makes the gates _runnable_ as local commands; it does not wire them to CI.
- **`packages/contracts`, `packages/ui`, `packages/testing`** — owned by `agent-contracts`,
  `agent-ui` and `agent-qa` respectively. Creating them here would put S0 inside another slice's
  boundary (`AGENTS.md` L4). They join the workspace when their owners create them; the globs
  already cover them.
- **`.env.example`** — `W0-T09`; nothing here reads configuration.

## 10. Open questions

None blocking. Two decisions taken by the operator during planning, recorded here so a reviewer
does not re-open them:

- **Turborepo is included** at minimal scope (`build`, `lint`, `typecheck`, `test` graph).
  `turbo.json` is already in the `agent-devops` charter's `owns:` list and `.turbo/` is already in
  `.gitignore`, so the repo anticipated it; the `W0-T01` line in `TODO.md` §6 does not name it.
  Confirmed by the operator on 2026-09-08.
- **`apps/api` and `apps/web` stubs are created in this task** rather than in `W0-T03`/`W0-T04`,
  because acceptance criterion 3 is not testable without at least one workspace member under
  `apps/`. The stubs contain no code under `src/modules/**` or `src/features/**`, which are
  forbidden to `agent-devops`. Confirmed by the operator on 2026-09-08.
