# W12-T05 — Three token layers, and a second theme that proves the swap

Task: `W12-T05` · Slice: S10 · Owner: `agent-ui` · Issue: #205
Branch: `W12-T05-token-layers-and-themes` · Run record: `W12-T05-token-layers-and-themes.run.md`
Design: [ADR-012](../../adr/ADR-012-design-system-and-component-workbench.md) §3, §4 ·
Builds on [`W12-T01`](W12-T01-ui-package-and-route-rules.md), [`W12-T02`](W12-T02-ui-primitives.md),
[`W12-T03`](W12-T03-storybook-workbench.md)

---

## 1. Purpose

`tokens.css` today is one flat file with two layers pretending to be three. Semantic names sit on
`:root` with hex values written directly into them; component tokens sit at the bottom reading those
semantics; there is no primitive layer at all, and `--mp-overlay-scrim: rgb(0 0 0 / 45%)` is a raw
literal in the component block — the one place the colour gate cannot see, because the gate exempts
the token file wholesale.

That arrangement has exactly one theme, and it cannot get a second one without rewriting every
colour declaration. Which is the failure ADR-012 §4 names: *"a theming system with one theme is an
untested theming system, and the usual failure is discovering that half the 'tokens' were literals
all along."* We are three components and thirty-eight stories in. This is the cheapest this task
will ever be, and every task after `W12-T07` adds to the bill.

Two things are being bought here, and only the first is visible:

1. **A theme is a file.** A palette ramp, the semantic mapping over it, a font pairing, a radius and
   density override. Swapping one changes the product's appearance and nothing else.
2. **The layering is a test, not a convention.** A component may not read a palette value; a
   semantic token must resolve in *every* shipped theme, not only the default. ADR-012 §3 names both
   assertions and this task owes them.

Who suffers without it: `agent-ui` first — every primitive from `W12-T07` on is written against a
token set nobody can prove is complete. Then every user, on the day a half-converted palette puts
near-black text on near-black background in whichever theme nobody was looking at.

---

## 2. User stories

- **As `agent-ui`**, I want a theme to be one file, so that adding the second one is a stylesheet and
  not an archaeology project through six component stylesheets.
- **As a slice agent writing a component**, I want the layering rule enforced by a test, so that
  reaching for `--mp-palette-clay-600` because the semantic name did not exist fails on my branch
  rather than quietly pinning the component to one theme.
- **As a reviewer**, I want to see a story in `default/dark` and `contrast/light` side by side, so
  that "the swap works" is something I looked at rather than something I was told.
- **As a user who has asked their operating system for more contrast**, I want borders and focus
  rings to thicken without my having to find a setting, so that the preference I already expressed
  is answered.

## 3. State machine

None. The switching model is two independent attributes on the root, both optional:

| Attribute | Values | Default when absent |
|---|---|---|
| `data-theme` | `default` · `contrast` | `default` |
| `data-scheme` | `light` · `dark` | follows `prefers-color-scheme` |

Four resolved combinations, all four shipped and all four tested.

**Why two attributes, when ADR-012 §4 says `[data-theme]`.** The ADR's sentence is about dark mode —
*"a theme cannot be chosen, only detected"* — and it is right about the defect. But the same section
names the themes `default` and `alt` and writes the pair as *"`default/dark` and `alt/light`"*: two
axes, named separately, in the ADR's own prose. One attribute cannot carry both without encoding a
tuple in a string. So `data-theme` carries the thing the ADR calls a theme, `data-scheme` carries
light or dark, and `prefers-color-scheme` remains the default rather than the only input — which is
the defect the ADR actually asked to fix. Recorded here rather than fixed quietly; ADR-012 §4's
wording is stale by one word and the ADR is not being amended for it.

The cost is three assertions in `tests/workbench.test.tsx`, which `W12-T03` wrote anticipating this
task and which change from `theme: 'dark'` to `scheme: 'dark'`.

## 4. API surface

### 4.1 The files

`@marketplace/ui/tokens.css` does not move and does not change meaning. It becomes an entry point
that `@import`s the layers in cascade order; every consumer keeps its one import.

