# W12-T03 — The workbench, and the runner that makes a story a test

Task: `W12-T03` · Slice: S10 · Owner: `agent-ui` · Issue: #203
Branch: `W12-T03-storybook-workbench` · Run record: `W12-T03-storybook-workbench.run.md`
Design: [ADR-012](../../adr/ADR-012-design-system-and-component-workbench.md) §5 ·
Builds on [`W12-T02`](W12-T02-ui-primitives.md)

---

## 1. Purpose

Thirty-eight stories exist and nobody can look at them. Seven components exist and reviewing one
means checking out a branch and starting a dev server — which is the UI half of a principle this
repo already holds for everything else (`TODO.md` §9 rule 2: *every PR gets a URL; reviewers click,
they don't imagine*).

That is the visible purpose. The load-bearing one is ADR-012 §5: **writing a story is writing the
component's test**. `@storybook/addon-vitest` runs every story as a Vitest browser test in the
runner this repo already has — the same `pnpm test`, the same CI job — so the per-component cost
goes up visibly and the `W10-T05` accessibility bill goes down. `W12-T04` then attaches axe to this
same project and an accessibility violation fails a pull request like any other assertion.

Who suffers without it: the reviewer, who is asked to imagine a focus ring; and every agent after
`W12-T04`, who would otherwise get accessibility feedback in an audit six months late rather than
in a failing test on their own PR.

The second reason to do it now rather than after the pages: `W12-T02`'s stories are currently
proven in jsdom — a document with no layout, propped up by three shims (`ResizeObserver`,
`scrollIntoView`, `DOMRect`). Overlays, focus restoration and anything that measures itself are
exactly what those shims fake. A real browser removes the fakery.

---

## 2. User stories

- **As a reviewer, human or agent**, I want a URL that shows every component in every state, so that
  reviewing UI is reading rather than reconstructing. *(The URL itself is `W12-T06`; this task is
  what it serves.)*
- **As a slice agent**, I want the states listed in one place I can open, so that I compose an
  existing component instead of writing a fourth button.
- **As `agent-ui`**, I want a story to fail CI when its component breaks, so that the stories stay
  true instead of decaying into a gallery of things that used to work.
- **As a Spanish-speaking reviewer**, I want to switch the workbench to `en-GB` and see what changes,
  so that a control that only works in one language is visible rather than theoretical.

## 3. State machine

None.

## 4. API surface

No runtime surface. Three configuration files and one test-runner change.

### 4.1 `packages/ui/.storybook/`

| File | What it decides |
|---|---|
| `main.ts` | Stories glob, `@storybook/react-vite`, `@storybook/addon-vitest`, **telemetry off** |
| `preview.tsx` | The two toolbars, the decorator that applies them, the token stylesheet |
| `preview.css` | The workbench's own chrome — never imported by the application |

**Telemetry is disabled** (`core.disableTelemetry`). Storybook reports usage on every `dev`, `build`
and test run. This repository is personal (`docs/board/IDENTITY.md`) and most of those runs are an
agent's; an outbound call nobody chose, from a developer machine and from CI, is not a default worth
keeping.

### 4.2 The toolbars

| Toolbar | Global | Effect |
|---|---|---|
| **Idioma** | `locale` — `es-ES` (default), `en-GB` | Wraps the story in React Aria's `I18nProvider` and sets `<html lang>`. Effective today, and it is how you see React Aria's *own* strings change. |
| **Tema** | `theme` — `light` (default), `dark` | Sets `[data-theme]` on the story container **and on the root**, because an overlay is portalled to `document.body` and would otherwise miss the switch. |

**The theme toolbar changes nothing visible yet, and that is deliberate.** `tokens.css` still
switches on `prefers-color-scheme` alone; making a theme a file, adding `[data-theme]` and shipping
a second theme is `W12-T05`, which is the next task. Wiring the toolbar now means T05 is a
stylesheet change rather than a workbench change. The spec says so, the code says so, and AC5 is
written so that it will keep passing when T05 makes it real.

### 4.3 Two test projects, one command

```ts
// packages/ui/vitest.config.ts — projects, not a second harness.
unit       → jsdom      → tests/**/*.test.{ts,tsx}     (behaviour + the filesystem gates)
storybook  → chromium   → every story, with its play    (via @storybook/addon-vitest)
```

`pnpm test` runs both. That is the point of the addon and it is what keeps the arrangement honest:
a separate `test:stories` script is a suite that stops running the first time someone forgets to
call it, which is precisely how the `database` job's hand-named suites decay
(`memory/repo/gotchas.md`).

**The cost, stated plainly**: a real browser becomes a prerequisite for `pnpm verify` —
`pnpm --filter @marketplace/ui exec playwright install chromium`, once. CI installs it in the
existing `unit` job.

## 5. Permissions matrix

Not applicable. One boundary is crossed and declared: `.github/workflows/ci.yml` belongs to
`agent-devops`. The change is the browser-install step the story tests need, in the job that already
runs `pnpm test` — ADR-012 §5's "the existing CI job, and one command". Flagged for review rather
than assumed.

## 6. Error cases

| Failure | Surfaces as |
|---|---|
| A story throws | That story's browser test fails, named after the story |
| A `play` function's assertion fails | Same, with the interaction step |
| No browser installed | The `storybook` project fails loudly at startup — the correct failure for a gate |
| A story file that matches no glob | AC2: the project must find stories, or the suite is vacuous |

---

## 7. Acceptance criteria

- **AC1** — Given `packages/ui`, when `pnpm test` runs, then **both** projects run: `unit` in jsdom
  and `storybook` in Chromium, from one command.
- **AC2** — Given the `storybook` project, when it runs, then it collects one test per story across
  all seven primitives and fails if it collects none. *(A glob that matches nothing passes every
  assertion after it.)*
- **AC3** — Given a story with a `play` function, when the `storybook` project runs it, then the
  interaction runs in the browser — no `ResizeObserver`, `scrollIntoView` or `DOMRect` shim
  involved.
- **AC4** — Given `preview.tsx`, when a story renders, then it is wrapped in `I18nProvider` with the
  `locale` global, and `<html lang>` matches it.
- **AC5** — Given the `theme` global, when it is set, then `[data-theme]` is present on both the
  story container and the document root. *(Presence, not appearance: `W12-T05` supplies the palette
  that makes it visible, and this criterion keeps passing when it does.)*
- **AC6** — Given `main.ts`, when Storybook starts or builds, then telemetry is disabled.
- **AC7** — Given `pnpm --filter @marketplace/ui build:storybook`, when it runs, then a static site
  is produced in `storybook-static/`, which is git-ignored. *(`W12-T06` deploys exactly this.)*
- **AC8** — Given CI, when the `unit` job runs, then it installs Chromium before `pnpm test`, so the
  story tests run there too rather than being skipped into a green result.
- **AC9** — Given the whole workspace, when `pnpm verify` runs, then it passes — every `W12-T02`
  assertion included, unchanged.

## 8. Data

None.

## 9. Out of scope

- **`parameters.a11y.test = 'error'`** — `W12-T04`, the next task, one addon and one line on this
  configuration.
- **Deploying the workbench** — `W12-T06`. `build:storybook` exists here so that task is a workflow
  file and nothing else.
- **The second theme and the token layering** — `W12-T05`, as §4.2 says.
- **Visual regression** — `W12-T16`, nightly Playwright screenshots over a pinned story list.
- **Stories for anything but the primitives.** Patterns do not exist yet.

## 10. Open questions

### Q1 — the jsdom story test was narrowed rather than deleted

`W12-T02`'s `tests/stories.test.tsx` rendered every story through `composeStories`. The browser
project now does that properly, so keeping both would assert the same thing twice, in the weaker
environment. What stays in jsdom is the assertion a browser cannot make: **a story that was never
written is missing** — every primitive must ship `LongText`. If the browser project ever becomes
slow enough to be skipped locally, this file is the thing that keeps the gate.

### Q2 — `setProjectAnnotations` is no longer ours to call

Storybook ≥10.3 applies `preview.tsx`'s annotations to the browser project itself, and says so on
every run when a setup file also calls it. The file was removed. Recorded because the pattern is in
every Storybook tutorial written before 10.3, and the next agent to add a browser project will
reach for it.

No `ESCALATION` blocks.
