# W12-T15 — A performance harness that measures what a user feels, not what a bundler reports

Task: `W12-T15` · Slice: S10 · Owner: `agent-ui` · Issue: #215
Branch: `W12-T15-performance-budget` · Run record: `W12-T15-performance-budget.run.md`
Design: [ADR-011](../../adr/ADR-011-web-application-architecture.md) §1, §4
Builds on [`W12-T06`](W12-T06-workbench-preview-deploy.md) (reading a deploy URL back rather than
guessing it), [`W12-T16`](W12-T16-visual-regression.md) (a gate is not believed until it has been
probed red)

---

## 1. Purpose

The backlog asks for four numbers: `LCP ≤2.5s`, `INP ≤200ms`, `CLS ≤0.1`, and `≤170 KB initial JS`.
**The fourth one is deleted by operator decision**, and the first three need a qualifier the backlog
never supplied. Both changes come from the same measurement, so it goes first.

### 1.1 The measurement

`main` @ `7cf335d`, production build of `apps/web`, served from localhost, Lighthouse 12 with its
default *simulated* throttling. Initial JS is **751 KiB raw / 228.7 KiB gzip** — `index` 202.2 kB
gzip, `packages/ui` 31.5 kB, the Rolldown runtime 0.5 kB. The lazy `ResultsMap` chunk is 0.38 kB, so
R9's map-is-a-separate-chunk rule is holding, and `stripMocks` is working: no MSW in the graph.

The same bytes, measured twice, differing only in the throttling profile:

| profile | perf | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|
| Lighthouse default mobile — 1.6 Mbps, 150 ms RTT, 4× CPU | **68** | 5.0 s *(score 10)* | 5.3 s *(22)* | 10 ms | 0 |
| realistic 4G — 10 Mbps, 40 ms RTT, 4× CPU | **100** | 0.9 s *(100)* | 1.0 s *(100)* | 0 ms | 0 |

A 32-point swing, and not one byte changed. `TBT ≈ 0` on both rows is the load-bearing part: 228 KiB
of gzipped JavaScript parses and executes in under 10 ms of blocking time *on a 4× slowed CPU*. The
bundle is not a CPU problem. It is a transfer-time problem, and only on a link far slower than the
one this product is for.

### 1.2 What that means for the byte budget

`≤170 KB initial JS` is a gate on a proxy. The measurement above says the proxy and the outcome come
apart completely depending on one config line, which makes the proxy worth less than the outcome it
was standing in for. The operator's decision, 2026-09-12, is to drop it:

> *"Don't really care about size of the initial bundle. 230 or 300Kb is more or less the same
> nowadays with a 4g or 5g connection. As long as the size is not lowering metrics too much (ie:
> under 85pt for first Paint, for example)."*

So this ticket ships **no byte budget of any kind** — not as a blocker, not as a warning. That is a
deliberate reversal of `TODO.md` §6 and of `W12-T18`'s aside that *"nothing new may reach the bundle
`W12-T15` is already over budget on"*. There is no budget to be over. A future ticket that wants one
must re-argue it from a measurement, not cite the backlog line this spec removed.

### 1.3 What the harness is actually for

Not to make the site fast — on the target profile it is already at 100. To notice when it **stops**
being fast, on a profile that reflects the users it is for, before a reviewer has to guess from a
diffstat whether a change is expensive.

This is worth stating plainly because it sets the expected value low and honest: **it begins its
life with almost no sensitivity.** Every metric scores 99–100 today, so a floor at 85 fires only
on something large — a render-blocking third party, an unsplit map library, a font that arrives
before first paint. It will not notice a 40 ms drift. It is a smoke alarm, not a thermostat, and
that is the operator's stated tolerance rather than an oversight. §10 Q1 asks whether it should be
tightened once real numbers from CI exist.

## 2. User stories

| As a | I want | So that |
|---|---|---|
| visitor | pages that appear quickly on a normal phone and a normal connection | I do not leave before the page appears |
| reviewer | to be told when my change makes a page meaningfully slower | I find out on the pull request, not from a user |
| repo owner | the threshold expressed in the units a user experiences | nobody re-derives what "170 KB" meant six months from now |

## 3. Design

### 3.1 The throttling profile *is* the decision

Everything else in this spec is plumbing. The profile is the ticket:

```
throughputKbps: 10000    # 10 Mbps down — a real 4G link, not a congested one
rttMs:            40     # 40 ms round trip
cpuSlowdownMultiplier: 4 # a mid-range phone, unchanged from Lighthouse's default
```

