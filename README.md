# marketplace

Marketplace for reformas, mantenimiento and urgencias — Spain first, EUR. A Fastify + Prisma API and
a separate Vite/React SPA in one pnpm workspace, joined only by `packages/contracts`.

The plan lives in [`TODO.md`](TODO.md). Most of the code is written by agents; how they are expected
to work is [`agents/AGENTS.md`](agents/AGENTS.md), and it is worth reading before the code.

## Getting started

```bash
pnpm install
```

That is the whole setup. It links every workspace member and builds `@marketplace/config`, which the
lint and test configs import at load time.

```bash
pnpm verify   # typecheck · lint · format:check · test · build — the local gate
pnpm test     # vitest across the workspace
pnpm format   # prettier --write
```

Requires Node ≥ 22.11 (`.nvmrc` pins 22.22.0) and pnpm ≥ 10.13.

## Running the web app

```bash
pnpm --filter @marketplace/web dev        # http://127.0.0.1:5173
```

### Strings

Spanish is the **source of truth**. Add a key to `src/i18n/locales/es.ts`; `en.ts` then fails to
compile until it is translated, and `t('typo.here')` fails to compile anywhere. That is what
"no hardcoded strings" (`TODO.md` §5.3) is enforced by — not review.

Keys are flat and dotted (`nav.home` is one key, not `home` under `nav`), which is why
`keySeparator` and `nsSeparator` are `false` in `src/i18n/index.ts`. **Do not remove them**: at
i18next's defaults every lookup would miss and render the raw key to the user.

The enforcement itself is tested. `apps/web/tests/fixtures/` holds three tiny TypeScript projects —
one that must compile and two that must not — and `tests/i18n.test.ts` asserts `tsc`'s exit code
for each.

### Colour and spacing

Every design value is a `--mp-`-namespaced custom property in `src/styles/tokens.css`. A colour
literal anywhere else fails the build, and so does a light-theme colour with no dark counterpart.
`agent-ui` owns that file and builds `packages/ui` on top of it.

### Adding a page

Add a route as a **child** of the layout route in `src/app/routes.tsx` so it inherits the shell.
Your page owns its own single `<h1>`; the layout has none.

> TypeScript is pinned to `~5.9.3` on purpose. TS 7 breaks `typescript-eslint` and declaration
> emit — see `memory/repo/gotchas.md` MEM-2026-09-08-01 for the condition to unpin.

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API. Skeleton — `W0-T03` brings the server, `W0-T05` Prisma. |
| `apps/web` | Vite + React SPA — router, layout shell, ES/EN i18n, theme tokens. |
| `packages/config` | The one place TypeScript, ESLint, Prettier and Vitest are configured. |
| `agents/` | Charters, prompt templates and policies for the agents building this. |
| `memory/` | What agents know across sessions. |
| `docs/adr`, `docs/specs` | Decisions, and one spec + run record per feature. |

## Adding a workspace package

`apps/*` and `packages/*` are picked up automatically. A new member needs four things, and
`tests/workspace.test.ts` fails the build if it is missing any of them:

1. `package.json` named `@marketplace/<dir>`, with `@marketplace/config` as a dev dependency.
2. `tsconfig.json` extending `@marketplace/config/tsconfig/node.json` or `/react.json` — and
   **not** re-declaring `strict`, `target`, `module` or `moduleResolution`.
3. `eslint.config.js` exporting `createEslintConfig()`.
4. `vitest.config.ts` exporting `defineWorkspaceConfig()`.

Copy `apps/api` — it is the smallest complete example.
