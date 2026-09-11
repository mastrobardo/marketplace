# W12-T04 — An axe violation fails the pull request

Task: `W12-T04` · Slice: S10 · Owner: `agent-ui` · Issue: #204
Branch: `W12-T04-story-a11y-gate` · Run record: `W12-T04-story-a11y-gate.run.md`
Design: [ADR-012](../../adr/ADR-012-design-system-and-component-workbench.md) §5 ·
Builds on [`W12-T03`](W12-T03-storybook-workbench.md)

---

## 1. Purpose

`TODO.md` schedules `W10-T05` — WCAG 2.1 AA — as an audit near the end of the project. That is the
single most expensive way to buy accessibility: by the time it runs there are hundreds of components,
each with its own focus ring, and the findings arrive as a report that nobody's current ticket is
about.

This task pays that bill per pull request instead. `@storybook/addon-a11y` with
`parameters.a11y.test = 'error'` runs axe against every story in the browser project `W12-T03`
built, and a violation fails the run exactly like a failing assertion — on the branch that caused
it, in the agent's own feedback loop, while the component is still the thing it is working on.

Who suffers without it: every user of assistive technology, eventually; and every agent from `W2`
on, who would otherwise get this feedback months late and out of context.

It is one addon and one line. The purpose section is longer than the diff, and that is the point of
the ticket existing separately — the decision is what it costs the next hundred pull requests, not
what it costs to write.

---

## 2. User stories

- **As a slice agent**, I want axe to fail my PR, so that I fix a missing label while I am looking
  at the component rather than in an audit six months later.
- **As a user of a screen reader**, I want the components I meet to have been checked automatically,
  every time, rather than on the day someone remembered.
- **As `agent-ui`**, I want the severity pinned by a test, so that turning the gate down to a
  warning is a visible decision instead of a quiet string change at the end of a hard afternoon.

## 3. State machine

None.

## 4. API surface

| File | Change |
|---|---|
| `.storybook/main.ts` | add `@storybook/addon-a11y` |
| `.storybook/preview.tsx` | `parameters.a11y = { test: 'error' }`, globally |
| `tests/workbench.test.tsx` | assert the severity is `'error'` and the addon is loaded |

**Global rather than per story.** Per-story parameters mean a new component is covered when someone
remembers; the global means it is covered by existing. The addon's other settings (`'todo'` — report
but do not fail — and `'off'`) stay available for a specific story that has a reason, which is then
one line in a diff a reviewer can see.

## 5. Permissions matrix

Not applicable.

## 6. Error cases

An axe violation is reported as a failing browser test, naming the rule, the element and the Deque
rule page — e.g. *"Buttons must have discernible text (button-name)"* against `$('div > button')`.

---

## 7. Acceptance criteria

- **AC1** — Given every story, when the `storybook` project runs, then axe runs against the rendered
  story and a violation fails the run.
- **AC2** — Given a story with a deliberate violation (an `img` with no `alt`, a `button` with no
  text), when the project runs, then it **fails**, naming the rules. *(The proof the gate is
  connected. A gate that has never been seen to fail is not known to be a gate — this is the
  `database`-job lesson from `memory/repo/gotchas.md`, applied to the thing this task is building.)*
- **AC3** — Given the seven primitives' 38 stories as they stand, when the project runs, then there
  are **no** violations — so the gate starts from a clean tree rather than an allowlist.
- **AC4** — Given `preview.tsx`, when the severity is read, then it is `'error'`, asserted by a test
  so that lowering it to `'todo'` or `'off'` fails that test.
- **AC5** — Given `pnpm verify`, when it runs, then everything passes as before.

## 8. Data

None.

## 9. Out of scope

- **Fixing an existing violation.** There are none; if there had been, fixing them is this task's
  work and the criterion above would have named them.
- **`apps/web`.** The shell has no stories. Its accessibility is asserted by `shell.test.tsx`'s
  landmark checks today and by the nightly axe run (`TODO.md` §7); when the storefront's pages ship
  (`W12-T09`+), whether pages get the same per-PR treatment is that ticket's decision.
- **Visual regression** (`W12-T16`) and **Lighthouse** (`W12-T15`).

## 10. Open questions

### Q1 — what happens the first time this blocks something urgent

The honest risk is not technical. `test: 'todo'` exists, it is one word, and the pressure to use it
arrives on the first PR blocked by a contrast ratio late in the day. AC4 makes that a test failure
rather than a silent edit, which is as far as a gate can go on its own: the rest is that the change
shows up in a diff, with a reviewer.

No `ESCALATION` blocks.