Network is relaxed to what the operator described; **CPU throttling is deliberately not relaxed**,
because the AC says *"a mid-range phone"* and a fast link does not make a slow phone fast. Keeping
4× is also what makes the gate able to catch the class of regression that bytes-thinking misses: a
change that adds little transfer but a lot of main-thread work scores badly here and would have
sailed through a byte budget.

Two rules around it, both structural:

1. **The profile lives in one committed file**, `apps/web/perf/profile.json`, read by both the
   workflow and the test that asserts it. Not duplicated into workflow YAML, where it would drift.
2. **A test asserts the profile's values, by number.** Reverting these three numbers to Lighthouse's
   defaults silently converts this gate back into a byte gate wearing a metric's name — the exact
   outcome §1.2 rejects — and it is a one-line change that looks like a cleanup. It fails the build
   instead. The reason is written beside the assertion, not only here.

### 3.2 Per-metric score floors, not the category score

The gate asserts **per-audit scores**, not `categories.performance.score`. The category score is a
weighted blend, so a serious LCP regression can be masked by TBT and CLS staying perfect — which,
given TBT is 0 ms and CLS is 0 today, is exactly the masking available here. Blending is the wrong
shape for a gate whose whole job is to name what regressed.

Floors, matching the operator's stated `85`:

| audit | floor | today (prod build, target profile) |
|---|---|---|
| `first-contentful-paint` | ≥ 85 | 100 |
| `largest-contentful-paint` | ≥ 85 | 100 |
| `total-blocking-time` | ≥ 85 | 100 |
| `cumulative-layout-shift` | ≥ 85 | 100 |

`INP` is **not** gated: it is a field metric that requires interaction, and Lighthouse's lab proxy
for it (`TBT`) is already in the table. Claiming to gate INP from a lab run would be claiming a
measurement nobody took. The backlog's `INP ≤200ms` is answered by TBT's floor and noted as such.

The floors are stored as scores rather than milliseconds on purpose. Milliseconds on a shared CI
runner are noisy; Lighthouse's score curves are log-normal and flatten hard near the top, so a score
floor absorbs runner variance that a millisecond ceiling would turn into flake. §10 Q1 revisits this
once there is CI data — `W12-T16`'s Finding 1 is the standing reminder that a tolerance chosen for
comfort can hide the regression it was bought to catch.

### 3.3 A harness now, a gate later

**This ticket ships a harness that reports. It does not block a merge, and it is not wired into CI.**

Operator decision, 2026-09-12, taken while this was being built:

> *"Don't worry too much about preview/release. If the harness is in place, we'll get to it later.
> Early optimisation is the root of all evils. While we keep performance in mind while developing,
> it should not be a blocker in this MVP phase."*

That reverses the AC's *"a pull request that makes the home or results page meaningfully slower
fails"* — but **not** the *"measured in CI"* half. A second operator decision, taken while this was
being built, put the harness on every pull request for its *visibility*:

> *"What about running the perf on GA and add the lighthouse scores to the run recap, as we do with
> test?"*

So it runs in CI and reports; it never fails. Those are separable, and keeping them separate is the
whole design: a reviewer sees the numbers on the pull request that moved them, and nobody is blocked
by drift on a product with no users.

So:

```
pnpm --filter @marketplace/web perf                        # serve ./dist, measure it
pnpm --filter @marketplace/web perf https://preview.url    # measure a deployment instead
pnpm --filter @marketplace/web perf -- --markdown FILE     # append the recap table to FILE
pnpm --filter @marketplace/web perf -- --screenshots DIR   # images, for routes below a floor
```

The runner takes an optional URL, so pointing it at a preview later is an argument, not a rewrite.
And the decision logic already knows what a shortfall is — `evaluate.mjs` returns `shortfalls`
rather than throwing — so **becoming a gate is an exit code and a workflow file**, which is exactly
the shape "we'll get to it later" needs. A test asserts the shortfall branch does *not* exit
non-zero today, so the reporting posture is a stated property rather than an accident of where the
code stopped.

Two things are kept from the gate design because they cost nothing and make the numbers worth
reading:

- **A warm-up navigation, discarded.** The first request to a cold server pays for something the
  change under review did not cause.
- **Three runs, median reported.** One Lighthouse run is a sample, not a measurement. The median is
  taken per audit, so one bad run cannot decide.

### 3.4 Which pages

Two, both named by the AC (*"the home or results page"*):

