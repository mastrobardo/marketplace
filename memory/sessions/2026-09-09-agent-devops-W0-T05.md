---
task:    W0-T05
agent:   agent-devops
session: 2026-09-09T09:00Z
status:  closed
---

# Session — W0-T05

## Goal
Prisma toolchain in `apps/api`: datasource + client factory, a migration history with an enforced
rollback convention, and an idempotent seed scaffold. **No domain models** — the seam stays empty
for `W1-T05`.

## Current state
**Done.** All 21 acceptance criteria pass: 39 static + 8 live. `pnpm verify` green.

## Log
- 09:00 operator assignment: run W0-T05 → W0-T06 → W0-T07 in one session, everything autoapproved.
  Operator flagged in advance that the GitHub Actions in W0-T07 will not run on their own PR.
- 09:05 sequencing decision: **strictly sequential**, merge each PR before cutting the next.
  W0-T06 and W0-T07 both write `.github/**` and would genuinely collide; MEM-2026-09-09-12 says
  even branches sharing no source file conflict on README/memory/lockfile.
- 09:10 scope decision: schema.prisma ships with **zero domain models**. AGENTS.md L3 freezes the
  seam and W1-T05 owns the models. This task is the mechanics around them.
- 09:15 chose to put the seed ledger (`SeedRun`) *in* schema.prisma rather than in raw SQL outside
  it: a table created by a migration but missing from the schema makes `prisma migrate dev` report
  drift forever, which trains agents to ignore drift. Flagged to agent-contracts in spec §10.
- 09:20 first migration **asserts** PostGIS rather than creating it — `CREATE EXTENSION` needs
  rights the app role has in no environment (see docker/postgres/init comment). Turns a one-time
  setup into a per-deploy precondition check.

- 09:28 `prisma migrate diff` rejected `--schema` and printed usage — the drift assertion read the
  exit code as drift. False positive, not a real failure. MEM-2026-09-09-16.
- 09:33 `pnpm verify` green; live suite 29/29 against `pnpm stack:up`.

## Blocked / escalations
None. Nothing in this task needed a human.

## Handoff
`W0-T05` is complete and merged. Next is `W0-T06` (CI) on its own branch — do **not** start it
until this PR is merged, because `T06` and `T07` both write `.github/**`.

Two things `W0-T06` inherits and should not rediscover:
- `pnpm verify` is daemon-free and can be lifted into CI unchanged.
- The live database tests are behind `STACK_LIVE=1` and need Postgres **with PostGIS** — migration
  `0000` fails deliberately without it, so a plain `postgres:17` service container will not do.
