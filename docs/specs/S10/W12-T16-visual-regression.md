# W12-T16 — Nightly visual regression, and the axe pass the story gate cannot reach

Task: `W12-T16` · Slice: S10 · Owner: `agent-ui` · Issue: #216
Branch: `W12-T16-visual-regression` · Run record: `W12-T16-visual-regression.run.md`
Design: [ADR-012](../../adr/ADR-012-design-system-and-component-workbench.md) §5, §6 ·
[ADR-011](../../adr/ADR-011-web-application-architecture.md) §1
Builds on [`W12-T03`](W12-T03-storybook-workbench.md), [`W12-T04`](W12-T04-story-a11y-gate.md),
[`W12-T06`](W12-T06-workbench-preview-deploy.md), [`W12-T18`](W12-T18-visual-foundations.md)

---

## 1. Purpose

Two gaps, both named by earlier tickets, both waiting on the same machinery.

**The first is visual.** `W12-T18` has just rewritten every colour, every type size and every shadow
in the system. Every gate in `packages/ui` stayed green while it did so, because every gate in
`packages/ui` measures *constraints* — contrast holds, tokens resolve, nothing hardcodes a literal.
None of them can see that a card's padding collapsed or that a button lost its border. `W12-T18` §10
Q4 says so in its own words: *"whether it is good is a human looking at the preview URL"*. That is
fine for the change that intends to alter the appearance. It is not fine for the next change that
does not — a refactor in `Card.module.css`, a React Aria minor bump, a token renamed in a sweep.
Nothing in this repo would report it.

**The second is accessibility, and it is the older debt.** `W12-T04` runs axe against every story
and fails the build on a violation — 74 assertions today, and it is the strongest gate the package
has. It covers *components*. The shell `W12-T09` built is not a component and will not become one:

| Surface | Covered by | Actually asserted |
|---|---|---|
| 14 components, 74 stories | `W12-T04` axe gate | the full ruleset, per story |
| skip link, landmark set, header search, language switcher | `shell.test.tsx` AC11 | landmark *presence* and name-uniqueness, by hand |
| home page, `become-a-pro`, legal slot | `home.test.tsx` AC10 | three landmark roles, by hand |
| the 404 page, the 500 page | — | **nothing** |

Hand-written landmark checks catch two failure classes out of the several dozen axe knows about, and
`MEM-2026-09-11-35` is what the gap costs: three `<section>` elements were invisible to the
accessibility tree for a whole ticket — pixel-identical to correct markup, passing every test — 
because an `aria-labelledby` id had been built from a translated string. A role query found it. No
gate would have.

Agreed with the operator on 2026-09-11 while reviewing `W12-T09`, and recorded as
`MEM-2026-09-11-20`: the axe pass over real routes lands **here**, because this is the ticket that
stands up Playwright, and standing Playwright up twice is the actual waste.

Both halves share one engine: a browser, a served build, and a list of things to visit. That is why
they are one ticket and not two.

**Sequencing.** The backlog says *"runs after `W12-T18`— there is no point baselining a look that is
about to be replaced."* `W12-T18` merged as #240. The precondition is met. `W12-T19` (the typeface)
will invalidate every baseline again, which §10 Q4 treats as a feature rather than a problem.

## 2. User stories

- **As a reviewer**, I want to be told when a change alters how a component looks, so that a styling
  change cannot quietly break an unrelated screen.
- **As a reviewer**, I want the two images side by side when that happens, so that I can decide in
  seconds whether it was intended.
- **As `agent-ui`**, I want a deliberate appearance change to be *cheap to accept* — one reviewed
  commit of new baselines — so that the gate does not become the thing everyone routes around.
- **As a visitor using a screen reader**, I want the skip link, the landmarks and both error pages to
  be checked by the same tool that checks the components, so that the parts every page inherits are
  not the only parts nobody tests.
- **As the repo owner**, I want a nightly failure to reach me, so that the run is a gate rather than
  a log nobody opens.
- **As anyone running this locally**, I want a local run to tell me plainly that my machine is not
  the reference environment, rather than showing me 74 differences that are all font smoothing.

## 3. State machine

A baseline has a lifecycle, and it is the part of this task most likely to be got wrong. Recorded
as a table because "just commit the PNGs" hides four distinct states:

| From | Event | To | Guard |
|---|---|---|---|
| no baseline for a pinned entry | nightly runs | **fail**, diff artefact is the actual render | never auto-create; see §10 Q2 |
| baseline exists | render matches within tolerance | **pass** | fingerprint matches (§4.3) |
| baseline exists | render differs | **fail** + `expected`/`actual`/`diff` artefacts | issue opened or updated (§4.5) |
| baseline exists | render differs **and the change was intended** | new baseline via `workflow_dispatch` → PR | regenerated in the CI image only |
| any | run is not in the reference environment | **fail in CI, skip loudly locally** | §4.3, and see §6 |

The fourth row is the one that makes this survivable. A visual gate with no accept path is a gate
that gets deleted the first time someone ships a deliberate redesign under time pressure.

## 4. API surface

No HTTP endpoint, no contract, no route, no component. The surface is a workflow, a config, a list,
and a directory of PNGs.

### 4.1 Enumeration comes from Storybook's own index, not from a glob

`storybook build` writes `storybook-static/index.json`: every story Storybook knows about, with its
`id`, `title` and `name`. That file is the enumeration source for both the shooting list and the
completeness gate in §4.2 — one artefact, so the two can never disagree about what a story is.

A story is shot at `iframe.html?id=<id>&viewMode=story`, with the `W12-T03` toolbars driven through
the URL: `&globals=theme:contrast;scheme:dark;locale:en-GB`. The globals are `theme`
(`default|contrast`), `scheme` (`light|dark`) and `locale` (`es-ES|en-GB`), declared in
`.storybook/preview.tsx`.

**Amended on implementation.** The coverage gate in §4.2 has to fail on the pull request that adds
an unpinned story, and reading `index.json` would put a 30-second Storybook build inside the `unit`
project on every PR in the repo. So the gate derives its subjects from the story *modules*, using
Storybook's own `toId` and `storyNameFromExport` rather than a local copy of its naming rules, and
the property this section actually wanted is kept by comparing both against the pinned list: per PR
*pinned == derived*, nightly *pinned == index*, therefore *derived == index*. Playwright forced the
issue anyway — `import.meta.glob` is a Vite feature and Playwright does not run through Vite. Run
record, Finding 4.

**Not the deployed workbench.** `W12-T06` puts a Storybook on `marketplace-ui.pages.dev`, and
shooting that URL would be less code. It is the wrong source twice over: the nightly would fail
whenever the *deploy* failed, and it would screenshot whatever is deployed rather than the tree the
run checked out. The build happens inside the run.

### 4.2 The pinned list is a file — and a hand-written list is the failure this repo keeps having

ADR-012 §6 and the backlog both say *pinned story list*, and pinning is right: a story with a
loading spinner or an open overlay is not a stable subject, and the gate must be allowed to say so.

But a hand-written list of subjects is the exact failure class this repo has now hit three times,
recorded in `memory/repo/gotchas.md` as *"CI gates fail open"*:

| Gate | Named its subjects by hand | Consequence |
|---|---|---|
| CI `database` job | suite filenames | a new suite is silently never run |
| `tokens.test.ts` AC6 (before `W12-T18`) | six colour pairs | the pair every `Card` renders in was not one of them |
| `tokens.test.ts` AC4 (before `W12-T18`) | `.css` files only | a `.tsx` inline style read a token that no longer existed |

So the list is a file, and **its completeness is a test**. `visual-coverage.test.ts` reads
`index.json` and the pinned list and fails when a story is in neither the list nor an exclusion
table. An exclusion carries a `reason` string; an exclusion with no reason fails the same test.
Adding a component therefore cannot quietly add an unwatched story — the choice is forced at the
moment it is cheap, which is `W12-T18`'s AC6 lesson applied one layer up: *a walker that skips a
consumer is a hand-written list wearing a loop's clothes.*

This test runs in the existing `unit` project on every PR, not nightly. A story added today should
fail *your* pull request, not tomorrow's cron.

### 4.3 The reference environment is a fingerprint, not a convention

ADR-012 §6 accepts the cost plainly: *"screenshot baselines are renderer- and OS-dependent, so they
are generated **only** inside the CI container image, and a local run does not update them."*

"Only in the CI image" implemented as a comment is a convention. Implemented as a check it is a
gate. `visual/fingerprint.json` sits beside the baselines and records what produced them — container
image reference and digest, Playwright version (`1.63.0` today), Chromium revision, viewport and
device scale factor. The runner compares before it compares pixels:

- **In CI, a mismatch fails.** Not skips. `ci.yml` already carries the reason in a comment of its
  own: *"GitHub counts a skipped required check as satisfied — a gate that can vanish is not a
  gate."*
