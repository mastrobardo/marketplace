# W12-T18 — Visual foundations: a palette, a type scale, and depth

Task: `W12-T18` · Slice: S10 · Owner: `agent-ui` · Issue: #232
Branch: `W12-T18-visual-foundations` · Run record: `W12-T18-visual-foundations.run.md`
Design: [ADR-012](../../adr/ADR-012-design-system-and-component-workbench.md) §3, §4 ·
[ADR-011](../../adr/ADR-011-web-application-architecture.md) §1 ·
Builds on [`W12-T05`](W12-T05-token-layers-and-themes.md), [`W12-T10`](W12-T10-home-page.md)

---

## 1. Purpose

Seventeen W12 tickets built the machinery for an appearance and none of them was asked to supply one.
`W12-T02` gave us seven primitives on React Aria — which, by design, *"gives us no appearance
whatsoever"* (ADR-012 §2). `W12-T05` gave us three token layers and proved the swap with a second
theme. `W12-T03`/`T06` gave us a workbench with a URL. `W12-T16` will screenshot it nightly.

What nobody owns is **what the values are**. The defaults were drawn as scaffolding in `W12-T01` and
have not been revisited since:

| Today | Consequence |
|---|---|
| `--mp-font-family: system-ui` | the single largest contributor to "this looks like a wireframe" |
| Four type sizes, largest `1.75rem` | the storefront `h1` is 28px; there is no display size |
| One `line-height: 1.55` for every size | correct for body copy, too loose for a headline |
| Shadow tokens exist; only overlays use them | every surface is flat, so nothing has hierarchy |
| Eleven palette entries, one accent | no tonal range for hover, selection, or emphasis |

The operator looked at `W12-T10`'s preview and said the structure is there and *"visually speaking it
lacks a lot"*. That is an accurate reading of a system that was deliberately built with no opinion
and then never given one.

Who suffers without it: every remaining storefront ticket — `W12-T11`, `T12`, `T13` all compose from
the same primitives, so they inherit whatever this layer is when they land. And `W12-T16`, which
would otherwise generate baselines for a look we are about to replace.

**This is a values change, not a components change.** It lands in `scale.css`, `themes/default.css`,
`themes/contrast.css` and `components.css` — the layers ADR-012 §3 built for exactly this — plus the
per-component stylesheets that consume them. No page's markup moves.

## 2. User stories

- **As a visitor**, I want the page to have a visible hierarchy — a headline that reads as a headline,
  surfaces that sit above the background — so that I can tell what the product wants me to do.
- **As a visitor with low vision**, I want the new palette to stay at WCAG AA in both schemes and both
  themes, so that a prettier site is not a less readable one.
- **As a visitor who prefers more contrast**, I want `themes/contrast.css` to still be a genuine
  alternative rather than a stale copy of the palette it was forked from.
- **As `W12-T11`/`T12`/`T13`**, I want the token layer to already be worth composing against, so that
  I build a page rather than quietly inventing a shade in a page stylesheet.
- **As `W12-T16`**, I want to baseline a look that is not about to change.
- **As `agent-ui` six months from now**, I want to know where these values came from, so that
  changing one is a decision rather than an archaeology exercise.

## 3. State machine

The theme layer has no state of its own. The one lifecycle is theme and scheme resolution, and it is
**unchanged by this task** — recorded here only so that a reader can see it was considered:

| From | Event | To | Guard |
|---|---|---|---|
| no attribute | — | default theme, scheme from `prefers-color-scheme` | `color-scheme: light dark` in `tokens.css` |
| any | `[data-theme="contrast"]` on a subtree | contrast theme | a theme is a file (ADR-012 §4) |
| any | `[data-scheme="light\|dark"]` on a subtree | that scheme | unanchored, so a container may carry one |
| any | `prefers-contrast: more` | thicker borders and focus rings | structural, not a theme swap |

Adding values to a layer cannot change this table. If it does, the task has gone wrong.

## 4. API surface

No HTTP endpoint, no contract, no route. The surface is the token graph, and the change is additive
to three of its four files.

### 4.1 Where the values come from — sourced, not invented

Drawing 30 accessible colour steps and a fluid type scale by hand is a week of work done worse. Three
vetted sources, each **vendored rather than depended on**:

