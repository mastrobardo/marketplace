---
task:    W0-T33
agent:   agent-devops
session: 2026-09-26
status:  open
---

# Session — W0-T33

## Goal
Replace the frozen MinIO pin `#292` landed as a stopgap with an object store this repo can still
pull next month, and resolve `W0-T27` (mirror the stack's images) with it rather than beside it.

## Current state
Implemented and verified locally; the mirror workflow has not been run. See
`docs/specs/S0/W0-T33-object-store.run.md` for the full verification transcript.

- `objects` is **Garage v2.4.1**, built in `docker/garage/` (upstream binary on Alpine, because the
  upstream image is `FROM scratch` and has no shell).
- Cold `pnpm stack:up` 7.7s, warm 2.0s. `tests/local-stack.test.ts` 15/15 live, repo suites 322
  passed / 6 skipped, `apps/api` 571/571 under `STACK_LIVE=1`, typecheck + prettier + gates clean.
- `.github/workflows/mirror-images.yml` + `docker/mirror.images` exist; **compose still points at
  the upstream images** on purpose (see Handoff).

## Log
- 14:2x Re-checked the row's premise before choosing, and it had moved: `dl.min.io` answers **410
  Gone** and both MinIO repos report `"archived": true`. That retired two of the four options the
  row was filed with — a quay robot account buys an *archived* server, and there is no released
  binary left to build our own image from.
- 14:4x Operator: **"NO AWS … will never."** Dropped the `amazon/aws-cli` provisioner that the plan
  had; provisioning is Garage's own CLI from the same image. Recorded as `MEM-2026-09-26-3`,
  including the `aws4fetch`-over-`@aws-sdk/client-s3` steer for whichever slice uploads first.
- 14:5x Operator asked about **Cloudflare Durable Objects**. Wrong primitive — stateful compute with
  transactional storage, reachable only from a Worker via a binding, no S3 endpoint. R2 is the
  Cloudflare object store and ADR-006 already chose it; the open question was only the local
  stand-in. Two real Cloudflare-shaped options were put up (a real R2 dev bucket; wrangler's
  experimental local R2 over S3, `wrangler@4.115.0`, July 2026) and the operator chose Garage.
- 15:1x Stood a throwaway Garage up by hand before writing any compose. Four measurements, all
  load-bearing: no shell in the image; `/health` is **503** until a layout is applied; `garage node
  id -q` works from a second container with the metadata volume read-only; `key import` /
  `bucket create` exit 1 when the thing exists. The 503 is what moved layout assignment into the
  server's entrypoint — `objects-init` waits on `service_healthy`, so doing it there deadlocks.
- 15:3x Proved S3 really serves (`PUT`/`LIST`/`GET` round trip) before trusting the design.
- 19:5x Dead end worth not repeating: a cold `stack:up` had `docker compose run --rm objects-init`
  **recreate** the healthy `objects` container — a race that passes. `stack:up` now builds
  explicitly first; recreate gone, cold path 15.2s → 7.7s.
- 20:0x `tests/env-example.test.ts` refused the five `S3_*` variables the first draft added for `W6`
  to inherit: *"mentions S3_ENDPOINT, which nothing reads"*. The guard is right — speculation
  removed, credentials documented where `provision.sh` creates them.
- 20:0x Self-inflicted: 28 `apps/api` failures (`sign-up failed: expected 500 to be less than 400`)
  were a suite pointed at 5432 while this machine's `.env` uses `POSTGRES_PORT=5433`. Already in
  `MEM-2026-09-17-8`; re-learned anyway.

## Blocked / escalations
Nothing blocked. One human step outstanding, by design — see Handoff.

## Handoff
**Next action**: push the branch, open the PR, then **dispatch `mirror-images`** and make the four
GHCR packages public (*Settings → Packages → Change visibility*) — `GITHUB_TOKEN` cannot do it
(`MEM-2026-09-26-5`). Then, and only then, repoint `docker-compose.yml` and
`docker/garage/Dockerfile` at `ghcr.io/mastrobardo/marketplace/…` and verify with an **anonymous**
pull (`docker logout ghcr.io` first). `W0-T27` stays open until that repoint lands.

**Do not redo**: the option analysis (spec §2 — five options with the evidence that retired each),
the four hand-measurements (run record §2), or the local verification. Do not reintroduce MinIO or
`mc` in any form, and do not add `amazon/aws-cli` or `@aws-sdk/client-s3`.
