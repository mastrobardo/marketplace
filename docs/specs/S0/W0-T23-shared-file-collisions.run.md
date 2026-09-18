# Run record — W0-T23 stop parallel agents colliding on shared files

> **This ticket was reverted whole, and this document is kept as the record of why.**
>
> `W0-T23` passed every one of its own acceptance criteria and was reverted in full — the direction
> was never put to the operator, and it was not the one they wanted
> (`docs/interventions/2026-09-09-W0-T23-01.md`, PR #161, verdict `REJECTED`).
> `agents/prompts/00-spec-authoring.md` cites it as the cautionary example every spec author reads:
> *"A spec that treats the direction as settled because an issue proposed it has skipped the only
> question that mattered."*
>
> Restored to `main` on 2026-09-18 because it existed **only** on `origin/W0-T23-shared-file-collisions`,
> which made a prompt's own reference depend on a branch surviving. Nothing here describes code that
> is in the repository; read it as the argument that was made, not as a design in force.

---

|            |                                                          |
| ---------- | -------------------------------------------------------- |
| **Task**   | `W0-T23` · issue [#153](https://github.com/mastrobardo/marketplace/issues/153) |
| **Agent**  | `agent-devops`                                           |
| **Date**   | 2026-09-09                                               |
| **Spec**   | `W0-T23-shared-file-collisions.md`                       |

---

## 1. What landed

Four changes, one per shared file that has collided or was about to, in the order the issue
recommended — highest cost-to-fix-later first.

| | Change | Commit |
|---|---|---|
| B | i18n split one file per namespace | `a4a4dfc` |
| A | memory split one record per file; `LONG_TERM.md` generated | `e7cb412` |
| D | `.gitattributes` + merge drivers + `relock.sh` | `85df566` |
| C | README Layout table generated from the workspace | `aba623e` |

300 tests, 0 failures. `typecheck`, `lint`, `format:check` clean.

## 2. The acceptance criterion is executed, not argued

AC1 is the point of the task, so it is a test that actually merges: `tests/parallel-merge.test.ts`
clones the repo into a scratch directory, builds two branches from `HEAD` — each adding a memory
record, a translation namespace and keys — and asks `git merge-tree --write-tree` whether they
combine. No working tree, no index, nothing left dirty.

**A green AC1 on its own would prove nothing**, because a test that cannot detect a conflict passes
for the wrong reason. So AC2 merges two branches that both append to one shared file and asserts
the conflict by path. If that ever goes green, `merge-tree` is not being asked what this suite
thinks it is, and AC1 is vacuous. That pairing is the only reason to trust the result.

## 3. The red phase, honestly

`MEM-2026-09-09-06` says a module-resolution failure is not a red phase, and **two of the three
suites started with exactly that** — the tests could not import files that did not exist yet:

```
Cannot find module '../src/i18n/locales/en/index.js' imported from apps/web/tests/i18n.test.ts
  TOTAL 0  FAILED 0

ENOENT: no such file or directory, scandir 'memory/repo/gotchas'
  TOTAL 0  FAILED 0
```

`TOTAL 0` is the tell: no assertion ran, so nothing was proved except that a path was wrong. Where
the layout change *is* the feature, that is unavoidable — the test cannot import a barrel before
the barrel exists — so it is recorded as what it is rather than pasted as if it were a red phase.

The real red came after the files existed, and it is the one worth reading, because it failed on
facts rather than on paths:

```
FAILED  memory/repo/gotchas/MEM-2026-09-07-09.md is well-formed
  AssertionError: bad scope: expected 'slice:S9' to match /^(repo|slice:[a-z-]+|flow:[a-z-]+)$/
FAILED  has no two records sharing an id
  AssertionError: two records claim the same id: expected 39 to be 41
  TOTAL 46  FAILED 17
```

Both were my errors about the repo rather than the repo's errors: `scope` uses slice **codes**
(`slice:S0`), which `agents/policies/memory.md` had fixed and my regex had guessed at. The second
was not my error — see §4.

`tests/parallel-merge.test.ts` never had a red phase against a broken implementation, which is why
its AC2 case exists: it merges two branches that append to one shared file and asserts the conflict.
A green AC1 is only meaningful because that case is green too.

## 4. Two defects the flat layout had been hiding

Neither was the task. Both were found by validating a layout that had never been validated, which
is most of the argument for the layout.

**Four records had no `status`.** `MEM-2026-09-09-02` and `-06` in gotchas, `MEM-2026-09-08-03` and
`-04` in the devops slice. In a 200-line appended file a missing final bullet is invisible; as a
file with frontmatter it is a parse failure. Defaulted to `active` — correct in all four cases,
none of them is superseded — and `tests/memory-layout.test.ts` now rejects the next one.

**Two ids each named two different facts.** The repo-wide and slice sequences were numbered
independently on 2026-09-09 and both reached 23 and 24:

| id | repo/gotchas | slices/agent-devops |
|---|---|---|
| `MEM-2026-09-09-23` | a CI gate on a shallow clone reports green | `secrets` is unavailable in a job-level `if:` |
| `MEM-2026-09-09-24` | a vitest JSON report can be stale | `pnpm <binary>` is a script lookup, not an exec |

Ids are global — `superseded-by MEM-…` and every citation in a run record resolve by id alone — so
each of those made **both** records unresolvable.

The fix direction was not free. `W0-T07`'s run record and session file already cite
`MEM-2026-09-09-23` meaning the *slice* one. Renumbering the slice records would have silently
broken two existing citations; renumbering the newer `W0-T12` gotchas to `-27` and `-28` broke none.
Checked with a grep before choosing, not after.

## 5. Decisions worth reviewing

- **The barrel is guarded, the index is generated.** Both are shared files, and they got different
  treatment on purpose. A generator that emits TypeScript is more machinery than two lines per
  namespace earns, so `locales/<lang>/index.ts` stays hand-written with a test that fails naming
  the exact line to add. `LONG_TERM.md` aggregates 41 records and hand-maintaining it *is* the
  collision, so it is generated. The rule is cost of the generator against cost of the collision,
  not consistency for its own sake.

- **A merge driver only where the file is a pure function of conflict-free inputs.** The issue
  proposes an append-merge driver as option E and then argues against it, and the argument is
  right: a keep-both script run on the three conflicting files in the `W0-T02/03/04` session was
  correct on five hunks and wrong on two, because the README Layout table looks append-shaped and
  is really a modification. The claim this task relies on is different and narrower — the merge
  result is *discarded* and the file recomputed — so the failure mode cannot occur. That is why
  `memory/LONG_TERM.md` and `pnpm-lock.yaml` get drivers and `README.md` does not.

- **`glossary.md` stays a table.** The only shared file left untouched. A term is one line and
  coining one happens once per domain concept, not once per task; eleven three-line files would be
  a worse artifact than the collision they avoid. Written into the test as a comment and into the
  spec's risks, so the next person sees a decision rather than an oversight.

- **`ci.yml` was not touched.** The drift checks are ordinary vitest tests, so the existing `unit`
  job already runs them. Editing the one file `W0-T12` had just changed, to add a job that would
  duplicate coverage, would have been this task committing the mistake it exists to prevent.

- **`en/` is checked per namespace, not per catalogue.** `satisfies Mirror<typeof spanish>` on a
  **direct object literal** is what enforces both directions — excess-property checking does not
  apply through a spread, so the same assertion on the composed barrel would have caught a missing
  key and silently accepted an invented one. `W0-T04` claimed the excess direction and never proved
  it; there is now an `excess-key` fixture that fails to compile.

## 6. Method note

The migration ran as a throwaway script rather than 41 hand-written files, and it **failed loudly
on the first malformed record instead of skipping it** — which is how §3's first defect surfaced.
A migration that tolerates bad input silently produces a clean-looking result and moves the
problem. The script stayed in the scratch directory: it has no second use, and a one-shot migration
committed to `scripts/` reads like a tool.

`rtk`'s vitest wrapper could not parse vitest 5's output, and `--reporter=basic` does not exist in
vitest 5. Every run here went through `rtk proxy npx vitest run --reporter=json --outputFile=<fresh
path>` — a fresh path each time, per `MEM-2026-09-09-28`, because a report file that is not
regenerated is indistinguishable from a run that changed nothing.

## 7. Self-assessment

- **Weakest part:** the merge drivers are per-clone local config. An agent that never runs
  `scripts/setup-git.sh` gets the old behaviour on `LONG_TERM.md` and the lockfile. It fails
  *toward* a conflict rather than toward a silent bad merge, which is the right direction, but AC1
  is only literally true for a clone that has been set up. The README now leads with the command and
  says what skipping it costs.

- **Look hardest at:** `tests/parallel-merge.test.ts` clones with `--shared`, which is fast and
  points the scratch clone's objects at the real repository. It only ever reads and it deletes the
  scratch directory in a `finally`, but it is the one test here that touches the repo it is testing.

- **Not fixed:** the i18n barrel still changes when a slice adds a *namespace* — once per slice,
  thirteen times ever, down from once per task. Sorted one-per-line so two such branches usually
  merge anyway. Stated in the spec's risks rather than left for a reviewer to find.

## 8. One thing fixed that was not this task

CI's `lint` job failed on the first push while `pnpm lint` was green locally, twice.

`packages/config/eslint.config.js` imports `./dist/eslint.js` — it must, because ESLint loads its
config as JavaScript and cannot read the TypeScript source. `turbo.json` gave `lint`
`"dependsOn": ["^build"]`, and the caret means *upstream* packages: `@marketplace/config` has no
upstream, so nothing ordered its lint after its own build. `@marketplace/config#lint` could start
before `dist/eslint.js` existed.

It only fails on a **cold** cache, which is why it had never been seen. The trigger was this branch
adding four `scripts` entries to the root `package.json` — part of turbo's global hash, so the whole
cache missed at once. The bug is older than this PR; the cache miss is what made it visible.

Reproduced deterministically rather than assumed:

```
$ rm -rf packages/config/dist .turbo packages/config/.turbo && pnpm lint
@marketplace/config:lint: Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '…/packages/config/dist/eslint.js' imported from …/packages/config/eslint.config.js
 Tasks:    0 successful, 2 total
```

Fixed with a package-specific override — `"@marketplace/config#lint": { "dependsOn": ["build"] }`,
no caret — plus two assertions in `tests/config-package.test.ts` anchored to the *reason*, so the
override is removed if `eslint.config.js` ever stops importing `dist/`. `pnpm verify` now passes
from a cold cache. Promoted as `MEM-2026-09-09-32`.

Out of scope for `W0-T23` and disclosed rather than folded in silently: it blocked the PR, it is
four lines, and leaving a known cold-cache failure for the next agent to rediscover would have cost
more than it saved.

## 9. Handoff

- **Every agent must run `./scripts/setup-git.sh` once**, and `pnpm memory:render` after writing a
  record. `agents/AGENTS.md` §3, `agents/policies/memory.md` and `agents/prompts/09-memory-write.md`
  all describe the new layout.
- A slice adding translations creates `locales/es/<slice>.ts` and `locales/en/<slice>.ts` and adds
  one sorted import and one spread to each barrel. The test names the line if you forget.
- `memory/repo/glossary.md` is the one shared append file left. If it starts colliding it gets the
  same treatment; it has not yet.
- `W0-T10` (#42) is the next unblocked `[A]` task in M0 — `CONTRIBUTING-agents.md` does not exist.
- Issues #43 (`W0-T11`), #46 (`W0-T14`) and #54 (`W0-T22`) are open but their work is on disk and
  merged. They want closing rather than doing.