- **Locally, a mismatch skips loudly** and prints what the reference environment is, so a developer
  gets one honest line instead of 74 diffs that are all font smoothing.

The two directions are different behaviours from one comparison, so both are asserted — 
`MEM-2026-09-11-22`: *a one-sided assertion about a flag only tests one of its two states, and the
untested state is the one that ships broken.*

The image is the official `mcr.microsoft.com/playwright:v1.63.0-noble`, pinned by digest. It is not a
fifth service (ADR-012 §6) and not a new vendor — it is a GitHub Actions `container:`, which is why
`ci.yml`'s existing jobs are untouched.

### 4.4 The axe pass runs over the real routes, against a real build

`@axe-core/playwright` (a `devDependency`; nothing reaches the bundle `W12-T15` is already over
budget on) drives the same ruleset `W12-T04` runs, against `apps/web` built and served by
`vite preview` inside the same container.

`VITE_ENABLE_MOCKS=true`, for the reason `MEM-2026-09-11-21` records: `GET /categories` is `W3-T01`
and does not exist, so without mocks every page renders its degraded shape and the pass would cover
the empty variant of each one. The populated page is the surface with the landmarks in it.

| Route | Why it is on the list |
|---|---|
| `/es` | the home page, ES — the primary locale |
| `/en` | the home page, EN — different text lengths, same landmarks |
| `/es/become-a-pro` | `AuthWall`, composed into a page rather than a story |
| `/es/legal/terms` | the pending-content slot, and a route with its own boundary |
| `/es/legal/nonsense` | the route-level 404 — the header must survive it (`MEM-2026-09-11-16`) |
| `/nope` | the shell-level 404 — an unknown `:lang` (`MEM-2026-09-11-17`) |
| the 500 page | the only error surface with no coverage at all — **see §10 Q1** |

`/es/search` and `/es/pro/:id` are deliberately absent from this list and from §7: both need query
state and a fixture provider id to be worth visiting, and both are covered as components by their
patterns' stories. Adding them is a follow-up, not a silent omission.

### 4.5 Two workflows, because one of them needs to write

`.github/workflows/nightly-visual.yml`

- `schedule:` nightly, plus `workflow_dispatch` so it can be run on demand without waiting a day.
- Runs in the pinned container; builds `storybook-static` and `apps/web`; shoots the pinned list;
  runs the axe pass; uploads `expected`/`actual`/`diff` on failure via `actions/upload-artifact`.
- `permissions: contents: read`, plus `issues: write` for the reporting below.
- **Reporting**: a failure opens an issue, and a *subsequent* failure updates the existing open one
  rather than opening a second. A nightly that files a fresh issue every night is a nightly whose
  notifications get muted in a week, at which point the gate is decorative. Closed automatically on
  the first green run.

`.github/workflows/visual-baselines.yml`

- `workflow_dispatch` only. Regenerates baselines in the same pinned container and **opens a pull
  request** with the new PNGs.
- Never a direct push: `main` is protected (`OPS-03`), and a baseline change is precisely the change
  a human should look at — two images, one decision. That is the accept path in §3 row 4.
- This is why it is a second file. `ci.yml` is `permissions: contents: read` by deliberate design
  and must stay that way; a job that opens a PR needs `contents: write` and `pull-requests: write`,
  and widening the pull-request workflow's token to get it would be a security regression traded for
  a file.

### 4.6 What this does not touch

No component, no pattern, no page, no token. If a file under `packages/ui/src/` or
`apps/web/src/` changes, it needs a reason in the run record — with one anticipated exception, the
500-page reachability question in §10 Q1, which is a change to `apps/web/src/routes/root.tsx` if the
operator picks option A.

## 5. Permissions matrix

A workflow has no roles, so the honest version of this section is the boundary declaration.

**`.github/**` and `scripts/**` are `agent-devops`'** (`agents/roles/agent-devops.md`), and this task
adds two workflows and a runner script. Declared rather than done quietly, exactly as `W12-T06` §5
declared the same thing:

- ADR-012 §6 assigns nightly visual regression to `W12` by name, as it assigned the workbench deploy.
- The changes are **additive** — two new files. `ci.yml` is not edited, and its read-only token is
  deliberately left alone (§4.5).
- Flagged for `agent-devops` review rather than assumed.

