# Run record — W1-T09 test-factories

```
Agent:        agent-contracts
Model:        claude-opus-5
Charter rev:  1
Skills used:  test-driven-development, api-and-interface-design, spec-driven-development
Started:      2026-09-11T00:00:00Z   Finished: 2026-09-11T00:15:00Z
Session file: memory/sessions/2026-09-11-agent-contracts-W1-T09.md
```

---

## Prompts

### 1. Spec authoring

Verbatim, from the operator, choosing the second task of an agreed series:

> W1-T09 (shared test factories in packages/testing) was slot 2 in the approved plan. Still next?
> → **Yes, W1-T09 next**

Written against `agents/prompts/00-spec-authoring.md`. §3 (state machine) and §5 (permissions) are
answered "not applicable" with the reason rather than omitted, because the prompt asks for a
judgement, not a section.

### 2. Contract proposal

Not re-prompted — this agent *is* `agent-contracts` (see `W1-T07`'s run record for the same note).
The freeze here is a new workspace package rather than a schema change:

- `packages/testing/` — manifest, tsconfig, eslint, vitest, tsup config, stub `src/index.ts`
- `"@marketplace/testing": "workspace:*"` in `devDependencies` of `apps/api`, `apps/web`,
  `packages/contracts`
- `infra/docker/api.Dockerfile` — one `COPY` line (see "Green phase" for how that was found)

No change to `apps/api/prisma/schema.prisma`. This task reads it and writes it never.

### 3. TDD red

`agents/prompts/02-tdd-red.md`, plus `MEM-2026-09-10-03` for the stub surface, plus
`MEM-2026-09-10-11` — the DDL refinement written on the previous task, which did not apply here
because nothing in `W1-T09` is a database object.

### 4. Implementation

`agents/prompts/03-implement-green.md`.

### 5+. Corrections

Two, both to **tests**, neither to a criterion:

1. **The reset hook was masking the red phase.** The first red run reported 27/27 failed, which was
   flattering and wrong: a file-level `beforeEach(resetFactories)` threw, so every test failed in
   the hook — including the structural ones that never touch the sequence. Re-scoped the hook to
   the two `describe` blocks that consume the sequence and re-ran. The honest figure is **19 failed,
   8 passed**, and the eight are named below. *Why the re-prompt was needed*: a red phase that
   fails for a reason unrelated to the behaviour under test is exactly the thing the run record
   exists to make visible, and reporting 27/27 would have hidden eight vacuous passes.
2. **AC9's scanner matched its own documentation.** The test forbids `new Date()` in `src`; it
   failed on the doc comment in `sequence.ts` that says *"never `new Date()`"*. Fixed by stripping
   comments before scanning. This makes the assertion correct rather than weaker — a comment
   explaining the rule is the opposite of the hazard, and a scanner that punishes explaining it
   teaches agents not to explain.

A third correction was to the **spec**: AC10 originally required "a registered id prefix" for every
model. `ProviderCategory` has a composite primary key and no `id` column at all, so the criterion
was unsatisfiable as written. Corrected before the red run, not after.

---

## Red phase

### Stub surface

`src/index.ts` written with the full type surface and every function throwing
`W1-T09 not implemented`; `ID_PREFIXES` an empty object.

### `packages/testing` — 27 tests, 19 failed, 8 passed

```
     × AC3 — every builder fills every field its model requires
     × AC3 — the provider defaults satisfy the schema CHECKs, not merely its types
     × AC4 — overrides replace defaults and leave everything else alone
     × AC5 — consecutive calls differ in id, and users differ in email
     × AC6 — ids are v4-shaped and never collide across entities
     × AC7 — createdAt is distinct and strictly increasing, so keyset paging has a total order
     × AC8 — resetFactories() restores byte-identical output
     × AC8 — without a reset, the sequence advances rather than repeating
     × User / ClientProfile / ProviderProfile / Address / Category — has a builder and a factory
     × AC11 — createUser issues exactly one user.create with the built row
     × AC12 — createProviderProfile with no userId creates the user it needs
     × AC13 — createProviderProfile with a userId creates no user
     × AC12 — createAddress and createClientProfile create their user too
     × AC12 — createProviderCategory creates both sides of the join
     × AC11 — createCategory needs no parent and issues one call

 Test Files  1 failed (1)
      Tests  19 failed | 8 passed (27)
```

### `apps/api` live — 3 tests, 3 failed

```
     × AC14 — every factory writes a row that reads back, through a real PrismaClient
     × AC14 — consecutive users do not collide on the lower(email) unique index
     × AC14 — a builder default that violates a CHECK is rejected by the database, not silently kept

Error: W1-T09 not implemented

 Test Files  1 failed (1)
      Tests  3 failed (3)
```

**This run was reconstructed, and that is worth saying plainly.** The live file was written during
the red phase but not *executed* until after the implementation existed, because it imports the
built package — so it passed on its first run and AC14 was never observed red. Rather than claim a
red phase that did not happen, the implementation was moved aside, the stub surface restored, the
package rebuilt, and the live suite re-run to produce the output above. The implementation was then
restored and both suites re-run green.

### Vacuous passes

| Test | Passed in red? | Why | Verdict |
|---|---|---|---|
| AC1 — private ESM package with four scripts | yes | `package.json` is a contract-freeze artefact; it existed before any behaviour did | Acceptable. It asserts wiring, not behaviour, and wiring is what the freeze step is for. |
| AC1 — is a devDependency of three consumers | yes | Same — the three manifests were edited in the freeze | Acceptable, same reason. |
| AC2 — imports no `@prisma/client`, nothing under `apps/` | yes | The stub imported nothing at all | **Weak.** It cannot fail until something is imported; its value is as a regression guard for the next agent, not as proof today. |
| AC2 — no production source imports the factories | yes | Nothing imported the package yet | **Weak**, same reason. Both AC2 tests earn their place going forward, not now. |
| AC9 — no `Math.random` / `Date.now` / bare `new Date()` | yes | The stub contained no code to violate it | **Weak** on the same grounds — but it did real work later, catching the comment-scanning defect above. |
| AC10 — "finds the models at all" | yes | A deliberate sanity check on the regex, not a criterion. Without it a regex matching nothing would make every AC10 case pass silently | Correct by design. |
| AC10 — `SeedRun` is allowlisted | yes | The allowlist lives in the test file | Acceptable — it asserts the allowlist carries a reason, which is a property of the test, deliberately. |
| AC10 — `ProviderCategory` has a builder and a factory | yes | The stub exported both functions, and `ProviderCategory` has no `id`, so the prefix check that failed the other five models was skipped | **Weak.** The other five models' cases failed correctly; this one shows `toBeTypeOf('function')` is a thin assertion against a stub surface. |

Eight of 30 criteria passed before any behaviour existed, four of them weakly. That is worse than
`W1-T07`'s clean zero, and the reason is structural: several of this task's criteria are *about*
wiring and boundaries, and wiring is established in the freeze step by definition. Naming them is
the honest alternative to pretending otherwise.

---

## Green phase

```
 RUN  v5.0.0 …/packages/testing
 Test Files  1 passed (1)
      Tests  27 passed (27)

 RUN  v5.0.0 …/apps/api   (STACK_LIVE=1)
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### Full local gate — all five commands

```
pnpm typecheck     Tasks: 8 successful, 8 total
pnpm lint          ESLint: No issues found
pnpm format:check  All matched files use Prettier code style!
pnpm test          Test Files 10 passed (10) · Tests 224 passed | 6 skipped (230)
pnpm build         Tasks: 5 successful, 5 total
```

Five commands this time, because `W1-T07` shipped with only four run and CI caught the fifth.

`pnpm test` failed on the first attempt, and on something no criterion in this spec covers:

```
FAIL tests/cd-workflows.test.ts > the image knows about every workspace package
AssertionError: these workspace members are not COPYed into the image:
  expected [ 'packages/testing' ] to deeply equal []
```

`infra/docker/api.Dockerfile` lists every workspace member's manifest by hand, and `W0-T07` had
already written the test that fails when a new one is not added. One `COPY` line fixed it. Worth
noting as the counter-example to this repo's other hand-maintained list: the same pattern, but with
a test behind it, so it fails closed instead of open.

---

## Deviations from spec

- **AC10 was corrected before the red run**, not implemented as originally written: "every model has
  a registered id prefix" became "every model *that declares an `id` field*". `ProviderCategory`'s
  primary key is the composite `(providerProfileId, categoryId)`. The spec carries the corrected
  wording.
- `infra/docker/api.Dockerfile` is touched, which §4 did not anticipate. It is one line, it is
  required to wire a new workspace member, and an existing test demanded it.

Otherwise none. All 30 criteria are implemented and tested as written.

---

## Human input received

- The operator selected this task from the series and, in the same exchange, chose `W1-T03 + W1-T04`
  for the third slot.
- No human edited, rejected or overrode any output on this branch — no `docs/interventions/` entry
  is required (L7).
- **Outstanding, non-blocking**: ESC-1 (spec §10), unchanged from `W1-T07` and now on its second
  task.

---

## Self-assessment

**Weakest part of this change.** The four weak vacuous passes in the table above — both AC2 tests,
AC9, and `ProviderCategory`'s AC10 case. Each asserts an absence, and an absence is trivially true
of a stub. They are worth keeping as regression guards for the agents who come next, but nobody
should read them as evidence that this branch got something right.

**What a reviewer should look at hardest.**

1. **`FactoryClient` versus real Prisma.** The structural interface is the central bet of this
   design (§4.3 Decision D). It bought the ability to test AC11..AC13 in CI's `unit` job instead of
   behind `STACK_LIVE`, which given ESC-1 is the difference between tested and not. It costs an
   `as unknown as FactoryClient` cast in the live test, which is exactly where a drift would hide.
   AC14 exercises all six delegates against a real client to compensate. If a reviewer thinks that
   trade is wrong, this is the place to say so — it is cheap to reverse now and expensive later.
2. **The builder defaults are opinions.** `ProviderProfile.kind` defaults to `MANITAS` so that a
   test forgetting to specify gets the *unlicensed* kind and a missing licence check fails rather
   than passes. `Category.requiresLicence` defaults to `false` for the mirror-image reason. Both
   are deliberate and both are arguable.
3. **`resetFactories()` is manual.** Q1 in the spec. A test that forgets it still passes, and its
   ids then depend on which tests ran before it. The fix belongs in `packages/config`'s vitest
   preset, which is `agent-devops`'s file.

**What I would tell the next agent working in this slice.**

Add a factory when you add a table — AC10 will fail until you do, and that is the point.
`beforeEach(resetFactories)` in every file that builds anything. If you need a scenario rather than
a row (`a provider with three categories in Madrid`), build it in your own slice from these
primitives; composite builders here would become a dumping ground.

And: **the local gate is five commands, not four.** `pnpm typecheck && pnpm lint &&
pnpm format:check && pnpm test && pnpm build`.