| route | why |
|---|---|
| `/es/` | the home page, the one that is mostly a search box (`W12-T10`) |
| `/es/search?q=fontanero&where=Madrid` | the results page, with query state, because an empty results page is not the page (`W12-T11`) |

Spanish only. Running both languages doubles the runtime to re-measure the same bundle with a
different locale chunk, and `/es/` is the primary market. Never a translated segment — `/es/search`,
per the standing rule.

### 3.5 What a preview URL would serve, and the bias it would introduce

`deploy-preview.yml` builds the web app with `VITE_ENABLE_MOCKS: 'true'`, and `main.tsx` does
`await startMocks()` **before** `createRoot().render()`. So the measured page blocks its first paint
on a 160.7 kB gzip MSW chunk and a service-worker registration that production never executes.

Nothing measures the preview today (§3.3), so this is recorded for whoever wires it up. It was
measured rather than reasoned about, because the code shape suggests a much bigger number than it
produces:

| build | FCP | LCP | perf |
|---|---|---|---|
| production shape (`stripMocks` active) | 0.9 s *(100)* | 1.0 s *(100)* | 100 |
| preview shape (`VITE_ENABLE_MOCKS=true`) | 1.1 s *(99)* | 1.3 s *(100)* | 100 |

**0.2 s and one point.** Recorded as a known, accepted bias rather than fixed: the gate measures a
build ~1 point slower than the one users get, which is conservative in the safe direction, and the
alternative — a second preview build without mocks, purely to measure — costs a deploy to remove a
one-point bias. Revisit when the mock handlers are deleted as `W3` lands, which the deploy
workflow's own comment already anticipates.

### 3.6 The run recap

A `perf` job in `.github/workflows/ci.yml` builds the storefront and appends a table to
`$GITHUB_STEP_SUMMARY`, which is what puts it in the run recap:

| route | CLS | FCP | LCP | TBT |
|---|---|---|---|---|
| home | 100 | 99 | 100 | 99 |
| results | 100 | 99 | 100 | 98 |

Four properties, each with a reason:

1. **Columns are derived from the audit ids** — `largest-contentful-paint` → `LCP`, computed, not
   looked up. A lookup table would be a second hand-written list keyed by audit, and a metric
   nobody had abbreviated would render a blank heading rather than fail.
2. **The browser version is printed.** A Chrome update that moves every number at once is otherwise
   indistinguishable from a regression. This is `W12-T16`'s `fingerprint.json` lesson, applied at a
   cost of one line.
3. **The browser is pinned** to the Playwright Chromium the story tests already install, via
   `CHROME_PATH` — not whatever Chrome the runner image ships this week.
4. **The job is not a gate**, and says so in a comment: *"Do not add this job to branch
   protection."* Every other job in that file is a gate and the names are a contract (`W0-T13`);
   making this one required in repository settings would reverse a product decision through a
   settings change rather than a reviewed one. A test asserts that warning is present.

### 3.7 A shortfall carries images, not just a number

> *"Failing tests should also carry a screenshot, not just the .md file with test run and what's
> going wrong."* — operator, 2026-09-12

A score that says a page got slower does not say what the user saw, and "open the log" is the
instruction nobody follows. So a route below a floor writes:

- **the filmstrip** — Lighthouse's eight frames, each named by the millisecond it painted
  (`home-filmstrip-05-03090ms.jpg`), zero-padded so a directory listing sorts in load order. This is
  the diagnostic one: *blank until 3.6 s* is visible rather than inferred.
- **the final frame** — which answers the other question a red run raises: whether the page rendered
  at all, or whether the harness measured an error state very quickly.

They cost **no extra browser work**: Lighthouse captures both during the run being reported, so this
is decoding what is already in the result. They are uploaded as the `perf-screenshots` artifact, and
the recap names it — but only when images exist, because a pointer to an empty artifact on every
green run is a pointer nobody reads on the red one.

A green run writes nothing and does not create the directory.

### 3.8 What this ticket does not touch

- **No byte budget**, per §1.2.
- **No Lighthouse SEO, a11y or best-practices category.** SEO is deferred (ADR-011 Amendment 1) and
  gating it here would smuggle back the thing that was deferred. Accessibility already has two
  stronger gates — `W12-T04` over stories and `W12-T16` over routes — and Lighthouse's a11y category
  is a weaker subset of axe run twice.
- **No font strategy.** `W12-T19` has not chosen a typeface and `W12-T18` deliberately left
  `system-ui` alone, so there is no web font to preload, subset, or give a `font-display`. Writing
  that machinery now means writing it against a face that does not exist. Moved out; see §9.
