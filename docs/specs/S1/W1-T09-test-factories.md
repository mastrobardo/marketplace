# W1-T09 — Provide shared test data builders

Task: `W1-T09` · Slice: S1 · Owner: `agent-contracts` · Issue: #63
Branch: `W1-T09-test-factories` · Run record: `W1-T09-test-factories.run.md`

---

## 1. Purpose

`memory/repo/conventions.md` has promised since `MEM-2026-09-07-06` that "test data comes from
`packages/testing`". The package does not exist. Every test written so far has therefore had to
hand-roll its rows — `core-schema.test.ts` has a `makeUser`, a `makeAddress` and a `returned`
helper, all private to that file — and the next twelve slices will each write their own.

The cost is not duplication, which is cheap. It is that a failure stops being reproducible. When
`agent-money`'s booking test fails and `agent-jobs`'s does not, the first question is whether they
were testing the same kind of user, and with a fixture inlined in each file there is no way to
answer it except by reading both. Multiply by thirteen agents working in separate sessions.

`TODO.md` §6 calls this the "TDD prerequisite for every slice", and it is the last piece of W1 that
M1 is waiting on. It is worth doing before the slices arrive rather than after, because a factory
introduced late has to fight the fixtures already written against it.

---

## 2. User stories

- **As an agent building a slice**, I want a `buildUser()` that returns a valid user, so that my
  test says what is *interesting* about the user and nothing else.
- **As an agent debugging a cross-slice failure**, I want every slice's users to be built the same
  way, so that "is it the same shape?" is not a question I have to answer by reading two files.
- **As a reviewer**, I want a test run to be reproducible from its seed, so that a failure I cannot
  reproduce is a real signal rather than the normal state of affairs.
- **As the next agent to add a table**, I want the suite to tell me a factory is missing, so that
  the convention holds without anyone policing it in review.

---

## 3. State machine

None. Factories build values; they have no lifecycle.

---

## 4. API surface

No HTTP endpoints. The surface is the new workspace package `@marketplace/testing`, one entry
point, wired into `pnpm-workspace.yaml` (already globbed by `packages/*`) and consumed as
`"@marketplace/testing": "workspace:*"` in the `devDependencies` of `apps/api`, `apps/web` and
`packages/contracts`.

### 4.1 Determinism primitives — `resetFactories()`, `nextId()`, `nextAt()`

```ts
import { resetFactories } from '@marketplace/testing';

beforeEach(resetFactories);
```

**Decision A — a sequence, not a seeded PRNG.** The obvious build is `faker` with a fixed seed. A
counter is strictly better here: it is reproducible without a dependency, and the values it
produces are *legible*. `00000001-0000-4000-8000-000000000003` is the third user, readable as such
in a failure message, and `Provider 4` sorts where a reader expects. Realistic-looking data buys
nothing a test can assert on.

Ids are v4-shaped so they satisfy `@db.Uuid`, `z.uuid()` and Postgres alike — version nibble `4`,
variant `8` — with an 8-hex prefix per entity registered in one table:

| Entity | Prefix | Third instance |
|---|---|---|
| `User` | `00000001` | `00000001-0000-4000-8000-000000000003` |
| `ClientProfile` | `00000002` | … |
| `ProviderProfile` | `00000003` | … |
| `Address` | `00000004` | … |
| `Category` | `00000005` | … |

so a user id can never collide with an address id, and a wrong-id bug names its own entity.
`ProviderCategory` has no prefix and needs none: its primary key is the composite
`(providerProfileId, categoryId)` and it has no `id` column at all.

**Decision B — `nextAt()` returns a fixed epoch plus a fixed step per call**, never `new Date()`.
Timestamps are therefore distinct and strictly increasing. That is not cosmetic: `W1-T02` froze
keyset paging, `MEM-2026-09-10-07` records that keyset paging over a non-total order drops rows at
page boundaries, and a paging test cannot demonstrate that with rows that share a `createdAt`.

