# W12-T20 — The storefront loads the design system's stylesheet

Task: `W12-T20` · Slice: S10 · Owner: `agent-ui` · Issue: none — added to §6 by `W2-T09`, after the
board import
Branch: `W12-T20-design-system-stylesheet` · Run record: `W12-T20-design-system-stylesheet.run.md`
Design: [ADR-012](../../adr/ADR-012-design-system-and-component-workbench.md) §1, §5, §6 ·
[ADR-011](../../adr/ADR-011-web-application-architecture.md) §1
Builds on [`W12-T02`](W12-T02-ui-primitives.md) §4 (the `./styles.css` export),
[`W12-T16`](W12-T16-visual-regression.md) (the route list), [`W12-T18`](W12-T18-visual-foundations.md)
(the appearance this ticket finally shows)

---

## 1. Purpose

`apps/web/src/main.tsx` imports `@marketplace/ui/tokens.css` and `./styles/app.css`. **Nothing
imports `@marketplace/ui/styles.css`** — the `dist/ui.css` export `W12-T02` §4 created for exactly
this purpose. So every React Aria component in the application renders as an unstyled browser
control: the header's compact search, every `Button`, every `TextInput`, every `Select`, the
`Dialog`, the `Card`, the `ResultRow`.

It has been this way since `W12` began. Seven page tickets shipped against it. `W12-T18` spent a
ticket on a palette, a type scale and depth, and **the application has never rendered any of it** —
only the tokens, which `app.css` consumes for the shell's own `.mp-*` layout classes. The workbench
shows the design system; the product does not.

**Why no suite noticed**, which is the more important half:

| Gate | What it covers | Why it was blind |
|---|---|---|
| `W12-T04` axe per story | components | Storybook's preview imports the stylesheet |
| `W12-T16` story screenshots | components | same — the baselines are *Storybook* renders |
| `W12-T16` axe over real routes | the storefront | axe checks the a11y tree; an unstyled page has a *correct* one |
| the unit suites | the storefront | they assert semantics — roles, names, hrefs — never appearance |
| `ui-package.test.ts` AC3 | `main.tsx`'s imports | it asserts the **tokens** import, and stops there |

Every gate was working. Between them they had no way to observe the thing that was wrong, and the
one test looking directly at `main.tsx`'s import list was satisfied by the import that *was* there.

Found by `W2-T09` while building `/es/signup` and **confirmed by experiment**: adding the one import
turns raw browser inputs into the designed system.

**The fix is one line. The ticket is the gate**, because a defect that survived seven tickets and
five suites will survive an eighth unless something can see it.

## 2. User stories

- **As a visitor**, I want the storefront to render the design system it ships, so that the product
  looks like the workbench it was built in.
- **As `W2-T09`'s sign-up form**, I want my inputs to be the `TextInput` I composed rather than the
  browser's, so that the page I shipped is the page you see.
- **As `W12-T18`**, I want the palette and type scale I landed to reach a user.
- **As the next page ticket**, I want a stylesheet that is loaded, so that composing from
  `packages/ui` produces an appearance rather than markup.
- **As `agent-ui` after the next refactor**, I want a test that fails the moment the application
  stops loading the component layer — in *any* of the ways it can stop, not only by someone deleting
  a line from `main.tsx`.

## 3. State machine

None. A stylesheet import has no lifecycle. Recorded so the reader can see it was considered: the
one ordering question is settled in §4.2 and is not state.

## 4. API surface

No endpoint, no contract, no route, no migration. The surface is the application's stylesheet graph.

### 4.1 The change

```diff
  import '@marketplace/ui/tokens.css';
+ import '@marketplace/ui/styles.css';
  import './styles/app.css';
```

### 4.2 Why that order, and not another

Three stylesheets, and the order is the whole of the design decision here:

| Position | File | Why there |
|---|---|---|
| 1 | `@marketplace/ui/tokens.css` | declares the custom properties the other two *read*. A `var()` resolves at use, so this could sit anywhere and still work — it stays first because it is the layer everything else depends on, and the file order should say so. |
| 2 | `@marketplace/ui/styles.css` | the component layer. Must precede `app.css`, because equal-specificity rules are resolved by source order and the shell must be able to win. |
| 3 | `./styles/app.css` | the shell's `.mp-*` layout classes. Last, so that when a page's layout and a component's own style collide, the page ticket's intent survives a design-system update. |

No conflict is currently *known* — `app.css` is 50 selectors, all `.mp-*` or element-level, and the
component CSS is hashed CSS Modules (`._button_u46b4_1`), so the two cannot collide on class name.
The order is chosen for the collision that has not happened yet.

### 4.3 What `pnpm dev` now needs

`@marketplace/ui/styles.css` resolves to `dist/ui.css`, which is a **build output**. CI is already
correct: `turbo.json` gives `build`, `test`, `lint` and `typecheck` a `dependsOn: ["^build"]`, so the
package is built before anything consumes it. A clean checkout running `pnpm dev` is **not** —
the root `prepare` script builds `@marketplace/config` and generates the Prisma client, and never
builds the UI package. Today that fails at the tokens import already; after this change it fails at
two. The root `dev` script builds `@marketplace/ui` first, so a clean checkout has one instruction
rather than a lore.

## 5. Permissions matrix

| Role | Sees it |
|---|---|
| anonymous | allow |
| CLIENT / PROVIDER / ADMIN | allow |

