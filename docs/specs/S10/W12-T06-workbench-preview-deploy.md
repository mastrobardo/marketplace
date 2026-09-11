# W12-T06 — The workbench gets a URL

Task: `W12-T06` · Slice: S10 · Owner: `agent-ui` · Issue: #206
Branch: `W12-T06-workbench-preview-deploy` · Run record: `W12-T06-workbench-preview-deploy.run.md`
Design: [ADR-012](../../adr/ADR-012-design-system-and-component-workbench.md) §6 ·
Builds on [`W12-T03`](W12-T03-storybook-workbench.md) · Depends on
[ADR-006](../../adr/ADR-006-hosting-and-environments.md)

---

## 1. Purpose

`TODO.md` §9 rule 2: *every PR gets a URL; reviewers click, they don't imagine.* That principle has
had no UI half. There is now a workbench with 38 stories in it and the only way to see one is to
check out the branch and start a dev server — which reviewers, human or agent, will not do, and so
components get reviewed as diffs. A focus ring cannot be reviewed as a diff.

This task gives the workbench the same treatment the application already gets: built on every pull
request, deployed, and the URL commented next to the app preview. It is the second half of ADR-012's
argument — the stories are the tests (`W12-T03`, `W12-T04`) *and* the review surface.

**Not a fifth service.** A second Cloudflare Pages *project*, `marketplace-ui`, on the account M0
already pays for, using the credentials the preview pipeline already holds. The four-service rule
(Fly, Neon, Cloudflare, Sentry) holds, and AC7 asserts that no new secret appears.

---

## 2. User stories

- **As a reviewer**, I want a link in the pull request that shows every component in every state, so
  that reviewing UI is looking rather than imagining.
- **As a slice agent**, I want to see what already exists before I build a fourth button.
- **As whoever pays the bill**, I want the preview deployments to disappear when the pull request
  closes, rather than accumulating forever.

## 3. State machine

None. The deployment lifecycle is `deploy-preview.yml`'s and predates this task.

## 4. API surface

No runtime surface. Three workflow changes and one new Pages project.

| Workflow | Change |
|---|---|
| `deploy-preview.yml` | build the workbench, create the project if missing, deploy it, add the URL to the existing comment |
| `deploy-staging.yml` | the same deploy on merge to `main`, so the shared workbench is what is on `main` |
| `deploy-preview-teardown.yml` | delete that branch's workbench deployments when the PR closes |

### 4.1 Decisions worth stating

**In the existing `deploy` job, not a job of its own.** It needs the same `preview` environment and
the same credentials, and a reviewer should get **one** comment with both links rather than two to
correlate. The cost is that a workbench failure fails the job that also deploys the app; the benefit
is that there is exactly one place where a preview is assembled.

**On every pull request, not only the ones touching `packages/ui`.** A path filter would be cheaper
and would mean a reviewer sometimes gets a link and sometimes does not, with no way to tell which
case they are in. A token change, a route rule, a dependency bump — all show up in the workbench.
The build is seconds.

**The project is created by the workflow, not by a human.** `wrangler pages deploy` against an
unknown project *prompts*, and CI has no TTY to answer, so the first run would hang or fail on a
blank error. `wrangler pages project create` is non-interactive and idempotent if "already exists"
is tolerated — which it is, by `case`, not `grep` (grep exits 1 on no match, which under `set -e`
means either an aborted job or the `|| true` that `AC31` forbids). If the API token turns out to be
scoped to a single project, this step fails with Cloudflare's own message and *that* is when a human
is needed — see §10 Q2.

**The URL is read back from wrangler, never constructed.** `*.pages.dev` subdomains are globally
unique, so `marketplace-ui` may be served from `marketplace-ui-x7q.pages.dev`. The app deploy learned
this the expensive way (`AC34`) and the same rule is repeated here rather than rediscovered.

## 5. Permissions matrix

