# W3-T07 — run record

```
Task:   W3-T07  [A]
Agent:  agent-providers
Branch: W3-T07-provider-profile-api
Spec:   W3-T07-provider-profile-api.md
```

## Prompts

### 1. Sequencing

> Please continue with next task (w3t07)

Read as: `TODO.md` §6's NEXT block, which names `W3-T07` and the two things `W3-T05` left it.
Boot sequence run in order; no open session file for this task ID.

### 2. Four decisions before any code

The plan was put to the operator with four decisions attached, because each of them would have been
a guess: what a provider with no base address answers, whether the module is `providers/` or the
charter's `professionals/`, raw SQL or the typed client, and whether to widen `packages/testing` or
work around it a third time. Answered A–D in one reply (see the spec §2.1, §2.2, §2.4, §2.9).

The answer to A carried a product correction that is larger than the ticket: **a base address is
required of every provider, and it is the centre of their operating radius rather than their home.**
It does not change what this endpoint does — it changes what its 404 *means*, and it makes two
comments in the seam wrong. Both are recorded as proposals for `agent-contracts` in the spec's §5.

## Red phase

The module surface was created first as stubs — `MEM-2026-09-09-06`: *"`Cannot find module` with
`Tests  no tests` means no assertion ran"*. `routes.ts` returned a plugin that throws, so the 13
criteria in `apps/api/tests/provider.test.ts` were collected and run, and each one failed on the
missing implementation rather than on a missing file.

```
 ❯ tests/provider.test.ts (13 tests | 13 failed)

⎯⎯⎯⎯⎯ Uncaught Exception ⎯⎯⎯⎯⎯
Error: not implemented
 ❯ src/modules/providers/routes.ts:15:11
     13| export function providerRoutes(_deps: ProviderRoutesDeps): FastifyPlug…
     14|   return () => {
     15|     throw new Error('not implemented');
       |           ^
     16|   };
     17| }
 ❯ Plugin.exec ../../node_modules/.pnpm/avvio@9.3.0/node_modules/avvio/lib/plugin.js:125:28
 ❯ Boot._loadPlugin ../../node_modules/.pnpm/avvio@9.3.0/node_modules/avvio/index.js:446:10

 Test Files  1 failed (1)
      Tests  13 failed (13)
     Errors  13 errors
   Duration  130.68s
```

Then the live suite, 11 criteria, against a migrated scratch database.

## Green phase

First implementation run: **12 passed, 1 failed** — and the failure was in the test, not the code.

```
AssertionError: expected 200 to be 404 // Object.is equality
- 404
+ 200
 ❯ tests/provider.test.ts:128:33
```

`boot(undefined)` was meant to mean *"the repository finds nothing"*, but the helper declared
`answer: ProviderProfile | undefined = profile()` and **a default parameter fires on an explicit
`undefined`** — so "found nothing" and "found the fixture" were the same call, and the 404 path had
no coverage at all. Replaced with a rest-args helper where the arity is the distinction. Worth
recording because it fails in the direction that hides a gap rather than showing one: had the route
answered 200 for a missing provider, this test would still have passed.

Final, on this branch:

| Gate | Result |
|---|---|
| `pnpm typecheck` | 10/10 |
| `pnpm lint` | clean |
| `apps/api`, `STACK_LIVE=1` | **207/207**, 12 files (183 before this task) |
| `packages/contracts` | 210/210 |
| `packages/testing` | 33/33 (32 before) |
| `packages/ui` | 255/255 |
| `apps/web` | 239/239 |
| root `pnpm test` | 266 passed, 6 skipped · 10/10 turbo tasks |

## What building it caught

### 1. A provider with no base address cannot be serialised, and the schema allows one

`ProviderProfileSchema` requires `city`, `province` and `point`, all non-null; `base_address_id` is
nullable. There is no correct answer available to the endpoint — the contract cannot describe such a
provider, and this slice may not change the contract.

It answers `404`, on the grounds that the provider is already unlisted everywhere else. But the
finding is not the status code, it is that **the schema permits a state the product cannot serve**.
Put to the operator, who settled it as a product rule rather than an encoding question: *every
provider must have a base address, and it is the centre of their operating radius — not where they
live.* A provider may set it to a city centre and cover 40 km from there.

That makes the 404 transitional, and it moved two things out of this ticket: `W3-T02` requires the
address at creation (its `TODO.md` line now says so), and `NOT NULL` is a migration for
`agent-contracts` (spec §5 Q1). It also makes a *comment* wrong in two files — `schema.prisma:214`
and `packages/contracts/src/search.ts` both justify the coarse point with "usually a home address",
which is now the wrong reason for the right behaviour (§5 Q2). The privacy rule itself does not
weaken: a provider may still enter their home and no endpoint can tell which did.

### 2. Both `Decimal` columns would have reached the wire as objects

`ratingAvg` is `Decimal(3,2)?` and the address coordinates are `Decimal(9,6)`. Prisma returns
`Decimal` instances, which `JSON.stringify` renders as an object rather than a number — so
`ProviderProfileSchema.parse` rejects them, and `coarsenPoint` would have received something that is
not a number at all. Caught by the live suite, which is the only place a real column meets the
projection; the boundary suite's stub returns numbers because it is typed to.

This is `MEM-2026-09-17-11` paying for itself a second time, on a different failure than the one it
was written for.

### 3. `select` rather than `include`, because the omissions are the security boundary

