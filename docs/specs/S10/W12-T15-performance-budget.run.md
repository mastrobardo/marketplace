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

**One near-miss worth recording.** `pnpm test` piped to `/dev/null` and then read from
`.vitest/json/output.json` reported "22 passed, 7 files" — exactly the new file's count. That was a
stale report, not a suite run. The real number is **140 passed across 12 files**. Reading a JSON
report that a previous filtered run had written would have made a partial run look like a full one.

## Verification

| Check | Result |
|---|---|
| `pnpm --filter @marketplace/web test` | 140 passed, 12 files |
| `pnpm --filter @marketplace/web typecheck` | clean |
| `pnpm --filter @marketplace/web lint` | clean |
| `pnpm --filter @marketplace/web perf` | 8/8 audits at 100, floor 85 |
| AC13 red probe | 4 audits driven to 0 and reported |
| AC18 profile-revert probe | 2 tests fail, named |

## Known gaps, carried deliberately

- **Nothing runs this automatically.** By decision (§3.3), and the cost is that it will rot unless
  someone runs it. The first sign will be a `perf` script that no longer starts.
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