| Source | Feeds | Licence | Form |
|---|---|---|---|
| [Radix Colors](https://www.radix-ui.com/colors) | the palette layer in both themes | MIT — **verify before copying** | 12-step scales, light + dark pairs, alpha variants |
| [Open Props](https://open-props.style/) | type scale, fluid sizes, elevation | MIT | CSS custom properties, no build step |
| [React Aria starter kit (vanilla CSS)](https://react-aria.adobe.com/getting-started) | component-level treatment | **unverified — check before copying a line** | styled implementations of every component, light/dark/high-contrast |

**Vendored, not installed, and that is the important word.** ADR-012 §4 says *"a theme is: a
`--mp-palette-*` ramp, the semantic mapping over it, a font pairing, and optional radius and density
overrides. Nothing else."* A theme file that does `--mp-palette-stone-50: var(--sand-2)` is a theme
that no longer resolves on its own: `tokens.test.ts` walks a graph of `--mp-*` declarations, and
`--sand-2` is not in it. So the hexes are copied in with a comment naming the scale and step they
came from, and the dependency count stays where it is — which also means nothing is added to the
231 KB `W12-T15` is already over budget on.

Radix Colors earns its place specifically because its twelve steps are defined **by role**, not by
lightness — 1–2 page background, 3–5 component background at rest/hover/active, 6–8 borders, 9–10
solid fills, 11 muted text, 12 high-contrast text. That is very close to the semantic names
`W12-T05` already chose, so the mapping is a table rather than a judgement call, and steps 11 and 12
are built to a stated APCA contrast target — which `tokens.test.ts` AC6 then *measures* rather than
trusts.

The React Aria starter kit is a **reference to read, not a package to add**. It is the closest thing
that exists to "what should a good combobox on this exact library look like", and its light / dark /
high-contrast structure is the one this repo already has. Anything taken from it is re-expressed as
CSS Modules over component tokens, because a second styling system inside `packages/ui` is the thing
ADR-012 §3 exists to prevent.

### 4.2 The type scale — the biggest single win

Today: four sizes, one line-height, no display step.

```
--mp-font-size-sm / base / lg / xl        (0.875 / 1 / 1.25 / 1.75rem)
--mp-font-line-height: 1.55               ← for all of them
```

Proposed: a scale with display sizes, and **a line-height per size** — leading tightens as type
grows, and a single ratio is why the `h1` reads as large body text. Fluid sizing (`clamp()`) for the
display steps only, so a hero headline is not phone-sized on a desktop and desktop-sized on a phone.

The exact step count and ratio are the implementer's, within one constraint: **every size token has a
matching line-height token**, asserted, so the next size added cannot inherit body leading by
accident.

### 4.3 Elevation

`--mp-palette-shadow-45` / `-65` exist and only `Dialog` and `Popover` read them. This adds a
semantic elevation set — resting, raised, overlay — mapped in the theme layer, so a card can sit
above the page without a component stylesheet writing a shadow of its own. `boundaries.test.ts` AC18
already forbids a colour literal in a component stylesheet; a shadow is a colour with extra steps.

### 4.4 What this does *not* touch

The primitives' markup, the patterns' markup, and every page's structure. If a `.tsx` under
`src/` changes, the diff needs a reason in the run record. The exception is
`packages/ui/src/**/*.module.css`, which is where consuming a new component token happens.

## 5. Permissions matrix

| Role | Sees the new appearance |
|---|---|
| anonymous | allow |
| CLIENT / PROVIDER / ADMIN | allow |

A stylesheet has no permissions. There is no deny row and therefore no deny criterion; the honest
version of this section for a theming task is that it does not apply.

## 6. Error cases

Not runtime failures — a CSS variable does not throw. These are the ways this task fails, each of
which must be a red test before it is a fixed bug:

| Case | Behaviour |
|---|---|
| A new palette step breaks contrast on a pair | `tokens.test.ts` AC6 fails, per theme × scheme |
| A pair that AC6 does not list breaks contrast | **nothing fails today** — see §7 AC6 and §10 Q2 |
| `themes/contrast.css` is not updated alongside the default | AC3's "same set of names in every theme" fails |
| A semantic token is added but only to one theme | AC3 fails — it resolves in one combination and not the other |
| A component stylesheet writes a shadow or a size literal | colour is gated; **size and shadow are not** — see §7 AC20 |
| A font-size is added with no matching line-height | nothing fails today — see §7 AC19 |
| An axe violation appears because contrast dropped | `W12-T04`'s gate fails the PR on any story |

## 7. Acceptance criteria

| # | Given / When / Then | Test |
|---|---|---|
| AC1 | Given the new palette, when the graph resolves, then every semantic token resolves in **every** theme × scheme combination | `tokens.test.ts` AC3 (existing) |
| AC2 | Given both themes, when compared, then they declare the identical set of colour names | `tokens.test.ts` AC3 (existing) |
| AC3 | Given the new palette, when each listed pair is measured, then all meet WCAG AA in every combination | `tokens.test.ts` AC6 (existing) |
| AC4 | Given a palette value, when located, then it is declared in a theme file and nowhere else | `tokens.test.ts` AC2 (existing) |
| AC5 | Given the new component tokens, when resolved, then each references a semantic token or its own family | `tokens.test.ts` AC5 (existing) |
| **AC6** | Given **every foreground/background semantic pair the components actually compose**, when measured, then each meets AA — the pair list is **derived from the component-token graph, not hand-written** | `tokens.test.ts` (**new** — replaces the six-entry literal) |
| **AC19** | Given every `--mp-font-size-*` token, when the graph is read, then a matching line-height token exists for it | `tokens.test.ts` (**new**) |
| **AC20** | Given every component stylesheet, when read, then it names no raw `px`/`rem` font-size and no raw `box-shadow` value — both come from tokens, like colour | `boundaries.test.ts` (**new**, extending AC18) |
| **AC21** | Given the display type steps, when resolved, then they are fluid (`clamp`) and the resolved minimum is smaller than the resolved maximum | `tokens.test.ts` (**new**) |
| AC22 | Given every story, when the workbench suite runs, then axe passes — contrast included | `W12-T04`'s gate (existing) |
| AC23 | Given `Theme.stories.tsx`, when it renders, then the four-up theme × scheme grid still shows four genuinely different renderings | `tokens.test.ts` AC7/AC8 + the story (existing) |
| AC24 | Given the vendored values, when a palette step is read, then a comment names its source scale and step | reviewed, not tested — see §10 Q3 |

AC6 is the one that matters most and the one this task should be judged on. The current list is six
hand-written pairs, and `--mp-color-text-muted` on `--mp-color-surface` is **not among them** — which
is precisely the combination `Card`'s description renders in, on every category card, step, and trust
point on the home page. A palette change is exactly the event that would break it, and today nothing
would say so. This is the same failure class as `MEM` "CI gates fail open": *a gate that names its
subjects by hand only ever checks the ones somebody remembered.*

## 8. Data

No migration, no Prisma change, no contract change, no new runtime dependency. Two or three
`devDependencies` may appear if a colour-space or contrast helper is needed for the derived AC6; a
runtime dependency would be a deviation requiring a reason.

## 9. Out of scope

- **The typeface** — split out as `W12-T19` (#233). `--mp-font-family` stays `system-ui` here. Choosing a face is a licensing
  and cost decision with a human on the other end of it, and a self-hosted font is also a
  `W12-T15` performance question (`font-display`, subsetting, preload). It splits into its own ticket,
  and this one is written so that ticket is a one-line change in the theme file.
- **Imagery, illustration and iconography.** There is no asset pipeline until `W12-T15` and no
  licensed art. The trust strip stays text. Naming this explicitly because it is the other half of
  why the page reads as unfinished, and a palette will not fix it.
- **Page structure.** No hero photograph, no layout rework, no new sections. If the composition is
  wrong, that is a page ticket, not a token ticket.
- **A brand.** Name, logo, voice. Not `agent-ui`'s to invent — see §10 Q1.
- **Component behaviour.** React Aria owns it; nothing here touches an interaction.
- **`W12-T16`'s baselines.** This task should land *before* it, not do its job.

## 10. Open questions

### ESCALATION — Q1: is there a brand coming from outside?

```
ESCALATION
Task:      W12-T18
Question:  Is a name, logo, or brand palette arriving from outside this repo — and if so, when?
Options:   A) No brand yet. This task picks a defensible neutral palette from Radix, tuned to the
              existing warm-neutral + clay-accent direction, and the eventual brand is a theme file.
           B) A brand is coming. Wait, or build the mapping now and fill the ramp later.
Recommend: A, but only if the answer is actually "no". The cost of guessing wrong is low *because*
           ADR-012 §4 made a theme a file — a brand palette lands as a ramp swap, not a refactor.
           That is the whole return on W12-T05, and this is the first task that collects it.
Blocked:   Nothing. A is safe to start under either answer.
Not blocked: Everything.
```

**Answered by the operator, 2026-09-12: A — no brand is arriving.** *"No, i will hire a designer
after the first phase."* With a direction: **grey, blue, and accents orange / dark orange, keeping
the light style.**

The first implementation had guessed a warm neutral (Radix `sand` + `brown`) under option A's own
logic and was wrong about the direction, which is precisely the cost ADR-012 §4 caps at one file —
the palette was re-cut on Radix `slate` + `blue` + `orange` in that one file plus the component
mapping, with no component markup touched. The re-cut is recorded in the run record; the
operator's own words are the spec now.

### Q2 — the contrast gate names its pairs by hand

Six literal pairs today. `--mp-color-text-muted` on `--mp-color-surface` is missing and is what every
`Card` description renders in. AC6 makes the list derived: walk the component-token graph, find each
token whose name says foreground (`-fg`, `-color`, `-text`) paired with the surface its component
puts it on, and measure all of them.

The honest caveat: "the surface its component puts it on" is not fully knowable from the token graph —
`--mp-card-description-fg` and `--mp-card-bg` are a pair because `Card.module.css` uses them
together, and only the stylesheet says so. So the derivation is *per component family*: every `*-fg`
in a family is measured against every `*-bg` in the same family, plus the page-level pairs. That
over-measures slightly, which is the correct direction for a gate to be wrong in.

**Resolved on implementation: the derivation pairs by *variant* within a family.** A foreground
with an exact variant match is measured against that background **and nothing else** — without that
rule `--mp-listbox-option-focus-fg` is also measured against `--mp-listbox-bg`, which is white on
white and a failure for a composition that never happens. Over-measuring is the safe direction only
while the extra pairs are real. The result is **21 pairs per combination, 84 measurements**, against
24 before — and it failed on the palette already in `main`: `--mp-card-eyebrow-fg` on
`--mp-card-bg-hover` at 4.4:1.

### Q3 — AC24 is reviewed, not tested

"Every vendored value carries a comment naming its source" is worth doing and not worth a test: the
assertion would be a regex over comments, which passes for a comment that is wrong. Provenance is a
review item. It is stated as an AC anyway so that a reviewer knows to look for it, and so that the
absence is a finding rather than a preference.

### Q4 — this ticket cannot prove it worked

Every criterion above is a constraint: contrast holds, tokens resolve, nothing hardcodes a value.
None of them says *it looks better*, and no test can. The three existing checks that come closest —
the axe gate, the four-up theme story, and `W12-T16`'s screenshots — verify that it is not broken and
not accidentally changed. **Whether it is good is a human looking at the preview URL**, and this
ticket should not pretend otherwise. `W12-T06` deployed the workbench for exactly this, and the
storefront preview covers the composed pages.

### Q5 — the starter kit's licence is unverified

The React Aria starter kits are real and include a vanilla-CSS variant with light, dark and
high-contrast modes. The licence covering them was **not** established while writing this spec — the
pages that describe them do not state one. Nothing may be copied from them until it is, and if it
turns out to be restrictive the task loses a reference and nothing else: Radix Colors and Open Props
carry the parts this ticket depends on.

**Still unresolved after implementation (2026-09-11), and therefore honoured:** the pages describing
the starter kits state no licence, and React Aria's Apache-2.0 covers the library rather than the
downloadable kit. **Nothing was copied from it** — not a line and not a measurement. Radix Colors
(MIT) and Open Props (MIT) carried the whole ticket, exactly as this section predicted. The
reference stays unavailable until someone establishes the terms.
