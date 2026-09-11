# W12-T01 — `packages/ui`, and the rules that keep server rendering a switch

Task: `W12-T01` · Slice: S10 · Owner: `agent-ui` · Issue: #201
Branch: `W12-T01-ui-package-and-route-rules` · Run record: `W12-T01-ui-package-and-route-rules.run.md`
Design: [ADR-011](../../adr/ADR-011-web-application-architecture.md) (rules R1–R6),
[ADR-012](../../adr/ADR-012-design-system-and-component-workbench.md) (`packages/ui`, tokens)

---

## 1. Purpose

`packages/ui` is in the target tree in `TODO.md` §2 and owns slice S10 in §4, and it does not
exist. `apps/web/src/styles/tokens.css` exists, is good, and has a real gate behind it — and
nothing consumes it, because there is nothing to consume it *from*. Meanwhile ADR-011 records six
rules (R1–R6) whose entire value is that they are true **before** there is code to retrofit, and
records them as prose.

Who suffers without this: the next twelve slice agents. The first one that needs a button writes
one; the second writes a slightly different one; and `W10-T05` then buys WCAG compliance the most
expensive way there is. And the first route module that reads `window` at import time costs
nothing today and costs the whole SSR migration in `W12-T14` — the migration ADR-011 justifies by
claiming it is a switch rather than a rewrite. A convention that is not a gate does not survive a
deadline (`TODO.md` R11, and the run-record decay ADR-010 documents).

This task therefore buys three things and no features: the package, the gates, and the shape the
gates apply to.

**Restructuring, and what it costs** (prompt `00-spec-authoring.md` requires this stated, after
`W0-T23`). Two moves: `tokens.css` from `apps/web/src/styles/` into `packages/ui/src/styles/`, and
`apps/web/src/pages/*` into `apps/web/src/routes/*` as route modules. The first is named by the
ticket and by ADR-012's consequences. The second is three files, touched by nobody else today, and
without it the ADR-011 lint globs (`src/routes/**`, `src/features/**`) match no file in the repo —
a gate over an empty set, which is the failure mode `docs/interventions/2026-09-09-W0-T23-01.md`
and `memory/repo/gotchas.md` both warn about from the other direction. The standing cost is that
every future page is a route module rather than a page component; that is ADR-011's decision, not
this spec's.

---

## 2. User stories

- **As a slice agent**, I want one package that already holds the tokens, so that my first
  component has somewhere to live that is not my own feature folder.
- **As the agent who executes `W12-T14`**, I want a route that cannot import a browser global at
  module scope, so that flipping on server rendering is a build change rather than an archaeology
  project across three hundred components.
- **As a reviewer**, I want R2, R3 and R5 to fail a pull request, so that "no `window` at module
  scope" is something I can stop reading diffs for.
- **As `agent-devops`**, I want the new gates to run inside the `unit` job that already exists, so
  that a new suite cannot be silently absent from CI (`memory/repo/gotchas.md` — the `database`
  job names its suites by hand and a new file is skipped while the run stays green).
- **As the next agent to add a route**, I want the shape test to tell me the export is wrong, so
  that R1 holds without anyone policing it in review.

## 3. State machine

None. A package, a lint configuration and two test suites have no lifecycle. The rendering-mode
state machine that motivates them is ADR-011's, and it is executed by `W12-T14`.

## 4. API surface

No HTTP endpoints. The surface is a new workspace package and one changed import in `apps/web`.

### 4.1 `@marketplace/ui`

```jsonc
{
  "name": "@marketplace/ui",
  "exports": {
    ".": { "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
    "./tokens.css": "./src/styles/tokens.css"
  }
}
```

Two entries, deliberately different in kind:

- `.` is **built** — Vite library mode for the JS (it is the builder Storybook, CSS Modules and
  React Aria all want in `W12-T02`/`W12-T03`) plus `tsc --emitDeclarationOnly` for the types. No
  new build tool: both are already workspace dependencies. It exports nothing yet; `W12-T02` fills
  it. The wiring is the deliverable, because an exports map discovered to be wrong *after* seven
  components depend on it is a much worse afternoon.
- `./tokens.css` is **served from source**. It is plain CSS custom properties — there is nothing to
  compile, and a consumer that must run a build before it can read a colour is a consumer that will
  hardcode the colour. `W12-T02` adds `./styles.css` for compiled CSS Modules output.

`packages/ui` never imports `packages/contracts` (ADR-012). Nothing in this task tests that,
because there is nothing here to import it from; the gate belongs to `W12-T02`.

