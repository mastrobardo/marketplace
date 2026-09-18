# Run record — W2-T03 route guards

```
Agent:        agent-identity
Model:        claude-opus-5
Charter rev:  1
Skills used:  test-driven-development, security-and-hardening, api-and-interface-design
Started:      2026-09-18   Finished: 2026-09-18
Session file: memory/sessions/2026-09-18-agent-identity-W2-T03.md
```

This ticket was picked and steered by the operator in a live session rather than dispatched from
`TODO.md`, so `## Prompts` below is the operator's own words, verbatim, in order. The internal
phases still followed `agents/prompts/00-spec-authoring.md`, `02-tdd-red.md` and
`03-implement-green.md`.

## Prompts

### 1. Task selection

> Please suggest and continue with next tasks in the list

Answered with the state of the backlog and one finding: `TODO.md`'s NEXT block names `W3-T02`, and
`W3-T02` needs three things that do not exist — a write contract (`packages/contracts/**` is
forbidden to `agent-providers`), a session guard (nothing in `apps/api/src/modules/**` reads a
session), and a way to become a `PROVIDER` at all (`W2-T05`). Offered four orderings; the operator
chose:

> W2-T03 guards first

### 2. Spec review — the three open questions

> Q1: 401 should be, Admin with no bypass is fine. HOWEVER, either a super admin or a way to
> actually have money opermissions is required: someone should be able to look into transactions.
> GetSession is fine without deletedAt: a suspended/blocked/deleted user should return no data. Not
> even deletedAt

### 3. Scope correction — what a provider is

> it is fine leaving money for later. HOWEVER, please not providers will be of 2 main types:
> manitas y professionales. There will be more subtypes (electrician etc) but we can think about it
> later as well.

### 4. Corrections

No re-prompt was needed for a wrong output. Both operator messages after the spec were **new
information**, not corrections of a mistake, and each changed the design rather than repairing it:

- Q3 replaced §3.3 entirely. The spec had the guard reading `status`/`deletedAt` from better-auth's
  session payload and checking them. The rule *"should return no data. Not even `deletedAt`"* turns
  that into a `where` clause, so account state never becomes a value (see §3 below).
- Prompt 3 added §3.5.2 and AC17. The spec never said `MANITAS`/`PRO` were roles, but nothing
  stopped a later ticket assuming it — and `TODO.md` §3's domain sketch actively invites the
  mistake by listing `role(s) CLIENT | MANITAS | PRO | ADMIN`.

## Red phase

Three test files, no implementation:

```
 FAIL  tests/guard-live.test.ts [ tests/guard-live.test.ts ]
 FAIL  tests/guard.test.ts [ tests/guard.test.ts ]
Error: Cannot find module '../src/modules/auth/guard.js' imported from
  /Users/…/apps/api/tests/guard.test.ts
 FAIL  tests/permissions.test.ts [ tests/permissions.test.ts ]
Error: Cannot find module '../src/modules/auth/permissions.js' imported from
  /Users/…/apps/api/tests/permissions.test.ts

 Test Files  3 failed (3)
      Tests  no tests
```

Failing for the absence of the modules under test, which is the right reason.

## Green phase

`permissions.ts` and `guard.ts` written; second run, **7 failed** — and the failures were in the
*test harness*, not the implementation (§2 below):

```
 × AC3: runs the handler when the roles carry the permission
 × AC5: refuses a principal whose roles lack the permission
 × AC6: CLIENT → provider-profile:update-own is 403
 × AC6: PROVIDER → provider-profile:update-own is 200
 × AC6: ADMIN → provider-profile:update-own is 403
 × AC7: ADMIN gets no implicit bypass
 × AC15: an explicit grant to ADMIN works
AssertionError: expected 404 to be 200
```

After the probe-path fix, and with the local stack up:

```
 Test Files  2 passed | 1 skipped (3)
      Tests  22 passed | 5 skipped (27)

STACK_LIVE=1 … vitest run guard-live
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Full gates, from the repository root:

```
pnpm typecheck        10/10 tasks
pnpm lint             ESLint: No issues found
pnpm format:check     All matched files use Prettier code style
pnpm build            6/6 tasks

STACK_LIVE=1 DATABASE_URL=… pnpm --filter @marketplace/api exec vitest run
 Test Files  17 passed (17)
      Tests  257 passed (257)       ← 230 before this task

pnpm test (workspace, live suites skipped)
 api 160 passed / 97 skipped · web 230 · contracts 210 · ui 255 · testing 33 · root 283
