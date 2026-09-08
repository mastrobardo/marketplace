---
task: W0-T02
agent: agent-devops
session: 2026-09-09
status: closed
---

# Session — W0-T02 local stack

## Goal

`docker compose up` gives a PostGIS database, a mail catcher and S3-compatible object storage on
localhost, so slice agents can write integration tests before any cloud account exists.

## Starting state

`main` at a0dbbc5 (W0-T01 merged). No `docker-compose.yml` anywhere in the repo. Branch
`W0-T02-local-stack` off `main`. Docker 28.3.2 / Compose v2.38.2 running on an arm64 mac.

## Log
- Chose Mailpit over MailHog and `imresamu/postgis` over `postgis/postgis`: both canonical images
  are amd64-only, verified with `docker manifest inspect`. → `memory/repo/gotchas.md` MEM-2026-09-09-01.
- Red: 9 static assertions failed with no compose file. Then took the stack down and ran with
  `STACK_LIVE=1` so the 6 live assertions were observed red too — a gated test that is only ever
  skipped is not a red phase.
- Dead end: `docker compose up --detach --wait` exits 1 when the one-shot bucket provisioner
  finishes at 0. No per-service opt-out exists. Split `stack:up` into wait-then-provision.
  → slice memory MEM-2026-09-09-03.
- `pnpm stack:up` failed on this machine: an unrelated project's container already held 5432. Made
  every host port `${VAR:-default}` rather than asking the operator to stop their other work.
  → slice memory MEM-2026-09-09-04. This machine now has a gitignored `.env` with POSTGRES_PORT=5433.
- Dead end that cost the most time: AC10 "timed out in 5000ms" while passing in isolation. It was
  not a hang — Vitest 5 silently ignores `it(name, fn, 30_000)`; only `{ timeout }` as the second
  argument works. → `memory/repo/gotchas.md` MEM-2026-09-09-02.
- `pnpm verify` exits 0: 31 passed, 6 skipped (the live criteria, correctly gated off).

## Handoff
`W0-T02` is complete and green; the PR is open and **not merged** (L6 — needs cross-review by
`agent-contracts` or `agent-qa`).

**What the next agent inherits**
- `pnpm stack:up` is the whole local setup. Postgres `marketplace/marketplace_local` on 5432,
  database `marketplace`, `postgis` + `postgis_topology` already enabled. Mailpit UI on 8025 with
  a JSON API at `/api/v1/messages`. MinIO on 9000, bucket `marketplace-uploads`, private.
- If a port is taken, put an override in `.env` — do not edit `docker-compose.yml`.
- `tests/local-stack.test.ts` is the template for every integration test in this repo: gate live
  work behind an env flag, resolve addresses with `docker compose port`, never hardcode.
- **`W0-T05` must not try to `CREATE EXTENSION`** — `docker/postgres/init/01-postgis.sql` does it
  at container init, because the application role will not have that right on Neon either.

**Next**: `W0-T03` (Fastify skeleton) and `W0-T04` (web skeleton) are independent of this and of
each other. `W0-T06` (CI) should follow: the static criteria here are daemon-free on purpose so CI
can adopt them immediately, but nothing references them yet.

**Open, not blocking**: local Postgres and Neon are not checked against each other. A collation or
extension divergence will surface as a `W0-T05` migration failure on staging, not as a test failure
here. A `prisma migrate diff` gate against a Neon branch is the real fix and belongs to `W0-T06`.
