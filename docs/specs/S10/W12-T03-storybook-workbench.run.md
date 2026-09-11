# Run record — W12-T03 storybook-workbench

```
Agent:        agent-ui
Model:        claude-opus-5
Charter rev:  2
Skills used:  spec-driven-development, test-driven-development, ci-cd-and-automation,
              frontend-ui-engineering
Started:      2026-09-11T15:42:00Z   Finished: 2026-09-11T16:00:00Z
Session file: memory/sessions/2026-09-11-agent-ui-W12-T03.md
```

---

## Prompts

### 1. Spec authoring

Verbatim, from the operator — the instruction that opened the series, of which this is the third
task:

> comntinue with  W12-T01 to T03. also, take a look at w12t06 as it might convenient to add to the
> queue
> **Which tasks should I take in this run?** → T01 + T02 + T03, Add T04 (a11y = error), Add T06
> (deploy workbench)
> **How should the branches land?** → Stacked PRs, you merge as we go

Written against `agents/prompts/00-spec-authoring.md`. §3 and §8 are "none"; §5 exists to declare
one boundary crossing (`.github/workflows/ci.yml` is `agent-devops`') rather than to leave it in the
diff for a reviewer to notice.

### 2. Contract proposal

Not run — no contract, no schema. The `packages/ui` → `packages/contracts` prohibition from ADR-012
is already a gate (`tests/boundaries.test.ts`, `W12-T02`).

### 3. TDD red

Against `agents/prompts/02-tdd-red.md`. This task is almost entirely configuration, so the test plan
is about what configuration can silently stop doing:

- the two projects exist and one of them is a real browser (AC1, AC2);
- the decorator actually reaches the story — asserted by rendering it, not by reading it (AC4, AC5);
- Storybook does not phone home (AC6);
- **CI installs a browser before running the tests** (AC8), which is the assertion that matters
  most. Without it the story tests do not run in CI, and a suite that does not run reports success.

That last one reads `agent-devops`' workflow from `packages/ui`, deliberately: if the step is
dropped, the failure should appear where someone can act on it.

### 4. Implementation

Against `agents/prompts/03-implement-green.md`: `.storybook/`, then the two-project Vitest config,
then the CI step, then the assertions above.

### 5. Corrections

Three, all mine:

1. **`import playwright from '@vitest/browser-playwright'`** — the package has no default export in
   Vitest 5. `import { playwright }`. The error was at config load, which is the cheapest possible
   place to be wrong.
2. **`setProjectAnnotations` was mine to delete, not to write.** Storybook ≥10.3 applies
   `preview.tsx`'s annotations to the browser project itself and prints an advisory box saying so on
   every run. Removed the setup file entirely. Worth recording: every Storybook tutorial written
   before 10.3 tells you to add it.
3. **AC8 compared a comment with a step.** `unit.indexOf('pnpm test')` matched the phrase inside the
   comment I had written above the install step, so the ordering assertion failed against correct
   YAML. Matching `- run: pnpm test` fixed it — and the failure was a fair one: an assertion about
   ordering has to name the thing whose order matters.

---

## Red phase

```
 ❯ packages/ui  vitest run --project=unit tests/workbench.test.tsx
 FAIL  tests/workbench.test.tsx > AC8 … > installs Chromium in the job that runs the tests
      → AssertionError: the browser is installed after the tests that need it: expected false to be true
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

The other eight assertions were written against configuration that did not exist when the file was
written and went green as each piece landed; AC8 is the one that survived to a real red — and then
turned out to be red for a reason nobody would have guessed (correction 3).

Before the browser project existed, `pnpm --filter @marketplace/ui test` ran **70 tests in one
jsdom project**. That is the baseline this task moves.

## Green phase

```
 ❯ packages/ui  vitest run
   Test Files  12 passed (12)      Tests  79 passed (79)

   --project=unit        39 passed   (jsdom: behaviour, boundaries, tokens, workbench wiring)
   --project=storybook   40 passed   (Chromium: every story, with its play function)

 ❯ pnpm --filter @marketplace/ui build:storybook
   Storybook build completed successfully → storybook-static/ (8.7 MB)     (AC7 — W12-T06 deploys this)

 ❯ pnpm verify → typecheck ✓  lint ✓  format:check ✓  build ✓
                 test: everything passes except one pre-existing failure — see below.
```

Story count: the jsdom `stories.test.tsx` shrank from 39 assertions to 8, because the browser
project now renders every story properly. What stays in jsdom is the assertion a browser cannot
make — that a `LongText` story which was never written is missing.

## Deviations from spec

- **`tests/stories.test.tsx` was narrowed, not deleted** (spec §10 Q1). Keeping the jsdom rendering
  loop would assert the same thing twice, in the weaker environment.
- **Storybook telemetry is disabled** — not in the ticket, and one line. It phones home on every
  `dev`, `build` and test run; this repo is personal (`docs/board/IDENTITY.md`) and most of those
  runs are an agent's. An outbound call nobody chose is not a default worth inheriting silently.
- **`.github/workflows/ci.yml`** — one step added to the existing `unit` job, declared in spec §5.
  It is `agent-devops`' file, and ADR-012 §5's whole claim is "the existing runner, the existing CI
  job, one command", which cannot be true without a browser in that job.

## Human input received

- Scope and cadence, quoted in §Prompts. No human edited a file on this branch.
- **Reported to the operator, not fixed here:** `pnpm test` fails on `@marketplace/testing` with
  *"no buildAuditRecord() — add one, or allowlist the model with a reason"*. It is **pre-existing
  and not this branch's**: `W1-T07` (#195) added the `AuditRecord` model, `W1-T09` (#196) added the
  gate that every model needs a factory, and they merged in that order. Verified by stashing this
  branch's changes entirely and re-running. CI on `main` itself is red for it (run 34573704861), and
  it is the only failing job on this stack — everything else on PR #219 is green.

  Not fixed here for two reasons: `packages/testing` is `agent-contracts`' (L4), and the fix is a
  design judgement rather than a typo — `W1-T07`'s law is that an `AuditRecord` is written *only*
  through `transition()`, so the right answer may well be the allowlist entry the gate's own message
  offers rather than a factory that fabricates one.

  **The turbo cache is why nobody saw it.** The test reads `apps/api/prisma/schema.prisma`, which is
  outside the package turbo hashes for `@marketplace/testing#test`, so a pass from before the model
  existed kept being replayed locally. It only failed here because an install invalidated the cache.
  That is a second finding and a worse one than the first.

## Self-assessment

- **Weakest part of this change.** The theme toolbar switches nothing visible, because `tokens.css`
  still keys on `prefers-color-scheme` and `W12-T05` is what makes a theme a file. It is written
  down in three places and the criterion asserts presence rather than appearance, so it will keep
  passing when T05 makes it real — but a toolbar that looks like it works and does not is exactly
  the kind of thing that gets rediscovered as a bug. T05 is next; if it slips, this is the thing to
  remember.
- **What a reviewer should look at hardest.** `vitest.config.ts`, and specifically the decision that
  `pnpm test` runs both projects. It makes a real browser a prerequisite for `pnpm verify` on every
  machine and in CI. The alternative — a separate `test:stories` script — is cheaper for everyone
  until the first time someone forgets to call it, after which the accessibility gate that `W12-T04`
  is about to attach to this project stops running and nothing says so.
- **What I would tell the next agent in this slice.** `W12-T04` is one addon and one line on
  `preview.tsx` — the project it attaches to already exists and already runs every story in Chromium.
  For `W12-T05`, the toolbar is already wiring `[data-theme]` onto both the story container and the
  document root; you need a palette, not a workbench change. And do not add a setup file that calls
  `setProjectAnnotations`: Storybook does it for you now, and will tell you so on every run.
