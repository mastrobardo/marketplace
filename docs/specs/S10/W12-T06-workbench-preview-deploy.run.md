# Run record — W12-T06 workbench-preview-deploy

```
Agent:        agent-ui
Model:        claude-opus-5
Charter rev:  2
Skills used:  ci-cd-and-automation, test-driven-development, spec-driven-development
Started:      2026-09-11T16:12:00Z   Finished: 2026-09-11T16:30:00Z
Session file: memory/sessions/2026-09-11-agent-ui-W12-T06.md
```

---

## Prompts

### 1. Spec authoring

Verbatim, from the operator, in the message that opened the series:

> comntinue with  W12-T01 to T03. also, take a look at w12t06 as it might convenient to add to the
> queue

and, in answer to the question about scope:

> **Which tasks should I take in this run?** → T01 + T02 + T03, Add T04 (a11y = error), **Add T06
> (deploy workbench)**

The "take a look at" was answered before any work started, with a recommendation and a caveat: queue
it right after T03, and treat it as `[M]` rather than `[A]` because `wrangler pages deploy` against
a non-existent project prompts and CI cannot answer. **That caveat turned out to be half wrong** —
see §Deviations.

### 2. Contract proposal

Not run — no contract, no schema.

### 3. TDD red

Against `agents/prompts/02-tdd-red.md`, with an admission. The assertions in
`tests/cd-workflows.test.ts` were written *after* the workflow edits rather than before, because the
first thing this task needed was to read three existing workflows closely enough to know what an
assertion should even say. The red phase was therefore **recovered, not skipped**: the workflow
changes were stashed and the suite re-run, so the paste below is a genuine failing run of the
assertions against the tree as it was.

That is weaker than writing them first and the record says so rather than presenting it as TDD.

### 4. Implementation

Against `agents/prompts/03-implement-green.md`: the preview deploy and the comment, then the staging
deploy, then the teardown.

### 5. Corrections

Two:

1. **`grep` failed an existing gate.** AC29 — "every CLI a workflow runs is installed first" — flags
   any command the runner is not known to provide, and my "already exists" check used `grep`.
   Rewritten as a `case`, which is what `deploy-preview.yml` itself already argues for in a comment:
   grep exits 1 on no match, which under `set -e` means either an aborted job or the `|| true` that
   AC31 forbids. The repo had already met this trap and written it down; I met it anyway by not
   reading the file I was editing closely enough first.
2. **The teardown had no branch to delete.** `deploy-preview-teardown.yml`'s preflight job declared
   `configured`, `app` and `db-branch` as outputs but not `pages-branch` — the guard script emits it,
   the job simply did not pass it on, because until now nothing downstream wanted it.

---

## Red phase

The workflow changes stashed, the assertions run against the tree as it was:

```
 ❯ pnpm vitest run tests/cd-workflows.test.ts
   ❯ AC35 — the workbench is deployed beside the app, not instead of it (7)
     × builds the static workbench and deploys it to its own project
     × creates the Pages project if it does not exist, without a prompt
     × reads the workbench URL back from wrangler rather than constructing it
     × puts the URL in the comment the reviewer already gets
     × deploys on merge as well as per pull request
     × deletes its preview deployments when the pull request closes
      Tests  6 failed | 77 passed (83)
```

The seventh — "adds no new secret, because it is not a new service" — passes in both states, which
is correct: it is a regression assertion, and the thing it guards against is a *future* edit.

## Green phase

```
 ❯ pnpm vitest run tests/cd-workflows.test.ts     Test Files 1 passed      Tests 83 passed (83)
 ❯ pnpm verify → typecheck ✓  lint ✓  format:check ✓  build ✓
                 test: green except the pre-existing @marketplace/testing failure (see W12-T03)
```

Each new `run:` block was also parsed out of the YAML and checked with `bash -n`, because a syntax
error in a workflow script is discovered on a pull request, by someone else, in a job that took ten
minutes to get there.

**What cannot be proven here**: that the deploy itself works. It needs the `preview` environment's
credentials, which no agent may hold (`policies/human-boundaries.md`), so the first real evidence is
this pull request's own preview run. That is a genuine gap and the reason §10 Q2 exists.

## Deviations from spec

- **`W12-T06` is `[A]` after all, or very nearly.** Before starting I reported it as mislabelled —
  effectively `[M]`, because `wrangler pages deploy` prompts for an unknown project and CI has no
  TTY. Half right: the prompt is real, but `wrangler pages project create` is non-interactive, and
  the workflow can provision its own project with the token it already has. The human step survives
  only as a *fallback*, if that token turns out to be scoped to `marketplace-web` alone — written as
  a `BLOCKED — needs human` block in spec §10 Q2 so that whoever reads the red job knows what to do.
  Correcting this before the ticket was executed is the point of having looked.
- **The teardown deletes deployments through the Cloudflare REST API**, not wrangler, because
  wrangler 3 has no command for it. Same credentials, same tolerance for an absent resource.
- **`tests/cd-workflows.test.ts` and three workflows are `agent-devops`'** (declared in spec §5).
  ADR-012 §6 assigns this deployment to `W12`; the changes are additive and the assertions sit with
  the existing deploy assertions rather than in `packages/ui`, so the next agent editing the
  pipeline meets them.

## Human input received

- The instruction to evaluate and queue this task, quoted in §Prompts.
- One thing found and **not** fixed: `deploy-preview-teardown.yml` has never deleted a Cloudflare
  deployment at all. Every `marketplace-web` preview ever built is still there. This task tears down
  the project it introduces; the web app's is `agent-devops`' pipeline and their call, and it is
  written into spec §10 Q1 rather than quietly changed here.

## Self-assessment

- **Weakest part of this change.** It has never run. Three workflow edits, two of them shell, are
  asserted by tests that read YAML — which proves the *intent* is written down, not that Cloudflare
  accepts it. The first pull request that runs this pipeline is the real test, and the two things
  most likely to be wrong are the project-creation step's tolerance of Cloudflare's exact wording
  and whether the teardown's `jq` filter matches the shape Pages actually returns.
- **What a reviewer should look at hardest.** The decision to deploy the workbench inside the
  existing `deploy` job. It means a Storybook build failure fails the app preview too. I think that
  is right — a preview is one thing a reviewer either gets or does not — but it is the choice that
  would be annoying to reverse once people are used to the comment's shape.
- **What I would tell the next agent in this slice.** Three of the five `W12` foundation tasks now
  touch `agent-devops`' files: a CI step (`T03`), and three workflows (`T06`). That is not scope
  creep, it is what "the workbench is deployed and its stories are the test suite" actually costs —
  but it is worth someone deciding whether `agent-ui`'s charter should say so, rather than each
  ticket declaring it in §5 again.