Not applicable, and one boundary declared: all three workflows and `tests/cd-workflows.test.ts` are
`agent-devops`'. ADR-012 §6 assigns this deployment to `W12` explicitly, the changes are additive,
and the assertions live beside the existing deploy assertions rather than in `packages/ui` so that
the next agent editing the pipeline sees them. Flagged for review rather than assumed.

## 6. Error cases

| Failure | Behaviour |
|---|---|
| Pages project absent | Created by the workflow; "already exists" is a success |
| API token cannot create a project | The step fails with Cloudflare's message — the one case needing a human |
| wrangler prints no `*.pages.dev` URL | The step fails rather than commenting a guessed link |
| A deployment is already gone at teardown | Success. An absent resource is not a failure, or the teardown gets re-run and leaves the other resources alive |
| The workbench build fails | The preview job fails, which is correct: the stories are also the tests |

---

## 7. Acceptance criteria

- **AC1** — Given a pull request, when the preview pipeline runs, then the workbench is built with
  `pnpm --filter @marketplace/ui build:storybook` and deployed to the Pages project
  `marketplace-ui`, and the web app still deploys to `marketplace-web`.
- **AC2** — Given a Pages project that does not exist, when the pipeline runs, then it is created
  non-interactively, and a subsequent run tolerates "already exists".
- **AC3** — Given the deploy step, when it finishes, then the URL is read back from wrangler's
  output, and the step fails rather than emitting a constructed one.
- **AC4** — Given a preview deployment, when the pipeline comments, then the same comment carries
  the web, API **and** workbench URLs.
- **AC5** — Given a merge to `main`, when the staging pipeline runs, then the workbench is deployed
  to `marketplace-ui` on branch `main`.
- **AC6** — Given a pull request that closes, when the teardown runs, then that branch's workbench
  deployments are deleted, tolerating any that are already gone.
- **AC7** — Given `deploy-preview.yml`, when its secret references are listed, then they are exactly
  the five that already existed. *(A new secret would mean somebody had added a vendor.)*

## 8. Data

None.

## 9. Out of scope

- **A custom domain** for the workbench. `*.pages.dev` is what reviewers click; a domain is a DNS
  action, which is `[H]`.
- **Access control.** The workbench is public, like the preview app. It contains no data — it is
  seven components and Spanish placeholder copy.
- **Visual regression** (`W12-T16`), which is nightly Playwright screenshots and not a deployment.
- **Deleting `marketplace-web`'s accumulated preview deployments** — see §10 Q1.

## 10. Open questions

### Q1 — the web app's previews are not torn down either

Writing AC6 surfaced that `deploy-preview-teardown.yml` has never deleted a Cloudflare deployment at
all: it destroys the Fly app and the Neon branch, and every `marketplace-web` preview ever built is
still there. This task adds teardown for the project it introduces; doing the same for
`marketplace-web` is a change to a pipeline this ticket does not own, on a resource that is not
billed per deployment. **Written down rather than done quietly** — it is `agent-devops`' call, and
worth a ticket.

### Q2 — the one case that needs a human

If `CLOUDFLARE_API_TOKEN` is scoped to the `marketplace-web` project rather than to the account's
Pages, project creation fails and no amount of retrying helps:

```
BLOCKED — needs human
Task:     W12-T06
Need:     either a Cloudflare API token with account-level Pages:Edit, or the Pages project
          `marketplace-ui` created by hand (production branch `main`)
Why:      `wrangler pages project create` cannot create a project the token may not create, and
          `pages deploy` prompts for an unknown project, which CI cannot answer
Where:    Cloudflare dashboard → Workers & Pages → Create → Pages; or the token's permissions
Meanwhile: everything else in the pipeline is unaffected — the app preview deploys as before, and
          the workbench step is the only one that fails
```

This is the *fallback*, not the plan: the token already deploys to Pages, and Pages:Edit is
normally account-scoped. The first run on a real pull request is what settles it, and this block is
here so that whoever reads the red job knows exactly what to do in the case where it does not.
