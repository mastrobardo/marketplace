# Run record — W12-T05 token-layers-and-themes

```
Agent:        agent-ui
Model:        claude-opus-5
Charter rev:  2
Skills used:  spec-driven-development, test-driven-development, frontend-ui-engineering,
              incremental-implementation, git-workflow-and-versioning
Started:      2026-09-11T17:40:00Z   Finished: 2026-09-11T18:05:00Z
Session file: memory/sessions/2026-09-11-agent-ui-W12-T05.md
```

---

## Prompts

### 1. Spec authoring

From the operator, in full:

> continue with w12

Which made the first decision this task took a *reading* decision rather than a design one: W12's
foundation tasks are ordered in `TODO.md` and in ADR-012, `T01`–`T04` and `T06` were merged, and
`T05` is the last one before the search-schema seam. So the task was picked from the board rather
than proposed, and the plan was put to the operator before any file was touched — including the one
call that could reasonably have gone the other way (see *Corrections*, below).

### 2. Contract proposal

Not run. No zod schema, no Prisma model, no `packages/contracts` file — a stylesheet split and a
test. Nothing to freeze.

### 3. TDD red

Against `agents/prompts/02-tdd-red.md`. The tests were written first and in full — the resolver
included — against four stylesheets that did not exist. Output below.

### 4. Implementation

Against `agents/prompts/03-implement-green.md`. Four CSS files, two of them themes; then the two
density tokens through the component stylesheets; then the workbench and the app-side assertion the
split invalidated.

### 5. Corrections

Two, both worth keeping.

**The plan said `prefers-contrast: more` would apply the whole contrast theme.** Writing it showed
that plain CSS cannot combine a media query with an attribute selector in one rule, so "apply the
theme from a preference" means writing the entire semantic mapping a second time — a palette in two
places, which is the exact failure this ticket exists to prevent. Caught before the spec was
finished rather than after the CSS was written, and the spec was amended in place (§7 AC8, §10 Q1):
the media query now carries the two structural tokens, and choosing a theme from a preference is
handed to `W12-T09`, which already owns persistence and SSR.

**The same problem, one layer down, had a better answer.** The obvious way to ship a dark palette
that can be *chosen* is the one the web mostly uses: declare it twice, once under
`@media (prefers-color-scheme: dark)` and once under `[data-scheme='dark']`. That is a palette in
two places too. `color-scheme` plus `light-dark()` writes each colour **once** with both values in
it, makes `prefers-color-scheme` the default and `[data-scheme]` the override, and needs two rules
in total rather than a second copy of the file. It also turned out to be why the four-up story is
possible at all — see *Findings*.

---

## Red phase

The tests, and the resolver they lean on, against a `src/styles` that still held one flat file:

```
 ❯ packages/ui  vitest run --project=unit tests/tokens.test.ts

 ❯ |unit| tests/tokens.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/tokens.test.ts [ tests/tokens.test.ts ]
Error: ENOENT: no such file or directory, open '…/packages/ui/src/styles/scale.css'
 ❯ read tests/token-graph.ts:247:8
 ❯ tests/tokens.test.ts:57:41

 Test Files  1 failed (1)
      Tests  no tests
```

Then, with the four files written and before anything was adjusted — this is the run that earned
its keep, because three of the five failures were the *test* being wrong rather than the CSS:

```
 Test Files  1 failed (1)
      Tests  5 failed | 21 passed (26)

 × resolves every var(--mp-…) in the package in default/light
 × resolves every var(--mp-…) in the package in default/dark
 × resolves every var(--mp-…) in the package in contrast/light
 × resolves every var(--mp-…) in the package in contrast/dark
   AssertionError: expected [ …(18) ] to deeply equal []
   + "primitives/Combobox.module.css: --trigger-width",
   + "styles/themes/contrast.css: --mp-palette-ink-0",
   + …16 more

 × lets the page override the media query in both directions
   AssertionError: expected '/*\n * Design tokens — the entry poin…'
     to match /:root\[data-scheme=['"]light['"]\]…/
```

Three findings in one run:

