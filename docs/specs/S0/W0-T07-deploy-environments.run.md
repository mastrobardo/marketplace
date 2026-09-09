# Run record — W0-T07 deploy environments

|                  |                                                                |
| ---------------- | -------------------------------------------------------------- |
| **Agent**        | `agent-devops`                                                  |
| **Model**        | `claude-opus-5`                                                 |
| **Charter rev**  | 1                                                               |
| **Skills used**  | `ci-cd-and-automation`, `security-and-hardening`, `test-driven-development`, `spec-driven-development`, `documentation-and-adrs` |
| **Started**      | 2026-09-09T10:10Z                                               |
| **Finished**     | 2026-09-09T10:55Z                                               |
| **Branch**       | `W0-T07-deploy-environments` (from `W0-T06-ci-pull-request-checks`) |
| **Issue**        | https://github.com/mastrobardo/marketplace/issues/39            |
| **Spec**         | [`W0-T07-deploy-environments.md`](W0-T07-deploy-environments.md) |
| **Session file** | `memory/sessions/2026-09-09-agent-devops-W0-T07.md`             |

---

## Prompts

### 1. Task assignment (operator, verbatim)

> continue till w07, everything is autoapproved. However, consider the GA actions might need an
> extra ticket, cause they will not run in auto for w07 PR

The second sentence is a design steer and it is correct. It turned out to understate the problem;
see *The operator's steer*.

### 2. Plan (agent, presented before any file was written)

> 1. Branch, spec, session memory.
> 2. `fly.toml` + `infra/`; four workflows: preview-deploy, preview-teardown on PR close, staging
>    on merge to `main`, production from a manual tagged release promoting the staging artifact.
> 3. **Every deploy job guarded on secret presence** — missing `FLY_API_TOKEN` / `CLOUDFLARE_*` /
>    Neon makes the job skip with a message naming the exact GitHub path a human must set, per
>    `agents/policies/human-boundaries.md`. No secret value ever enters the repo.
> 4. Red/green: static tests over the workflows (teardown fires on `closed`, staging only from
>    `main`, production requires a tag + the `production` environment, guard present on every
>    deploy job).
> 5. File `W0-T24` for the human activation, add it to `TODO.md` §6.

Followed. One thing the plan did not anticipate: the image itself could be built and run locally,
which turned out to be where the only real defect was found.

### 3. Corrections

No corrective re-prompt.

---

## The operator's steer, and why it was worse than stated

The instruction was that the Actions "will not run in auto for w07 PR". True, and there are **two
separate reasons**, only the first of which is obvious:

1. **The deploy jobs are unconfigured.** `OPS-04`, `OPS-07`, `OPS-08`, `OPS-09` and `W0-T09` are all
   `[H]` and none is done, so the preflight guard reports `configured: false` and every deploy job
   skips. This is by design and it is reported, not silent.
2. **`release-production.yml` cannot be *triggered* at all** — not by this PR, and not by merging
   it. A `push: tags` workflow first exists on a tag only once it has been merged and a tag
   created. Its trigger, its `environment: production` protection rule and its approval gate are
   therefore wholly unexercised, and no amount of configuration on this PR would change that.

So issue #39's four "done when" boxes cannot honestly be ticked by this PR. **Issue #156
(`W0-T24`, `[H]`)** carries the remainder and is now in `TODO.md` §6.

## Red phase

Two suites, written before any workflow or script existed.

`tests/deploy-guard.test.ts` — the guard, as **code** rather than YAML, because `secrets` is not
available in a job-level `if:` and the guard is the one part that must already be correct on the
day the credentials arrive:

```
 × AC1 … preview / staging / production report configured with nothing missing   (3 failures)
 × AC2 … names both missing secrets, not just the first
 × AC3 … treats "" as unset, because that is what an unset GitHub secret interpolates to
 × AC3 … treats whitespace as unset too
 × AC4 … every target names at least one SCREAMING_SNAKE_CASE variable            (3 failures)
 × AC4 … scopes production to the smallest set
 × AC5 … names the GitHub settings path for every missing secret
 × AC6 … echoes no value back, even when one is present
 × AC7 … deterministic, lowercase, DNS-safe, ≤30 chars, contains the PR number    (4 failures)
 × AC8 … two PRs never share an environment
 Test Files  1 failed (1)
      Tests  16 failed | 2 passed (18)
```

`tests/cd-workflows.test.ts` — the four workflows:

```
 × AC9…AC12   preview lifecycle: triggers, idempotent teardown, one source for the app name
 × AC13…AC17  promotion: staging on main, tag-triggered release, no build step, migrations first
 × AC18…AC24  safety: no pull_request_target, environment on every job, minimal permissions,
              every job gated on the guard, no secret shapes in tracked files, pinned actions
 × AC25, AC26 documentation, and the W0-T06 gates left untouched
 Test Files  1 failed (1)
      Tests  42 failed | 3 passed (45)
```

58 failing assertions.

## Green phase

```
scripts/deploy/config.ts                    REQUIRED per target, checkDeployConfig, renderMissing
scripts/deploy/names.ts                     previewAppName / previewBranchName / previewPagesBranch
scripts/deploy/check.ts                     the preflight CLI; writes $GITHUB_OUTPUT, always exits 0
.github/workflows/deploy-preview.yml        Fly + Neon branch + Pages preview, URLs commented
.github/workflows/deploy-preview-teardown.yml  destroys all three, idempotently
.github/workflows/deploy-staging.yml        builds the image once, tags by SHA, migrates, deploys
.github/workflows/release-production.yml    promotes that digest, no build step, behind approval
infra/docker/api.Dockerfile                 multi-stage, non-root, migrations shipped with the image
infra/fly/api.{preview,staging,production}.toml
README.md                                   the Deployment section and the secret table
TODO.md                                     W0-T23 and W0-T24
```

```
$ pnpm vitest run tests/cd-workflows.test.ts tests/deploy-guard.test.ts
      Tests  66 passed (66)

$ docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:1.7.7 -color
(clean — exit 0, across all five workflows)

$ pnpm verify
 typecheck 4 ok · lint 4 ok · format clean · build 3 ok
 test      api 44 passed | 8 skipped · web 15 passed · root 144 passed | 6 skipped
```

## What was actually verified

The workflows cannot run. The artifact they deploy can, and was:

```
$ docker build --file infra/docker/api.Dockerfile .        # succeeds, 119 MB
$ docker run -d -p 18080:8080 … && curl /health
{"status":"ok","uptime":1.06,"version":"w0t07-verify"}
$ docker exec … id
uid=100(marketplace) gid=101(marketplace)                  # not root
$ docker exec … node -e "require('@prisma/client')"
client loaded, seedRun delegate: object
```

That last line is the whole reason for building it — see *Deviations* 2.

## The unconfigured path, proven in CI