### 4.2 The route-module contract (ADR-011 R1)

A file in `apps/web/src/routes/` exports `Component`, and may export `loader`, `action`,
`ErrorBoundary`, `meta`, `handle` and `shouldRevalidate`. Nothing else — no helper, no constant, no
default export. `src/app/routes.tsx` assembles them into the `RouteObject[]` the router consumes.

### 4.3 The three lint rules

A local flat-config plugin at `apps/web/eslint/route-rules.js`, applied only to
`apps/web/src/routes/**` and `apps/web/src/features/**`:

| Rule | ADR-011 | Reports |
|---|---|---|
| `no-module-scope-browser-global` | R2 | `window`, `document`, `localStorage`, `sessionStorage`, `matchMedia`, `navigator` referenced outside any function |
| `no-module-scope-mutable` | R5 | a module-scope `let`/`var`, or a module-scope `const` initialised with `new Map`/`Set`/`WeakMap`/`WeakSet` |
| `no-fetch-in-component` | R3 | a call to the global `fetch` anywhere but inside a `loader` or `action` |

**Why a plugin and not `no-restricted-globals` + `no-restricted-syntax`.** Both rules are
scope-blind: they can ban `document` in a file, and R2 bans it *at module scope only* — inside an
effect or a handler it is correct and necessary. A selector that approximates "at module scope"
either misses `export const x = window.matchMedia(...)` or fires inside a callback, and a gate that
cries wolf is turned off within a week. Three small rules with ESLint's scope analysis are ~90
lines and are exactly right. They are testable with `RuleTester`, which the approximation is not.

**Why `no-module-scope-mutable` is narrower than "no mutable module scope".** R5 names a data-leak
class: `const cache = new Map()` is per-user in a browser and shared between all users on a server.
A frozen constant array of nav items is not that, and banning it would make the rule an obstacle
rather than a gate. `let`/`var` and the four collection constructors are the cache shapes; the rule
says so in its message.

**Why the rules live in `apps/web` and not `packages/config`.** `MEM-2026-09-08-02` puts shared
tooling config in `packages/config` and explicitly permits a package layering its own override with
a comment saying why. These rules encode ADR-011, which is about `apps/web`; there is one consumer.
`packages/config` is owned by `agent-devops`, so promoting them there is a cross-slice change worth
making when the back office (`W9`) becomes the second consumer, and not before. See §10 Q1.

## 5. Permissions matrix

Not applicable — no runtime actor, no endpoint, no data. The permission surface this task touches is
the agent charter one: `agents/roles/agent-ui.md` gains `apps/web/src/routes/**` and
`apps/web/eslint/**` in `owns:`, because the charter as written forbids nothing here but authorises
nothing either, and `L4` makes that a review failure rather than a judgement call. The charter
revision is bumped and `.claude/agents/` regenerated, which the `agents-drift` gate verifies.

## 6. Error cases

No runtime errors. The failure modes are build-time and each has a criterion:

| Failure | Surfaces as | Criterion |
|---|---|---|
| Browser global at module scope in a route | lint error `no-module-scope-browser-global` | AC11 |
| Module-scope cache in a route or feature | lint error `no-module-scope-mutable` | AC12 |
| `fetch` in a component | lint error `no-fetch-in-component` | AC13 |
| A route module that needs a DOM to import | test failure in `route-modules.test.ts` | AC8 |
| A route module exporting something else | test failure in `route-modules.test.ts` | AC9 |
| The rules configured over the wrong glob | test failure in `route-rules.test.ts` | AC14 |
| A broken `exports` map | resolution failure in `ui-package.test.ts` | AC2 |

---

## 7. Acceptance criteria

### The package

- **AC1** — Given the workspace, when `pnpm --filter @marketplace/ui build` runs, then
  `packages/ui/dist/index.js` and `packages/ui/dist/index.d.ts` exist.
- **AC2** — Given `apps/web`, when it resolves `@marketplace/ui` and `@marketplace/ui/tokens.css`
  through Node's exports map, then both resolve, and the resolved stylesheet declares
  `--mp-color-bg`. *(The consumer-side test: an exports map is only correct from outside.)*
- **AC3** — Given the repository, when `apps/web/src/styles/` is listed, then `tokens.css` is not
  there, and `apps/web/src/main.tsx` imports the stylesheet from `@marketplace/ui`.

### The token gates, where they now live

- **AC4** — Given `packages/ui/src/styles/tokens.css`, when its custom properties are read, then
  every one is `--mp-` namespaced and the families `color`, `space`, `radius` and `font` all exist.
  *(Was `apps/web` AC14.)*
