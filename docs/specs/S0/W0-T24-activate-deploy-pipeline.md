# Spec — W0-T24 activate and verify the deploy pipeline

|               |                                                       |
| ------------- | ----------------------------------------------------- |
| **Task**      | `W0-T24` `[H]` → `[M]`                                |
| **Slice**     | S0 Platform                                           |
| **Owner**     | `agent-devops`                                        |
| **Reviewers** | `agent-qa`                                            |
| **Issue**     | https://github.com/mastrobardo/marketplace/issues/156 |
| **Status**    | in progress — preview half                            |

---

## 1. Purpose

`W0-T07` landed four deploy workflows and asserted they were correct. The operator has now set the
`preview` environment's five credentials, which should have been enough to make one of them run.

It was not. The pipeline did not deploy, and the reason was not the missing configuration it
reported — it was three defects that no test in `W0-T07` could see, because every one of them
lives in the gap between a workflow and the thing it invokes.

This task closes that gap, and adds the assertions that would have caught each one.

## 2. What was actually wrong

### 2.1 The guard was never handed the secret it checked for

`W0-T07`'s deviation 8 added `PREVIEW_DATABASE_URL` to `REQUIRED.preview` after noticing the
workflow consumed a secret the guard did not check. It added the name to the guard's list and
never added it to the preflight step's `env:`. The guard read `undefined`, reported it missing,
and set `configured=false`.

Both `deploy` and `destroy` are gated on that output, so **every preview deploy and every teardown
skipped — permanently, and regardless of what a human set in GitHub.** Observed on run
[34361193641](https://github.com/mastrobardo/marketplace/actions/runs/34361193641): all six
secrets present in the environment, guard reporting one missing, deploy skipped.

`tests/env-example.test.ts` was written to prevent exactly this and could not. It unions
`secrets.*` across the whole workflow directory and compares that set to `REQUIRED`, so a single
read anywhere in any file satisfies it. It proves a secret is *consumed* somewhere; it says nothing
about whether the guard *deciding on it* receives it.

### 2.2 `neonctl` was invoked and never installed

Both preview workflows call `neonctl`. Nothing installs it: it is in no dependency list and no
setup step. It would have failed with `command not found` — except both call sites end in a
blanket fallback (`|| echo "branch already exists — reusing it"` on create, `|| true` on delete).

So the failure mode was not a red build. It was: **the deploy reports success having created no
database, and the teardown reports success having deleted nothing** — leaving a Neon branch alive
and billing, which is the precise outcome the teardown workflow exists to prevent.

### 2.3 The deployed app was never given `DATABASE_URL`

`apps/api/src/config.ts` declares `DATABASE_URL: z.url()` with no default, so the API exits on
boot without it. All three deploy workflows set it as a *workflow* variable scoped to the migration
step, and none ran `flyctl secrets set` on the app. The migration would succeed, the deploy would
report success, and the container would crash-loop on a variable nobody gave it.

This one was latent in `preview`, `staging` **and** `production`.

## 3. Design decisions

### 3.1 A preview's database URL is returned, not configured

`PREVIEW_DATABASE_URL` is removed rather than wired in. A single static URL points every open pull
request at one shared database, which makes the per-PR Neon branch pointless and lets two PRs'
migrations corrupt each other. The connection string now comes back from
`neonctl connection-string` at deploy time, is masked with `::add-mask::`, and is passed to both
the migration and the Fly app.

It therefore stops being a secret a human sets — which is what `W0-T07`'s own comment predicted
`W0-T16` would do. It simply became load-bearing earlier than planned.

### 3.2 "Already exists" is tolerated; nothing else is

The blanket `||` on branch creation is replaced by an explicit `neonctl branches get` test. Re-running
a preview must be idempotent, so an existing branch is fine — but a missing binary and a missing
parent branch are not, and the old form could not tell the three apart.

The teardown keeps `|| true`. That is deliberate and documented in its header: a teardown that
fails because a resource is already gone is one that gets re-run and leaks the *others*.

### 3.3 The parent branch stays `sanitised-staging`

`W0-T20` (sanitisation) is open, so this branch may not exist yet. With §3.2 in place the failure
is now loud and named rather than swallowed, so the first run reports it precisely. Pointing
previews at unsanitised data to make the pipeline go green would invert ADR-006.

## 4. Acceptance criteria

| AC | Assertion |
|---|---|
| `AC28` | Every name in `REQUIRED[target]` appears in the `env:` of the guard step that checks it |
| `AC29` | Every CLI a workflow invokes has a corresponding setup or install step |
| `AC30` | Every variable `EnvSchema` requires without a default is set on the Fly app, not only on the migration step |

All three are per-workflow and fail the specific file, in `tests/cd-workflows.test.ts`.

## 5. Out of scope

- **`staging`**: the environment exists with no secrets. The guard reports all four correctly.
- **`production`**: the environment does not exist. `release-production.yml` remains untriggerable
  until a `v*` tag exists on a merged commit.
- **Neon branch-per-PR lifecycle** beyond create/delete — `W0-T16`.
- **Sanitising staging data** — `W0-T20`, and issue #156 holds that previews must not point at
  unsanitised data before its preview half is closed.
