# Run record — W1-T07 state-machine

```
Agent:        agent-contracts
Model:        claude-opus-5
Charter rev:  1
Skills used:  test-driven-development, api-and-interface-design, spec-driven-development
Started:      2026-09-10T23:02:00Z   Finished: 2026-09-10T23:20:00Z
Session file: memory/sessions/2026-09-10-agent-contracts-W1-T07.md
```

---

## Prompts

### 1. Spec authoring

Verbatim, from the operator:

> start with next task. Eventually, pick 3 to complete in serie

followed, after a plan was presented and three tasks proposed (W1-T07, W1-T09, W1-T08):

> proceed with w1t07. skip t08 for now

The spec was then written against `agents/prompts/00-spec-authoring.md`, which was loaded verbatim
and followed section by section. Its ten required sections are the ten sections of
`W1-T07-state-machine.md`.

Boot sequence per `AGENTS.md` §0 was executed first: `agents/AGENTS.md`,
`agents/roles/agent-contracts.md`, `memory/LONG_TERM.md`, `memory/repo/conventions.md`,
`memory/repo/glossary.md`, `memory/slices/agent-contracts.md`, `memory/sessions/` (no open file for
this task ID), `TODO.md` §3 and §6, and the two adjacent merged specs `W1-T05` and `W1-T06`.

### 2. Contract proposal

Not re-prompted. This agent **is** `agent-contracts`, so `prompts/01-contract-proposal.md` — whose
purpose is for another agent to request a seam change — does not apply. The freeze was performed
directly, per L3, and consists of:

- `packages/contracts/src/state-machine.ts` (new, exported from `src/index.ts`)
- `apps/api/prisma/schema.prisma` — `AuditRecord` model, `ActorType` enum
- `apps/api/prisma/migrations/0006_audit_record/{migration.sql,down.sql}`

### 3. TDD red

`agents/prompts/02-tdd-red.md`, loaded verbatim and followed. The stub-surface step it implies for
a new module comes from this slice's own memory:

> **MEM-2026-09-10-03** — When the deliverable *is* the module, the honest red phase needs the
> surface to exist first as functions that throw, and any schema as a validator that accepts
> everything. Some tests will still pass vacuously; name each one and say why in the run record.

### 4. Implementation

`agents/prompts/03-implement-green.md`.

### 5+. Corrections

None. No re-prompt was needed: the implementation passed all 26 criteria on its first run, and no
test was modified after the red phase.

---

## Red phase

### Stub surface

`src/state-machine.ts` was first written with the full type surface, every function throwing
`W1-T07 not implemented`, and `AuditRecordSchema = z.any()`.

The Prisma half of the freeze was **deliberately reduced** for the red run. Migration `0006` was cut
back to exactly what `prisma migrate diff` produced — table, enum, two indexes — with the `CHECK`
and the append-only trigger held back until the green phase, and the two objects dropped from the
dev database to match. Writing the trigger first would have made AC23/AC24 pass on their first ever
run, which is no evidence that the test would catch the trigger's absence. That is the exact trap
`MEM-2026-09-10-03` describes.

### `packages/contracts` — 22 tests, 22 failed

```
 RUN  v5.0.0 /Users/davide.arcinotti/experiments/marketplace/packages/contracts

 ❯ tests/state-machine.test.ts (22 tests | 22 failed) 9ms
   ❯ AC1..AC6 — defineMachine refuses a table that does not describe a machine (6)
     × AC1 — returns a frozen machine exposing what it was given 2ms
     × AC2 — refuses a rule naming a state that is not declared, naming the state 1ms
     × AC3 — refuses two rules for the same (from, event), which would depend on array order 0ms
     × AC4 — refuses a state unreachable from initial, naming it 1ms
     × AC5 — refuses a dead-end state that was not declared terminal 0ms
     × AC6 — refuses a terminal state that has an outgoing transition 0ms
   ❯ AC7..AC14 — a transition is permitted only if the table says so (8)
     ...

 FAIL  tests/state-machine.test.ts > ... > AC1 — returns a frozen machine exposing what it was given
Error: W1-T07 not implemented
 ❯ defineMachine src/state-machine.ts:95:9
     93|   _definition: MachineDefinition<S, E, Ctx>,
     94| ): StateMachine<S, E, Ctx> {
     95|   throw new Error(NOT_IMPLEMENTED);
       |         ^

 FAIL  tests/state-machine.test.ts > ... > AC20 — actorType and actorId are one fact and cannot disagree
AssertionError: a SYSTEM actor carrying a user id was accepted: expected true to be false

 Test Files  1 failed (1)
      Tests  22 failed (22)
```

### `apps/api` live — 4 tests, 4 failed

```
     × AC22 — a transition writes the state and exactly one matching audit row 2474ms
     × AC23/AC24 — a written record can be neither updated nor deleted 1867ms
     × AC25 — a failed audit write rolls the state change back 1741ms
     × AC26 — the column refuses a SYSTEM actor carrying a user id 1937ms

Error: W1-T07 not implemented                                              (AC22)
AssertionError: expected 'NO_ERROR' to match /AUDIT_RECORD_IMMUTABLE/       (AC23/AC24)
Error: W1-T07 not implemented                                              (AC25)
AssertionError: expected 'NO_ERROR' to match /audit_record_actor_pairing_check/  (AC26)

 Test Files  1 failed (1)
      Tests  4 failed (4)
```

The first live run failed with `TypeError: defineMachine is not a function` instead — the stub had
not been built into `dist/`, which `@marketplace/contracts` resolves to. That is a stale-build
failure, not a missing-behaviour one, so the package was rebuilt and the red run repeated. The
output above is the repeated run.