- **AC5** — Given the same file, when the light `:root` colour tokens are compared with the
  `prefers-color-scheme: dark` block, then every light colour token has a dark counterpart.
  *(Was `apps/web` AC15.)*
- **AC6** — Given every stylesheet under `packages/ui/src`, when each is read, then none other than
  `tokens.css` contains a colour literal — and the walker proves itself by finding `tokens.css`.
- **AC7** — Given every stylesheet under `apps/web/src`, when each is read, then none contains a
  colour literal. *(The app half of the old AC16 stays with the app.)*

### The route-module contract — R1, and R2 as a consequence

- **AC8** — Given every module in `apps/web/src/routes/`, when each is imported in a Node
  environment with no DOM, then the import succeeds. *(A route that needs a browser to *load* fails
  today, years before anyone tries to server-render it.)*
- **AC9** — Given every module in `apps/web/src/routes/`, when its exports are listed, then
  `Component` is among them and every export is one of `Component`, `loader`, `action`,
  `ErrorBoundary`, `meta`, `handle`, `shouldRevalidate`.
- **AC10** — Given `apps/web/src/app/routes.tsx`, when its imports are read, then every file in
  `src/routes/` is imported by it, and `apps/web/src/pages/` does not exist.

### The lint rules — R2, R3, R5

- **AC11** — Given a route module, when it references `document` at module scope, then
  `no-module-scope-browser-global` reports it; and when it references `document` inside a function,
  then nothing is reported.
- **AC12** — Given a route module, when it declares `let` at module scope or a `const` holding
  `new Map()`, then `no-module-scope-mutable` reports each; and when it declares a `const` holding
  a literal, or a `let` inside a function, then nothing is reported.
- **AC13** — Given a route module, when a component or hook body calls `fetch`, then
  `no-fetch-in-component` reports it; and when a `loader` calls `fetch`, then nothing is reported.
- **AC14** — Given `apps/web`'s real ESLint configuration, when the same offending source is linted
  as `src/routes/x.tsx` and as `src/i18n/x.ts`, then the first reports all three rules and the
  second reports none. *(The wiring is the gate. A rule that is written and not applied is the
  `database`-job failure mode in a new costume.)*

### Nothing regresses

- **AC15** — Given the existing suites, when `pnpm verify` runs, then `shell.test.tsx`,
  `i18n.test.ts` and the build all pass unchanged, and `pnpm tsx scripts/generate-claude-agents.ts
  --check` reports no drift.

## 8. Data

None. No Prisma model, no migration, no seed.

## 9. Out of scope

- **Any component.** Button and its six siblings are `W12-T02`. `src/index.ts` exports nothing.
- **Storybook** (`W12-T03`) and `parameters.a11y.test = 'error'` (`W12-T04`).
- **Token layering** — primitive → semantic → component, `[data-theme]`, a second theme and the
  layering assertions are `W12-T05`. `tokens.css` moves as it is; it is not rewritten here.
- **R4 and R6.** R4 (state in the URL) has no code to apply to until the search schema (`W12-T07`).
  R6 is violated exactly once today, by the i18n singleton in `apps/web/src/i18n/index.ts`; ADR-011
  records it as known debt owned by `W12-T14`, and this task deliberately leaves it.
- **`src/features/`.** The glob covers it; the directory is created by the first slice that needs
  it. Linting a path that does not exist yet is free and is the point.
- **Promoting the rules to `packages/config`.** See §10 Q1.

## 10. Open questions

### Q1 — the rules' eventual home

`apps/web/eslint/route-rules.js` has one consumer. The back office (`W9`) will be the second, and
ADR-012 §1 says it consumes the same design system — which implies the same architecture rules.
When that happens the rules move to `packages/config` as an `agent-devops` change, and this
question is the note that says so. Not blocking: moving three rules and re-pointing one import is
an hour, and guessing at the second consumer's needs now is how a shared abstraction gets designed
against one example.

### Q2 — `no-fetch-in-component` and the generated client

R3 bans "fetch in a component" and ADR-011 §4 bans the hand-written URL alongside it. The rule
catches the global `fetch`; it cannot yet catch `client.search(...)` because `packages/contracts`
exports no client. When it does, the rule gains a list of banned import specifiers. Recorded here
so the next agent extends the rule rather than discovering the hole.

No `ESCALATION` blocks: nothing in this task needs a human decision, a secret or a dashboard.
