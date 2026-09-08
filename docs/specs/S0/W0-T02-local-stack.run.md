# Run record — W0-T02 local stack

|                  |                                                                |
| ---------------- | -------------------------------------------------------------- |
| **Agent**        | `agent-devops`                                                  |
| **Model**        | `claude-opus-5`                                                 |
| **Charter rev**  | 1                                                               |
| **Skills used**  | `test-driven-development`, `ci-cd-and-automation`, `incremental-implementation`, `security-and-hardening`, `git-workflow-and-versioning` |
| **Started**      | 2026-09-09T00:05Z                                               |
| **Finished**     | 2026-09-09T00:35Z                                               |
| **Branch**       | `W0-T02-local-stack` (from `main` @ a0dbbc5)                    |
| **Issue**        | https://github.com/mastrobardo/marketplace/issues/34            |
| **Spec**         | [`W0-T02-local-stack.md`](W0-T02-local-stack.md)                |
| **Session file** | `memory/sessions/2026-09-09-agent-devops-W0-T02.md`             |

---

## Prompts

### 1. Task assignment (operator, verbatim)

> continue with the task. For this session: go from w0-t1 to W0-T04 directly. Branch the  3
> branches from main. Everything is autoapproved, however be sure to include a plan step before
> each execution. The plan will be reported on the run file

Three instructions, all structural: skip nothing between `W0-T01` and `W0-T04`; branch all three
independently from `main` rather than stacking them; and keep the plan-before-execution step from
`rules/workflows.instructions.md`, but as a *recorded* artifact rather than a blocking question.
No design steer was given, so every choice below is the agent's and is argued in the spec.

### 2. Plan (agent, presented before any file was written)

Recorded here because the operator asked for the plan step to live in the run record:

> 1. Branch `W0-T02-local-stack` from `main`.
> 2. Spec → `docs/specs/S0/W0-T02-local-stack.md`.
> 3. Open session memory `memory/sessions/2026-09-09-agent-devops-W0-T02.md`.
> 4. **Red**: `tests/local-stack.test.ts` — static assertions over `docker-compose.yml` (services,
>    pinned images, healthchecks, named volumes, no real secrets) plus live assertions gated on
>    `STACK_LIVE=1`. Observe failure.
> 5. **Green**: `docker-compose.yml`, Postgres init SQL enabling PostGIS, root `stack:*` scripts.
> 6. Bring the stack up for real, run the live suite, paste both transcripts.
> 7. Full `pnpm verify`.
> 8. Run record (this plan included), session handoff, memory promotion.
> 9. Commit, push, PR against issue #34 — not merged.

The plan was followed. Step 5 acquired one item not in it — making every host port overridable —
for the reason in *Deviations*.

### 3. Corrections

No corrective re-prompt from the operator. Four reversals happened inside the task, all driven by
tool output rather than by a human saying the output was wrong; they are in *Deviations*.

---

## Red phase

The static criteria (1–7), with no `docker-compose.yml`, no `docker/` and no `stack:*` scripts:

```
 × AC1 — the stack declares exactly the services the MVP needs > declares db, mail, objects and one bucket provisioner 3ms
 × AC2 — every image is pinned > pins every image to an explicit tag 1ms
 × AC3 — nothing is reachable from outside this machine > binds every published port to the loopback interface 0ms
 × AC4 — the stack is up only when it is actually usable > gives every long-running service a healthcheck 0ms
 × AC4 — the stack is up only when it is actually usable > makes the bucket provisioner wait for a healthy object store 0ms
 × AC5 — data survives a restart > persists database and object data in named volumes 0ms
 × AC6 — the compose file holds no real credential > contains nothing shaped like a real secret 0ms
 × AC6 — the compose file holds no real credential > uses low-entropy local placeholders for every credential 0ms
 × AC7 — one command up, one command down, one command clean > exposes stack:up, stack:down, stack:reset and stack:logs at the root 0ms
 ↓ AC8/AC9 … ↓ AC12   (skipped — STACK_LIVE unset)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  9 failed | 6 skipped (15)
```

