# W12-T16 — run record

Task: `W12-T16` · Branch: `W12-T16-visual-regression` · Issue: #216
Spec: [`W12-T16-visual-regression.md`](W12-T16-visual-regression.md)

---

## What landed

Two halves of one engine, as the spec argued: the nightly screenshot comparison over the pinned
story list, and the axe pass over the storefront's real routes. Plus the accept path, because a
visual gate without one gets deleted the first time somebody ships a deliberate redesign.

| | |
|---|---|
| Subjects derived | 74 stories, 14 files — pinned, 0 excluded |
| New tests | 44 in `packages/ui` + 10 in `tests/cd-workflows.test.ts` + 2 in `apps/web` |
| Routes under axe | 7, all passing |
| Workflows | `nightly-visual.yml`, `visual-baselines.yml` — `ci.yml` untouched |
| Baselines committed | **none yet** — deliberately, see §Q2 below |

## Red phase (L1)

### The coverage gate, before there was anything to cover

```
$ pnpm exec vitest run --project unit tests/visual-coverage.test.ts

Error: Failed to resolve import "../visual/pinned.js" from "tests/visual-coverage.test.ts".
Does the file exist?
  Plugin: vite:import-analysis
  File: packages/ui/tests/visual-coverage.test.ts:5:35

 Test Files  1 failed (1)
      Tests  no tests
```

Then, with the modules written and `PINNED` deliberately left empty — the gate enumerating its own
work, which is the shape the whole ticket is about:

```
 FAIL  tests/visual-coverage.test.ts > the real package is fully covered
AssertionError: expected [ …74 items ] to deeply equal []

+   "primitives-textinput--with-error (Primitives/TextInput → WithError) is in neither the
     pinned list nor the exclusions. Add it to PINNED, or exclude it with a reason.",
+   "foundations-themes--matrix (Foundations/Themes → Matrix) is in neither the pinned list
     nor the exclusions. Add it to PINNED, or exclude it with a reason.",
     …

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

### The runner and the reporter

```
$ pnpm exec vitest run --project unit tests/visual-runner.test.ts tests/visual-report.test.ts

Error: Failed to resolve import "../visual/report.js" from "tests/visual-report.test.ts".
Error: Failed to resolve import "../visual/config.js" from "tests/visual-runner.test.ts".

 Test Files  2 failed (2)
      Tests  no tests
```

### AC8 — a missing baseline, proven to fail and to write nothing

```
$ pnpm exec playwright test visual/stories.spec.ts -g "patterns-card--default"

  Error: A snapshot doesn't exist at packages/ui/visual/baselines/patterns-card--default.png.

  1 failed

$ ls visual/baselines
ls: visual/baselines: No such file or directory
```

That is `updateSnapshots: 'none'` doing the one thing Playwright would not have done by default —
its default writes the missing baseline and fails, which means the first run after a regression
adopts the regression as the new truth.

## Finding 1 — the tolerance was hiding exactly what the gate is for

**AC19's probe failed to fail, twice, and the second time it was the gate's fault.**

Probe one: `padding-top: 1px` inserted at the top of `.card`. The run passed. Correct — the rule
already had `padding: var(--mp-card-padding)` eight lines below, and the shorthand overrides the
longhand regardless of order-of-appearance intuition. **The probe was wrong, not the gate**, which
is `MEM-2026-09-11-10`'s rule applied to a green rather than a red: ask which of the two is wrong
before fixing either.

Probe two: `padding-top: calc(var(--mp-card-padding) + 1px)`, placed *after* the shorthand. Verified
in the browser before trusting anything — `getComputedStyle(...).paddingTop === '17px'`, up from
16px. The run still passed.

That one was the gate. Measured by dropping the threshold to zero:

```
Error: expect(locator).toHaveScreenshot(expected) failed
  511 pixels (ratio 0.01 of all image pixels) are different.