The deploy workflows cannot deploy, but the path they *do* take was exercised for real on PR #157
([run 34318489905](https://github.com/mastrobardo/marketplace/actions/runs/34318489905)):

```
success   preflight
skipped   deploy
```

and the preflight job's log, verbatim:

```
BLOCKED — needs human
Target:   preview
Need:     5 secret(s) that no agent may create
Where:    Settings → Environments → preview → Add secret

  - FLY_API_TOKEN
  - CLOUDFLARE_API_TOKEN
  - CLOUDFLARE_ACCOUNT_ID
  - NEON_API_KEY
  - NEON_PROJECT_ID

Meanwhile: this deploy is skipped, not failed. Nothing was created and nothing was changed.
See W0-T24 for the activation checklist, and docs/adr/ADR-006 for what each one is for.
```

So the guard, the skip, the reporting and the green-not-red decision are all **verified against
GitHub**, not just against unit tests. What remains unverified is every line after the gate — which
is the whole of `W0-T24`. CI itself: six gates green
([34318489835](https://github.com/mastrobardo/marketplace/actions/runs/34318489835)).

## Deviations from the plan

1. **`pnpm deploy` needs `--legacy`.** From pnpm 10, `deploy` refuses a workspace that does not set
   `inject-workspace-packages=true`. Setting that would change how every developer's local install
   resolves workspace packages; the escape hatch is the smaller change.

2. **`pnpm deploy --prod` discards the generated Prisma client** — and nothing would have caught
   it. `pnpm deploy` rebuilds `node_modules` from the store, and the store holds the *published*
   `@prisma/client`: a shell whose real code `prisma generate` writes into the installed package.
   The first image built, booted and served `/health` correctly while
   `require('@prisma/client')` threw `MODULE_NOT_FOUND` — because no route touches the database
   *yet*. The first slice to run a query would have found this in production, on a deploy that
   passed every gate. Fixed by regenerating into the pruned tree; AC27 guards the ordering.
   MEM-2026-09-09-22.

3. **Every GitHub expression moved out of `run:` and into `env:`.** `actionlint`'s shellcheck
   flagged `HEAD^{commit}` — but the underlying issue is larger: `${{ }}` inside a `run:` block is
   textual substitution performed before the shell exists, which is the standard Actions injection
   vector, and it also makes the script unparseable by shellcheck. All four workflows now pass
   values through `env:`. MEM-2026-09-09-23.

4. **The release's ancestry check fetches `main` explicitly.** A tag checkout has no
   remote-tracking branch for `main`, so `git merge-base --is-ancestor "$sha" origin/main` would
   have failed on a ref that does not resolve — reporting `RELEASE_NOT_ON_MAIN` for every release,
   including the legitimate ones.

5. **Root `tsconfig.json` includes `scripts/deploy/**`, not `scripts/**`.** Widening it to all of
   `scripts/` surfaced ~40 pre-existing type errors in `generate-claude-agents.ts`, `seed-board.ts`
   and `update-issues.ts`, which predate this task. Fixing them is a change of its own; noted for
   `W0-T15`, which wires `generate-claude-agents.ts` into CI.

6. **AC7 and AC15/AC18 test mechanisms corrected.** The workflow assertions originally read the raw
   file, so the comments explaining *why* there is no `pull_request_target` and no `docker build`
   were flagged as the very things they rule out. The assertions now strip comments first: a test
   about what a workflow does must read code, not prose.

7. **Two defects that only CI could find**, on the first run of PR #157 — both invisible locally,
   and both exactly what `W0-T06` was built for:
   - **`pnpm tsx …` is not a command.** pnpm reads a bare word as a script name, so the preflight
     step died with `Command "tsx" not found`. `tsx` was a devDependency of `apps/api` only; it is
     now a root devDependency and the workflows call `pnpm exec tsx`. The repo's other root scripts
     use `node --experimental-strip-types`, which cannot be used here: it does not resolve the
     `./config.js` specifiers that `check.ts` imports.
     The failure mode matters more than the fix — preflight *failed* rather than reporting
     "unconfigured", so the PR showed a red X. That is the outcome spec §10 argues against.
   - **AC22 flagged itself.** The test greps every tracked file for the four providers' token
     prefixes, and its own regex necessarily contains all four. It passed locally because the file
     was still untracked when `pnpm verify` ran, and failed the moment it was committed. Excluded
     by path with a comment, rather than by obfuscating the patterns.

## Notes for the reviewer

- **This lands inert, and the PR body says so.** Do not read six green checks as evidence that a
  deploy works. #156 is the activation ticket, and #39 should stay open until it closes.
- **The judgement call worth disagreeing with** (spec §10): an unconfigured deploy **succeeds**
  rather than fails. Failing would make every PR red until four accounts exist, which trains
  everyone to ignore red. The cost is that a genuinely broken deploy could hide behind the same
  green — which is why the guard is unit-tested code that prints what it skipped, not a YAML
  condition.
- **No `pull_request_target`, anywhere.** It is the only way to deploy a fork's PR, and it runs the
  base branch's workflow with full secrets against untrusted code. Fork PRs get no preview. AC18.
- **`production` holds the shortest secret list** — no Cloudflare or Neon API key — so a release
  cannot create or destroy a database branch. Blast radius is a function of what the token reaches.
- **No secret value is in this diff**, and AC22 greps every tracked file for the four providers'
  token shapes to keep it that way.

## Blocked

```
BLOCKED — needs human
Task:     W0-T07
Need:     Fly, Cloudflare and Neon accounts, GitHub Environments, and the secret values
Why:      no deploy job can execute, and release-production.yml cannot even be triggered, until a
          tag exists on a merged commit
Where:    GitHub → Settings → Environments → {preview,staging,production} → Add secret
          (names in README "What a human has to set"; OPS-04, OPS-07, OPS-08, OPS-09, W0-T09)
Meanwhile: the pipeline is written, actionlint-clean, and its guard is unit-tested; the image it
          deploys is built, run and verified locally. No deploy has ever run. Issue #156.
```

## Interventions

| Type | What | Ledger |
|---|---|---|
| `AUTOAPPROVE` | Operator pre-authorised the session, including merging the agent's own PRs. | `W0-T05` run record |
| `TOOL_BLOCKED` | `gh pr merge` refused by the harness; branches are stacked instead. | `W0-T06` run record |
| `SCOPE_SPLIT` | Issue #39's acceptance criteria cannot be met by this PR. Rather than tick them anyway, the unmeetable half was split into #156 (`W0-T24`, `[H]`) and #39 stays open. | this row |

No `MANUAL_FIX`: no gate was skipped, weakened or disabled.
