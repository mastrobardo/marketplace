# W12-T15 — run record

Spec: [`W12-T15-performance-budget.md`](W12-T15-performance-budget.md) · Issue: #215
Branch: `W12-T15-performance-budget`

---

## What this ticket turned out to be

It arrived as *"performance budget as a gate: … ≤170 KB initial JS"* and it ships as a harness that
reports and blocks nothing. Both changes came from the operator, and both are worth reading before
the diff, because the diff is small and the decisions are not.

## Finding 1 — the byte budget was gating a proxy that comes apart from the outcome

Measured before anything was written. `main` @ `7cf335d`, production build of `apps/web`:

```
dist/assets/index-*.js      659.6 kB │ gzip: 202.2 kB
dist/assets/dist-*.js       108.4 kB │ gzip:  31.5 kB   (packages/ui)
dist/assets/rolldown-*.js     0.7 kB │ gzip:   0.5 kB
                            ───────────────────────────
initial JS                  751 KiB  │ gzip: 228.7 KiB
```

Against `≤170 KB` that is 35% over on gzip and 4.4× over on raw — and the backlog never said which.
So the first question was the unit, which is the `marketplace-threshold-units` lesson exactly.

Then the same bytes, twice, changing only the throttling profile:

| profile | perf | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|
| Lighthouse default mobile — 1.6 Mbps, 150 ms | **68** | 5.0 s (10) | 5.3 s (22) | 10 ms | 0 |
| realistic 4G — 10 Mbps, 40 ms, 4× CPU | **100** | 0.9 s (100) | 1.0 s (100) | 0 ms | 0 |

**32 points, zero bytes.** And `TBT ≈ 0` on both rows, which is the part that decided the ticket:
228 KiB of gzipped JS parses and executes in under 10 ms of blocking time *on a 4× slowed CPU*. The
bundle was never a main-thread problem. It is transfer time, on a link this product is not for.

The operator's call on seeing that: drop the byte budget entirely rather than restate it in gzip.
`TODO.md` §6 is edited to say so, because a future agent reading the backlog line would otherwise
faithfully rebuild what was just rejected.

Attribution of the main chunk, kept because it will be wanted by whoever does bundle work later:

```
653.7 kB  react-aria   (+151.2 react-aria-components, +86.1 react-stately)
532.6 kB  react-dom
353.8 kB  react-router
164.9 kB  axios          ← does what fetch does natively
109.5 kB  app
 81.2 kB  i18next
 67.5 kB  @tanstack/query-core
```

None of it is a requirement now. It is an optimisation with no measured user-visible cost.

## Finding 2 — the probe worked, and TBT did not see it

AC13. A three-second synchronous busy-wait injected into the built `index.html`:

```
  ok   home     cumulative-layout-shift    100 (floor 85)
  LOW  home     first-contentful-paint       0 (floor 85)
  LOW  home     largest-contentful-paint     0 (floor 85)
  ok   home     total-blocking-time        100 (floor 85)
  ok   results  cumulative-layout-shift    100 (floor 85)
  LOW  results  first-contentful-paint       0 (floor 85)
  LOW  results  largest-contentful-paint     0 (floor 85)
  ok   results  total-blocking-time        100 (floor 85)

4 below floor:
  home: first-contentful-paint scored 0, floor is 85 (short by 85)
  ...
```

Reverted, the same build is back to 100 everywhere (AC14).

**`total-blocking-time` stayed at 100 through a three-second block.** TBT only counts long tasks
*after* FCP, so work that delays first paint is invisible to it. That matters because §3.2 gates TBT
as the lab stand-in for INP: it is a fine proxy for post-paint responsiveness and no proxy at all
for a blocking script in the head. FCP and LCP caught this; TBT alone would have called it clean.
Filed as §10 Q5 — it is a standing argument against ever narrowing the floors to "just TBT".

## Finding 3 — the profile guard, probed in both directions

The three numbers in `profile.json` *are* the ticket, and reverting them is a one-line change that
reads like a cleanup. So it was probed rather than assumed. Setting them back to Lighthouse's
defaults:

```
passed: 20 failed: 2
 FAIL: is the realistic 4G profile, by value
    AssertionError: expected 1638.4 to be 10000
 FAIL: is not Lighthouse's default mobile profile
    AssertionError: expected 1638.4 not to be 1638.4
```

Restored, 22 pass. Both directions, because a guard only ever seen passing is not a guard —
`W12-T16` Finding 1.

## Finding 4 — the preview URL would have measured a build we do not ship

`deploy-preview.yml` sets `VITE_ENABLE_MOCKS: 'true'`, and `main.tsx` does `await startMocks()`
**before** `createRoot().render()`. So a preview measurement blocks first paint on a 160.7 kB gzip
MSW chunk and a service-worker registration that production never executes.

The code shape suggests a large number. Measured, it is not:

| build | FCP | LCP | perf |
|---|---|---|---|
| production shape | 0.9 s (100) | 1.0 s (100) | 100 |
| preview shape | 1.1 s (99) | 1.3 s (100) | 100 |

0.2 s and one point, biased in the safe direction. Recorded in spec §3.5 for whoever wires CI up,
rather than fixed with a second build that costs a deploy to remove one point. Worth noting that
this finding is what a byte-based gate would have shouted about — 160.7 kB gzip, a 70% increase —
while the user-visible cost was one point. The same argument as Finding 1, arrived at from the
other end.

## Finding 5 — the filmstrip shows the regression; the score only reports it

Added after the operator asked that a shortfall carry a screenshot rather than only a table. The
images turn out to be free — Lighthouse captures them during the run already being measured — and
the filmstrip is the one that earns its place. Frame sizes from the AC13 regression, `home`:

