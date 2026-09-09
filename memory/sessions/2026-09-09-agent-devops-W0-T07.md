---
task:    W0-T07
agent:   agent-devops
session: 2026-09-09T10:10Z
status:  closed
---

## Goal
Four deploy workflows — preview per PR, teardown on close, staging on merge, tagged production
release promoting the staging artifact. `[M]`: every credential is `[H]` and none exists, so this
lands **inert** and `W0-T24` carries the activation.

## Current state
**Done, and inert by design.** 66 assertions green, actionlint clean across five workflows, and the
API image built, run, and verified to serve `/health` as non-root with a working Prisma client.
No deploy has ever run. Issue #156 (`W0-T24`) carries the activation.

## Log
- 10:10 operator steered this in advance: "the GA actions might need an extra ticket, cause they
  will not run in auto for w07 PR". Correct, and worse than stated — see below.
- 10:15 **the guard is code, not YAML.** `secrets` is not available in a job-level `if:`, so the
  standard shape is a preflight job reading secrets into an output. Putting the logic in
  `scripts/deploy/` makes the one part that must work on the day the secrets arrive unit-testable.
- 10:20 unconfigured deploys **succeed**, not fail. Failing would make every PR red until the
  accounts exist, which trains everyone to ignore red. Flagged in spec §10 as a judgement call.
- 10:25 **no `pull_request_target`.** It runs the base branch's workflow with full secrets against
  untrusted code — the most exploited GHA misconfiguration. Fork PRs take the unconfigured path.
- 10:30 second-order finding for the operator's point: `release-production.yml` triggers on a `v*`
  tag, so it is not merely unconfigured — it is never *triggered* by this PR or by merging it. Its
  environment protection and approval gate are wholly unexercised until someone tags.

- 10:40 built the image locally and found the real defect: `pnpm deploy --prod` discards the
  generated Prisma client. The image boots and `/health` answers because nothing queries the
  database yet — the first slice that did would have found it in production. MEM-2026-09-09-22.
- 10:45 moved every `${{ }}` out of `run:` into `env:`. actionlint's shellcheck found one instance;
  the general case is the Actions injection vector. MEM-2026-09-09-23.
- 10:50 filed #156 and added `W0-T23`/`W0-T24` to `TODO.md` §6.

## Blocked / escalations
BLOCKED — needs human (full block in the run record and the PR body). OPS-04, OPS-07, OPS-08,
OPS-09, W0-T09.

## Handoff
`W0-T05`, `W0-T06` and `W0-T07` are all complete, on three **stacked** branches. PRs #154 → #155 →
#156's sibling; merge bottom-up: #154, then #155, then #157.

Do **not** close issue #39 — its four "done when" boxes cannot be ticked by this PR. Issue #156
(`W0-T24`) is the activation ticket and it is `[H]`.

Next unblocked agent task in W0 is `W0-T10` (`CONTRIBUTING-agents.md`) or `W0-T12` (the
`spec-present` / `intervention-logged` gates), both `[A]`. `W0-T23` (issue #153) should land before
many slices run in parallel.
