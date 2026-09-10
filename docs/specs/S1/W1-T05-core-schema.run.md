# Run record — W1-T05 core database schema

| | |
| --- | --- |
| Agent | `agent-contracts` |
| Model | `claude-opus-5` |
| Skills used | `agents/prompts/00-spec-authoring.md`, `agents/policies/escalation.md`, `test-driven-development` (red before green), `memory/repo/glossary.md` |
| Started | 2026-09-10 |
| Spec | `docs/specs/S1/W1-T05-core-schema.md` |
| Issue | [#59](https://github.com/mastrobardo/marketplace/issues/59) |

---

## What was asked, and how the order changed

The agreed serial W1 order had `W1-T07` next. The operator changed it mid-plan to see the basic
schema first, with one explicit instruction: **one readable table per entity in the spec**. That
shaped the document — §5 is six entity tables plus an index table each, rather than a prose design
with a Prisma block at the end.

Worth recording because it was a good instinct: the entity tables are what surfaced Q1 and Q2. Two
columns holding the same fact are easy to miss in prose and impossible to miss in a table.

## The spec came first, and stopped

Spec committed at `b1af038` with **no implementation**, five escalations, and the task's status line
saying so. The operator answered all five (`bd7d4e4`). Nothing in `schema.prisma` was written until
that point, which is the pipeline's contract-freeze step doing its job rather than a formality.

**Q2 was answered more broadly than it was asked, and this was the most valuable moment in the
task.** The question was whether `ClientProfile.defaultLocation` should point at an `Address`. The
answer — *"fine for address, but we need both address and lat lng"* — is a rule about what a
location **is**. Applied consistently it also condemns `ProviderProfile`'s bare `latitude`/
`longitude`, which were coordinates with no address. I asked one clarifying question rather than
guessing, because the sentence had two readings that produced materially different tables, and the
answer collapsed two geography implementations into one.

What that bought and cost is in spec §13; the cost is a new privacy rule (a base address is usually
a home) that did not exist when the provider had no address at all. It is written into §8 as a deny
that `W3-T02` and `W3-T07` inherit, because a constraint living only in the head of whoever wrote
the schema is not a constraint.

## Red phase

`apps/api/tests/core-schema.test.ts`, 22 tests, run **before** any schema existed:

```
Tests  21 failed | 1 passed (22)
  model User is missing
  0002_core_enums/down.sql does not exist
  AC-1 — user: expected 'f' to be 't'
  AC-3..AC-17 — relation "user" does not exist
```

**The one passing test was passing for the wrong reason.** AC-13 (no Prisma drift) went green
against an empty schema, because nothing that could drift existed. A green test in a red phase is
worth looking at rather than being pleased about — this one only became meaningful once there was a
generated column to check, which is exactly when it failed.

## Four things the tests found that the design had not

**1. `user` is a Postgres keyword, and the failure is silent.** Checked rather than assumed, in
psql against a real table:

```
CREATE TABLE "user" (id int);
SELECT 1 FROM user LIMIT 1;   -->  1
```

That returned a row. The parser resolves the bare word to `current_user`, so a missing pair of
quotes reads something entirely different instead of erroring. The table became `app_user`; the
Prisma model, the API and the spec still say `User`. This is a deviation from the spec the operator
had just approved, made because the evidence is unambiguous and the domain model is unchanged — it
is recorded in §5.1 with the transcript above rather than applied quietly.

**2. `@updatedAt` makes every raw-SQL insert fail.** It is applied by the Prisma *client*, so the
generated column is `NOT NULL` with no database default. This is not a test-only problem: `W3-T05`
must use raw SQL for `ST_DWithin`, and the seed pipeline is raw. Fixed at the schema layer with
`@default(now()) @updatedAt` — Prisma emits the `DEFAULT` itself, so there is no drift. The residual
limitation (a raw `UPDATE` leaves `updated_at` stale) is recorded in §6 rather than solved with a
trigger on five tables.

**3. Reading the drift report beat applying the pre-agreed fallback.** AC-13 failed as feared. But
the report was specific:

```
[*] Altered column `location` (default changed from
    `Some(DbGenerated(Some("(st_setsrid(st_makepoint(...), 4326))::geography")))` to `None`)
```

Prisma reads `GENERATED ALWAYS AS … STORED` as a column **default** and wanted to drop it only
because the datamodel declared none. Declaring the same expression as `@default(dbgenerated(...))`
made AC-13 pass. **Q4's approved fallback was not needed and stands unused.** The generalisable
part: a drift report that names *what* differs is a specification of the fix, not just a verdict.
Reaching for the contingency plan without reading it would have thrown away the generated column
for no reason.

**4. Two of my own tests were wrong, in ways worth naming.** `psql -tAc` with `RETURNING id` prints
the row *and* the `INSERT 0 1` status tag, and feeding that pair back as a uuid produced a parse
error that read exactly like a schema bug. And the SQLSTATE regex looked for `SQLSTATE: 23505` when
verbose psql prints `ERROR:  23505:` — so a constraint that was working correctly reported as a
failure. Both were test defects presenting as product defects; in both cases the fix was in the
harness, and in neither case did the schema change.

## Green

```
Tests  22 passed (22)      core-schema.test.ts (STACK_LIVE=1)
Tests  77 passed (77)      whole apps/api suite, including W0-T05's own drift criterion
typecheck  6/6 · lint  6/6 · build  4/4 · prettier clean
```

AC-16 deserves a note: it asserts the planner *uses* `address_location_gist`, not merely that the
index exists, by inserting 20 000 rows and reading `EXPLAIN`. A GIST index Postgres declines to use
is indistinguishable from a working one in `pg_indexes`, and that is the failure this schema exists
to prevent.

AC-18 (category depth ≤ 2) is declared in this spec and tested in `W3-T01`, because §5.5 deliberately
puts that rule in the application rather than in a trigger.

## Deliberate non-changes

**The live-database helpers in `core-schema.test.ts` duplicate `db.test.ts` rather than extracting a
shared module.** That file belongs to `W0-T05` / `agent-devops`, and refactoring another slice's
tests to save forty lines is precisely the non-functional restructuring
`agents/prompts/00-spec-authoring.md` says to get agreed first — `W0-T23` was built, merged and
reverted whole for less. The duplication is noted at the top of the file so it reads as a decision.

**No seed data.** `W3-T01` seeds categories and a human decides the licence flags.

## What this leaves for the next task

- `W1-T07` (state machine, #61) can now persist an audit record if it wants to — though the spec's
  §7 `User.status` table is declared, not implemented, and `AuditLog` is deliberately still absent.
- `W3-T05`'s proximity query is written out in §5.3, joining `provider_profile → address`, so the
  first geo endpoint starts from a query that has been run rather than one that has been imagined.
- The privacy deny in §8 needs a test each in `W3-T02` and `W3-T07`.
