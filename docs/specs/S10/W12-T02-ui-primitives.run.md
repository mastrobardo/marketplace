# Run record — W12-T02 ui-primitives

```
Agent:        agent-ui
Model:        claude-opus-5
Charter rev:  2
Skills used:  spec-driven-development, test-driven-development, frontend-ui-engineering,
              incremental-implementation
Started:      2026-09-11T15:15:00Z   Finished: 2026-09-11T15:40:00Z
Session file: memory/sessions/2026-09-11-agent-ui-W12-T02.md
```

---

## Prompts

### 1. Spec authoring

Verbatim, from the operator — the same instruction that opened `W12-T01`, whose scope covers this
task as the second of the queued series:

> comntinue with  W12-T01 to T03. also, take a look at w12t06 as it might convenient to add to the
> queue
> **Which tasks should I take in this run?** → T01 + T02 + T03, Add T04 (a11y = error), Add T06
> (deploy workbench)
> **How should the branches land?** → Stacked PRs, you merge as we go

Written against `agents/prompts/00-spec-authoring.md`. §3 (state machine), §5 (permissions) and §8
(data) are answered "not applicable" with the reason. The interaction state these controls have is
React Aria's, and saying so is the point of ADR-012 §2 — a design system whose specs describe their
own listbox state machine has already lost the argument for buying one.

### 2. Contract proposal

Not run, and this time the reason is a rule rather than an absence: ADR-012 §1 forbids this package
from importing `packages/contracts` at all. `tests/boundaries.test.ts` AC15 makes that a gate, which
is the first time it has been one — `W12-T01` had nothing to enforce it against.

### 3. TDD red

Against `agents/prompts/02-tdd-red.md`. Every criterion is queried the way a user or a screen reader
reaches the control — `getByRole`, `getByLabelText`, and following `aria-describedby` to its text.
A test that reaches for a class name proves the markup has not changed; a test that reaches for a
role proves the control is still a control, which is the only thing worth asserting about a library
that supplies the behaviour.

Three assertions exist to stop a gate going vacuous: the story glob must find stories at all, the
stylesheet walker must find component stylesheets (the guard `W12-T01` could not yet have), and
`index.ts` must export a primitive before AC16 loops over the list.

### 4. Implementation

Against `agents/prompts/03-implement-green.md`. Order: tokens, then the two primitives everything
else composes (`Button`, `Field`), then the three field controls, then the two overlays, then the
stories. The entry point was written last, so every export had already been rendered by a test.

### 5. Corrections

Five, all of my own work. Four came from a failing test, and the fifth from reading the build output:

1. **A regex rewrite mangled the JSX.** Adding the `cx()` helper across seven files with a
   search-and-replace ate the closing brace on every multi-line `className`. The compiler caught it
   immediately; the lesson is that the repair was mechanical and the original mistake was doing it
   mechanically at all.
2. **`Select` never carried `aria-invalid`.** I wrote the prop, React Aria dropped it, and the test
   failed. Investigating the DOM rather than forcing the attribute through was the right call: the
   trigger is a `button`, `aria-invalid` belongs on an input, and React Aria links the error message
   by `aria-describedby` and puts the constraint on the hidden native select. The dead prop was
   removed and the criterion rewritten to assert the behaviour that exists (spec AC11).
3. **`Combobox` never showed its empty state.** React Aria closes a menu whose collection is empty,
   so `renderEmptyState` was unreachable — which killed *both* states this control exists to show,
   loading and no-match. `allowsEmptyCollection` fixes it.
4. **`Combobox` never filtered.** React Aria filters an *uncontrolled* collection only; a controlled
   `items` list is the caller's to filter. Typing `zzzz` left every option on screen. Fixed with
   `useFilter`'s locale-aware `contains`, which is also the only version of this that works in
   Spanish — `String.includes` would fail on *València* the moment someone types `valencia`.
5. **The bundle was 339 KB.** The library build inlined React Aria, so `apps/web` would have pulled
   the whole of it in to use one `Button`, and ADR-011's ≤170 KB initial-route budget would have
   failed one task later. Externalised the `react-aria*` packages: **339 KB → 8.81 KB** (2.48 KB
   gzipped), plus `sideEffects: ["*.css"]` so a consumer can drop what it does not import.

No re-prompt from the operator was needed.

---

## Red phase

Seventeen failures, before any component existed.

