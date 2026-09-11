# Run record — W12-T04 story-a11y-gate

```
Agent:        agent-ui
Model:        claude-opus-5
Charter rev:  2
Skills used:  test-driven-development, frontend-ui-engineering, spec-driven-development
Started:      2026-09-11T16:02:00Z   Finished: 2026-09-11T16:10:00Z
Session file: memory/sessions/2026-09-11-agent-ui-W12-T03.md (same session; this task is the tail of T03)
```

---

## Prompts

### 1. Spec authoring

Verbatim, from the operator — this task was added to the queue in answer to a question asked before
any work began:

> **Which tasks should I take in this run?** → T01 + T02 + T03, **Add T04 (a11y = error)**, Add T06
> (deploy workbench)

It was offered as "~one config line on top of T03", and that estimate held. The spec is longer than
the diff on purpose: what is being decided is what this costs the next hundred pull requests.

### 2. Contract proposal

Not run — no contract, no schema.

### 3. TDD red

Against `agents/prompts/02-tdd-red.md`, with one wrinkle worth naming. The natural test for this
task — "an axe violation fails the build" — cannot live in the repository, because a story that
always fails cannot stay in the tree. So the red phase was run as a **deliberate probe**, its output
pasted below, and what remains is the assertion that the severity is still `'error'`.

That split is deliberate: the probe proves the gate is *connected*, and the permanent test prevents
it being *disconnected*. Neither alone is enough — the first cannot be kept, and the second would
pass on a configuration that does nothing.

### 4. Implementation

One addon, one parameter. Against `agents/prompts/03-implement-green.md`.

### 5. Corrections

None. The first run of the browser project passed all 40 stories, which is the answer this ticket
was hoping for and also exactly the answer a gate that is not connected would give — hence the probe
below, before believing it.

---

## Red phase

A temporary story with two violations axe cannot miss — an `img` with no `alt`, a `button` with no
text — added, run, and deleted:

```
 ❯ packages/ui  vitest run --project=storybook
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |storybook (chromium)| src/primitives/AxeProbe.stories.tsx > Long Text
Expected the HTML found at $('div > button') to have no violations:
"Buttons must have discernible text (button-name)"
https://dequeuniversity.com/rules/axe/4.13/button-name?application=axeAPI

Expected the HTML found at $('img') to have no violations:
"Images must have alternative text (image-alt)"
https://dequeuniversity.com/rules/axe/4.13/image-alt?application=axeAPI

 Test Files  1 failed | 7 passed (8)
      Tests  1 failed | 40 passed (41)
```

That is AC2, and it is the only evidence that matters here: the gate fails, in the browser, naming
the rule and the element.

## Green phase

```
 ❯ packages/ui  vitest run
   Test Files  12 passed (12)     Tests  81 passed (81)

   --project=storybook  40 passed — 38 stories across seven primitives, axe clean (AC3)
   --project=unit       41 passed — including the two new assertions that pin the gate (AC4)

 ❯ pnpm verify → typecheck ✓  lint ✓  format:check ✓  build ✓
                 test: green except the pre-existing @marketplace/testing failure documented in
                 W12-T03's run record — AuditRecord, #195 before #196, red on main.
```

**No primitive needed fixing.** Seven components, 38 stories, zero violations on the first run. That
is React Aria doing the expensive half of the job — which is the bet ADR-012 §2 made, and this is
the first evidence for it rather than an argument about it.

## Deviations from spec

None.

## Human input received

- The decision to add this task to the queue, quoted in §Prompts. No human edited a file on this
  branch.

## Self-assessment

- **Weakest part of this change.** It is not the code, it is the durability. `test: 'todo'` is one
  word away, and the pressure to reach for it arrives on the first pull request blocked by a
  contrast ratio at the end of a long day. AC4 turns that into a failing test rather than a silent
  edit; a gate cannot do more than make the decision visible.
- **What a reviewer should look at hardest.** Whether `a11y` belongs in the global `parameters` at
  all — a per-story opt-in would be gentler and would mean a new component is covered only when
  somebody remembers, which is the failure mode this whole ticket exists to remove. If the global is
  wrong, it is wrong now, not after two hundred stories.
- **What I would tell the next agent in this slice.** Axe runs on what is *rendered*, so a state
  that has no story is a state no accessibility check has ever seen. That is the second reason the
  `LongText` gate in `tests/stories.test.tsx` matters: a component whose overflow case was never
  written has a whole untested surface, and now an unchecked one too.
