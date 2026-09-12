# W12-T15 — A performance gate that measures what a user feels, not what a bundler reports

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

### 1.3 What the gate is actually for

Not to make the site fast — on the target profile it is already at 100. To notice when it **stops**
being fast, on a profile that reflects the users it is for, before a reviewer has to guess from a
diffstat whether a change is expensive.

This is worth stating plainly because it sets the expected value low and honest: **the gate begins
its life with almost no sensitivity.** Every metric scores 99–100 today, so a floor at 85 fires only
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

### 3.3 Where it runs, and the URL it is given

On the **preview deployment**, per the AC (*"measured on the deployed preview, not on a developer
machine"*), reading the URL from `deploy-preview.yml`'s `pages` step output. Never constructing it:
that step's own comment records that a guessed `*.pages.dev` hostname gave every reviewer a dead
link for a while, and a perf gate pointed at a 404 measures a 404 very quickly and passes.

A **warm-up navigation is performed and discarded** before the measured runs. The first request to a
freshly deployed Pages project is a cold edge cache, and a cold first byte would be attributed to
the change under review.

**Three runs, median reported** (`numberOfRuns: 3`). One Lighthouse run on a GitHub-hosted runner is
not a measurement, it is a sample.

### 3.4 Which pages

Two, both named by the AC (*"the home or results page"*):

| route | why |
|---|---|
| `/es/` | the home page, the one that is mostly a search box (`W12-T10`) |
| `/es/search?q=fontanero&where=Madrid` | the results page, with query state, because an empty results page is not the page (`W12-T11`) |

Spanish only. Running both languages doubles the runtime to re-measure the same bundle with a
different locale chunk, and `/es/` is the primary market. Never a translated segment — `/es/search`,
per the standing rule.

### 3.5 What the preview URL actually serves, and the bias it introduces

`deploy-preview.yml` builds the web app with `VITE_ENABLE_MOCKS: 'true'`, and `main.tsx` does
`await startMocks()` **before** `createRoot().render()`. So the measured page blocks its first paint
on a 160.7 kB gzip MSW chunk and a service-worker registration that production never executes.

This was measured rather than reasoned about, because the code shape suggests a much bigger number
than it produces:

| build | FCP | LCP | perf |
|---|---|---|---|
| production shape (`stripMocks` active) | 0.9 s *(100)* | 1.0 s *(100)* | 100 |
| preview shape (`VITE_ENABLE_MOCKS=true`) | 1.1 s *(99)* | 1.3 s *(100)* | 100 |

**0.2 s and one point.** Recorded as a known, accepted bias rather than fixed: the gate measures a
build ~1 point slower than the one users get, which is conservative in the safe direction, and the
alternative — a second preview build without mocks, purely to measure — costs a deploy to remove a
one-point bias. Revisit when the mock handlers are deleted as `W3` lands, which the deploy
workflow's own comment already anticipates.

### 3.6 What this ticket does not touch

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
| `.github/workflows/deploy-preview.yml` | `agent-devops` | **edits** — adds job outputs and a gate job |
| `apps/web/vite.config.ts` | `agent-ui` | untouched |
| `TODO.md` §6 | shared | edits the `W12-T15` line to remove the byte budget |

The `deploy-preview.yml` edit is `agent-ui` touching `agent-devops`' file for the **fifth** W12
ticket in a row. `W12-T16` §10 Q3 filed this, `W12-T06`'s run record asked for it to be settled, and
it is still not settled. Declared here again rather than quietly done; see §10 Q3.

## 5. Error cases

| Case | Behaviour | Why |
|---|---|---|
| preview not configured (`preflight.outputs.configured != 'true'`) | gate job skipped | forks and unconfigured secrets must not fail a PR on a deploy that never happened |
| `pages` step produced no URL | job fails | already `exit 1` upstream; a perf gate must not silently measure nothing |
| preview URL returns non-200 | job fails, prints the status | a fast 404 is a perfect score |
| a single Lighthouse run crashes | retry once, then fail | a crashed run is not a zero score |
| median run below a floor | **job fails**, naming the audit, its score and the floor | the whole point |
| a floor is missing from the config for a gated audit | test fails | a gate cannot silently stop covering a metric — `marketplace-ci-gates-fail-open` |

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
- **AC8** The gate reads the preview URL from the `pages` step output; the string `pages.dev` appears in no URL the gate constructs.
- **AC9** A warm-up navigation runs and is discarded before the measured runs.
- **AC10** Three runs; the median is what is asserted.
- **AC11** Both routes in §3.4 are measured; `/es/search` carries its query string.
- **AC12** The job is skipped, not failed, when the preview is not configured.

**Believing it**
- **AC13** A deliberate regression — a render-blocking `<script>` with an artificial delay in `index.html` — drives at least one gated audit below its floor and **fails the job**. Recorded in the run record with the real output, as `W12-T16` AC19 required.
- **AC14** With that regression reverted, the gate passes on the same commit.
- **AC15** The failure output names the audit, the measured score and the floor — not just a red X.

**Not smuggling anything back**
- **AC16** No assertion anywhere in this ticket is expressed in bytes.
- **AC17** No Lighthouse category other than `performance` is requested.

## 7. Out of scope

Each of these is real work with a real reason to exist; none is a gate, and bundling them here is
how a gate ticket becomes a quarter.

- **R2 image pipeline, `srcset`/AVIF.** Belongs with the ticket that introduces real images; there
  are no content images on the two measured routes today, which is also why CLS is 0.
- **Font loading strategy.** Blocked on `W12-T19` (`[B]`, operator). §3.6.
- **Bundle reduction.** `axios` is ~165 kB of source in the initial chunk doing what `fetch` does
  natively, and the React Aria surface is larger than what the storefront renders. Both are now
  optimisations rather than requirements, and neither has a measured user-visible cost on the target
  profile. A ticket for them needs its own justification.
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

### Q3 — `agent-ui` has now edited `agent-devops`' workflows in five consecutive W12 tickets

`W12-T06`, `W12-T11`, `W12-T12`, `W12-T16`, and now this one. Each declared it; none resolved it.
Either the ownership boundary in `agents/AGENTS.md` is wrong, or five tickets have quietly breached
it. Filed, not fixed (L10) — but it is the third spec to say so, and a constraint that is declared
and breached every time is not a constraint.

### Q4 — does a perf gate on every PR pay for its runtime?

Three runs × two routes × one Lighthouse startup each, plus the warm-up, on every pull request that
deploys a preview. Call it three to five minutes. The alternative shape is nightly, like
`W12-T16` — cheaper, but it reports after the merge, and the AC explicitly asks for *"a pull request
that makes the home or results page meaningfully slower fails"*. Built as a PR gate per the AC;
recorded here because if it proves slow or flaky, moving it to the nightly is the first thing to
try, ahead of loosening the floors.
