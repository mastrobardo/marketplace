---
task:    W3-T02
agent:   agent-providers
session: 2026-09-18
status:  closed
---

# Session — W3-T02

## Goal
The provider profile write path: `GET`/`PUT /api/providers/me`, the first guarded route in the
API — and the migration that makes `base_address_id` `NOT NULL`, so the state `W3-T07` answers
`404` for stops existing.

## Current state
- `main` at `3a9cca1` (`W2-T03`, #263 merged). Branch `W3-T02-provider-profile-write`.
- The guard exists and has **no consumer**: `guards.requirePermission('provider-profile:update-own')`
  is already the one row in `apps/api/src/modules/auth/permissions.ts`, shipped with `W2-T03`. This
  ticket is what makes the cell mean something; the matrix does not grow.
- `packages/contracts/src/provider.ts` holds only the **read** projection. No write schema exists,
  and `packages/contracts/**` is forbidden to this slice — the operator approved making the seam
  edit in this PR (2026-09-18), so it is made as `agent-contracts` and said so in the spec.
- Nobody can currently sign in *and* own a profile: `auth-demo-users`' `2222…` has credentials and
  no `provider_profile` row; `demo-providers`' five profiles have no credentials. Operator's answer:
  **upsert** — the first write creates the row.

## Log
- 12:xx operator settled four things up front: branch off merged `main`; `PUT /me` upserts; the
  `NOT NULL` migration lands in this PR; working hours stay with `W3-T09` (no columns exist).
- 12:xx found the migration's real cost before writing it: `packages/testing`'s
  `buildProviderProfile` defaults `baseAddressId: null` (`builders.ts:143`), so **every**
  factory-created profile would fail to insert — `factories-live`, `provider-live` and
  `search-live` all break unless `createProviderProfile` composes an address the way
  `createProviderCategory` already composes its parents.
- 12:xx and two live assertions describe a state that stops existing: `provider-live.test.ts:198`
  ("has nothing to serve for a provider with no base address") and half of `W3-T05` AC6. They get
  re-homed onto the schema, the way `W3-T10` re-homed the deleted handlers' criteria.

## Blocked / escalations
None.

## Handoff

**`W3-T02` is complete.** The contract (write + own schemas), migration `0009`, `schema.prisma`,
`write-repository.ts`, both routes, the composition root, `packages/testing`, five updated suites,
the spec, the run record, `TODO.md` and the memory promotions are on
`W3-T02-provider-profile-write`.

Gates: typecheck 10/10 · lint clean · format:check clean · build 6/6 · `apps/api` **286** under
`STACK_LIVE=1` (19 files, 257 before) · contracts 227 · web 230 · ui 255 · testing 33 · root 283 ·
`pnpm db:seed` idempotent against the migrated database.

The live suites need `DATABASE_URL` and the local port is **5433**. The write suite migrates its own
scratch database (`w3t02_write`) — see `MEM-2026-09-18-10` for why.

**Next action: `W3-T01`** — the real category tree. `W3-T02` validates slugs against `category`, and
that table holds only the four demo rows `W3-T10` seeded. It is `[M]` `[B]`: `BD-07` (which
categories legally require a licence in Spain) is the operator's, and it now blocks a provider
picking a real trade rather than just a badge.

**Do not redo:**
- A "provider with no base address" fixture. `0009` made the column `NOT NULL`; Postgres refuses the
  row (`23502`), and the assertions about it live in `core-schema.test.ts` now.
- `ON DELETE SET NULL` on `provider_profile.base_address_id`. It is `RESTRICT`, deliberately —
  `core-schema`'s `AC-9` inverted to say so.
- Making `GET /providers/me` answer `404` when the guard is absent. It answers `400` from the public
  by-id route, because `/me` and `/:id` share a path space. The property is *never `200`*.
- Updating an address row in place on a profile save. A change creates a new row; an identical
  address is reused. The old row may be somebody's home (`W2-T08` owns cleanup — spec Q3).
- Adding a `PATCH`. `PUT` is the whole document, and §3.3 says why.

**Carry forward:** three open questions in the spec, none blocking — `kind` is self-declared (the
licence gate is `W3-T08`'s verified `Certification`), the 20-category bound is mechanical, and every
base-address change leaves an orphan row that nothing cleans up.

**Skills used**: `test-driven-development` (two red suites, and a green phase where seven failures
were the test's own fault), `api-and-interface-design` (§3.3's PUT-not-PATCH, §3.4's two
projections), `security-and-hardening` (the owner projection is the only place `line1` appears, and
the write answers the public one).