This is the **fourth** `W12` task to touch `agent-devops`' files — `T03` a CI step, `T06` three
workflows, and now `T16`. `W12-T06`'s run record already asked for this to be settled once instead
of re-declared per ticket, and nobody has settled it. Raised as §10 Q3.

## 6. Error cases

A screenshot comparison does not throw. These are the ways this task fails, each of which must be a
red test before it is a fixed bug:

| Case | Behaviour |
|---|---|
| A story exists with no pinned entry and no exclusion | `visual-coverage.test.ts` fails **on the PR that added it** |
| An exclusion carries no reason | the same test fails |
| A pinned entry names a story id that no longer exists | the same test fails — a renamed story silently stops being watched otherwise |
| A baseline is missing for a pinned entry | the nightly fails; the render is uploaded but **not** written as a baseline (§10 Q2) |
| The run is not in the reference environment, in CI | **fails**, never skips |
| The run is not in the reference environment, locally | skips, printing what the reference is |
| A render differs | fails, three artefacts uploaded, issue opened or updated |
| An axe violation on a real route | fails, with the rule id, the selector and the route |
| The nightly fails every night for a week | one issue, updated — not seven issues |
| Anti-aliasing noise on an unchanged component | **the risk this task carries** — see §10 Q4 |

## 7. Acceptance criteria

| # | Given / When / Then | Test |
|---|---|---|
| AC1 | Given the built workbench, when the runner enumerates subjects, then they come from `storybook-static/index.json` and not from a source glob | `visual-coverage.test.ts` |
| AC2 | Given a story present in `index.json`, when it is in neither the pinned list nor the exclusions, then the suite fails naming that story id | `visual-coverage.test.ts` |
| AC3 | Given an exclusion entry, when it carries no non-empty `reason`, then the suite fails | `visual-coverage.test.ts` |
| AC4 | Given a pinned entry whose story id is absent from `index.json`, when the suite runs, then it fails — a renamed story is an uncovered story | `visual-coverage.test.ts` |
| AC5 | Given the reference environment, when the fingerprint matches, then the comparison runs | `visual-runner.test.ts` |
| AC6 | Given a fingerprint mismatch **in CI**, when the runner starts, then it exits non-zero and does not skip | `visual-runner.test.ts` |
| AC7 | Given a fingerprint mismatch **locally**, when the runner starts, then it skips and prints the reference environment | `visual-runner.test.ts` |
| AC8 | Given a pinned entry with no committed baseline, when the nightly runs, then it fails and writes no baseline | `visual-runner.test.ts` |
| AC9 | Given a render that differs beyond tolerance, when the nightly runs, then `expected`, `actual` and `diff` are all produced | `visual-runner.test.ts` + a deliberate red probe in the run record |
| AC10 | Given a render identical to its baseline, when the nightly runs, then it passes and no artefact is uploaded | `visual-runner.test.ts` |
| AC11 | Given each route in §4.4, when axe runs against it, then there are no violations | the nightly's axe pass |
| AC12 | Given the 404 routes, when axe runs, then both the route-level and shell-level 404 are visited and pass | the nightly's axe pass |
| AC13 | Given the served app, when the axe pass runs, then it is served from a real `vite preview` build with `VITE_ENABLE_MOCKS=true`, not a dev server | `cd-workflows.test.ts` |
| AC14 | Given `nightly-visual.yml`, when it is read, then it runs on a schedule, in the digest-pinned container, with `contents: read` | `cd-workflows.test.ts` |
| AC15 | Given `visual-baselines.yml`, when it is read, then it is `workflow_dispatch`-only and opens a pull request rather than pushing to `main` | `cd-workflows.test.ts` |
| AC16 | Given `ci.yml`, when this branch is diffed, then its `permissions:` block is unchanged | `cd-workflows.test.ts` |
| AC17 | Given a nightly failure with an open issue already filed by a previous run, when it fails again, then the existing issue is updated and no second issue is opened | `visual-report.test.ts` |
| AC18 | Given a green run after a failing one, when it completes, then the open issue is closed | `visual-report.test.ts` |
| AC19 | Given the whole suite, when a deliberate one-pixel change is introduced to a component stylesheet, then the nightly fails — proven red once, pasted into the run record | red probe (L1) |

AC19 is the one this task should be judged on. Every other criterion can pass on a runner that
screenshots a blank page. `MEM-2026-09-11-29` is the precedent and the warning: *a check that can
only pass is not a check* — the deferred-import assertion was believed only after the import was
deliberately flattened and the test watched to fail.