A gated test that is only ever skipped is not a red phase, so the live criteria (8–12) were also
observed failing, with the compose file present but the stack down:

```
 × AC8/AC9 — a real database with real geography > accepts a connection as the application user 80ms
 × AC8/AC9 — a real database with real geography > exposes PostGIS in the application database 67ms
 × AC10 — mail is captured, never delivered > captures a message submitted over SMTP 66ms
 × AC11 — object storage is live and provisioned > reports the object store live 65ms
 × AC11 — object storage is live and provisioned > creates the uploads bucket 372ms
 × AC12 — the stack reports itself healthy > has every long-running service healthy 63ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  6 failed | 9 passed (15)
```

All fifteen assertions have been observed red.

## Green phase

```
$ pnpm stack:up
 Container marketplace-mail-1     Healthy
 Container marketplace-objects-1  Healthy
 Container marketplace-db-1       Healthy
Added `local` successfully.
Bucket created successfully `local/marketplace-uploads`.
Access permission for `local/marketplace-uploads` is set to `private`
objects-init: marketplace-uploads ready

$ STACK_LIVE=1 pnpm vitest run tests/local-stack.test.ts --reporter=verbose
 ✓ AC1  … declares db, mail, objects and one bucket provisioner 7ms
 ✓ AC2  … pins every image to an explicit tag 2ms
 ✓ AC3  … binds every published port to the loopback interface 2ms
 ✓ AC4  … gives every long-running service a healthcheck 4ms
 ✓ AC4  … makes the bucket provisioner wait for a healthy object store 1ms
 ✓ AC5  … persists database and object data in named volumes 4ms
 ✓ AC6  … contains nothing shaped like a real secret 0ms
 ✓ AC6  … uses low-entropy local placeholders for every credential 1ms
 ✓ AC7  … exposes stack:up, stack:down, stack:reset and stack:logs at the root 1ms
 ✓ AC8  … accepts a connection as the application user 259ms
 ✓ AC9  … exposes PostGIS in the application database 112ms
 ✓ AC10 … captures a message submitted over SMTP 155ms
 ✓ AC11 … reports the object store live 70ms
 ✓ AC11 … creates the uploads bucket 336ms
 ✓ AC12 … has every long-running service healthy 71ms

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Duration  1.14s

$ pnpm verify       # typecheck · lint · format:check · test · build
 Test Files  3 passed (3)
      Tests  31 passed | 6 skipped (37)
verify -> 0
```

The 6 skips in `pnpm verify` are the live criteria: the default gate needs no Docker daemon, which
is what keeps `W0-T06` free to decide whether CI runs the stack at all.

## Deviations from spec

Four. Two are image substitutions already argued in the spec's §10; two were forced by tool
behaviour discovered while bringing the stack up.

1. **Mailpit replaces MailHog** (`TODO.md` §6 names MailHog). MailHog is archived and its final
   release publishes a single-architecture `amd64` image; verified directly —
   `docker manifest inspect mailhog/mailhog:v1.0.1` returns a v2 manifest with no platform list,
   while `axllent/mailpit` returns `386/amd64/arm64`. On the operator's arm64 machine MailHog runs
   under emulation. Mailpit is the maintained successor with the same SMTP-catcher + JSON-API
   shape the acceptance criteria need. **No acceptance criterion changed.**

2. **`imresamu/postgis` replaces `postgis/postgis`.** Same problem, verified the same way:
   `postgis/postgis:17-3.5` (and `:18-3.6`, and the `-alpine` variants) list `amd64` only.
   `imresamu/postgis` is the multi-architecture build from the same maintainer. Recorded as a repo
   gotcha with the condition to switch back.

3. **Every published host port became overridable.** Not in the plan. `pnpm stack:up` failed with
   `Bind for 0.0.0.0:5432 failed: port is already allocated` — an unrelated container from another
   project on this machine already held 5432. Telling the developer to stop their other work is not
   a fix, so each port is now `127.0.0.1:${VAR:-<conventional>}:<container>`; the documented
   defaults are unchanged, and services still reach each other by container name regardless.
   AC3's assertion was widened from a literal `\d+` to accept the `${VAR:-\d+}` form, and the live
   tests now ask `docker compose port` where a service actually landed rather than assuming.