```

`maxDiffPixelRatio: 0.001` reads as *"a thousandth of the image"*. On a 1280×800 screenshot it is a
budget of **1,024 pixels**. A real one-pixel layout shift on one component moves **511**. So the
threshold was twice the size of the regression it exists to catch, and the gate would have run
green every night while looking strict.

Now `maxDiffPixels: 60` — absolute, and a test asserts the ratio form is *absent* so it cannot come
back. Absolute is the right shape for the underlying reason too: anti-aliasing noise does not scale
with the viewport, so a ratio quietly buys more tolerance for bigger screenshots, which is backwards.

With the fix, the probe fails and produces all three images — which is AC9, evidenced rather than
configured:

```
  Error: expect(locator).toHaveScreenshot(expected) failed
  1 failed

$ ls visual-results/*/
patterns-card--default-actual.png
patterns-card--default-diff.png
patterns-card--default-expected.png
```

Probe reverted; `git diff packages/ui/src/` is empty.

**The lesson is not "pick a smaller number".** It is that a threshold expressed as a ratio of a
thing whose size you did not think about is a number nobody has actually chosen. This gate spent
most of its first afternoon in a state where it could not fail.

## Finding 2 — a passing axe run and a broken axe run look identical

All seven routes pass. That is good news and it is also exactly what an `AxeBuilder` that failed to
inject would report. `results.violations` is `[]` either way.

So the suite now asserts `results.passes.length > 0` — the rules that ran and were satisfied —
which is evidence the page was examined at all. Same failure class as `MEM-2026-09-11-29` and as
`W12-T04`, which proved its own axe gate with a deliberate violation before anyone believed it.

## Finding 3 — ESLint was walking the built workbench

`pnpm turbo run lint` reported **21,128 problems**, essentially all of them from bundled vendor code
in `packages/ui/storybook-static/`. The directory is gitignored; ESLint does not read `.gitignore`.

It has been latent since `W12-T03`: nobody had run `build:storybook` before `lint` in the same
working tree. `packages/ui/eslint.config.js` now ignores the build output, and gives the `visual/`
runner Node globals — the package is configured `browser` because everything else in it renders.

## Finding 4 — `import.meta.glob` is a Vite feature, and Playwright is not Vite

The spec's §4.1 wanted one enumeration source so the shooter and the coverage gate could not
disagree. The first implementation had the Playwright spec deriving subjects from the story modules;
Playwright does not run through Vite, so `import.meta.glob` is not a function there.

The fix keeps the guarantee and splits the comparison in two, each where it is cheap:

- per PR, in Vitest: **pinned list == derived from the story modules**
- nightly, in Playwright: **pinned list == `storybook-static/index.json`**

Transitively, derivation == index, which is what §4.1 actually wanted. Neither half needs the other
to be running.

## Deviations from the spec

- **§4.1 / AC1 — enumeration.** The spec names `storybook-static/index.json` as the single source.
  The coverage gate derives from the story modules instead, using Storybook's own `toId` and
  `storyNameFromExport` rather than a local copy of its naming rules. Reason: AC2 must fail on the
  pull request that adds an unpinned story, and requiring a 30-second Storybook build inside the
  `unit` project would put that cost on every PR in the repo forever. The "cannot disagree" property
  is preserved by Finding 4's two-sided comparison.
- **AC10 / §10 Q4 — the tolerance is a count, not a ratio.** See Finding 1. The spec said "a small
  non-zero pixel tolerance"; it did not say which units, and the units were the bug.
- **§10 Q5 — the matrix.** No entry carries a `matrix` override. `Foundations/Themes → Matrix`
  builds its four panels from its own `COMBINATIONS` array rather than from the toolbar globals, so
  one screenshot of it already covers all four theme × scheme combinations — which is what §10 Q5
  said it wanted ("covered in one image rather than 74"). The override mechanism exists and is
  tested for the first subject that genuinely needs it.
- **`EXCLUSIONS` is empty.** The spec anticipated excluding the animated stories. They do not need
  it: the package's only `@keyframes` is `Button.module.css`'s spinner and it is already
  `animation: none` under `prefers-reduced-motion`, which the runner forces. A spinner that is not
  spinning is a deterministic subject. The overlay stories are portalled to `document.body`, which a
  full-page screenshot captures, and they are the states most worth watching.
- **§4.6 said no source file changes.** `apps/web/src/shared/fault.ts` (new),
  `apps/web/src/routes/root.tsx` (one call), `apps/web/vite.config.ts` (the stripping plugin) —
  all of it §10 Q1 option A, which §4.6 already flagged as the anticipated exception.
  `packages/ui/eslint.config.js` changed for Finding 3.

## The escalations, as resolved

### Q1 — the 500 page had no URL. **Option A.**

`shared/fault.ts` throws a 500 `Response` on `?__boom=1`, and `vite.config.ts` replaces the module
with a no-op at *resolve* time unless `VITE_ENABLE_FAULT_ROUTES=true`. Not an `import.meta.env`
guard: `MEM-2026-09-11-14` records what that is worth — Rollup resolves the import while building
the module graph, before the dead branch is minified away, which is how 511 KB of MSW reached a CDN
behind a guard that read as sufficient.

Asserted in both directions, and the absence assertion was probed red by leaking the flag into it:

```
$ VITE_ENABLE_FAULT_ROUTES=true pnpm exec vitest run -t "a normal build has no fault trigger"
AssertionError: a chunk carries the deliberate-fault trigger
  1 failed
```

A query parameter that 500s the storefront on demand is a denial-of-service primitive if it survives
into a real build, so the one-sided version of this test was never sufficient.

### Q2 — a missing baseline **fails**, and writes nothing.

Evidenced above. The consequence is accepted and is visible on day one: **the first nightly after
this merges will be red**, because no baselines are committed yet. They land through
`visual-baselines.yml` as this ticket's second pull request, which exercises the accept path once,
deliberately, rather than leaving it to be discovered at 2am.

Baselines were generated locally during the probes and **deleted rather than committed** — macOS
font rasterisation is not the reference environment, and committing them would poison the gate on
its first run. That is the fingerprint's whole purpose and it would have been an ironic way to break
it.

## Known gaps, carried deliberately

- **No baselines yet**, so the screenshot half is unproven against real content. It is proven
  against a probe, which is the strongest evidence available before the images exist.
- **The flake rate is unknown and will stay unknown for about a fortnight** (§10 Q4). If it is not
  near zero, the correct response is to shrink the pinned list, not to raise `maxDiffPixels` until
  it goes green. The ceiling assertion exists to make that harder to get wrong under deadline.
- **§10 Q3 — `agent-ui` has now touched `agent-devops`' files in four W12 tasks.** Declared in §5
  again, as `W12-T06` did, and `W12-T06`'s run record already asked for it to be settled once. Filed
  rather than fixed (L10).
- **`/es/search` and `/es/pro/:id` are not in the axe route list** (§4.4), and that is a stated
  omission rather than an oversight: both need query state or a fixture id to be worth visiting.
- **The nightly's reporting path is untested against a real GitHub API.** The *decision* is pure and
  covered in both directions; the `gh` calls around it are not, and will not be until the first red
  night.

## Self-assessment

The part worth reviewing hardest is **Finding 1**, and not only for the number. The gate was
configured to look careful — pinned container, disabled animations, zero retries, a ceiling asserted
in a test — and every one of those was real while the threshold made the whole thing incapable of
failing on a single-component change. Every assertion about the *configuration* passed throughout.
Only running the thing against a deliberate regression found it, which is the argument AC19 was
written to make and the reason it was written as a probe rather than an assertion.

Second: I nearly recorded probe one as evidence the gate worked in reverse — "the gate passes on an
unchanged tree" — and it was a no-op change. Verifying `getComputedStyle` in the browser before
trusting the next probe is what turned a wrong conclusion into Finding 1.

Third, a process note: the spec said "one enumeration source" and the implementation could not have
it. The honest fix was not to abandon the property but to work out which two cheap comparisons
compose into it. A spec that states a *property* rather than a mechanism survives that; §4.1 stated
the mechanism and had to be deviated from to keep the property.
