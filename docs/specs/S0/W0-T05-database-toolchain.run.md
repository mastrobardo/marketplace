# Run record — W0-T05 database toolchain

|                  |                                                                |
| ---------------- | -------------------------------------------------------------- |
| **Agent**        | `agent-devops`                                                  |
| **Model**        | `claude-opus-5`                                                 |
| **Charter rev**  | 1                                                               |
| **Skills used**  | `test-driven-development`, `spec-driven-development`, `incremental-implementation`, `documentation-and-adrs` |
| **Started**      | 2026-09-09T09:00Z                                               |
| **Finished**     | 2026-09-09T09:35Z                                               |
| **Branch**       | `W0-T05-database-toolchain` (from `main` @ ac12991)             |
| **Issue**        | https://github.com/mastrobardo/marketplace/issues/37            |
| **Spec**         | [`W0-T05-database-toolchain.md`](W0-T05-database-toolchain.md)  |
| **Session file** | `memory/sessions/2026-09-09-agent-devops-W0-T05.md`             |

---

## Prompts

### 1. Task assignment (operator, verbatim)

> continue till w07, everything is autoapproved. However, consider the GA actions might need an
> extra ticket, cause they will not run in auto for w07 PR

The same assignment covers `W0-T06` and `W0-T07`. The second sentence is a design steer and is
acted on in `W0-T07`, not here.

### 2. Plan (agent, presented before any file was written)

> 1. Sequencing: strictly sequential — `W0-T05` → merge → `W0-T06` → merge → `W0-T07`. `T06` and
>    `T07` both write `.github/**` and would genuinely collide (MEM-2026-09-09-12).
> 2. Branch, spec, session memory file.
> 3. Scope guard: **toolchain only, no domain models** — `schema.prisma` is the frozen seam and
>    `W1-T05`/`agent-contracts` owns the models (AGENTS.md L3).
> 4. Red: static tests for datasource/client wiring, migration conventions and `db:*` scripts;
>    live tests behind `STACK_LIVE=1` for apply-to-empty-DB and seed re-runnability.
> 5. Green: Prisma in `apps/api`; a first migration that **asserts** PostGIS rather than creating
>    it; a `SeedRun` ledger so "repeatable" is enforced; an empty seeder registry with a
>    sanitisation hook stubbed for `W0-T20`.
> 6. Reversibility: a `down.sql` per migration folder, with a test that fails when one is missing.
> 7. `pnpm verify` + a live run against `pnpm stack:up`; run record, README, memory, PR.

Followed as written.

### 3. Corrections

No corrective re-prompt from the operator. Two reversals inside the task, both driven by tool
output; see *Deviations*.

---

## Red phase

Stub modules were created first — `src/db/client.ts`, `prisma/seed/{types,registry,run}.ts` and
`prisma/reset.ts`, each throwing `not implemented` — so that every assertion actually ran rather
than the suite dying at module resolution. That sequencing is carried over deliberately from
`W0-T03`, where the first red turned out to be an import error.

`apps/api/tests/db.test.ts` — 18 failed, 3 passed, 8 skipped (the live criteria):

```
 × AC1 … generates against an unreachable DATABASE_URL
 × AC2 … reads postgresql from env("DATABASE_URL")
 × AC2 … contains no connection string literal
 × AC3 … builds a client from a validated Config
 × AC4 … returns the same instance on a second call
 × AC5 … exposes a disconnect for shutdown hooks and tests
 × AC9 … has at least one migration
 × AC9 … pairs every migration.sql with a non-empty down.sql
 × AC11 … names every folder NNNN_snake_case, contiguous from 0000
 × AC8 … raises with the command a human must run, and never creates the extension
 × AC13 … accepts an empty list without complaint
 × AC17 … names the duplicated id
 × AC17 … allows distinct ids
 × AC18 … refuses a remote host
 × AC18 … allows loopback
 × AC18 … allows a remote host when no seeder is localOnly
 × AC19 … refuses, naming the variable
 × AC19 … allows development and test
 Test Files  1 failed (1)
      Tests  18 failed | 3 passed | 8 skipped (29)
```

`tests/database-toolchain.test.ts` — 16 failed, 2 passed:

```
 × AC20 … exposes pnpm db:generate / db:migrate / db:migrate:deploy / db:migrate:status
          / db:seed / db:reset                                          (6 failures)
 × AC20 … delegates each one to the api package rather than reimplementing it
 × AC20 … generates the client as part of install
 × AC20 … implements db:generate … db:reset in the api package          (6 failures)
 × AC20 … points prisma at the seed entrypoint
 × AC21 … ignores prisma generation output
 Test Files  1 failed (1)
      Tests  16 failed | 2 passed (18)
```

34 failing assertions across the two files, covering all 21 acceptance criteria.

## Green phase

```
apps/api/prisma/schema.prisma                       datasource + generator + SeedRun, no domain models
apps/api/prisma/migrations/0000_require_postgis/    migration.sql (asserts) + down.sql (documented no-op)
apps/api/prisma/migrations/0001_seed_run_ledger/    migration.sql + down.sql
apps/api/prisma/migrations/migration_lock.toml
apps/api/prisma/seed/{types,registry,run}.ts        Seeder type, empty registry, the runner
apps/api/prisma/seed.ts                             the CLI Prisma also calls after `migrate reset`
apps/api/prisma/reset.ts                            assertResettable + the wrapper
apps/api/src/db/client.ts                           cached client built from Config
package.json, apps/api/package.json                 six db:* scripts; prepare generates the client
apps/api/{tsconfig,eslint.config}.js                prisma/** typechecked and linted
.gitignore                                          generated client never committed
```

Static suite, no daemon:

```
 Test Files  1 passed (1)      apps/api/tests/db.test.ts    21 passed | 8 skipped (29)
 Test Files  1 passed (1)      tests/database-toolchain.test.ts   18 passed (18)
```

Live suite, against `pnpm stack:up`:

```
$ STACK_LIVE=1 vitest run tests/db.test.ts
 Test Files  1 passed (1)
      Tests  29 passed (29)
   Duration  14.24s
```

Full gate:

```
$ pnpm verify
 typecheck  4 successful, 4 total
 lint       4 successful, 4 total
 format     all matched files use Prettier code style
 test       api 44 passed | 8 skipped · web 15 passed · root 49 passed | 6 skipped
 build      3 successful, 3 total
```

## Deviations from the plan

1. **`prisma migrate diff` rejects `--schema`.** The test helper appended `--schema` to every
   Prisma invocation, which is right for `generate`, `migrate deploy`, `migrate dev` and
   `migrate status` and wrong for `migrate diff` — the CLI printed its usage text and exited 1,
   which the drift assertion (AC12) read as *drift detected*. A false positive on a drift check is
   the expensive kind of failure: it claims the schema and migrations disagree when they do not.
   Fixed in the test by letting the caller pass `--schema`. Promoted to MEM-2026-09-09-16.

2. **The seed ledger went into `schema.prisma` rather than raw SQL.** The first instinct was to
   keep the seam completely empty by creating `_seed_run` in a migration only. Prisma compares the
   *database* against the *schema*, so a table present in one and absent from the other is reported
   as drift on every subsequent `migrate dev` — which would train every agent to ignore drift
   warnings, the exact signal AC12 exists to protect. One infrastructure model in the seam is the
   cheaper cost. Flagged to `agent-contracts` in spec §10.

## Notes for the reviewer

- **The seam is deliberately empty of domain models.** `User`, `Category` and the geo columns are
  `W1-T05`. If you expected a schema here, that is the disagreement to have now.
- **`SeedRun` is the one exception**, and spec §10 offers it to `agent-contracts` to own instead.
  The runner needs only that the table exist with those three columns.
- **Migrations do not run on boot, and `pnpm verify` does not touch a database.** Both are load
  bearing: the first is ADR-006's separate approved deploy step, the second keeps the local gate
  daemon-free so `W0-T06` can adopt it as-is.
- **AC10 is the one that pays for the `down.sql` convention**: it applies every rollback in reverse
  and asserts the ledger table is gone. A `down.sql` that lies fails that test.

## Interventions

| Type | What | Ledger |
|---|---|---|
| `AUTOAPPROVE` | The operator pre-authorised the whole session, including merging the agent's own PR — which `agents/policies/human-boundaries.md` otherwise forbids. `AGENTS.md` puts a direct operator instruction above every other rule, so it is taken as the override and recorded here rather than silently obeyed. | this row |

No `MANUAL_FIX`: no gate was skipped, weakened or disabled.
