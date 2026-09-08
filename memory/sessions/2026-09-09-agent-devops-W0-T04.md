---
task: W0-T04
agent: agent-devops
session: 2026-09-09
status: closed
---

# Session — W0-T04 web skeleton

## Goal

Turn `apps/web` from a one-line placeholder into a Vite/React shell: router, layout, ES/EN i18n
where a missing key fails the build, and a theme token layer `agent-ui` can build the design system
on.

## Starting state

`main` at a0dbbc5. `apps/web/src/index.ts` is the W0-T01 placeholder. Branch `W0-T04-web-skeleton`
off `main`, independent of the T02 and T03 branches.

## Log
- Carried the `W0-T03` lesson forward: created the module surface as `not implemented` stubs before
  writing tests, so the first red was 15 real assertion failures rather than a collection error.
- Chose `react-i18next` over a hand-rolled `t()`: Spanish needs plurals and interpolation almost
  immediately, and i18next's TS augmentation still gives the compile-time key safety the issue asks
  for. Spanish is the source of truth; `en.ts` must `satisfies Translations`.
- **Non-obvious and load-bearing**: `keySeparator: false` / `nsSeparator: false`. Our keys contain
  dots, and at i18next's defaults every lookup misses and renders the key.
  → `memory/repo/gotchas.md` MEM-2026-09-09-10.
- Dead end: `tests/i18n.test.ts` and `tests/tokens.test.ts` under jsdom — `import.meta.url` is an
  http URL there. Pinned both to `// @vitest-environment node`, then had to guard `tests/setup.ts`
  because setupFiles runs for every suite. → slice memory MEM-2026-09-09-11.
- **The expensive one**: the `unknown-key` fixture compiled clean. My own comment
  `// @ts-expect-error is deliberately NOT used: …` is a valid directive and suppressed the error
  the fixture existed to produce. → `memory/repo/gotchas.md` MEM-2026-09-09-09.
- Two shell tests were order-dependent: i18next is a module singleton and the language leaked
  between tests. Each test now sets its own starting language, and the default is asserted against
  `i18next.options.lng`, not against whatever ran before.
- Verified beyond jsdom: `vite build` (110 modules, 444ms), then served `dist/` and confirmed both
  catalogues are in the bundle and both light and dark `--mp-color-accent` are in the CSS.

## Handoff
`W0-T04` is complete and green; the PR is open and **not merged** (L6).

**What the next agent inherits**
- Add your route as a child of the layout route in `src/app/routes.tsx` — that is how you inherit
  the shell, including for the not-found page.
- Add strings to `src/i18n/locales/es.ts` **first**. `en.ts` then fails to compile until you
  translate them; that is the feature, not an obstacle.
- Never write a colour literal in a stylesheet — add a token to `src/styles/tokens.css`. The token
  test fails the build on a raw colour, and on a light colour with no dark counterpart.
- Your page owns its own single `<h1>`; the layout deliberately has none.
- `apps/web/src/features/**` is still empty and is `forbidden:` to this agent — it is yours.

**For `agent-ui`**: `src/styles/tokens.css` is yours from here. The run record lists the three
decisions baked into it (semantic colour names, the `--mp-` namespace, one global `:focus-visible`).

**Open, not blocking**: the language choice is not persisted across reloads — it needs a user
preference (`W2-T04`), so an English-speaking user returns to Spanish on refresh. And AC16's colour
gate is a regex over `.css` files: it will not see a colour in an inline `style` prop or an SVG
`fill`, so it stops covering the surface the moment those appear.
