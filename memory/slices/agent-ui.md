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

### React Aria conveys invalidity by linking the message, not with `aria-invalid`
- **id**: MEM-2026-09-11-04
- **scope**: slice:S10
- **fact**: On `Select` the trigger is a `button`, so React Aria does not put `aria-invalid` on it.
  It links the error message with `aria-describedby`, marks the wrapper `data-invalid` for styling,
  and puts the constraint on the hidden native select. `TextInput` *does* get `aria-invalid`,
  because there the control is an input.
- **why**: I asserted the attribute I expected, React Aria dropped the prop, and the test failed —
  correctly. Forcing the attribute through would have produced markup that looks right in a diff and
  is not what the ARIA practices say.
- **apply**: Assert the linked message and `data-invalid`, not the attribute. More generally: when a
  React Aria prop seems not to work, read the rendered DOM before working around it.
- **evidence**: `packages/ui/tests/primitives.test.tsx` AC11; `docs/specs/S10/W12-T02-ui-primitives.md` §7
- **status**: active

### React Aria filters uncontrolled collections only, and its own strings are English
- **id**: MEM-2026-09-11-05
- **scope**: slice:S10
- **fact**: A `ComboBox` given controlled `items` does **not** filter — that is the caller's job
  (`useFilter`, `sensitivity: 'base'`, which matches *València* for `valencia`). It also closes a
  menu with an empty collection unless `allowsEmptyCollection` is set, which otherwise makes both
  the loading and the no-match states unreachable. Separately, React Aria's built-in strings default
  to English: a `Select` with no placeholder renders *"Select an item"*.
- **why**: Each of the three is invisible until a specific state happens, and two of them are states
  an ES-first product hits on day one.
- **apply**: Controlled combobox → filter it yourself, locale-aware. Empty states →
  `allowsEmptyCollection`. And wrap `apps/web` in `<I18nProvider locale="es-ES">` when the shell is
  built (`W12-T09`).
- **evidence**: `packages/ui/src/primitives/Combobox.tsx`; spec §10 Q2 and Q3
- **status**: active

### The design system holds no copy and bundles no React Aria
- **id**: MEM-2026-09-11-06
- **scope**: slice:S10
- **fact**: Every user-visible string in `packages/ui` is a prop with a Spanish default —
  `pendingLabel`, `loadingLabel`, `emptyLabel`, `suggestionsLabel`, `placeholder`. And the library
  build lists `react-aria*` as `external`, with `sideEffects: ["*.css"]`.
- **why**: Copy in the design system means an i18n dependency in a package that must stay
  domain-free. And inlining React Aria made the entry point 339 KB — `apps/web` would have pulled
  all of it in to use one `Button`, failing ADR-011's ≤170 KB budget one task later and looking like
  the page's fault. External: 8.81 KB.
- **apply**: Adding a component? Its strings are props. Adding a dependency to this package? Ask
  whether the consumer should bundle it instead, and check `dist/index.js` in the build output.
- **evidence**: `packages/ui/vite.config.ts`; `docs/specs/S10/W12-T02-ui-primitives.run.md`
- **status**: active

### The workbench is two Vitest projects, and one command runs both
- **id**: MEM-2026-09-11-07
- **scope**: slice:S10
- **fact**: `packages/ui/vitest.config.ts` declares `unit` (jsdom: behaviour, boundaries, tokens,
  wiring) and `storybook` (real Chromium via `@storybook/addon-vitest`: every story with its `play`).
  `pnpm test` runs both, so a browser is a genuine prerequisite —
  `pnpm --filter @marketplace/ui exec playwright install chromium`, and a step in CI's `unit` job.
  Storybook ≥10.3 applies `preview.tsx`'s annotations to the browser project itself: **do not** add
  a setup file that calls `setProjectAnnotations`.
- **why**: A separate `test:stories` script is a suite that stops running the first time someone
  forgets to call it — and from `W12-T04` that suite is the accessibility gate. The browser
  prerequisite is the price of the gate being real.
- **apply**: Adding a component? Its stories are its browser tests; nothing else to wire. Assertions
  a browser cannot make — a story that was never written — stay in the jsdom project.
- **evidence**: `docs/specs/S10/W12-T03-storybook-workbench.md` §4.3; `packages/ui/vitest.config.ts`
- **status**: active