- `--trigger-width` is React Aria's, set on the popover at run time. Already allowed by name in
  `boundaries.test.ts`; the new sweep did not know that and had to.
- A theme's palette references resolve **only inside that theme** — that is what a theme is. The
  sweep was checking every reference in every combination, which asks `contrast/…`'s ramp to exist
  under `default/…`. Scoped to the consumers; AC3 already proves the theme-internal chains, since
  every semantic token it resolves runs through one.
- The `:root[data-scheme]` assertion was written from the plan, and the implementation had moved
  past it: anchoring the scheme to `:root` would reach the document and nothing else, and the
  four-up story would have been four copies of whatever the document was set to. The assertion now
  asserts the *unanchored* form, with a negative lookbehind so re-anchoring it fails.

## Green

```
 ❯ packages/ui  pnpm test
 Test Files  6 passed (6)
      Tests  106 passed (106)        # 64 unit + 42 storybook

 ❯ marketplace  pnpm verify
 typecheck ✓  lint ✓  format:check ✓  test ✓  build ✓
```

The 42 include the two new stories. `Foundations/Themes` renders all four combinations at once, and
its `play` function is the assertion the node resolver cannot make: `getComputedStyle` on four
panels that differ only by two attributes, checked on background, colour, font family, radius and
border width. It passed on the first run — which is the same answer a story that was rendering four
identical panels would give, so the numbers were read before being believed: four distinct
backgrounds, asserted as a `Set` of size four.

---

## Findings

### `light-dark()` resolves per element, which is what makes the four-up story possible

A custom property holding `light-dark(a, b)` is substituted as an unparsed token stream; the
function is evaluated when the value is finally computed, against the `color-scheme` of the element
computing it. So `--mp-color-bg` declared once on `:root` yields the light value inside a
`[data-scheme='light']` container and the dark one inside its `[data-scheme='dark']` sibling, on the
same page. Every theme and scheme selector in these files is therefore deliberately **not** anchored
to `:root`.

### The built CSS does not contain `light-dark()` at all

Lightning CSS (through Vite) lowers it to its own `--lightningcss-light` / `--lightningcss-dark`
space-toggle, driven by `@media (prefers-color-scheme: dark)` *and* by every rule that declares
`color-scheme` — including `[data-scheme='light']` and `[data-scheme='dark']`. So the switch
survives the build, but `apps/web/dist/assets/*.css` reads nothing like the source. Checked rather
than assumed, and written down in `memory/repo/gotchas.md`: the next person to grep the built CSS
for `light-dark(` will find zero matches and should not conclude the feature was dropped.

### Two literals were hiding in stylesheets the design system owns

`1px` in nine places and `2px` in six — a border and a focus ring, values with no name. They are
`--mp-border-width` and `--mp-focus-ring-width` now, which is what lets the contrast theme be
structurally different rather than only differently coloured, and what lets
`@media (prefers-contrast: more)` answer a user preference in two declarations.

### The colour gate had a hole exactly where it was least visible

`--mp-overlay-scrim: rgb(0 0 0 / 45%)` sat in the component block of `tokens.css`, and the gate
exempted `tokens.css` wholesale — so the one file allowed to hold colours was also the one file
nobody was checking for holding them in the wrong layer. The exemption is now the two theme files,
and `components.css` is checked like any other stylesheet.

---

## Deviations from the spec

None after the amendment recorded under *Corrections*. The spec's §3 note about ADR-012 §4's
wording stands: `[data-theme]` carries the theme and `[data-scheme]` the scheme, which is two
attributes where the ADR's sentence says one and the ADR's own examples (`default/dark`,
`alt/light`) say two.

## What the next task inherits

- Two themes, four combinations, all four tested and all four rendered.
- A resolver (`tests/token-graph.ts`) that any future token gate can lean on rather than re-deriving
  — it already answers "what does this token actually equal in this theme".
- `W12-T09` owns the switcher: persistence, the control in the header, and reading
  `prefers-contrast` to pick a theme rather than only a border width.
- `W12-T07`'s search-bar patterns should need no new colour. If one does, it needs a semantic token
  in both themes — which is now a failing test rather than a conversation.

No `ESCALATION` blocks.