4. **`stack:up` is two commands, not one.** `docker compose up --detach --wait` exits **1** when a
   one-shot container finishes — even at exit code 0 (`container marketplace-objects-init-1 exited
   (0)`, then a non-zero exit). So the script waits on the three long-running services and then
   runs the provisioner as its own step, which has the side benefit of surfacing the provisioner's
   exit code directly instead of hiding it in `--wait`'s verdict.

Two test-side corrections, both fixing an assertion that encoded a guess rather than the
requirement:

- **AC11** read the object-store credentials from the provisioner's own environment under invented
  names (`MC_HOST_USER`). `MC_HOST_<alias>` is a real `mc` variable with a different meaning, so
  those names were a latent trap. The test now reads `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
  from the `objects` service — the names the image mandates, so there is nothing left to guess.
- **AC10** was written as a hand-rolled SMTP conversation to avoid pulling in a mail library for
  one assertion. The first version advanced only on `2xx` replies and therefore hung at `DATA`,
  which answers `354`. Fixed to advance on any non-error final reply, and to buffer by line so a
  multi-line `EHLO` response is parsed correctly rather than by chance.

## Human input received

- The task assignment in *Prompts §1*, including the standing "everything is autoapproved"
  authorisation, which is why the plan in §2 was recorded rather than used as a blocking question.
- Nothing else. No credential, account or value was supplied or needed — the stack is entirely
  local by construction.

## Notes for the reviewer

- **`.env` exists in the working tree of the machine this ran on** (`POSTGRES_PORT=5433`), because
  5432 was occupied. It is gitignored and deliberately not committed. On a machine with a free
  5432, no `.env` is needed at all.
- **The credentials in `docker-compose.yml` are real credentials for a service bound to loopback**,
  and that is the intended design, not an oversight. AC6 exists to keep it that way: it fails if
  anything in the file acquires the shape of a real secret, and it fails if a credential stops
  looking like an obvious placeholder.
- **`postgis_topology` is enabled alongside `postgis`.** Nothing in the MVP uses it yet. It is
  enabled at init because enabling an extension later needs superuser rights the application role
  will not have on Neon, and the cost of carrying it is a few hundred kilobytes.

## Self-assessment

- **Weakest part of this change**: the local stack and the deployed stack are now two different
  things that nothing checks against each other. Local is Postgres 17 in a container with an ICU
  `es-ES` collation; ADR-006 says Neon. A collation or extension difference between them will not
  be caught by any test here — it will be caught by `W0-T05`'s first migration failing on staging.
  A `prisma migrate diff` gate against a Neon branch (`W0-T06`) is the real answer.
- **Second weakest**: AC6's placeholder check is a heuristic — `/^[a-z0-9_]{8,32}$/` — and a real
  secret that happened to be lowercase and short would pass it. It is a nudge in the same spirit as
  the money-is-cents lint rule; the actual guard is the `secret scan` gate in `W0-T06`.
- **What a reviewer should look at hardest**: the two image substitutions. They are the decisions a
  future agent will inherit silently, and both are third-party namespaces rather than the canonical
  ones. The evidence for each is a `docker manifest inspect` anyone can re-run, and both carry a
  documented condition for switching back.
- **What I would tell the next agent working in this slice**: `pnpm stack:up` is the whole setup,
  and if it fails on a port, put an override in `.env` rather than fighting it. The live tests are
  the template for any integration test you write — gate on `STACK_LIVE`, ask
  `docker compose port` for addresses, and never hardcode a host port.
- **Not verified**: nothing runs in CI (`W0-T06`). The static criteria are daemon-free by design so
  CI can adopt them immediately, but no workflow references them yet. The stack has also only ever
  been run on arm64 macOS — the `amd64` path is asserted by the image manifests, not exercised.