A stylesheet has no permissions; the honest version of this section is that it does not apply.

## 6. Error cases

Not runtime failures — a missing stylesheet does not throw, which is the entire reason this ticket
exists. These are the ways the application can lose the component layer again. Each must be a red
test before it is a fixed bug:

| Case | Today | After |
|---|---|---|
| Someone deletes the import from `main.tsx` | nothing fails | AC2 fails |
| The `./styles.css` export is renamed or dropped from `packages/ui` | nothing fails | AC1 fails |
| `packages/ui`'s build stops emitting `dist/ui.css` | nothing fails | AC1 + AC3 fail |
| The import survives but a bundler plugin strips it from the build | nothing fails | AC3 fails |
| A future entry point (`W12-T14`'s SSR root) loads tokens and forgets components | nothing fails | AC2 fails — it asserts the *entry*, whichever file that is |
| The page renders unstyled for any other reason | nothing fails | AC4 fails on a pixel diff |

The last row is the one that generalises. AC1–AC3 each name a mechanism that can break; AC4 asserts
the *outcome*, and is the only one that would have caught a cause nobody predicted.

## 7. Acceptance criteria

| # | Given / When / Then | Test |
|---|---|---|
| **AC1** | Given the app, when `@marketplace/ui/styles.css` is resolved through the exports map, then it resolves, is non-empty, and carries real component rules — at least one class selector and at least one `var(--mp-` reference | `apps/web/tests/ui-package.test.ts` (**new**) |
| **AC2** | Given the web entry point, when its imports are read, then it imports **both** `@marketplace/ui/tokens.css` and `@marketplace/ui/styles.css` | `apps/web/tests/ui-package.test.ts` (**new**, beside the existing tokens assertion) |
| **AC3** | Given a production build of `apps/web`, when its emitted CSS is read, then it contains the component layer — proven by declaration fragments **derived from `dist/ui.css` at test time**, never by a hand-written list of class names | `apps/web/tests/ui-package.test.ts` (**new**) |
| **AC4** | Given each route in `W12-T16`'s list, when the nightly runs, then its rendered appearance matches a committed baseline | `packages/ui/visual/routes.spec.ts` (**new**, beside the existing axe run) |
| **AC5** | Given the route baselines, when the coverage check runs, then every route in `ROUTES` has exactly one baseline and no baseline exists for a route that is gone | `packages/ui/tests/visual-coverage.test.ts` (**new**) |
| **AC6** | Given the import is removed, when AC2, AC3 and AC4 run, then each fails | the red probe, evidenced in the run record |
| **AC7** | Given a clean checkout, when `pnpm dev` is run, then the UI package is built first and the dev server starts | `tests/workspace.test.ts` (**new**) |
| **AC8** | Given the story baselines, when the nightly runs, then they are **unchanged** — Storybook always loaded this stylesheet, so this ticket must not move a story pixel | asserted by the nightly; confirmed in the run record |

AC3 is the one this ticket should be judged on. AC2 asserts a line of source, which is exactly the
assertion that was already passing while the bug was live — it only ever sees the failure mode
somebody thought of. AC3 asserts the artefact the browser actually receives, and it is derived from
the design system's own output rather than from a list, because `memory/repo/gotchas.md` now has
four instances of a hand-written subject list failing open.

AC4 is the honest version of the whole ticket: the storefront's *appearance* had no observer at all.

## 8. Data

No migration, no contract change, no new runtime dependency. New committed binary baselines (one PNG
per route, generated only inside the pinned Playwright container — `visual/fingerprint.json`).

## 9. Out of scope

- **Any visual adjustment made because the pages now look different.** This ticket changes what is
  loaded, not what is designed. If the header's search bar is the wrong width once it is styled,
  that is a page ticket with its own before and after — the value of this diff is that it is one
  import, and the review can be about the appearance rather than about the code.
- **`W12-T16`'s per-PR promotion.** The route screenshots join the nightly, where ADR-012 §6 put the
  visual run deliberately. A screenshot gate on every pull request turns every intended design
  change into a red required check.
- **`W12-T19`** — the typeface. Unchanged; `system-ui` still.
- **The dead `.mp-language select` rule in `app.css`**, left over from the switcher `W12-T09`
  replaced with links. Noticed while reading; not this ticket's line to delete.
- **`W12-T14`'s SSR entry point.** AC2 asserts the entry point that exists today. When the framework
  switch lands, that ticket carries its own entry and this assertion follows it.

## 10. Open questions

- **Q1** Should the route baselines shoot both locales, or is `/es` + `/en` on the home page enough
  coverage for a layer that is locale-independent? Shooting every route twice doubles the nightly's
  binary footprint for a stylesheet that does not read the locale. The list starts as
  `W12-T16`'s — one shot per route, ES except where the route *is* the EN one.
- **Q2** The 500-page route (`/es?__boom=1`) is reachable only in a build with
  `VITE_ENABLE_FAULT_ROUTES`. Its baseline is therefore a picture of a surface no production build
  can render. Shooting it anyway, because it is the surface with the least coverage of any kind —
  noted so the next reader knows it was deliberate.
- **Q3** `W12-T13`, `T14` and `T17` will add routes. Nothing makes a *new* route acquire a baseline
  — AC5 checks the list against the baselines, not the router against the list. Deriving the route
  list from the router is the real fix and it is `W12-T14`'s to make, once routes are modules a
  Worker can enumerate.