`include: { baseAddress: true }` returns `line1` and `line2`; `include: { categories: … }` on the
profile returns `userId` and `baseAddressId`. Both would have been caught by the outbound parse —
but only *after* the private columns were in memory, one spread away from a response. An explicit
`select` on every level makes the exclusion structural and makes adding a field a visible edit.
Promoted as `MEM-2026-09-17-13`.

### 4. A default parameter made a 404 test pass through the 200 path

See the green phase. The test asserted the right thing about the wrong call.

### 5. The factory gap is two gaps, not one

`ProviderProfileInput` is widened here (`serviceRadiusMetres`, `hourlyRateCents` nullable,
`baseAddressId` added) with the operator's agreement, closing the part of `MEM-2026-09-17-10` that
was about to be worked around a third time. Writing the live fixtures then turned up a second
instance: `AddressInput` has no `line2`, while the column is `line2 String?`. Left alone — widening
one factory was the agreed scope and `line1` is the column `W1-T05` §8 names first — but recorded on
the same memory entry rather than rediscovered by `W3-T03`.

### 6. `*/` inside a block comment closes the block comment

Updating `apps/web/mocks/provider.ts`'s header to say the mock outlived `W3-T07` introduced the
literal MSW pattern into a `/** … */` comment, which ended the comment mid-sentence and produced
four parse errors in a file whose logic had not changed. `handlers.ts` writes these paths in prose
for the same reason. Thirty seconds to fix, and the only reason it is written down is that the error
(`TS1160: Unterminated template literal`, pointing at the end of the file) names neither the comment
nor the cause.

## The evidence

**The privacy projection is asserted against a row that really has the private columns.** The live
fixture writes `line1: 'Calle Secreta 7'` and the assertion is that the serialised profile does not
contain that string — so it tests the projection rather than the absence of data. Alongside it, a
key-for-key comparison against the contract's field list, which is what catches a column that is
absent today and added tomorrow.

**The coarse point is asserted against the stored value.** The fixture stores Puerta del Sol at full
precision (40.416775, −3.70379) and the test requires the response to be 40.417 / −3.704 **and** not
to equal the stored latitude. `W3-T05` found that a fixed point which is exactly representable hides
a whole class of defect here; this one is not the value under test, it is the value being changed.

**One SQL statement per request is *not* claimed.** `W3-T05` asserts it by counting Prisma query
events; this endpoint deliberately issues two to three and the spec says why (§2.2). Recording the
absence so a reviewer does not read the missing criterion as an oversight.

## Deviations from spec

**None in behaviour.** Two notes on scope:

- The spec's §2.9 says `packages/testing`'s `ProviderProfileInput` is widened, and it is. It does
  **not** widen `AddressInput`, which the live fixture then turned out to need for `line2`. Left as
  it was — `line1` is the column the deny rule names first and the key-for-key assertion covers
  `line2` anyway — and recorded on `MEM-2026-09-17-10` rather than done unasked.
- The charter fix landed in **two** files, not one: `agents/roles/agent-providers.md` and
  `.claude/agents/agent-providers.md` carry the same `owns:` list in different formats.

## Known gaps, carried deliberately

- **`GET /api/providers/:id` answers 404 for a provider that exists**, when they have no base
  address. Deliberate, argued in §2.4, and removed by `W3-T02` plus the migration in §5 Q1.
- **The MSW handler still answers**, so the storefront's profile page is still a facade. `W3-T10`,
  behind the seeder, exactly as `W3-T05` left `GET /search`.
- **No `agent-contracts` review yet** of the two proposals in §5. Neither blocks this branch.
- **`packages/ui` failed once under `turbo run test`** — two `.stories.tsx` files failing to import
  a Storybook addon file out of `node_modules` — and then passed 255/255 in isolation and again on a
  second full run. Nothing in this branch touches `packages/ui` or anything it depends on. Recorded
  as a flake observation for `agent-qa`, not diagnosed here.
- **Running the live suites locally needs `DATABASE_URL` exported**, which `.env` does not carry.
  Without it `auth.test.ts` fails in `beforeAll` and then again in `afterAll`, which reads as a
  broken suite rather than a missing variable. The command is in the session file's handoff. Whether
  `.env.example` should carry it is `agent-devops`', not this ticket's.

## Human input received

Four decisions, answered in one reply before any code was written (see Prompts §2), plus the product
rule on base addresses that came with the answer to A. The rule is recorded as `MEM-2026-09-17-15`
and carried into `W3-T02`'s backlog line; it is the reason §2.4's 404 is documented as transitional
rather than as the design.

No intervention ledger entry is required: nothing was rejected, overridden or hand-edited.

## Self-assessment

**What went well.** The four decisions were identified before writing code rather than discovered
halfway through, which is the only reason the no-base-address question reached the operator at all —
it is invisible from the contract and from the mock, and the obvious implementations either 500 or
invent a nullable field. Copying `W3-T05`'s module split cost nothing and the boundary suite ran in
412ms without a database.

**What I would do differently.** The `boot(undefined)` helper was wrong in a way that hid a gap, and
it was wrong because I wrote the helper before the test that needed the distinction. The failure
happened to surface it; a slightly different route implementation would have left the 404 path
untested and green.

**Confidence.** High on the endpoint and its tests. The weakest claim in this branch is that the
`ui` failure was a flake — it passed twice afterwards and touches nothing this branch changed, but
"it went away" is evidence, not proof.
