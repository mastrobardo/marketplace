---
task:    W1-T07
agent:   agent-contracts
session: 2026-09-10T00:00:00Z
status:  closed
---

# Session — W1-T07

## Goal
One mechanism for moving anything between states: a declarative transition table with guards, a
rejection path for anything not declared, and an audit record written for every transition that
happens. Serves the six state machines `TODO.md` §3 names — Job, Booking, Payment, Auction,
EmergencyRequest, Certification.

## Current state
Branch `W1-T07-state-machine` cut from `origin/main` @ b9792c8. Nothing written yet.

## Log
- 00:05 Boot sequence done. `W1-T05` (schema) and `W1-T06` (money) are the two merged siblings;
  their specs are the style reference.
- 00:10 Read `TODO.md` §3: six state machines to serve, and an `AuditLog` sketched as
  `actor, action, entity, before/after, at`. This task builds the *transition* ledger; a
  general field-level audit log is a different thing and stays out of scope.
- 00:15 Boundary check. Charter `owns:` covers `packages/contracts/**`, `apps/api/prisma/**`,
  `docs/adr/**`. It does **not** cover `apps/api/src/**` and explicitly forbids
  `.github/workflows/**`. So the machine is pure and lives in contracts; the table and its
  migration live in prisma; nothing is written under `apps/api/src/`.
- 00:18 That boundary settles the design question of where the audit write happens: the seam
  cannot import Prisma (the web app imports the seam), so `transition` takes a recorder function
  and the caller binds it to its own transaction client.
- 00:20 **Escalation found before writing a line**: `.github/workflows/ci.yml:127-129` names the
  live suites by hand. A new file under `apps/api/tests/` does not run in the `database` job, and
  I may not edit that file. Recorded in the spec §10 as ESC-1. This is exactly what #174 exists
  to fix.
- 00:22 `prisma migrate reset` drops the schema, so an append-only trigger on `audit_record` does
  not break `pnpm db:reset`. TRUNCATE also bypasses row triggers. Checked before committing to
  the trigger.

- 00:40 Red: 26/26 failed, none vacuously. Held the trigger and CHECK out of the contract
  freeze so the DDL criteria could go red — promoted as MEM-2026-09-10-11.
- 00:52 Green: 26/26 pass, no test changed. Full local gate clean; no schema drift.
- 00:55 Trap worth the note: `prisma migrate diff --shadow-database-url` resets the shadow db,
  which drops PostGIS, so migration 0000 refuses and the diff dies with P3006. Use `--from-url`
  against a migrated database. Promoted to memory/repo/gotchas.md as MEM-2026-09-10-12.

## Blocked / escalations
ESC-1 (spec §10) is **open and non-blocking**. `.github/workflows/ci.yml` lines 127-129 name the
live suites by hand; `apps/api/tests/audit-record.test.ts` is not among them and this agent may not
edit that file (L4). AC22..AC26 therefore do not run in CI. They pass locally and the run record
carries that output. Resolution is one line from `agent-devops`, or #174 landing first.

## Handoff
Nothing is half-done. Spec, tests, implementation, migration, run record and memory are all on
`W1-T07-state-machine` and the full local gate is green.

**Next action**: open the PR and hand it to a reviewer (L6 — never merge your own). Then start
`W1-T09` (shared test factories in `packages/testing`), which is the agreed next task in the
series; `W1-T08` was dropped by the operator.

**Do not redo**: the red phase. It is captured in the run record and cost the only chance to get an
honest one — the trigger and CHECK are in the migration now, so re-running the tests against a
fresh database will pass, which proves nothing about whether they would catch a regression.

**Do not "fix"**: `check()` returning CONFLICT for a `from` the machine does not declare. It is a
known, deliberate gap recorded in the run record's self-assessment; changing it needs its own task
because no acceptance criterion covers it (L10).