**Decision C — `resetFactories()` is mandatory in `beforeEach`, not automatic.** The package cannot
register a global hook without owning the vitest setup file, which belongs to `packages/config`
(`MEM-2026-09-08-02`) and to `agent-devops`. AC8 proves that resetting restores byte-identical
output; §10 Q1 asks whether the hook should move into the shared preset later.

### 4.2 Builders — pure, no client

```ts
buildUser(overrides?)             buildAddress(overrides?)
buildClientProfile(overrides?)    buildCategory(overrides?)
buildProviderProfile(overrides?)  buildProviderCategory(overrides?)
```

Each returns a plain object carrying every field its model requires, with overrides shallow-merged
last. Nothing is validated on the way out: a builder must be able to produce a *deliberately
invalid* row, because half the tests that matter are the ones asserting a constraint fires.

### 4.3 Persisting factories — `createUser(client, overrides?)` and siblings

```ts
const user = await createUser(prisma);
const profile = await createProviderProfile(prisma);   // creates its own user
const address = await createAddress(prisma, { userId: user.id });
```

**Decision D — the client is a structural interface, not `PrismaClient`.** `FactoryClient` declares
only the `create` calls the factories make. This is the `W1-T07` recorder trick and it buys three
things: `packages/testing` takes no dependency on `@prisma/client`, so `apps/web`'s browser test
bundle stays clean and the package needs no second entry point; a recording fake satisfies the
interface in ten lines; and therefore the factory *logic* — parent auto-creation, override
merging, uniqueness — is tested in CI's `unit` job rather than behind `STACK_LIVE`.

The risk it takes on is that the structural interface could drift from Prisma's real shape. AC14
is the one criterion that needs a database, and it exists to close exactly that gap.

**Decision E — a factory creates the parent it needs unless given one.** `createProviderProfile`
with no `userId` creates a user. The alternative makes every test open with three lines of
scaffolding, which is the thing this task exists to delete.

---

## 5. Permissions matrix

Not applicable — a test-only package with no runtime callers and no roles.

The one rule that matters is a boundary rather than a permission: **`@marketplace/testing` is a
`devDependency` everywhere and is never imported from `src/`.** AC2 enforces it.

---

## 6. Error cases

No error envelope: nothing here reaches the wire. Two failures are worth naming:

| Failure | How it presents | Why it is acceptable |
|---|---|---|
| A test forgets `beforeEach(resetFactories)` | Ids continue across tests, so one test's ids depend on which tests ran before it | Loud in a diff, and AC8 documents the contract. Q1 proposes making it automatic. |
| A builder is asked for an invalid row | It produces one | Deliberate (§4.2) — a constraint test needs invalid input. |

---

## 7. Acceptance criteria

### The package

1. **AC1** — Given the workspace, When `pnpm build` runs, Then `@marketplace/testing` builds and is
   resolvable as `@marketplace/testing` from `apps/api`, `apps/web` and `packages/contracts`.
2. **AC2** — Given the repository, When the import graph reachable from `packages/testing/src` is
   walked, Then it imports neither `@prisma/client` nor any `apps/**` module; and no file under any
   `src/` directory in the repo imports `@marketplace/testing`.

### Builders

3. **AC3** — Given each of the six builders, When called with no arguments, Then it returns an
   object carrying every field its Prisma model requires and no field the model does not declare.
4. **AC4** — Given a builder and an overrides object, When called, Then the overrides replace the
   defaults and everything unnamed keeps its default.
5. **AC5** — Given two consecutive calls to the same builder, When their results are compared, Then
   their ids differ, and for `User` their emails differ — the unique index on `lower(email)` makes
   a shared default email an immediate collision.
6. **AC6** — Given any builder, When it produces an id, Then the id parses as a v4-shaped uuid, and
   ids from two different builders never collide.
7. **AC7** — Given three consecutive builder calls, When their `createdAt` values are compared,
   Then they are distinct and strictly increasing, so a keyset-paging test (`W1-T02`) has the total
   order it needs.

### Determinism

8. **AC8** — Given a sequence of builder calls, When `resetFactories()` is called and the identical
   sequence is repeated, Then the second run's output is deeply equal to the first's.