| File | Layer | Holds | May read |
|---|---|---|---|
| `src/styles/tokens.css` | — | four `@import`s, and the rules as prose | — |
| `src/styles/scale.css` | primitive | `--mp-space-*`, `--mp-radius-*`, `--mp-font-size-*`, `--mp-font-weight-*`, `--mp-font-line-height`, `--mp-layout-*`, `--mp-border-width`, `--mp-focus-ring-width` | nothing |
| `src/styles/themes/default.css` | primitive → semantic | `--mp-palette-*` ramp; `--mp-color-*`, `--mp-font-family`; radius and density overrides | `--mp-palette-*`, `scale.css` |
| `src/styles/themes/contrast.css` | primitive → semantic | the same set, different values | the same |
| `src/styles/components.css` | component | `--mp-button-*`, `--mp-field-*`, `--mp-listbox-*`, `--mp-overlay-*`, `--mp-dialog-*`, `--mp-popover-*` | semantic only |
| `src/primitives/*.module.css` | — | no token declarations | component + semantic |

The scale is theme-independent by default and theme-overridable by exception: a theme that wants
sharper corners re-declares `--mp-radius-*`, and that is the whole mechanism. Nothing else in the
package may re-declare a token it did not define.

### 4.2 Two new semantic tokens

`--mp-border-width` (default `1px`) and `--mp-focus-ring-width` (default `2px`). Both exist because
the contrast theme needs them and because they are currently written as literals in nine and six
places respectively — values the design system does not name, in stylesheets the design system owns.
The component stylesheets are updated to read them.

`--mp-overlay-scrim`'s literal becomes a semantic `--mp-color-overlay`, per theme.

### 4.3 The token graph, resolved

`tests/tokens.test.ts` gains a resolver: it parses the four stylesheets, builds the declaration map
for each of the four `theme × scheme` combinations, and follows every `var()` chain to a literal.
Every assertion below is made against **resolved values**, not against the text of a file. That is
the difference between "the token is declared somewhere" and ADR-012 §3's word, *resolves*.

### 4.4 The workbench

`preview.tsx` gains a second toolbar. `theme` (Tema: *Por defecto* · *Alto contraste*) and `scheme`
(Esquema: *Claro* · *Oscuro*), both written to the story container and to `document.documentElement`
— the root because an overlay portals to `document.body`, which is the reason `W12-T03` gave and it
has not changed.

## 5. Permissions matrix

Not applicable.

## 6. Error cases

| Condition | Where it surfaces |
|---|---|
| A component stylesheet reads `--mp-palette-*` | `tokens.test.ts` — layering |
| A `var(--mp-…)` that nothing declares | `tokens.test.ts` — every reference resolves |
| A semantic token declared by one theme and not another | `tokens.test.ts` — completeness, both directions |
| A component token whose chain reaches a palette value | `tokens.test.ts` — layering |
| A colour literal outside `themes/*.css` | `tokens.test.ts` — the existing rule, narrowed |
| A theme whose text does not meet 4.5:1 on its own background | `tokens.test.ts` — contrast |
| A theme that changes nothing at runtime | `Theme.stories.tsx` `play` — computed values differ |

---

## 7. Acceptance criteria

- **AC1** — Given `@marketplace/ui/tokens.css`, when a consumer imports it, then every token
  resolves exactly as it did before this task in the default theme — *the layering is a
  refactor, and the shipped appearance does not move.*
- **AC2** — Given any file in `packages/ui` that is not `src/styles/themes/*.css`, when it is read,
  then it contains no reference to `--mp-palette-*` and no colour literal.
- **AC3** — Given each of the four `theme × scheme` combinations, when the token graph is resolved,
  then every `--mp-color-*` declared by any theme resolves to a literal in all four — no token is
  declared by one theme and missing from another, in either direction.
- **AC4** — Given every `var(--mp-…)` reference in the package — component stylesheets and token
  files alike — when the graph is resolved, then each one names a token that is declared.
- **AC5** — Given a component token, when its chain is followed, then it reaches a semantic token
  and never a `--mp-palette-*` value.
- **AC6** — Given each of the four combinations, when the resolved colours are measured, then
  `text` on `bg`, `text` on `surface`, `text-muted` on `bg`, `accent-contrast` on `accent` and
  `accent` on `bg` each meet WCAG AA — 4.5:1 for the text pairs, 3:1 for `accent` on `bg`, which is
  a boundary and not body copy.