## 8. Data

No migration, no Prisma change, no contract change, no runtime dependency.

**Baselines are committed PNGs** — ADR-012 §6, and the reason Chromatic was rejected. Scale, at
today's 74 stories and a `default`/`light` default matrix (§10 Q5): ~74 files, order of 3–5 MB.

Two consequences, stated rather than discovered:

- **Every deliberate appearance change rewrites all of them.** `W12-T19` will. A palette tweak will.
  Git stores each revision whole, so the repository grows by the full set each time. Accepted: the
  alternative is the vendor this ADR declined.
- **Git LFS is rejected**, deliberately. It is another moving part, it breaks a plain `git clone` for
  anyone without the extension, and 5 MB does not need it. Revisit if the set passes ~50 MB.

New `devDependencies`: `@playwright/test`, `@axe-core/playwright`. Both dev-only; the `W12-T15`
budget is untouched.

## 9. Out of scope

- **A visual-testing service.** Chromatic, Percy, Argos. ADR-012 §6 settled this: a fifth vendor with
  a snapshot quota, on a stack deliberately kept to four services.
- **Per-PR visual checks.** This is nightly, by ADR. A per-PR screenshot job doubles CI minutes and
  turns every legitimate design change into a red required check. The per-PR gates stay the ones
  that measure constraints.
- **`/es/search` and `/es/pro/:id`** in the axe pass — §4.4 states why, and it is a follow-up.
- **Fixing anything the axe pass finds.** If a real route has a violation, this ticket reports it and
  files the fix as its own task. L10: implement the acceptance criteria; something else being broken
  is a task, not a fix in this PR. The exception is a violation that makes AC11 unpassable, which is
  an escalation, not a quiet widening of the exclusion list.
- **`W12-T19`'s typeface**, which will invalidate every baseline this ticket generates. That is the
  system working (§10 Q4).
- **Responsive breakpoint matrices.** One viewport, stated in the fingerprint. Mobile-first matters
  (`agent-ui` non-negotiable) and a second viewport doubles the baseline set for a second ticket to
  justify.

## 10. Open questions

### ESCALATION — Q1: the 500 page cannot currently be reached on purpose

```
ESCALATION
Task:      W12-T16
Question:  How should the nightly reach the 500 error page, given that W12-T09 deliberately made it
           unreachable?
Context:   The root ErrorBoundary renders when the shell loader throws. MEM-2026-09-11-21 removed
           the only way that happened in practice — the categories request now degrades to [] — 
           which was the correct fix and is why the storefront is deployable at all. So there is now
           no URL that produces the 500 page, and it is the one surface with no a11y coverage of any
           kind.
Options:   A) A build-time-stripped trigger: the root loader honours `?__boom=1` only when a flag is
              set at build time, stripped at resolve time exactly as W12-T08's stripMocks handles
              the MSW worker (MEM-2026-09-11-14 — a runtime `import.meta.env` guard is NOT enough;
              that shipped 511 KB of mocks to a CDN). The nightly builds with the flag on.
           B) Drop the 500 page from the route list and cover it as a story after all, mounting the
              boundary component directly. Cheaper, and it stops testing the thing we care about:
              whether the boundary renders correctly *when the shell has actually failed*.
           C) Leave it uncovered and say so.
Recommend: A. It is the only option that exercises the real failure path, and the stripping
           mechanism already exists and is already tested (mocks.test.ts AC17 + AC19, both
           directions). The cost is a file under apps/web/src/routes/ changing in a ticket whose §4.6
           says it touches no source — declared there rather than discovered in review.
Blocked:   AC11's 500 row, and nothing else.
Not blocked: The entire visual-regression half, and six of the seven routes.
```

**Answered by the operator, 2026-09-12: proceed on the recommendation — option A.** Implemented as
`apps/web/src/shared/fault.ts`, stripped at resolve time by `vite.config.ts` unless
`VITE_ENABLE_FAULT_ROUTES=true`, and asserted in both directions in `mocks.test.ts`. The absence
assertion was probed red by leaking the flag into it. All seven routes now pass axe, the 500 page
included.

### ESCALATION — Q2: a missing baseline should fail, but that makes the first run red by construction

