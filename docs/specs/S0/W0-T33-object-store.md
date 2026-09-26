# W0-T33 — An object store this repository can still pull next month

- **Slice**: S0 Platform (`agent-devops`)
- **Decides**: what stands in for Cloudflare R2 in the local stack, now that MinIO cannot, and where
  the stack's images are pulled from. Resolves `W0-T27` with it rather than beside it.
- **Unblocks**: nothing today — no slice uploads a file before `W6`. It un-breaks `pnpm stack:up`
  permanently instead, which is what the operator made top priority on 2026-09-26.

---

## 1. Purpose

`#292` unblocked the stack by pinning Bitnami's frozen builds of MinIO, and filed itself as a
stopgap: a frozen image gets no security patch, ever. This is the ticket that was supposed to choose
something durable. The first thing it did was re-check the premise, and the premise had moved.

**MinIO's open-source server no longer exists as something to depend on.** Verified 2026-09-26:

| Check | Result |
|---|---|
| `dl.min.io/server/minio/release/linux-amd64/minio` | **410 Gone** — *"The open-source MinIO Server, MinIO Client (mc) and MinIO KES projects are archived and no longer maintained. MinIO does not provide product support, security updates, or security advisories for them"* |
| `github.com/minio/minio` API | `"archived": true`, last push 2026-04-24 |
| `github.com/minio/mc` API | `"archived": true` |
| `quay.io/minio/minio` manifest, anonymous | token issued, then **401** — re-confirmed from `#292` |

That retires one of the four options this row was filed with. **Authenticating to quay with a robot
account was never the durable answer**: the credential buys an archived server, so it pays the cost
of ending *clone and run* and still leaves the security objection standing. The same reasoning
retires building our own image from the released binary — there is no binary to build from.

## 2. What was chosen, and against what

**Garage v2.4.1** (Deuxfleurs, released 2026-09-08), in the container slot MinIO occupied, with
every stack image mirrored into this repository's own registry.

| Option | Why not |
|---|---|
| Robot account on quay.io | Archived upstream: the credential buys an unmaintained server (§1) |
| SeaweedFS 4.47 | Maintained and public, and the simplest swap — one container, static credentials. Its S3 surface is a gateway over a distributed filesystem, with more dialect gaps than Garage's, so an uploads bug could be the gateway rather than our code |
| `adobe/s3mock`, `localstack/localstack` | A mock. `W6` would develop against something that is not an object store |
| Point dev and CI at a real R2 bucket | Maximum fidelity — it *is* production's service (ADR-006) — but every clone and the CI `database` job then need credentials and network, and concurrent runs share one bucket. *Clone and run* becomes *clone, get credentials, run* |
| wrangler/miniflare's local R2 over S3 | Real, and newer than this row: `wrangler@4.115.0` / `@cloudflare/vite-plugin@1.48.0`, announced July 2026 — but **experimental**, documented in draft, and built around a Workers dev server while `apps/api` is Fastify on Fly. Worth revisiting when it is stable |
| Drop object storage until `W6` | Cheapest today, and nothing in the product touches it. Returns the same decision later, under deadline, with *clone and run* broken in the meantime |

**Cloudflare Durable Objects are not a candidate and not an oversight.** They are stateful compute —
an actor with transactional SQLite/KV storage, addressed by name and reachable only from a Worker
through a binding. There is no S3 endpoint and no credentialed HTTP API, and the storage is for
coordination state, not licence PDFs. R2 is Cloudflare's object store and ADR-006 already chose it
for staging and production; the only open question was what stands in for it locally.

### 2.1 No AWS

**Operator, 2026-09-26: *"NO AWS. I dont use aws for personal projects and will never."*** This is a
constraint on the stack, not a preference to route around, and it is why provisioning does not use
`amazon/aws-cli` — the obvious server-agnostic provisioner and the shape this spec was first drafted
with. Provisioning uses Garage's own CLI instead, which is one fewer image in the stack anyway.

It reaches past this ticket: talking to R2 means SigV4 either way, but it does **not** require AWS's
SDK. `aws4fetch` is the small non-AWS signer for exactly this, and the slice that first uploads a
file should reach for it rather than `@aws-sdk/client-s3` (`memory/repo/decisions.md`).

