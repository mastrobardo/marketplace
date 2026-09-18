# Run record — W3-T02 provider profile write path

```
Agent:        agent-providers (with one seam edit as agent-contracts, §8.3 of the spec)
Model:        claude-opus-5
Charter rev:  1
Skills used:  test-driven-development, api-and-interface-design, security-and-hardening
Started:      2026-09-18   Finished: 2026-09-18
Session file: memory/sessions/2026-09-18-agent-providers-W3-T02.md
```

## Prompts

### 1. Continuation

> So please continue with W3t02. Compact conversation before

Four things were settled before the spec, by answering a question with four options each:
branch from the merged `main` (*"263 was already ,erged"*), **upsert** on the first write, the
`NOT NULL` migration **in this PR**, and **working hours excluded** (they belong to `W3-T09`, and
no column exists for them).

### 2. Corrections

No re-prompt was needed for a wrong output. The only mid-flight correction was to the author's own
test: `AC13`'s claim that an unguarded build answers `404` on `/providers/me` turned out to be half
right, and the honest property is narrower (§2 below).

## Red phase

Two suites, no implementation:

```
packages/contracts
 FAIL  tests/provider-write.test.ts   Tests  17 failed (17)
   TypeError: Cannot read properties of undefined (reading 'parse')   ← the schemas do not exist

apps/api
 FAIL  tests/provider-write.test.ts
   Error: Cannot find module '../src/modules/providers/write-repository.js'
   Test Files  1 failed (1)        Tests  no tests
```

## Green phase

```
packages/contracts   provider + provider-write     43 passed
apps/api             provider-write (boundary)     18 passed
apps/api             provider-write-live           11 passed   (STACK_LIVE=1)

STACK_LIVE=1 DATABASE_URL=… pnpm --filter @marketplace/api exec vitest run
 Test Files  19 passed (19)
      Tests  286 passed (286)      ← 257 before this task

pnpm typecheck  10/10 · pnpm lint  clean · pnpm format:check  clean · pnpm build  6/6
pnpm test       api 178/108 skipped · web 230 · contracts 227 · ui 255 · testing 33 · root 283
pnpm db:seed    ran 0, skipped 2 already applied (idempotent against the migrated database)
```

## 1. The migration's blast radius, which was the real work

`ALTER COLUMN base_address_id SET NOT NULL` is two lines. What it touched:

**The foreign key had to change with the column.** It was `ON DELETE SET NULL`, which is no longer
an outcome Postgres can produce — the delete would fail with a constraint error naming the column
rather than the cause. `RESTRICT` states the intent correctly, and `core-schema.test.ts`'s `AC-9`
**inverted**: it used to assert *"deleting a base address leaves the provider, no longer
searchable"* and now asserts that the delete is refused (`23503`). That test is the clearest
statement of what this ticket changed — a provider used to be unlistable by a `DELETE` somewhere
else.

**Every live suite that builds a provider.** `packages/testing`'s `buildProviderProfile` defaulted
`baseAddressId: null`, so with the constraint in place `factories-live`, `provider-live` and
`search-live` would all have failed at insert. `createProviderProfile` now composes an address the
way `createProviderCategory` already composes its parents — the fix belongs in the factory, not in
three call sites — and the package's own `AC12`/`AC13`/`AC17` moved with it.

**Two assertions that stopped being runtime questions.** `provider-live` seeded a provider with no
base address and asserted the endpoint had nothing to serve; `search-live`'s `AC6` seeded one and
asserted it was unsearchable. Neither row can be written now, so both moved into
`core-schema.test.ts` as a `23502` — impossibility belongs where it is enforced, not where it is
observed (spec §8.5). `AC6`'s **radius** half is untouched: a null radius is still legal and still
means "not set".

**And one branch of production code died.** `repository.ts` returned `undefined` for a row whose
address was null — `W3-T07`'s transitional `404` for a provider who exists. Prisma now types the
relation as non-null, so the comparison was a type error rather than dead code, which is the
cheapest possible way to be told.

## 2. `/me` and `/:id` share a path space, and the fail-closed property is "never 200"

`W2-T03` §3.7 deferred one assertion to this ticket: a private route must not exist at all when the
guard is absent. Written as *"answers 404"*, it failed — with a `400`:

```json
{"error":{"code":"VALIDATION_FAILED","message":"The provider id is not a uuid."}}
```

With the static `/providers/me` unregistered, `me` is simply an id, and the public by-id route
answers it as a malformed one. The `PUT` is a genuine `404` because no route accepts that method.
So the property asserted is the one that actually matters — **never `200`, and no data** — and the
status depends on which route is missing. The test says so in as many words, because the next person
to read it will otherwise "fix" it back.

The happy path needed pinning for the same reason: `tests/provider-write.test.ts` asserts that a
`GET /api/providers/me` with the private routes present reaches the *own* repository and the public
one is not called even once.

## 3. Two things about the live suites, neither about this feature

**Deterministic factories collide across parallel suites.** `provider-write-live` passed alone and
failed in the full run, inside `createUser` — `packages/testing` generates ids and emails from one
sequence, so two suites writing to the same database produce the same `app_user.email`. The
established answer was already in the repo (`provider-live` and `search-live` each migrate a scratch
database); this suite now does the same, and the comment says why rather than leaving the next
author to rediscover it.

**A workspace package's `dist` is what `apps/api` imports.** After changing `packages/testing`,
`factories-live` failed with a Prisma validation error still showing `baseAddressId: null` — the
source was right and the build was stale. `pnpm --filter @marketplace/testing build` before running
a live suite that exercises a package you have just edited.

## Deviations from spec

- **AC13's wording**, as above (§2). The spec's §7 and §3.7 were both updated before the test was
  written, so this is recorded rather than silently corrected.
- Nothing else. The upsert, the address-replacement rule, the slug set replacement, the transaction
  and both projections shipped as specified.

## Human input received

| Decision | Recorded in |
|---|---|
| Branch from the merged `main` | — |
| `PUT /me` **upserts** — the first write creates the profile | spec §3.2, AC4/AC5 |
| The `NOT NULL` migration lands **in this PR** | spec §8.1, migration `0009` |
| **Working hours excluded** — `W3-T09` owns the calendar, and no column exists | spec §1.1, §9 |

Plus the three carried from `W2-T03` that this ticket is the first consumer of: `401` for a
suspended user, no implicit `ADMIN`, and account state as a filter rather than a field.

## Self-assessment

- **Weakest part of this change**: the address-replacement rule (§3.5). It is right for the case it
  was designed for — a provider moving their operating centre must not rewrite the home address a
  `client_profile` may point at — and it leaves an orphan row behind on every change. Nothing
  cleans those up, and nothing will until `W2-T08` decides what erasure means. Q3 in the spec says
  so out loud rather than leaving it to be discovered in a GDPR review.
- **What a reviewer should look at hardest**: `createProviderWriter`'s transaction — specifically
  that the slug resolution happens **before** any write, and that `sameAddress` compares every
  field. A missed field there means a save that looks idempotent and quietly creates an address row
  each time. `AC7` and `AC9` are the two tests that would catch it.
- **What I would tell the next agent working in this slice**: the write answers the **public**
  projection on purpose — what you saved is what a visitor sees — and both projections are built
  from one `select` in `repository.ts`. If you add a column, add it there; if you add a private
  column, add it to `OWN_SELECT` only, and a test in `provider.test.ts` will tell you if it escapes.
