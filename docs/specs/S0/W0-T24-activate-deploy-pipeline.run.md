# Run record — W0-T24 activate the deploy pipeline

|                  |                                                                 |
| ---------------- | --------------------------------------------------------------- |
| **Agent**        | `agent-devops`                                                    |
| **Model**        | `claude-opus-5`                                                   |
| **Charter rev**  | 1                                                                 |
| **Skills used**  | `test-driven-development`, `debugging-and-error-recovery`, `ci-cd-and-automation`, `security-and-hardening`, `spec-driven-development` |
| **Started**      | 2026-09-09T14:00Z                                                 |
| **Branch**       | `W0-T24-activate-deploy-pipeline` (from `main`)                   |
| **Issue**        | https://github.com/mastrobardo/marketplace/issues/156             |
| **PR**           | https://github.com/mastrobardo/marketplace/pull/159               |
| **Spec**         | [`W0-T24-activate-deploy-pipeline.md`](W0-T24-activate-deploy-pipeline.md) |

---

## Prompts

### 1. Task assignment (operator, verbatim)

> All env are setup on github. Now u can continue with the next steps. However, w0-T07 task did
> not deploy anything

Both halves are correct, and the second is the whole task. The operator had set the `preview`
environment's five credentials at 13:40–13:54. Every deploy after that still skipped.

### 2. Operator decisions (asked before any file was written)

| Question | Answer |
|---|---|
| Static `PREVIEW_DATABASE_URL` vs. the URL Neon returns | **Use the branch URL** |
| Verify `sanitised-staging` / the Pages project up front, or let a run report them | **Let the run tell us** |

Both held. The second decided the shape of the work: it is why defect 2 below was worth fixing
*before* the first real run rather than after it — a swallowed failure would have made "let the run
tell us" produce a green tick and no information.

## What was wrong

`W0-T07` asserted the pipeline was correct and could not test the only thing that mattered. Four
defects, each in the gap between a workflow and something it invokes.

### 1. The guard was never handed the secret it checked for

`W0-T07`'s deviation 8 added `PREVIEW_DATABASE_URL` to `REQUIRED.preview` and did not add it to
the preflight step's `env:`. The guard read `undefined`, reported it missing, set
`configured=false` — and both `deploy` and `destroy` are gated on that output.