- **No image pipeline.** See §9 — it is real work, it is not a gate, and it is separable.

## 4. Permissions matrix

| File | Owner | This ticket |
|---|---|---|
| `apps/web/perf/**` | `agent-ui` | creates |
| `apps/web/package.json` | `agent-ui` | adds the `perf` script and two devDependencies |
| `apps/web/eslint.config.js` | `agent-ui` | adds a node-globals override scoped to `perf/**` |
| `apps/web/tests/perf-budget.test.ts` | `agent-ui` | creates |
| `.github/workflows/ci.yml` | `agent-devops` | **edits** — adds the non-gating `perf` job |
| `.gitignore` | shared | ignores the screenshot output directory |
| `TODO.md` §6 | shared | edits the `W12-T15` line to remove the byte budget |

The `ci.yml` edit is `agent-ui` touching `agent-devops`' file for the **fifth** W12 ticket running.
`W12-T16` §10 Q3 filed it, `W12-T06`'s run record asked for it to be settled, and it is still not
settled. Declared here rather than quietly done — and this time it is deliberate rather than
avoided, which makes Q3 more pressing, not less.

**One thing this ticket cannot enforce from the repository.** The `perf` job must never be added to
branch protection. The workflow says so in a comment and a test asserts the comment is there, but
branch protection is a repository setting: nothing in the codebase can stop someone ticking the box,
and doing so would convert a reported number into a merge gate without a review.

## 5. Error cases

| Case | Behaviour | Why |
|---|---|---|
| `dist/` has not been built | the run fails, saying so | measuring a directory that is not there is measuring nothing |
| a client route has no file on disk | the server falls back to `index.html` | `/es/search` exists only as a client route; serving 404 would measure the 404, which is fast and would pass |
| a single Lighthouse run crashes | the process exits non-zero with the stack | a crashed run is not a zero score, and a broken harness must not read as a passing one |
| Lighthouse reports no such audit | throws, naming the audit | "did not report" must never read as "fine" — the shape of a gate that fails open |
| an audit has a non-numeric score | throws, naming it | same |
| median below a floor | **reported**, naming the audit, its score and the floor; exit code stays 0 | §3.3 — it reports, it does not block |
| a floor names an audit the harness does not gate, or vice versa | test fails | coverage is derived from the floors; there is no second list to drift |

## 6. Acceptance criteria

**The profile**
- **AC1** `apps/web/perf/profile.json` exists and is the only place the three throttling numbers appear.
- **AC2** A test asserts `throughputKbps === 10000`, `rttMs === 40`, `cpuSlowdownMultiplier === 4`, with the §3.1 reason beside it.
- **AC3** A test fails if the profile equals Lighthouse's default mobile profile.

**The floors**
- **AC4** Floors are declared per audit, as scores, in one committed file.
- **AC5** A test asserts every audit the workflow gates has a floor, and every floor names an audit the workflow gates — derived from one list, so the two cannot drift. Not a second hand-written list.
- **AC6** The category score is not asserted anywhere (§3.2).
- **AC7** `INP` is absent from the floors, and a comment says why.

**The run**
- **AC8** The runner takes an optional URL and measures `./dist` when given none; no URL is hard-coded.
- **AC9** A warm-up navigation runs and is discarded before the measured runs.
- **AC10** Three runs; the median is taken per audit, so one bad run cannot decide.
- **AC11** Both routes in §3.4 are measured; `/es/search` carries its query string, and no URL segment is translated.
- **AC12** A shortfall is **reported, not fatal** — the shortfall branch does not exit non-zero, and a test asserts it. A crash still exits non-zero.

**Believing it**
- **AC13** A deliberate regression — a render-blocking busy-wait injected into the built `index.html` — drives at least one gated audit below its floor and is reported. Recorded in the run record with the real output, as `W12-T16` AC19 required.
- **AC14** With that regression reverted, every audit is back at or above its floor on the same build.
- **AC15** The output names the audit, the measured score and the floor — not just a red X.
- **AC18** Reverting `profile.json` to Lighthouse's default mobile numbers **fails the test suite**, with the failure naming the expected value. Probed, not assumed.

**Not smuggling anything back**
- **AC16** No assertion anywhere in this ticket is expressed in bytes.
- **AC17** No Lighthouse category other than `performance` is requested.

