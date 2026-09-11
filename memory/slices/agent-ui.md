# Slice memory — agent-ui

Durable knowledge for this slice only. Written and owned by this agent alone. Read it at the start
of every task; add to it at the end of every task that taught you something reusable.

Entry format (see `agents/policies/memory.md`):

```markdown
### <short title>
- **id**: MEM-<date>-<n>
- **scope**: slice:S10
- **fact**:
- **why**:
- **apply**:
- **evidence**: <PR / file:line / ADR / intervention id>
- **status**: active
```

Keep it to facts that changed how you would work. Task-specific detail stays in the session file.

---

### A route module exports the route contract and nothing else
- **id**: MEM-2026-09-11-01
- **scope**: slice:S10
- **fact**: `apps/web/src/routes/*.tsx` exports `Component` and, where relevant, `loader`,
  `action`, `ErrorBoundary`, `meta`, `handle`, `shouldRevalidate`. A helper, a constant or a second
  component belongs in `apps/web/src/shared/`. `apps/web/tests/route-modules.test.ts` imports every
  route module **in a node environment with no DOM** and fails on both counts.
- **why**: ADR-011's claim that server rendering is a switch rather than a rewrite is only true if
  every route written between now and `W12-T14` is shaped for it. A route that needs a browser to
  *import* is the most common SSR migration failure and is invisible in an app that only ever loads
  in a browser.
- **apply**: Adding a page? Add a module under `src/routes/`, export `Component`, and wire it into
  `src/app/routes.tsx`. Do not re-create `src/pages/`.
- **evidence**: `docs/specs/S10/W12-T01-ui-package-and-route-rules.md` AC8–AC10; ADR-011 R1
- **status**: active

### The route rules are a local ESLint plugin, and deliberately narrow
- **id**: MEM-2026-09-11-02
- **scope**: slice:S10
- **fact**: `apps/web/eslint/route-rules.js` holds three rules — `no-module-scope-browser-global`
  (R2), `no-module-scope-mutable` (R5), `no-fetch-in-component` (R3) — applied by
  `apps/web/eslint.config.js` to `src/routes/**` and `src/features/**` only. R5's rule flags `let`,
  `var` and `new Map/Set/WeakMap/WeakSet` at module scope; it does **not** flag a constant array or
  object.
- **why**: `no-restricted-globals` and `no-restricted-syntax` cannot see scope, and R2 has to allow
  inside an effect what it bans at module scope. And a rule that flags a frozen constant is an
  obstacle rather than a gate — the narrowing is what keeps it switched on.
- **apply**: Extending them? `tests/route-rules.test.ts` has both halves — `RuleTester` for the
  logic and a lint through the app's *real* config for the wiring. Keep both; a rule attached to no
  glob is green forever. When `packages/contracts` exports a client, `no-fetch-in-component` gains
  a banned-import list (spec §10 Q2). When `W9` becomes a second consumer, the rules move to
  `packages/config` as an `agent-devops` change (§10 Q1).
- **evidence**: `docs/specs/S10/W12-T01-ui-package-and-route-rules.md` §4.3, AC11–AC14
- **status**: active

### Tokens are served from source, not from the build
- **id**: MEM-2026-09-11-03
- **scope**: slice:S10
- **fact**: `@marketplace/ui/tokens.css` maps to `src/styles/tokens.css`, not to `dist/`. The `.`
  entry is built (Vite library mode for JS, `tsconfig.build.json` for declarations — the base
  preset sets `noEmit`, which cannot be combined with `emitDeclarationOnly`).
- **why**: Plain custom properties have nothing to compile, and a consumer that must build the
  package before it can read a colour is a consumer that will hardcode the colour.
- **apply**: Keep `src/styles` in `files`. Compiled CSS Modules output is a *separate* export
  (`./styles.css`) added by `W12-T02`; do not move the tokens behind the build to unify them.
- **evidence**: `packages/ui/package.json`; spec §4.1; `apps/web/tests/ui-package.test.ts`
- **status**: active
