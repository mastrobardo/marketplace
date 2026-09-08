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