```

## 1. The design the operator's Q3 produced

The spec as reviewed had the guard read `status` and `deletedAt` off better-auth's session payload,
where they are `additionalFields` (`auth/auth.ts:100`), and refuse on them. The answer —
*"a suspended/blocked/deleted user should return no data. Not even `deletedAt`"* — is a stronger
rule than a refusal, and it changed the adapter:

```ts
const user = await prisma.user.findFirst({
  where: { id: session.user.id, status: 'ACTIVE', deletedAt: null },
  select: { id: true, roles: true },
});
if (user === null) return null;
```

The state is in the predicate, so it never becomes a value: nothing to log, nothing to put on the
principal, and no downstream branch that *could* answer differently for a suspended user than for a
signed-out one. `Principal` is `{ userId, roles, sessionId }` and the type carries a comment saying
it may never gain a state field.

Two things fell out of it that the original design did not have. The guard no longer depends on
whether better-auth returns `additionalFields` on its *read* path — a property of the version we are
pinned to, and the spec's Q3 was a request to go and measure it. And "suspension means now" became
true on guarded routes without touching `W2-T02`'s territory: `auth.test.ts:320` still pins that
better-auth's own `get-session` answers a suspended user's live cookie, and `guard-live.test.ts`
now pins that the same cookie gets `401` from a guarded route, with the session row still present.

The cost is one extra primary-key read per authenticated request, stated in §3.3 of the spec rather
than discovered by whoever profiles this later.

## 2. The 404s were the test's fault, and the reason generalises

Seven criteria failed against a correct implementation because the probe route was registered as

```ts
`/api/probe/permission/${encodeURIComponent(permission)}`   // → …/provider-profile%3Aupdate-own
```

Two separate problems, either one fatal. A `:` in a Fastify path is a **parameter**, so the
un-encoded spelling would have declared a wildcard; and find-my-way **decodes** the incoming path
before matching, so the percent-encoded spelling registers a route that nothing can reach. The
request and the route disagreed while looking identical in the source.

Fixed by slugging the permission through one function both sides call, which is the actual lesson:
when a test builds a URL and a route from the same value, that value must pass through **one**
transformation, not two that happen to agree today.

Worth knowing beyond this file — any later ticket registering a route from a domain identifier
(`W3-T03`'s portfolio keys, `W5`'s webhook paths) hits the same edge.

## 3. What is deliberately not here

- **No product route is guarded.** `W3-T02` is the first consumer and adds the `preHandler` in its
  own PR. The guard's proof today is a probe route the tests own; §3.7's *registration* half — a
  private route not registered at all when `auth` is absent — is asserted there, because there is no
  private route here to leave unregistered. What this ticket asserts instead is the runtime edge of
  the same rule: a resolver that throws produces `500`, never a pass (AC13).
- **One row in the matrix.** `provider-profile:update-own`. The growth rule is in the module's own
  doc comment: a permission enters in the same PR as the route that guards with it.
- **No money permission, and no `ADMIN` allow cell anywhere.** §3.5.1 of the spec records the
  operator's requirement and the constraint it lands under (`MEM-2026-09-18-2`): the transactions
  view arrives with **its own role**, not by widening the `ADMIN` that `W9-T04` gives to moderators.
  `W5-T10` has to exist first — the schema ends at `AuditRecord` and there are no transactions to
  read. AC15 proves the mechanism over a fixture matrix so that nothing empty ships in the real one.

## Deviations from spec

- **AC13 was rewritten during the red phase**, before any test was written against the old wording.
  It said *"`buildApp` with a guarded route module but no `auth` answers 404"*, which cannot be
  asserted honestly while no such module exists — the test would have registered the route itself
  and then asserted its own decision. It now asserts fail-closed behaviour that is real today (a
  throwing resolver → `500`), and the composition assertion moves to `W3-T02` with the route. Spec
  §3.7 and §7 both updated.
- Nothing else. No contract change, no migration, no ADR: `UNAUTHENTICATED` and `FORBIDDEN` were
  already in the registry and `roles`/`status`/`deletedAt` were already columns.

## Human input received

Three decisions, all from the operator on 2026-09-18, all recorded:

| Decision | Recorded in |
|---|---|
| A suspended user's guarded request is `401`, not `403` | spec §3.3/§3.4, `MEM-2026-09-18-3` |
| `ADMIN` gets no implicit bypass — **and** money permissions must be reachable | spec §3.5/§3.5.1, `MEM-2026-09-18-2` |
| A suspended/blocked/deleted user returns no data, *not even `deletedAt`* | spec §3.3, `MEM-2026-09-18-3` |
| Providers are manitas and profesionales, with trade subtypes later — neither is a role | spec §3.5.2, `MEM-2026-09-18-4` |

## Self-assessment

- **Weakest part of this change**: it ships a mechanism with one consumer that does not exist yet.
  Every property is asserted, but the assertions run against a probe route the test owns, and a
  probe route is a thing that agrees with you. `W3-T02` is where the guard meets a real handler, and
  it should land next rather than in three tickets' time.
- **What a reviewer should look at hardest**: `buildSessionResolver`. It is two round trips where
  most codebases have one, it is the only place account state is visible at all, and if the
  liveness `where` clause is ever relaxed to a `select`, the operator's rule is gone with no test
  failing — because the principal would still look right. Also worth a second read: `principalOf`
  throws a plain `Error` deliberately, so a missing `preHandler` is a `500` and not a plausible
  `401`.
- **What I would tell the next agent working in this slice**: the matrix is the readable artefact —
  add your row there, in the PR with your route, and do not add a `can()` call anywhere but a
  `preHandler`. If your rule needs to look at a row (is this provider a `PRO`? do they own this
  booking?), it is not a permission; it is a check the route makes after the repository answers, and
  §3.6 says which of `403` and `404` it owes.