**Every preview deploy and every teardown skipped permanently, whatever a human set in GitHub.**
Run [34361193641](https://github.com/mastrobardo/marketplace/actions/runs/34361193641): six
secrets present in the environment, guard naming one missing, deploy skipped.

The fix that introduced it was itself a fix for a related bug. That is the interesting part: the
change was correct about the problem and wrong about the wiring, and nothing downstream noticed.

`tests/env-example.test.ts` exists to prevent exactly this and structurally could not — it unions
`secrets.*` across the whole workflow *directory* and compares that to `REQUIRED`, so one read
anywhere satisfies it. **An inventory test must assert the consumer receives the value, not that
the name appears somewhere in scope.** `AC28`.

### 2. `neonctl` was invoked and installed by nothing

In no dependency list and no setup step, with both call sites ending in a blanket fallback
(`|| echo "branch already exists — reusing it"`, `|| true`). `command not found` read as success:
the deploy would report success having created no database, and the teardown would report success
having deleted nothing — leaving a branch alive and billing, which is the one outcome that
workflow exists to prevent. `AC29`.

### 3. The deployed app was never given `DATABASE_URL`

`DATABASE_URL` is `z.url()` with no default, so the API exits on boot without it. All three deploy
workflows set it as a workflow variable scoped to the migrate step and none ran `flyctl secrets
set`. Migration succeeds, deploy reports success, container crash-loops. Latent in `preview`,
`staging` **and** `production`. `AC30`.

### 4. The flyctl action was pinned to a tag that does not exist

```
Unable to resolve action `superfly/flyctl-actions@v1.5`, unable to find version `v1.5`
```

superfly tags releases without the `v` prefix. `1.5` exists; `v1.5` never did. All four workflows
carried it, four commits old and completely invisible — because the job had never once got past
the preflight gate.

`AC23` asserts every action is pinned and that the ref does not float. Both were true of a tag that
did not exist. **No static test could have caught this**; it needed a job that actually starts.
Every other `uses:` in the five workflows was checked against the GitHub API and resolves.

## Red phase

Three new suites in `tests/cd-workflows.test.ts`, written before any workflow was touched:

```
 × AC28  deploy-preview.yml / deploy-preview-teardown.yml    guard not handed REQUIRED
 × AC29  deploy-preview.yml / deploy-preview-teardown.yml    neonctl never installed
 × AC30  deploy-preview.yml / deploy-staging.yml /           DATABASE_URL never set on the app
         release-production.yml
 Tests  7 failed | 52 passed (59)
```

Seven failures on exactly the affected files, and no others.

`AC29`'s first draft flagged `sha=` in `release-production.yml` as an uninstalled command. A
first-token regex over shell needs assignment and keyword filters before it is worth trusting; the
false positive was fixed before the green phase rather than excluded by path.

## Green phase

```
scripts/deploy/config.ts                    PREVIEW_DATABASE_URL removed from REQUIRED
.github/workflows/deploy-preview.yml        neonctl pinned+installed; branch URL returned and
                                            masked; DATABASE_URL staged onto the Fly app;
                                            explicit `branches get` in place of a blanket `||`
.github/workflows/deploy-preview-teardown.yml  neonctl installed (keeps its deliberate `|| true`)
.github/workflows/deploy-staging.yml        DATABASE_URL staged onto the app
.github/workflows/release-production.yml    DATABASE_URL staged onto the app
all four                                    setup-flyctl@v1.5 → @1.5
.env.example                                PREVIEW_DATABASE_URL removed, status corrected
```

```
$ pnpm vitest run tests/cd-workflows.test.ts tests/deploy-guard.test.ts tests/env-example.test.ts
      Tests  89 passed (89)

$ docker run --rm … rhysd/actionlint:1.7.7
(clean — exit 0, across all five workflows)

$ pnpm verify
 typecheck · lint · format · test · build — all green
```

## What was actually verified, and what was not

Unlike `W0-T07`, the gate is open and the evidence is a real run rather than a unit test.

| Run | Result |
|---|---|
| [34362507991](https://github.com/mastrobardo/marketplace/actions/runs/34362507991) | preflight **success** — first `configured: true` in the repo's history. Deploy failed at *Set up job*: defect 4. |
| [34362792694](https://github.com/mastrobardo/marketplace/actions/runs/34362792694) | flyctl and neonctl both install. Branch creation **fails loudly**, all seven downstream steps skipped. |
| [34365548656](https://github.com/mastrobardo/marketplace/actions/runs/34365548656) | same, now printing the `BLOCKED — needs human` block. |

The second row is the one worth reading twice. Before this branch, that same Neon condition would
have gone **green** — `|| echo` would have swallowed it, the deploy would have created a Fly app
pointed at a database that did not exist, and the PR would have shown a passing check. The red X
is defect 2's fix working.

**Still never executed**: the Fly deploy, the Pages deploy, the URL comment, the teardown, staging,
and the production release. `AC28`–`AC30` are unit-tested, not proven in the field.

## Deviations from the plan

1. **`PREVIEW_DATABASE_URL` was removed, not wired in.** The plan said wire it into the preflight
   `env:`. The operator chose the branch URL instead, which is the better answer: one static URL
   points every open pull request at one shared database, defeating the per-PR Neon branch and
   letting two PRs' migrations corrupt each other. `W0-T07`'s own comment predicted `W0-T16` would
   do this; it became load-bearing early.

2. **Defect 3 was not in the plan.** Found while confirming what the migrate step consumed, by
   reading `EnvSchema` against the workflows rather than the workflows against themselves. It
   affected all three targets, and would have shown up as a crash-looping container after a deploy
   that reported success.

3. **Defect 4 could not have been planned for.** It is the answer to "what does `W0-T07`'s test
   suite structurally not cover", and the answer turned out to be "whether the things it pins
   exist". Nothing in CI resolves an action ref; that gap is still open and is flagged below.

## Blocked

```
BLOCKED — needs human
Task:     W0-T24
Need:     1. the expiration date removed from the Neon "sanitised-staging" branch
          2. the four staging secrets; the production environment does not exist at all
Why:      Neon cannot create a child of an expiring branch, so no pull request can get a
          preview database. Staging and production report their missing credentials correctly.
Where:    1. Neon → project → Branches → sanitised-staging → remove expiry, or
             `neonctl branches set-expiration sanitised-staging --project-id <id>`
             (omitting --expires-at clears it)
          2. Settings → Environments → {staging,production}
Meanwhile: the preview pipeline is correct up to the point it stops, and it stops loudly and
          names its own remedy. Four defects are fixed and three are guarded by tests.
```

## For the reviewer

- **A red preview check is the fix, not a regression.** Three of the four defects previously
  presented as green.
- **Nothing in CI verifies that a pinned action ref resolves**, so defect 4 can recur silently. The
  check belongs in CI, but `W0-T06`'s gate names are a contract for `W0-T13`'s branch protection,
  so adding one is a coordinated change and was deliberately left out of this PR.
- **`sanitised-staging` exists but `W0-T20` has not run**, so "sanitised" is currently a name
  rather than a guarantee. Issue #156 holds that previews must not point at unsanitised data
  before its preview half is closed — that constraint is unmet and this PR does not change it.

## Interventions

| Type | What | Ledger |
|---|---|---|
| `AUTOAPPROVE` | Operator pre-authorised the session. | `W0-T05` run record |
| `SCOPE_SPLIT` | The action-ref resolution check is left for `W0-T13`/`W0-T15` rather than added here, because new CI gate names are a branch-protection contract. | this row |

No `MANUAL_FIX`: no gate was skipped, weakened or disabled.