**The recap** (§3.6)
- **AC19** A `perf` job in `ci.yml` appends the score table to `$GITHUB_STEP_SUMMARY`.
- **AC20** The table has a column for every gated audit, with headings derived from the audit ids rather than a lookup table.
- **AC21** The recap records the browser version and the three profile numbers.
- **AC22** The job carries no `continue-on-error` — it passes because the script exits 0, not because failure is masked — and carries the "do not add to branch protection" warning. A test asserts both.
- **AC23** The browser is pinned via `CHROME_PATH` to the Playwright Chromium the lockfile fixes, not the runner's own Chrome.

**The images** (§3.7)
- **AC24** A route below a floor writes its filmstrip and final frame; a green run writes nothing and creates no directory.
- **AC25** Filmstrip frames are named by the millisecond they painted, zero-padded so a listing sorts in load order.
- **AC26** Images are uploaded as the `perf-screenshots` artifact, and the recap names that artifact only when images were written.
- **AC27** A Lighthouse result with no screenshots, or a non-base64 `data` field, yields no images rather than throwing.

## 7. Out of scope

Each of these is real work with a real reason to exist; none is needed to have the harness, and
bundling them here is how a harness ticket becomes a quarter.

- **CI wiring, and blocking a merge.** §3.3 — the operator's call, and the runner already takes a
  URL and already computes shortfalls, so this is an argument and an exit code when it is wanted.
- **R2 image pipeline, `srcset`/AVIF.** Belongs with the ticket that introduces real images; there
  are no content images on the two measured routes today, which is also why CLS is 0.
- **Font loading strategy.** Blocked on `W12-T19` (`[B]`, operator) choosing a face. §3.8.
- **Bundle reduction.** `axios` is ~165 kB of source in the initial chunk doing what `fetch` does
  natively, and the React Aria surface is larger than what the storefront renders. Both are now
  optimisations rather than requirements, and neither has a measured user-visible cost on the
  target profile. A ticket for them needs its own justification — not this line.
- **Field data / RUM.** Lab numbers only. INP in particular is honestly measurable only in the field.
- **A production-shaped preview build.** §3.5.

## 8. Open questions

### Q1 — the floors have no headroom to detect anything short of a catastrophe

Every gated audit scores 99–100 on the target profile. A floor at 85 leaves a gap that a real,
noticeable regression could sit inside without ever tripping it. The operator set 85 knowingly and
§1.3 says so, so this is not an escalation — but it should be revisited after roughly a fortnight of
CI runs, when the runner's actual variance is known. If the observed spread is ±2 points, a floor at
95 is both safe and far more useful than 85. **The failure mode to avoid is the opposite one**, and
`W12-T16` Finding 1 is the precedent: a tolerance loose enough to never fire, with every assertion
about the configuration passing while the gate was incapable of failing.

### Q2 — the profile is a judgement about users nobody has yet

10 Mbps / 40 ms is a reasonable Spanish 4G link. It is not measured, because there is no traffic to
measure. If real users arrive on worse connections than assumed, this gate will have been green
throughout while they had a bad time — and the default profile, the one this spec argues against,
would have been right after all. Not resolvable before production; flagged so the assumption is
visible rather than buried in a JSON file.

### Q3 — the ownership boundary was avoided here, not settled

`W12-T16` §10 Q3 recorded `agent-ui` editing `agent-devops`' workflows in four consecutive W12
tickets, each declaring it, none resolving it. This ticket's first draft would have been the fifth.
§3.3 removed the need before it was written, so the boundary holds here by luck rather than by
decision — and whoever wires this harness into CI inherits the same question with nothing new to
answer it. Still open; `W12-T06`'s run record asked for it first.

### Q4 — ~~does a perf gate on every PR pay for its runtime?~~ *(resolved before it was built)*

Asked because three runs × two routes × a Lighthouse startup each is three to five minutes on every
pull request. Resolved by §3.3: there is no PR gate in the MVP phase, so nothing is spent per pull
request. It returns as a real question for whoever wires this into CI, and the nightly — where
`W12-T16` already runs a browser — is the cheaper shape to try first.

### Q5 — TBT is blind to anything that blocks before first paint

Found while probing AC13. A three-second synchronous busy-wait in `<head>` drove FCP and LCP to
**0**, and `total-blocking-time` stayed at **100**: TBT only counts long tasks *after* FCP, so work
that delays first paint is invisible to it.

That matters because §3.2 gates TBT as the lab proxy for INP. It is a fine proxy for
post-paint responsiveness and no proxy at all for a blocking third-party script in the head — the
FCP and LCP floors are what actually caught that, and a harness gating TBT alone would have called
the regression clean. Recorded rather than acted on: the floors as specified do catch it, between
them. It is an argument against ever narrowing this to "just gate TBT".