```
ESCALATION
Task:      W12-T16
Question:  When a pinned story has no committed baseline, does the run fail or does it adopt the
           current render as the baseline?
Options:   A) Fail. A baseline is a reviewed artefact; adopting whatever rendered means the first
              run after a regression blesses the regression. The first nightly after this ticket
              merges is therefore red until a baselines PR lands — which is the accept path in §3
              working as designed, on day one.
           B) Adopt on first sight. Green immediately, and the gate silently certifies whatever
              state the tree was in.
Recommend: A, and land the initial baselines through visual-baselines.yml as the ticket's own second
           PR, so the mechanism is exercised once by the person who built it rather than first by
           someone else at 2am.
Blocked:   Nothing — this is a choice inside the implementation.
Not blocked: Everything.
```

**Resolved on implementation: A.** `updateSnapshots: 'none'`, evidenced in the run record — the
missing baseline fails and no file is written. The accepted consequence is that the **first nightly
after this merges is red** until the baselines land through `visual-baselines.yml`, which is the
accept path being exercised once by the person who built it.

### Q3 — `agent-ui` keeps touching `agent-devops`' files, and nobody has decided whether that is allowed

Four `W12` tasks now: `T03` a CI step, `T06` three workflows, `T16` two workflows and a script.
`W12-T06`'s run record asked for this to be settled — *"it is worth someone deciding whether
`agent-ui`'s charter should say so, rather than each ticket declaring it in §5 again"* — and it was
not. Each ticket has instead re-declared it in §5, which is the shape of a rule nobody owns.

Not blocking: the declaration in §5 is honest and reviewable. But the fix is one line in
`agents/roles/agent-ui.md` (`owns:` gains `.github/workflows/nightly-visual.yml` and its siblings, or
a stated shared-ownership rule), and it is `agent-devops`' call, not this ticket's. **Filed as its
own task rather than fixed here** (L10).

### Q4 — the honest risk is flake, and flake kills this gate faster than bugs do

Screenshot comparison has one characteristic failure: it is *almost* deterministic. Font hinting, GPU
vs software rasterisation, a one-frame animation, a focus ring that arrives a tick late. A nightly
that is red twice a week for reasons nobody can reproduce gets muted, and a muted gate is worse than
no gate — it reports coverage that does not exist.

Mitigations, all of which are implementation choices rather than open questions: the pinned container
(identical rasteriser every run), `prefers-reduced-motion` forced on, `animations: 'disabled'` in the
screenshot call, a small non-zero pixel tolerance, and exclusions for stories whose `play` function
opens an overlay — `MEM-2026-09-11-13` says those are already the awkward ones for the axe gate too.

**One of these turned out to be the ticket's main finding, in the opposite direction.** The
tolerance was `maxDiffPixelRatio: 0.001`, which is 1,024 pixels on a 1280×800 shot — twice what the
AC19 probe actually moves. The gate could not fail on a single-component regression while every
assertion about its configuration passed. It is an absolute `maxDiffPixels: 60` now, and a test
asserts the ratio form is absent. See the run record, Finding 1.

Stated here because it is the risk most likely to decide whether this ticket was worth doing, and it
will not be visible until the gate has run for a fortnight. **The run record should state the
observed flake rate after this has run a week**, and if it is not ~zero, the correct response is to
shrink the pinned list, not to raise the tolerance until it is green.

### Q5 — one theme × scheme combination, or four?

`W12-T18` shipped two themes across two schemes. Shooting all four quadruples the baseline set to
~296 PNGs and quadruples the rewrite cost of every future palette change.

**Decided, not escalated: the default matrix is `default`/`light`/`es-ES`, and the pinned list takes
a per-entry matrix override.** `Foundations/Themes` — the four-up grid `W12-T05` built — is pinned
with all four, so the combinations are covered in one image rather than 74. The reasoning: what a
dark-mode screenshot would catch is a component stylesheet holding a colour literal, and
`boundaries.test.ts` AC18 already fails that on the PR; `tokens.test.ts` AC3 and AC6 already resolve
and *measure* all four combinations. A screenshot would re-assert that more expensively and with more
flake.

Recorded as a decision rather than a silent default so that raising it later is one line in the
pinned list and a reviewed baselines PR.

### Q6 — this ticket's own value is invisible until something breaks

Every AC here proves the machine runs. None proves it will ever catch anything, and the honest
expectation is that its first real catch is months away. AC19's red probe is the only evidence
available at merge time that it *can* catch something, which is why it is the criterion this task
should be judged on and why it is written as a probe rather than an assertion.

Named for the same reason `W12-T18` §10 Q4 was: a ticket that cannot demonstrate its own value should
say so rather than let a green suite imply it.