- **AC7** — Given `data-scheme="light"` on the root, when the user's system is in dark mode, then
  the light palette applies — *an explicit choice beats the media query, which is the defect
  ADR-012 §4 named.*
- **AC8** — Given a user who has asked their system for more contrast, when the page renders under
  any theme, then `--mp-border-width` and `--mp-focus-ring-width` step up — *the preference is
  answered structurally, in two declarations, without a theme being swapped behind the page's back.*
- **AC9** — Given `Theme.stories.tsx` rendered in the browser project, when its `play` function
  reads the computed value of `--mp-color-bg`, `--mp-color-accent` and `--mp-radius-md` under each
  of the four combinations, then all four differ where the themes differ — *the swap is proven at
  runtime, not asserted from a file.*
- **AC10** — Given the swatch story, when axe runs against it, then there are no violations in any
  of the four combinations — every semantic foreground is rendered on its own background, so
  contrast is checked by the gate `W12-T04` built as well as by AC6.
- **AC11** — Given `preview.tsx`, when a story is opened, then both toolbars are present, Spanish
  first, and both attributes reach the story container and the document root.
- **AC12** — Given `pnpm verify`, when it runs, then both `packages/ui` projects and `apps/web` pass.

## 8. Data

None. No schema, no migration, no contract — this task touches no `packages/contracts` file and
needs no freeze.

## 9. Out of scope

- **A theme switcher in `apps/web`**, and choosing a theme from `prefers-contrast`. Persistence, a
  control in the header, the `prefers-reduced-*` family: that is the public shell, `W12-T09`. This
  task ships the mechanism and the workbench that exercises it; the product surface that offers it
  to a user is a different ticket with a different design question (cookie vs `localStorage`, and
  what SSR does with it — `W12-T14`).
- **A third theme**, or a brand theme for a partner. Two is what proves the swap; three is
  maintenance.
- **Loading a webfont.** `contrast.css` names `Atkinson Hyperlegible` first and falls back to the
  system stack, so the font token demonstrably swaps without this task acquiring a font loading
  strategy — which is `W12-T15`'s, with the performance budget that makes it a decision.
- **Amending ADR-012.** §4's wording is one word stale (§3 above); the record of that is this spec.

## 10. Open questions

### Q1 — is a high-contrast theme "genuinely different" enough to be the proof?

ADR-012 §4 asks for a second theme that *looks genuinely different*, because the point is to catch
literals that were never tokens. A decorative second brand would do that too, and would be the
obvious reading.

High-contrast was chosen instead because it differs on every axis the ADR lists — palette (all
twelve colours), font pairing, radius, and density via border and ring widths — while also being a
thing a user can want. A second brand theme is a fixture: it exists to make a test pass, nobody
looks at it, and it rots the first time someone adds a token and updates only the default. A theme
somebody will eventually be able to choose has a user, and a user is what keeps a file honest.

What it deliberately does **not** do is apply itself from `prefers-contrast: more`. In plain CSS —
no preprocessor here — a media query cannot be combined with an attribute selector in one rule, so
applying the whole theme by preference means writing the entire semantic mapping twice. A palette
duplicated across two blocks is precisely the rot this ticket exists to prevent: the day someone
adds a token, one of the two copies gets it. What the media query *does* carry is the two structural
tokens (AC8), which is two declarations and no duplication. Choosing a theme from a user preference
belongs with the surface that owns preferences — `W12-T09`, where persistence and SSR are already
the question.

The risk in the other direction is real and worth naming: high-contrast shares the default's
*structure*, so it would not catch a literal that happens to be structural rather than chromatic.
AC4 covers that gap from the other side — every `var()` reference must resolve — which is the
assertion a brand theme would have bought.

### Q2 — why is contrast asserted in a node test when axe already checks it?

Because axe checks what is rendered, and what is rendered is one combination at a time. AC10 gets
all four only because the swatch story renders all four at once, which is a property of that story
rather than of the gate. AC6 computes the ratios from the resolved token graph, so a theme is
checked whether or not anyone wrote a story for it — and the failure names the token pair rather
than a DOM node.

They overlap deliberately. The overlap is the point: the day someone deletes the swatch story
because it is "not a component", AC6 still holds.

No `ESCALATION` blocks.