## 3. Design

### 3.1 The image is built here, and the binary is upstream's

Garage ships `FROM scratch` — the binary and nothing else, verified: `/bin/sh` does not exist in
`dxflrs/garage:v2.4.1`. Both the server and the provisioner need a shell, so `docker/garage/`
carries a four-line Dockerfile that copies that same binary, from a pinned digest, onto Alpine.

Neither image this is made of can be withdrawn out from under the stack again, because §3.4 holds a
copy of both.

### 3.2 The layout is the node's business, not the provisioner's

A fresh Garage node answers RPC immediately and refuses reads and writes until a cluster layout
gives it a role. Measured, not assumed: in that window `GET /health` answers **503** and
`garage health` exits **1**.

That is a deadlock if the layout is provisioned from `objects-init`, because `objects-init` waits for
`service_healthy` (`W0-T02` AC4). So `docker/garage/entrypoint.sh` assigns the role on first boot,
before anything else can care, and reads the version `layout apply` demands back out of
`layout show` rather than assuming `1`. `objects-init` then does only what is about this
application: the S3 key and the bucket.

The healthcheck is `garage health`, which means **"healthy" is strictly later than "started"** and
carries the same claim `mc ready local` did.

### 3.3 Private by default is structural here

There is no `mc anonymous set none` to port, because Garage refuses anonymous requests outright
(`Forbidden: Garage does not support anonymous access yet`). The bucket is reachable only by the one
key `provision.sh` grants `--read --write`, so ADR-006's private-by-default is a property of the
server rather than a policy a script has to remember to set.

`objects-init` is idempotent by asking first: `key import` and `bucket create` both exit 1 when the
thing exists, and this service runs on every `stack:up`.

### 3.4 One copy of everything, held by this repository (`W0-T27`)

`docker/mirror.images` lists every third-party image the stack is made of, and
`.github/workflows/mirror-images.yml` copies each into `ghcr.io/mastrobardo/marketplace/…` with the
built-in `GITHUB_TOKEN` — no external account. `docker buildx imagetools create` copies server-side,
so no layer passes through the runner and the multi-architecture index survives; a step then fails
the run if a copy lost `linux/amd64` (CI) or `linux/arm64` (every laptop here).

This row was deprioritised once, on the reasoning that digest pinning makes a re-pointed tag fail
loudly. True, and aimed at the wrong failure: a pin detects an image that **changed** and survives
nothing about one that was **withdrawn**, which is what has now happened three times. A copy we hold
is the only measure that would have made any of the three a non-event.

### 3.5 Ports

Garage's own ports are S3 `3900` and admin `3903`. `OBJECTS_PORT` still publishes S3 on `9000`, so
nothing outside `docker-compose.yml` had to learn a new number. There is no web console to replace
MinIO's, so `OBJECTS_CONSOLE_PORT` becomes `OBJECTS_ADMIN_PORT` — the admin API's `GET /health` is
the one object-store signal a human can check from the host.

## 4. Acceptance criteria

`W0-T02`'s twelve criteria are the contract and they keep their claims; three change mechanism only.

1. **AC1–AC4, AC7, AC8–AC10, AC12 pass unchanged.** Four services, every image tagged, every port on
   loopback, a healthcheck on each long-running service, and the provisioner waiting on health.
2. **AC5 follows the data.** `objects` persists `/var/lib/garage/data` in a named volume; the
   metadata database gets its own. The claim is still *a named volume holds the object data*.
3. **AC6 covers where the credentials actually live.** Garage's formats (`GK` + 24 hex; a 64-hex
   secret) cannot satisfy the lowercase-placeholder rule, so they live in `docker/garage/` and the
   secret-shape scan reads those files too. The alternative was weakening the check to let them
   through.
4. **AC11 is Garage's liveness and Garage's bucket listing.** `GET /health` on the admin port, and
   `garage bucket list` addressed at the node whose id comes from the metadata volume.
5. **`.env.example` names no variable nothing reads.** `tests/env-example.test.ts` enforces it; the
   S3 credentials are documented where they are created instead.
6. **A cold `pnpm stack:up` is healthy and provisioned**, and a second one is a no-op.
7. **The mirror preserves both architectures**, or the workflow fails.
