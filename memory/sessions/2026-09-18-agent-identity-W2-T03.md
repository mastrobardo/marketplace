---
task:    W2-T03
agent:   agent-identity
session: 2026-09-18
status:  closed
---

# Session — W2-T03

## Goal
Route guards and the permissions matrix: the first authenticated boundary in `apps/api`, so that
`W3-T02` (and every write path after it) mounts on a reviewed guard instead of inventing one.

## Current state
- `main` at `b6097ec` (`W3-T10`, #261). Branch `W2-T03-route-guards`.
- **Nothing in `apps/api/src/modules/**` reads a session.** `getSession` appears only inside
  `auth/auth.ts`; the only routes are `/health`, `/api/auth/*`, `GET /api/search` and
  `GET /api/providers/:id`, all public.
- `roles`, `status` and `deletedAt` are `additionalFields` on better-auth's user
  (`auth/auth.ts:100`), `input: false`, and `cookieCache` is off (`auth.ts:126`) — so a session
  lookup hits the database on every request and sees the *current* row.
- `ERROR_CODES` already carries `UNAUTHENTICATED: 401` and `FORBIDDEN: 403`
  (`packages/contracts/src/errors.ts:14`), both `withoutDetails`. No contract change is needed.
- `auth.test.ts:320` pins, deliberately, that better-auth's own `get-session` still answers a
  suspended user's live cookie. That is `W2-T02`'s to flip; this ticket must not touch it.
- Seed reality: `auth-demo-users` seeds `2222…` with a password and `roles: [CLIENT, PROVIDER]`
  but **no `provider_profile` row**; `demo-providers`' five profiles have **no credentials**. So
  the live suite can sign in as a PROVIDER, and `W3-T02` will have to decide whether its write
  path creates the profile row.

## Log
- 10:xx surveyed the ticket before proposing it; `W3-T02` needs three things that do not exist
  (write contract, session guard, a way to be a provider). Operator chose the guard first.
- 10:xx guard placed in `modules/auth/` rather than `plugins/`: `plugins/auth.ts` is better-auth's
  mount and is already a carve-out from the error envelope (`app.ts:95`); the guard is the opposite
  — it is the thing that puts refusals *into* the envelope.

- 11:xx spec §1–§10 written; operator answered all three open questions in one pass.
  Q1 `401` confirmed. Q2 `ADMIN` stays non-implicit **with a condition**: money permissions must be
  reachable — "someone should be able to look into transactions" — which became §3.5.1 and
  `MEM-2026-09-18-2`. Q3 changed the design: liveness is a `where` clause, not a field, so the guard
  no longer depends on whether `getSession` returns `additionalFields` on its read path
  (`MEM-2026-09-18-3`).
- 11:xx cost accepted: one extra primary-key read per authenticated request. Revisit only with a
  measurement; the fix would be one raw statement joining `session` to `app_user`, never a cached
  flag.

- 11:xx operator: money deferred; providers are **manitas y profesionales**, with trade subtypes
  later. Neither is a `UserRole` — kind is a column on `provider_profile` (`schema.prisma:58`),
  trades are the `Category` tree, and a gated trade is a `Certification`. Spec §3.5.2 states the
  rule and AC17 makes `typecheck` enforce it. `TODO.md` §3's sketch still calls MANITAS/PRO roles —
  logged as O3 for `agent-contracts`.

## Blocked / escalations
None yet.

## Handoff

**`W2-T03` is complete.** `permissions.ts`, `guard.ts`, three test files, the spec, the run record,
`TODO.md` and the memory promotions are on `W2-T03-route-guards`.

Gates: typecheck 10/10 · lint clean · format:check clean · build 6/6 · `apps/api` **257** under
`STACK_LIVE=1` (17 files, 230 before this task) · web 230 · contracts 210 · ui 255 · testing 33 ·
root 283.

Running the live suite needs `DATABASE_URL` exported, and the local port is **5433**:
`STACK_LIVE=1 DATABASE_URL="postgres://marketplace:marketplace_local@127.0.0.1:5433/marketplace" \
  pnpm --filter @marketplace/api exec vitest run guard-live`

**Next action: `W3-T02`** — the first route to use the guard. Two things its spec must settle before
the route: the **write contract** (`agent-contracts`'), and what `PUT /api/providers/me` does for a
user with no `provider_profile` row — upsert, or `404` until `W2-T05`. The seeded world makes that
concrete: `auth-demo-users`' `2222…` can sign in and has no profile; `demo-providers`' five profiles
have no credentials.

**Do not redo:**
- Guarding a product route here. There is none; `W3-T02` adds the first `preHandler` and its own
  matrix row in the same PR. §3.7's registration half (`404`, never `200`, when `auth` is absent) is
  asserted there for the same reason.
- Reading `status`/`deletedAt` from the session payload. The operator's rule is that such a user
  returns **no data** — liveness is a `where` clause in `buildSessionResolver`, and `Principal` may
  never gain a state field (`MEM-2026-09-18-3`).
- Adding `ledger:read` or any admin allow cell. Money deferred by the operator; when it lands it
  comes with **its own role**, not a widened `ADMIN` (`MEM-2026-09-18-2`), and `W5-T10` has to exist
  first.
- `encodeURIComponent` on a permission when building a probe path. It is unreachable —
  `MEM-2026-09-18-7`.

**Seen once, not chased:** `apps/web` `tests/results.test.tsx` AC1 failed a single CI run with an
MSW unhandled-request error while the shell sat on `shell-loading`. Green on re-run, green three
times locally, and `apps/web` does not import anything this branch touched. Run record §4 has the
detail; `agent-qa` owns it if it recurs.

**Carry forward:** `W2-T02`'s open gap is now half-closed and worth re-reading when it is picked up:
better-auth's own `get-session` still answers a suspended user's live cookie (`auth.test.ts:320`,
unchanged), while a guarded route refuses it. The red phase also confirmed `getSession` returns the
session and user for a live cookie; whether `additionalFields` survive its read path was never
measured, because the design stopped depending on it.

**Skills used**: `test-driven-development` (the red phase in the run record — three missing modules,
then seven 404s that were the test's fault), `security-and-hardening` (§3.3/§3.4: what a refusal may
say, and why `401` and `403` are not interchangeable), `api-and-interface-design` (§3.2's port, and
§3.6's `/me` rule for ownership).