```
home-filmstrip-00-00515ms.jpg   3698 bytes
home-filmstrip-01-01030ms.jpg   3698 bytes
...                             3698 bytes   (identical — nothing has painted)
home-filmstrip-06-03605ms.jpg   3698 bytes
home-filmstrip-07-04120ms.jpg  16377 bytes   ← first paint
```

Seven identical blank frames and then the page. The three-second block is visible in a directory
listing, without opening anything. That is the argument for the filmstrip over the final frame: the
final frame shows a correct-looking page and says nothing about when it arrived.

## The CI job, and the one thing the repo cannot enforce

Wired into `ci.yml` on the operator's second redirect — run it on every pull request and put the
scores in the run recap, *"as we do with test"*. Verified with `actionlint:1.7.7`, the same version
the `workflows` job runs.

`CHROME_PATH` was checked rather than assumed: without it the harness drove the system Chrome
(`152.0.0.0`); with it, Playwright's pinned Chromium (`153.0.0.0`). The recap prints whichever it
used, so a browser bump that moves every number at once is distinguishable from a regression.

**What the repository cannot enforce:** the `perf` job must never become a required check. The
workflow says so in a comment, a test asserts the comment is present, and neither of those stops
someone ticking a box in repository settings. That would turn a reported number into a merge gate
without a review — the decision reversed by configuration rather than by argument.

## Two corrections made during the work

**The scope changed mid-build.** The spec was committed describing a blocking PR gate wired into
`deploy-preview.yml`. The operator then said the harness is enough for the MVP phase. §3.3, §4, §5,
the ACs and Q4 were rewritten rather than left to drift, and `.github/` ends up untouched — which
also means `W12-T16` §10 Q3's ownership complaint is avoided here rather than resolved, and §10 Q3
now says so.

**A test assertion was too coarse and caught the wrong thing.** `does not fail the process on a
shortfall` sliced `run.mjs` from the shortfall branch to the end of the file, which swallowed
`main().catch(… process.exit(1))` — a crash handler that *should* exit non-zero. It failed,
correctly, and the fix was to narrow the slice and then assert the crash path separately. A test
that had been written to pass would have asserted "no `process.exit` anywhere" and quietly forbidden
the right behaviour.

**Two test assertions were wrong, and both failed usefully.** `points at the artifact only when
images were written` asserted the pointer appears whenever a screenshot count is passed — but images
only ever exist alongside a shortfall, so the pointer belongs inside that branch and the test was
describing behaviour nobody wanted. And `is not a gate` sliced `ci.yml` from the `perf:` key, which
starts *below* the comment block it was asserting on, so it could never have found the warning it
was looking for. Both were fixed as tests, not as code.

**`format:check` is part of the `lint` gate and I had not run it before the first commit.** Three
files needed Prettier. Caught locally rather than by CI, but only because it was run before pushing
the second time — the first commit would have gone red.

**One near-miss worth recording.** `pnpm test` piped to `/dev/null` and then read from
`.vitest/json/output.json` reported "22 passed, 7 files" — exactly the new file's count. That was a
stale report, not a suite run. The real number is **140 passed across 12 files**. Reading a JSON
report that a previous filtered run had written would have made a partial run look like a full one.

## Verification

| Check | Result |
|---|---|
| `pnpm --filter @marketplace/web test` | 155 passed, 12 files |
| `pnpm --filter @marketplace/web typecheck` | clean |
| `pnpm --filter @marketplace/web lint` | clean |
| `pnpm --filter @marketplace/web perf` | 8/8 audits at 100, floor 85 |
| AC13 red probe | 4 audits driven to 0 and reported |
| AC18 profile-revert probe | 2 tests fail, named |
| `pnpm format:check` | clean |
| `actionlint 1.7.7` on `ci.yml` | clean |
| AC24 screenshot probe | 18 images for 2 failing routes; 0 on a green run |
| `CHROME_PATH` pin | 152.0.0.0 without, 153.0.0.0 with |

## Known gaps, carried deliberately

- **The CI job has never actually run.** Everything about it was verified locally — actionlint, the
  browser path resolution, the recap, the images — but the first real execution is this pull
  request's own. The browser-path step is the one most likely to surprise: it resolves through
  `pnpm --filter @marketplace/ui exec node -e`, and `playwright-core` was the first guess and was
  wrong (the package is `playwright`).
- **Nothing enforces that the job stays non-blocking** beyond a comment and a test asserting the
  comment. Branch protection lives in repository settings.
- **The floors have no sensitivity.** Everything scores 99–100, so a floor at 85 catches
  catastrophes and nothing smaller. §10 Q1 — revisit with real CI variance, and the direction to
  move is *up*.
- **The profile is an assumption about users who do not exist yet.** §10 Q2. If real traffic arrives
  on worse links, this harness will have been green throughout and the default profile would have
  been right after all.
- **Localhost, not a network.** Simulated throttling over a loopback server. Real TLS and CDN
  latency will make every number somewhat worse, so the floors must be re-derived, not carried over,
  when this first points at a deployment.
- **Two routes, Spanish only.** §3.4.

## Self-assessment

The part worth reviewing hardest is **Finding 1**, because the ticket's original acceptance criteria
could have been met without ever discovering it: install Lighthouse CI, set `≤170 KB`, watch it fail,
open a bundle-reduction epic. Everything would have looked diligent. The measurement that made that
the wrong plan took about four minutes and consisted of running the same build twice.

Second, Finding 2 is the one I nearly did not look at. The probe's purpose was to show the harness
could report red, and it did — four audits, loudly. Noticing that a fifth stayed green *when it
should not have* required reading the passing rows, which is not where attention goes when the
thing you were testing for has already happened.