9. **AC9** — Given `packages/testing/src`, When its source is scanned, Then no file references
   `Math.random`, `Date.now`, or constructs a `Date` from the current time — the three ways
   determinism is lost by accident.

### Coverage — the criterion that makes the convention stick

10. **AC10** — Given `apps/api/prisma/schema.prisma`, When every `model` it declares is
    enumerated, Then each has a builder and a persisting factory, and each model that declares an
    `id` field also has a registered id prefix — except models on an explicit allowlist, each
    carrying a written reason. A model added later fails this test until its factory exists.

### Persistence, against a recording fake

11. **AC11** — Given a fake client, When `createUser` is called, Then exactly one `user.create` is
    issued, its `data` is the builder's output, and the created row is returned.
12. **AC12** — Given a fake client and no `userId`, When `createProviderProfile` is called, Then a
    user is created first and the profile's `userId` is that user's id.
13. **AC13** — Given a fake client and an explicit `userId`, When `createProviderProfile` is
    called, Then no user is created and the supplied id is used.

### Persistence, against a real database

*(Runs only with `STACK_LIVE=1` — see §10 ESC-1.)*

14. **AC14** — Given a migrated database and a real `PrismaClient`, When every persisting factory
    is called in turn, Then each row is written and reads back — proving `FactoryClient` matches
    Prisma's real shape, and that the builders' defaults satisfy the schema's constraints (the
    `postal_code` pattern, the `service_radius_metres` bound, the `lower(email)` unique index).

---

## 8. Data

No schema change. No migration. This task reads `schema.prisma` (AC10) and writes to it never.

---

## 9. Out of scope

- **`Job` and `Booking` factories.** The issue names them; the tables do not exist. `W1-T05`
  shipped six tables and neither is among them. AC10 is what guarantees they get factories on the
  day they are added, which is a better answer than guessing their columns now.
- **`AuditRecord`.** It arrives with `W1-T07` (PR #195), which is unmerged and not on this branch.
  When #195 lands, AC10 will fail on this branch until an audit-record factory is added. That is
  the gate working, and the rebase is the moment to add it.
- **`SeedRun` / `_seed_run`.** On AC10's allowlist: it is `agent-devops`'s ledger of which seeders
  have run (`MEM-2026-09-09-15`), not domain data any test should be fabricating.
- **The production seed.** `apps/api/prisma/seed/` stays where it is and keeps its own registry.
  Factories are for tests. Sharing the two sounds tidy and would let a test's data reach a real
  database, which is a much worse failure than a little duplication.
- **Composite builders** (`aProviderWithThreeCategoriesInMadrid`). They belong to the slice whose
  scenario it is, built from these primitives.
- **Retro-fitting existing tests.** `core-schema.test.ts`'s private `makeUser` stays. Rewriting
  W1-T05's merged tests from this branch is scope creep (L10) and would put an agent-contracts
  change inside another task's proven test file.

---

## 10. Open questions

### ESC-1 — the live criterion again does not run in CI

```
ESCALATION
what:     AC14 lives in `apps/api/tests/factories-live.test.ts`, and
          `.github/workflows/ci.yml` lines 127-129 name the live suites by hand. It will not run.
why me:   `.github/workflows/**` is forbidden to this agent (L4).
mitigation: This spec deliberately pushes AC11..AC13 onto a recording fake so that the factory
          logic runs in the `unit` job. Only AC14 — does `FactoryClient` match real Prisma —
          needs a database. So the exposure here is one criterion, not five as in `W1-T07`.
options:  (a) `agent-devops` adds one line. (b) Land #174. (c) Merge with AC14 unproven in CI.
default:  (a), stated in the PR. This is the second task in a row to hit it; #174 is no longer a
          theoretical concern.
```

### Q1 — should `resetFactories()` be automatic?

It could be registered in `packages/config`'s vitest preset, making it impossible to forget
(§4.1 Decision C). That file belongs to `agent-devops` and to slice S0, so proposing it is right and
doing it here is not (L4). **Assumed: manual for now, documented in the package README.** Not
blocking.