```
 ❯ packages/ui  vitest run
⎯⎯⎯⎯⎯⎯ Failed Tests 17 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/boundaries.test.ts > AC16 … > gives each exported primitive a story file beside it
      → AssertionError: index.ts exports no primitive: expected 0 to be greater than 0
 FAIL  tests/boundaries.test.ts > AC18 … > has component stylesheets, and none of them names a colour
      → AssertionError: no component stylesheets: expected 0 to be greater than 0
 FAIL  tests/primitives.test.tsx > AC1 … > exports all seven
      → AssertionError: Button is not exported
 FAIL  tests/primitives.test.tsx > AC4/AC5/AC6 — Button > renders a real button with an accessible name
 FAIL  tests/primitives.test.tsx > AC4/AC5/AC6 — Button > announces pending work and refuses the press while it is pending
 FAIL  tests/primitives.test.tsx > AC4/AC5/AC6 — Button > does not fire onPress when disabled
 FAIL  tests/primitives.test.tsx > AC2/AC7/AC8/AC9 — TextInput and Field > associates the label with the control
 FAIL  tests/primitives.test.tsx > AC2/AC7/AC8/AC9 — TextInput and Field > links the description to the input
 FAIL  tests/primitives.test.tsx > AC2/AC7/AC8/AC9 — TextInput and Field > marks the input invalid and links the message, and does neither without one
 FAIL  tests/primitives.test.tsx > AC2/AC7/AC8/AC9 — TextInput and Field > marks a required field required
 FAIL  tests/primitives.test.tsx > AC10/AC11 — Select > opens as a listbox and selects with the keyboard
 FAIL  tests/primitives.test.tsx > AC10/AC11 — Select > marks the trigger invalid and links the message
 FAIL  tests/primitives.test.tsx > AC12 — Combobox > presents the loading label and offers nothing to choose
 FAIL  tests/primitives.test.tsx > AC12 — Combobox > says there is no match without calling it an error
 FAIL  tests/primitives.test.tsx > AC13 — Dialog > opens from its trigger, names itself, and returns focus on Escape
 FAIL  tests/primitives.test.tsx > AC14 — Popover > opens with the name it was given
 FAIL  tests/stories.test.tsx > AC17 … > finds story files at all
 Test Files  2 failed | 2 passed (4)
      Tests  17 failed | 53 passed (70)
```

## Green phase

```
 ❯ packages/ui  vitest run     Test Files  4 passed (4)     Tests  70 passed (70)
 ❯ pnpm verify → typecheck ✓  lint ✓  format:check ✓  test 224 ✓  build ✓

 ❯ packages/ui/dist
   ui.css     6.67 kB │ gzip: 1.43 kB
   index.js   8.81 kB │ gzip: 2.48 kB      (339.01 kB before React Aria was externalised)
```

Thirty-eight stories across seven primitives, every one of them rendered — with its `play` function
— by `tests/stories.test.tsx` through `composeStories`.

## Deviations from spec

- **AC11 was rewritten after the implementation disagreed with it.** See correction 2: the spec
  asked for `aria-invalid` on a select trigger, which is not how React Aria — or the ARIA practices
  — convey it. The criterion now asserts the linked message and `data-invalid`. The spec was changed
  on the branch rather than the behaviour being forced to match a sentence I wrote before looking.
- **`suggestionsLabel` was added to `ComboboxProps`**, and the spec updated. React Aria's own button
  label would otherwise be its English default, and every user-visible string in this package is a
  prop precisely so the design system can hold no copy and no i18n dependency.
- **AC13's focus-*return* is asserted through `waitFor`.** React Aria restores focus asynchronously;
  the synchronous assertion was failing on timing rather than on behaviour. The browser run in
  `W12-T03` is where this gets proven properly — jsdom is a document without a layout, and that is
  also why `tests/setup.ts` now shims `ResizeObserver`, `scrollIntoView` and `DOMRect`.
- **`react-aria` was added as a dependency** alongside `react-aria-components`, for `useFilter`. Same
  library family, already chosen by ADR-012 §2; not a new component-library decision under the
  charter rule that would need an ADR.

## Human input received

- Scope and cadence, quoted in §Prompts. No human edited a file on this branch.
- One finding is reported to the operator rather than fixed here, because fixing it is `W12-T09`'s:
  React Aria's built-in strings default to **English** (*"Select an item"*, *"Suggestions"*), so
  `apps/web` needs `<I18nProvider locale="es-ES">` around its tree. Spec §10 Q3.

## Self-assessment

- **Weakest part of this change.** `Combobox` filters locally, and `W12-T07` will hand it results a
  server has already filtered — possibly fuzzily. The local `contains` would then quietly drop rows
  the server meant to return. It is written down (spec §10 Q2) and the fix is a prop, but it is the
  thing in this PR most likely to be discovered rather than read.
- **What a reviewer should look at hardest.** The states, not the code: open `Combobox.stories.tsx`
  and ask whether `Loading` and `Empty` are really distinguishable to someone who cannot see the
  list, and whether `Button`'s `Pending` says enough. That judgement is what this whole layer exists
  to make once instead of thirteen times. After that, `tests/setup.ts` — three jsdom shims are three
  places where the test environment is not the browser, and `W12-T03` is what makes them stop
  mattering.
- **What I would tell the next agent in this slice.** The stories are the test suite from `W12-T03`
  on, so a component without a state is a state nobody will notice is missing — write the story
  first. Do not put copy in this package: every visible string is a prop with a Spanish default,
  including the name of the combobox's own button, and that is what lets the design system stay free
  of i18n. And wrap `apps/web` in `I18nProvider` when you build the shell, or React Aria will speak
  English to Spanish users in exactly the places nobody looks.
