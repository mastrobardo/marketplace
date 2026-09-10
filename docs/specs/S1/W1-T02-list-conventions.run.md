# Run record — W1-T02 list conventions

|                  |                                                                              |
| ---------------- | ---------------------------------------------------------------------------- |
| **Task**         | `W1-T02` · issue [#56](https://github.com/mastrobardo/marketplace/issues/56) |
| **Agent**        | `agent-contracts` (charter rev 1)                                            |
| **Model**        | `claude-opus-5`                                                              |
| **Skills used**  | `test-driven-development`, `api-and-interface-design`                        |
| **Date**         | 2026-09-10                                                                   |
| **Spec**         | `W1-T02-list-conventions.md`                                                 |
| **Session file** | `memory/sessions/2026-09-10-agent-contracts-W1-T02.md`                       |

---

## 1. What landed

`packages/contracts/src/pagination.ts`: the request schemas (`paginationQuery`, `listQuery`), the
response envelope (`pageEnvelope`, `PageInfoSchema`), the cursor codec, the sort grammar, `pageOf`
and the keyset predicate — sixteen exports, one of which (`PaginationError`) exists to keep
programmer errors out of the client's error envelope.

60 tests in `packages/contracts/tests/pagination.test.ts`, plus one new type-level fixture project
and an addition to the existing `valid` one. `pnpm verify` clean end to end: typecheck, lint,
format, 224 tests across 10 files, both builds.

No file outside `packages/contracts` changed, apart from `TODO.md` — which carries the board tick
and the new `W0-T25` line, and is the one shared file this branch touches.

## 2. The red phase

The whole suite was written against the spec's §4.7 surface before any implementation existed, so
the first run failed at import:

```
 ❯ tests/pagination.test.ts (0 test)

 FAIL  tests/pagination.test.ts [ tests/pagination.test.ts ]
TypeError: paginationQuery is not a function
 ❯ tests/pagination.test.ts:32:15
     30| type Sortable = (typeof SORTABLE)[number];
     31|
     32| const query = paginationQuery({ sortable: SORTABLE, defaultSort: '-cre…
       |               ^

 Test Files  1 failed (1)
      Tests  no tests
```

That is a red phase, but it is the weak kind: **one** failure standing in for sixty, which proves
the module is absent and nothing about whether any individual test can fail for its own reason.
`MEM-2026-09-10-03` — this slice's own memory, written by `W1-T06` — says so explicitly: when the
deliverable *is* the module, the surface has to exist as stubs first.

So it was re-run against a stub surface: every export present, functions throwing, schemas as
`z.looseObject({})`, constants carrying their real values because a constant has no
implementation. **In the interest of an honest record: this stub run happened after the
implementation was already written and committed** — it is a reconstruction of the red phase the
memory asks for, not the order events occurred in. What it buys is real all the same, because it is
the only way to see which criteria can pass without any code behind them:

```
 ❯ tests/pagination.test.ts (60 tests | 54 failed) 692ms
 Test Files  1 failed (1)
      Tests  54 failed | 6 passed (60)
```

54 of 60 red, each on its own assertion. The six that passed against a stub, and why:

| Test                                                     | Why it passed with no implementation                                                                     | Verdict                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| AC2 "accepts the maximum"                                | `z.looseObject({})` passes `{ limit: 100 }` straight through, so `parsed.limit` is 100 by accident.       | Vacuous. Its sibling — the four rejection cases — is the half of AC2 that carries the decision. |
| AC21 "accepts a well-formed page"                        | Same: a loose object accepts every valid page, and every invalid one too.                                 | Vacuous. The three rejection cases next to it all went red, which is where AC21's strictness lives. |
| AC21 "exports the page info shape on its own"            | `PageInfoSchema` existing at all is what it asserts.                                                      | Vacuous by design — it is an export check, and it is in the AC list for `W1-T03`'s benefit.     |
| AC23 "compiles the fixture that pages a matching row"    | The stub's `(...args: unknown[])` signatures accept anything, so the positive fixture compiled.           | Vacuous — **and necessary**. `MEM-2026-09-09-09`: without it, a negative fixture that always fails and one that never runs are indistinguishable. Its negative sibling correctly went red. |
| AC24 "exports every name the spec lists"                 | A stub *is* the full export surface. This test passing is the definition of the stub being complete.      | Vacuous by construction.                                                                       |
| AC24 "keeps a Sortable field name usable as a type"      | Asserts on the test file's own `SORTABLE` tuple; no module code is involved.                              | Vacuous, and arguably should not be an AC at all — it tests TypeScript, not this module.        |

Nothing in the list is a criterion that was never tested: every decision in §2 of the spec is
carried by at least one test that went red on its own assertion. The pattern is that in each pair,
the permissive half passes against a stub and the restrictive half does not — which is the expected
shape when the deliverable's whole job is refusing things.

## 3. What the two failures were actually saying

**AC16 was asserting a path that does not exist.** The test handed `pageOf` one row with a limit of
one and expected a throw for the missing sort field. But with `rows.length === limit` there is no
next page, so no cursor is built, so nothing reads the field. The implementation was right and the
test was wrong: it now passes two rows for a limit of one, which is the only shape in which a
cursor is constructed at all. Worth stating plainly because the tempting "fix" was the other one —
validating every row in `pageOf` whether or not a cursor needs building, which would have added a
per-row check to every list response in the platform to satisfy a test that had misread the code.

**AC23 caught the thing `SortSpec` exists for, in my own fixture.** `readonly SortField<'createdAt' | 'priceCents'>[]`
cannot hold decision F's appended `{ field: 'id' }` — which is exactly why the module exports
`SortSpec<F> = readonly SortField<F | 'id'>[]`, and I had not used it. The fixture failed to
compile for the wrong reason, which would have made the negative half of AC23 pass for the wrong
reason too: a fixture that fails because it is malformed proves nothing about the guarantee it was
written to check. `MEM-2026-09-09-09` is the same trap by a different route.

## 4. One deliberate probe before writing a line of the module

Reporting a *dynamic* validation message from inside a zod transform has three plausible APIs in
zod 4, and picking wrong is a silent failure rather than a compile error. So all three were run
against the installed `zod@4.5.4` first:

| Form                                              | Result                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `.transform((v, ctx) => { ctx.addIssue(…) })`      | works — the custom message reaches `error.issues`                          |
| `.refine(pred, (v) => ({ message: … }))`           | **silently ignored** — the issue arrives as the generic `"Invalid input"`   |
| `.superRefine((v, ctx) => …)`                      | works                                                                      |

The second is the form muscle memory produces, and it does not throw or warn — it just replaces
every specific reason (`"secretColumn" is not sortable here; allowed: …`) with `Invalid input`.
The module uses the first. This is `MEM-2026-09-09-02`'s shape again — an API that accepts the
wrong call and quietly does less — and is promoted to memory as such.

## 5. Coverage added beyond the spec

The cursor codec is hand-rolled (§4.3: `Buffer` breaks the web bundle, and `btoa`/`TextEncoder`
are globals the fixture projects compile `src` *without*, which is the check that keeps this
package runtime-agnostic). AC10 as specced round-tripped one ASCII position, which is not adequate
coverage for a base64 implementation written by hand. Added, and AC10 in the spec updated to match:
accented text, a string outside latin-1, a surrogate pair (emoji), a quote and a backslash, and
inputs of one, two and three characters — the three base64 group lengths, which are the three
places an off-by-one in the padding logic hides. All pass; none of them did so by luck, since the
1/2/3-character cases exercise different branches.

## 6. Deviations from spec

- **`cursor`'s output type.** §4.1 said "an optional opaque string"; the schema now outputs a
  decoded `CursorPosition`, for the same reason `sort` outputs a parsed spec — a handler decoding
  it itself would have to write a failure branch the boundary has already ruled out. The spec was
  updated in this branch rather than left to disagree with the code. No wire change: the cursor is
  still an opaque string in the query string and in OpenAPI.
- **Two guards beyond §4.7's table.** `pageOf` rejects a sort spec that does not end in the
  tiebreaker, and `assertSortable` rejects a `sortable` list that names a field twice. Both are
  construction- or defect-time throws, both additive, no shape change, no ADR.
- **`TIEBREAKER` and `SortSpec`/`Page`/`SortableValue` are exported** where the spec's table listed
  only functions and constants. A consumer cannot type its own repository function without them.

## 7. Human input received

Two exchanges, both before merge, neither a hand-edit or an override — so no ledger entry under L7.

**First:** decisions A–D were put to the operator with the plan and a recommendation each; the reply
was "start", so they stood as recorded (the same precedent `W1-T06` §8 set). E–H were derived while
writing the spec.

**Second:** the operator asked for the open decisions to be listed back and reviewed them one at a
time. **All eight stand**, on MVP grounds, including the two the spec flags as worth an argument
(the unsigned cursor, and the three numbers frozen ahead of `W3-T05`'s measurements). Spec §10's
ESCALATION is now closed rather than left open at merge, and the two flagged items are kept in §10
as conditions-under-which-this-changes rather than as questions. The only genuinely open question
left in this spec is offset paging for the back office, which belongs to `W9`.

Nothing in `pagination.ts` changed as a result: the code already implemented what was approved.

**On `W0-T25` (#166),** the ticket the operator asked for in the same original instruction — the
only part of it in this branch is its line in `TODO.md`; the work is `agent-devops`'. Its two open
questions were also closed in this exchange, and one of them corrected my recommendation:

- *Two PRs on one task* — not solved for the MVP. No suffix, no teardown guard. The accepted
  consequence is written into the ticket so it is legible later.
- *A branch with no task ID* — I had recommended falling back to `pr-<n>`. The operator rejected the
  premise: **every** branch carries a ticket, hotfixes included (possibly under a `hotfix/` folder),
  so there is no fallback and the task ID is parsed from the branch's last path segment. This is the
  better answer — a `pr-<n>` fallback would have quietly reintroduced the naming the task exists to
  remove, on exactly the branches nobody watches.

## 8. Self-assessment

- **Weakest part of this change.** `trySort`'s treatment of a blank `?sort=` as "no preference"
  rather than as an error. It is friendlier and it is a guess about client behaviour, made without a
  client to ask; `sort=createdAt,` still fails, so the inconsistency is defensible but it is an
  inconsistency. A reviewer who thinks an explicitly empty sort is a client bug should say so — it
  is one line.

- **What a reviewer should look at hardest.** `keysetPredicate`'s operator selection:
  `i < index ? 'eq' : prefix.direction === 'desc' ? 'lt' : 'gt'`. Every prefix clause must be an
  equality and only the final clause is directional; invert that and paging does not error, it
  silently skips rows — and it would skip them in production, on the second page, under load.
  AC19 asserts the shape over a four-field sort and AC22 walks three real pages, but both are
  in-memory. Second: whether `MAX_SORT_FIELDS = 3` and `PAGE_LIMIT_MAX = 100` are the right numbers
  to freeze into the seam before `W3-T05` has measured a geo query.

- **What I would tell the next agent in this slice.** Your list endpoint composes `listQuery` and
  returns `pageEnvelope`; if you are writing `skip`, `offset`, or `take: limit` without
  `fetchLimit`, stop. And do not translate the keyset predicate by hand a second time — spec §4.5
  has the three lines, and the whole point of decision H is that those three lines are identical in
  every repository.