### Vacuous passes

| Test | Passed in red? | Why | Verdict |
|---|---|---|---|
| — | — | — | — |

**None.** All 26 criteria failed in the red phase, every one of them because the behaviour was
missing: 22 on the stub's `W1-T07 not implemented`, AC20 on `z.any()` accepting a contradiction it
must reject, and AC23/AC24/AC26 on database objects that did not yet exist.

This is the criterion `W1-T06` could not meet (its currency literal never went red). It was met
here only because the trigger and the `CHECK` were held out of the contract-freeze step; had they
gone in with the rest of the migration, three criteria would have passed vacuously and this table
would have three rows.

---

## Green phase

```
 RUN  v5.0.0 /Users/davide.arcinotti/experiments/marketplace/packages/contracts
 Test Files  1 passed (1)
      Tests  22 passed (22)

 RUN  v5.0.0 /Users/davide.arcinotti/experiments/marketplace/apps/api   (STACK_LIVE=1)
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

No test was changed between red and green.

AC22, AC25 and AC26 each build their own scratch database with `prisma migrate deploy`, so they
exercise the committed `migration.sql` — including the trigger and the `CHECK` — rather than the
hand-patched development database.

### Full local gate

```
pnpm typecheck     Tasks: 6 successful, 6 total
pnpm lint          ESLint: No issues found
pnpm format:check  All matched files use Prettier code style!
pnpm test          Test Files 10 passed (10) · Tests 224 passed | 6 skipped (230)
pnpm build         Tasks: 4 successful, 4 total

prisma migrate diff --from-url <migrated dev db> --to-schema-datamodel  →  No difference detected.
```

`pnpm format:check` is in that list **after the fact**: the first CI run failed `lint` on two
unformatted test files, because the `lint` job runs `pnpm lint` *and* `pnpm format:check` and the
local self-review had only run the first. Fixed in a follow-up commit; both suites re-run green
after formatting. The lesson is in the self-assessment below.

The drift check is run `--from-url` against the migrated development database rather than
`--from-migrations` with a `--shadow-database-url`. Prisma resets the shadow database before
replaying, which drops the PostGIS extension, and migration `0000` then correctly refuses to apply
with `POSTGIS_MISSING`. Worth knowing before someone reads that failure as drift.

---

## Deviations from spec

None. All 26 acceptance criteria are implemented and tested as written.

Two things the spec named as decisions and the code carries unchanged: `check` normalises its
rejection so that what it returns is exactly what `transition` would throw (§7 AC13), and
`transition` freezes the audit record it hands to the recorder.

---

## Human input received

- The operator chose the task (`proceed with w1t07`) and dropped `W1-T08` from the series.
- No human edited, rejected or overrode any output on this branch, so no ledger entry under
  `docs/interventions/` is required (L7).
- **Outstanding, non-blocking**: ESC-1 in spec §10 asks `agent-devops` or the operator for one line
  in `.github/workflows/ci.yml`. Unresolved at the time of writing — see below.

---

## Self-assessment

**Weakest part of this change.** AC22…AC26 do not run in CI. `.github/workflows/ci.yml` lines
127-129 name the live suites by hand, `apps/api/tests/audit-record.test.ts` is not among them, and
`.github/workflows/**` is forbidden to this agent (L4). So the `database` job will report green
having run none of the five criteria that prove the ledger works against a real database. They pass
locally, and the output above is that run — but a green CI run on this PR means less than it looks
like it means, which is precisely the fail-open case issue #174 was filed for. This needs one line
added by someone who may touch that file, or #174 landed first.

**What a reviewer should look at hardest.**

1. **`check` with a `from` the machine does not declare.** It returns `CONFLICT` rather than
   raising `StateMachineDefinitionError`. Inside TypeScript that state is unreachable, but the
   value will in practice come from a database column, and a row holding a status the machine has
   never heard of is a real defect that this code reports as an ordinary 409. No acceptance
   criterion covers it, so treating it as a defect was out of scope under L10 — but it is the one
   design choice here I would most expect a reviewer to want changed. Worth its own task.
2. **Atomicity is the caller's to provide.** `transition` cannot open a transaction (Decision B),
   so a caller who forgets `$transaction` gets a state change and an audit record that can diverge.
   AC25 proves the mechanism supports atomicity; nothing can prove a future caller used it. If that
   is judged too weak a guarantee for money, the answer is a wrapper in the slice that owns the
   client, not a Prisma import in the seam.
3. **The append-only trigger versus `pnpm db:reset`.** Verified before committing to it:
   `prisma migrate reset` drops the schema and replays, and row-level triggers do not fire on
   `TRUNCATE`. Both reset paths are unaffected.

4. **Nothing, in the diff of the second commit.** It is `prettier --write` output only.

**What I would tell the next agent working in this slice.**

The `lint` CI job is two commands, not one: `pnpm lint` *and* `pnpm format:check`. Running only the
first is how this branch burned a CI cycle. `pnpm typecheck && pnpm lint && pnpm format:check &&
pnpm test && pnpm build` is the actual local gate.

Declare your machine once, at module scope, so `defineMachine`'s checks run at boot rather than per
request — that is the whole reason the validation lives at definition time. Do not write to
`audit_record` directly; the table is append-only and a wrong row cannot be corrected, only
followed by a right one. And when your deliverable is a database object rather than a function,
hold it out of the contract-freeze step: land the plain `migrate diff` output, watch the test fail,
then add the trigger. It is the only way the DDL gets a real red phase.
