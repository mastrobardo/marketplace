# W12-T16 — run record

Task: `W12-T16` · Branch: `W12-T16-visual-regression` · Issue: #216
Spec: [`W12-T16-visual-regression.md`](W12-T16-visual-regression.md)

---

## Status: spec only

This branch carries **the spec and nothing else**. No test, no workflow, no baseline. The
implementation is a second pull request against `main`, opened after the spec is reviewed — the same
shape `W12-T18` ran as (#234 spec, #240 implementation), and for the same reason: §10 carries two
escalations whose answers change what gets built, and building first would make the answer expensive.

The pipeline (`AGENTS.md` §1) is at step 1 of 8. **L1 has not been satisfied yet** — there is no red
phase in this record because there is no test yet, and a PR claiming implementation without one is
invalid regardless of the code. This PR does not claim it.

## What the spec had to establish first

| Checked | Found |
|---|---|
| Is `W12-T18` actually merged? | Yes — PR #240, `main` at `bff80ed`. The backlog's *"runs after `W12-T18`"* precondition is met |
| Is there an open session for this task? | No. `memory/sessions/` ends at `2026-09-11-agent-ui-W12-T12.md` |
| How many stories exist today? | 74, across 14 story files — the same 74 `W12-T04` runs axe against |
| What resolves `playwright`? | `1.63.0` (`pnpm-lock.yaml:2788`) — which pins the container image |
| Where does Storybook build to? | `packages/ui/storybook-static`, built by `pnpm --filter @marketplace/ui build:storybook` (`deploy-preview.yml:313`) |
| What are the toolbar globals called? | `theme`, `scheme`, `locale` (`.storybook/preview.tsx`) — needed for the shooting URL |
| Who owns `.github/**`? | `agent-devops`. Declared in spec §5 and raised as §10 Q3 |

## Decisions taken in the spec, and why

- **Enumeration from `storybook-static/index.json`, not a source glob** (§4.1). One artefact feeds
  both the shooting list and the completeness gate, so the two cannot disagree about what a story is.
- **The pinned list gets a completeness test that runs per-PR** (§4.2). This is the ticket's main
  idea. ADR-012 and the backlog both say *pinned list*, and a hand-written list of subjects is the
  failure this repo has had three times — the `database` job, `tokens.test.ts` AC6, `tokens.test.ts`
  AC4. Pinning stays; forgetting becomes a red test on the pull request that forgot.
- **The reference environment is a fingerprint file, not a convention** (§4.3). ADR-012 §6 says
  baselines are generated only in the CI image; a comment saying so is not a check. Mismatch fails in
  CI and skips loudly locally — both directions asserted, per `MEM-2026-09-11-22`.
- **Two workflow files, not one** (§4.5). The baseline-regeneration path needs `contents: write` and
  `pull-requests: write`; `ci.yml` is deliberately `contents: read`. AC16 asserts that block is
  unchanged by this branch.
- **One theme × scheme combination by default** (§10 Q5). Recorded as a decision rather than left as
  a silent default, because raising it later should be one line in the pinned list.
- **`W12-T18`'s lesson applied**: its §10 Q1 was *"safe under either answer"* and the implementation
  still guessed the answer's *contents* wrong. So Q1 and Q2 here are escalations rather than
  recommendations acted on — see below.

## Open, and blocking implementation

**Q1 — how does the nightly reach the 500 page?** `W12-T09` correctly made it unreachable
(`MEM-2026-09-11-21`: the categories request now degrades instead of throwing), so the one surface
with no a11y coverage of any kind also has no URL. Recommendation is option A, a build-time-stripped
`?__boom=1` trigger using `W12-T08`'s existing resolve-time stripping — **not** an
`import.meta.env` runtime guard, which `MEM-2026-09-11-14` records shipping 511 KB of mocks to a CDN.
Blocks one row of AC11 and nothing else.

**Q2 — does a missing baseline fail or self-adopt?** Recommendation is fail, with the initial
baselines landing through the regeneration workflow as this ticket's own second PR, so the accept
path is exercised once by the person who built it.

**Q3 — `agent-ui` has now touched `agent-devops`' files in four tasks.** `W12-T06`'s run record asked
for this to be settled once instead of re-declared per ticket; it was not. Filed as its own task
rather than fixed here (L10).

## Not yet done

- [ ] TDD red phase, pasted here (L1)
- [ ] `visual-coverage.test.ts`, `visual-runner.test.ts`, `visual-report.test.ts`
- [ ] `nightly-visual.yml`, `visual-baselines.yml`, `cd-workflows.test.ts` additions
- [ ] AC19's deliberate one-pixel red probe — the criterion this task is to be judged on
- [ ] Initial baselines, via the regeneration workflow
- [ ] Session memory closed with a handoff; durable learnings promoted to `memory/slices/agent-ui.md`
