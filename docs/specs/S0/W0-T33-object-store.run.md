# W0-T33 — run record

- **Session**: 2026-09-26, `agent-devops`
- **Spec**: [W0-T33-object-store.md](W0-T33-object-store.md)
- **Outcome**: Garage replaces MinIO in the local stack; every stack image has a mirror workflow.

---

## 1. What the premise check found

The row offered four options. Checking them before choosing removed two, and it is the reason this
did not ship as a quay robot account:

```
$ curl -sI https://dl.min.io/server/minio/release/linux-amd64/minio
HTTP/2 410
410 Gone
The open-source MinIO Server, MinIO Client (mc) and MinIO KES projects are
archived and no longer maintained. MinIO does not provide product support,
security updates, or security advisories for them…

$ gh api repos/minio/minio --jq '.archived, .pushed_at'   # and repos/minio/mc
true  2026-04-24T17:54:39Z
```

Candidate availability was checked the same way rather than assumed — anonymous token, then
manifest, then the platform list off the index. Public and multi-arch on 2026-09-26:
`dxflrs/garage` (v2.4.1, v2.2.0, v2.1.0), `chrislusf/seaweedfs` 4.47, `adobe/s3mock`,
`localstack/localstack`, `amazon/aws-cli` 2.37.4, plus the stack's existing `imresamu/postgis` and
`axllent/mailpit`. `minio/minio` answers 401 on Docker Hub and `openmaxio/openmaxio` does too.

## 2. What was measured before anything was written

A throwaway single-node Garage, driven by hand, because four design questions had answers I was not
willing to guess:

| Question | Measured |
|---|---|
| Does the image have a shell? | **No.** `exec: "/bin/sh": stat /bin/sh: no such file or directory` — `FROM scratch`, `Cmd` is `["/garage","server"]` |
| What does health mean before a layout exists? | `GET /health` → **503**; `garage health` → **exit 1**; `garage status` → `NO ROLE ASSIGNED`. After `layout apply`: 200 and exit 0 |
| Can a second container learn the node id? | **Yes** — `garage node id -q` with the metadata volume mounted **read-only**, while the server holds LMDB open |
| Is the bootstrap safe to re-run? | **No, as written**: `key import` and `bucket create` exit 1 when the thing exists — hence asking first |
| Does S3 actually serve? | **Yes** — `PUT`, `LIST` and `GET` round-tripped with the imported key |

The health measurement is what moved the layout out of `objects-init` and into the server's
entrypoint: `objects-init` waits for `service_healthy`, so provisioning the layout there would have
been a service waiting for itself. That deadlock never shipped because the 503 was measured, not
reasoned about.

## 3. Verification

```
$ pnpm stack:up                                  # cold: no image, no volumes
objects-init: imported key marketplace-local
objects-init: created bucket marketplace-uploads
objects-init: marketplace-uploads ready
pnpm stack:up  15.162 total                      # including both image pulls and the build

$ pnpm stack:up                                  # again
objects-init: key marketplace-local already imported
objects-init: bucket marketplace-uploads already exists
pnpm stack:up  2.002 total

$ docker compose ps
db running healthy | mail running healthy | objects running healthy
objects  127.0.0.1:9000->3900/tcp, 127.0.0.1:9001->3903/tcp

$ STACK_LIVE=1 pnpm vitest run tests/local-stack.test.ts
Tests  15 passed (15)

$ pnpm vitest run tests/                         # default, no daemon needed
Tests  322 passed | 6 skipped (328)

$ STACK_LIVE=1 pnpm --filter @marketplace/api exec vitest run
Tests  571 passed (571)

$ pnpm typecheck && pnpm format:check && pnpm gates
10 successful | All matched files use Prettier code style | agents-drift: ok
```

`docker build --no-cache` on `docker/garage` is **2.9s** — it is a `COPY`, so CI's `database` job
(`timeout-minutes: 15`) is in no danger from building the image on every run.

## 4. Two things the run got wrong, and what caught them

**A recreate nobody asked for.** On a cold run, `docker compose run --rm objects-init` recreated the
`objects` container *after* `up --wait` had already reported it healthy — Garage restarted the
moment before it was provisioned. Provisioning survived it, which is exactly why it was worth fixing
rather than leaving: it is a race that passes. `stack:up` now builds explicitly first
(`docker compose build --quiet objects && …`), which removes the recreate and, incidentally, took the
cold path from 15.2s to 7.7s.

**`.env.example` named five variables nothing reads.** The first draft added `S3_ENDPOINT`,
`S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` so that `W6` would inherit
names instead of inventing them. `tests/env-example.test.ts` failed: *".env.example mentions
S3_ENDPOINT, which nothing reads"*. The guard is right and the reasoning was speculation, so the
variables are gone and the credentials are documented where `provision.sh` creates them.

One non-finding, recorded so it is not re-diagnosed: 28 `apps/api` tests failed with `sign-up
failed: expected 500 to be less than 400` until the suite was pointed at **5433**. This machine's
`.env` sets `POSTGRES_PORT=5433` while CI uses 5432, so the run had been talking to an unrelated
Postgres. Already a known gotcha (`MEM-2026-09-17-8`), and re-learned anyway.

## 5. What is not verified here

**The mirror workflow has not run.** It needs a push to `main` or a manual dispatch, and its
packages are published under the operator's account, so it is theirs to trigger. Two consequences:

1. `docker-compose.yml` and `docker/garage/Dockerfile` still reference the upstream images. The
   repoint to `ghcr.io/mastrobardo/marketplace/…` is a follow-up commit once the copies exist.
2. **GHCR packages are created private**, and the built-in `GITHUB_TOKEN` cannot change that — it
   needs a PAT or one click per package in *Settings → Packages → Change visibility*. Four packages,
   once, and until then a clone that pulls from the mirror would need `docker login ghcr.io`. This is
   the one step in this ticket a human has to do, and the reason the repoint is not in this commit.
