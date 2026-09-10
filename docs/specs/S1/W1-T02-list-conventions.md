# Spec — W1-T02 one way to page, sort and filter a list

|               |                                                                             |
| ------------- | --------------------------------------------------------------------------- |
| **Task**      | `W1-T02` `[A]`                                                              |
| **Slice**     | S1 Contracts                                                                |
| **Owner**     | `agent-contracts`                                                           |
| **Reviewers** | `agent-discovery` (the endpoint with the longest lists) · `agent-devops`    |
| **Issues**    | [#56](https://github.com/mastrobardo/marketplace/issues/56)                 |
| **Status**    | in progress                                                                 |

---

## 1. Purpose

Nine endpoints in the MVP return a list, and every one of them is unbounded by default: geo search
(`W3-T05`), a provider's portfolio (`W3-T03`), jobs a provider can bid on (`W4-T07`), quotes on a
job (`W4-T04`), bids on an auction (`W6-T02`), the ledger (`W5-T10`), the moderation queue
(`W9-T04`), the licence queue (`W8-T02`), and search results in the UI (`W3-T06`).

If this task does not land first, each of those invents its own answer. That is not a tidiness
problem, it is three separate failures:

- **The client cannot be generic.** `W1-T03` generates a typed client from these schemas. Nine
  paging shapes means nine bespoke list hooks in the web app instead of one.
- **The first long list is a production incident.** `GET /providers/search` with no `limit` is a
  full table scan plus a PostGIS distance sort, serialised to JSON. The endpoint that discovers
  this is the one a client is waiting on.
- **Offset paging silently lies.** Auction bids and emergency broadcasts insert *while* a client is
  paging. With `OFFSET`, a row inserted before the cursor shifts everything down: page 2 repeats a
  row from page 1, and a row is never shown at all. Nobody files that bug, because from the outside
  it looks like the list was always that way.

So: one module in the seam that every list endpoint composes, with the paging algorithm written
once where it can be tested, rather than nine times where it cannot.

## 2. Decisions taken before this spec

Same precedent as `W1-T01` and `W1-T06`: seam decisions are settled with the operator **before** the
spec, because afterwards each costs an ADR (`agents/policies/contract-change.md`). Decisions A–D
were put to the operator with a recommendation each and the instruction back was to start, so they
stand as written. E–H are consequences of A that a reviewer will want stated rather than inferred.
§10 keeps all of them open for objection until this PR merges.

| #   | Decision                                                                                                        | Consequence                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Cursor (keyset) paging only.** No `offset`, no `page` number, anywhere.                                        | Correct under concurrent insert, and `O(1)` rather than `O(offset)` in the database. The cost is that a client cannot jump to page 7 — no MVP screen does, and both mobile list views are infinite-scroll (`W3-T06`).                              |
| B   | **`sort=-createdAt,priceCents`** — comma-separated fields, leading `-` for descending, against a per-endpoint **allow-list**.                                | Compact, appears in a URL unescaped, and is the same syntax the client already has to write by hand. The allow-list is the load-bearing half: an arbitrary sort field is an unindexed sort, which is a table scan a client can request.             |
| C   | **Filters are flat, typed, per-endpoint query parameters** (`status=OPEN&categoryId=…`), not a query language.   | Nine list endpoints do not justify an RSQL/JSON-filter parser, and a parser is a second attack surface to secure and a second thing `W1-T03` must express in OpenAPI. Each endpoint declares its filters as a zod shape and gets validation for free. |
| D   | **The envelope is `{ items, page: { nextCursor, hasMore } }` — no `total`.**                                     | A `COUNT(*)` over a PostGIS radius query costs about what the query costs, doubling the price of every search to render a number no screen in the MVP shows. Adding `total` later is additive; removing it after a client depends on it is not.       |
| E   | **Cursors are opaque but not signed.**                                                                           | See §4.3. A cursor carries only values the client was just shown, so there is nothing in it to protect; signing would require a secret inside `packages/contracts`, which is a pure package that both apps import.                                   |
| F   | **Every sort has `id asc` appended, always.**                                                                    | Keyset paging is only correct over a **total** order. A sort on `createdAt` alone has ties, and a tie at a page boundary drops or repeats rows. Appending the primary key makes every order total, for free.                                          |
| G   | **A `limit` above the maximum is rejected, not clamped.**                                                        | Clamping answers `limit=1000` with 100 rows and no indication, so the caller believes it has the whole list. That is a data-loss bug in the consumer that presents as an empty state. `VALIDATION_FAILED` says what happened.                       |
| H   | **The keyset predicate is provider-neutral**, not Prisma-shaped.                                                 | `packages/contracts` must not depend on Prisma — it is imported by the web app. The lexicographic expansion is the error-prone part and lives here with tests; mapping four field/op/value triples onto `where` is three lines in a repository (§4.5). |

## 3. Scope

**In:** the request schema (`limit`, `cursor`, `sort`) and its composition with per-endpoint
filters; the response envelope; cursor encode/decode; the lexicographic keyset predicate; the
helper that turns `limit + 1` rows into a page and its `nextCursor`. All in `packages/contracts`.

**Out:** the Prisma mapping. There is no `schema.prisma` yet — `W1-T05` writes it — and decision H
puts the mapping in the repository layer by design. §4.5 gives the three lines it costs.

**Out:** the endpoints. This task ships no route. Each slice's list endpoint composes these
schemas when it is built, and `W1-T04`'s harness is what proves it did.

**Out:** the OpenAPI representation of a paged response. `W1-T03` generates it; this task's job is
to leave one shape for it to generate rather than nine.

**Out:** offset paging as an escape hatch for the back office. `W9-T04`'s moderation queue and
`W9-T05`'s dashboards may genuinely want page numbers and totals. If so, that is a separate,
deliberate addition, not a second convention smuggled in beside the first — §10.

**Out:** full-text search ranking and geo distance ordering. Those are sort *fields* that
`W3-T05` will declare in its allow-list; the mechanism is the same, the SQL is that slice's.

## 4. Design

### 4.1 The request

```ts
export const paginationQuery = <const F extends readonly [string, ...string[]]>(config: {
  sortable: F;
  defaultSort: string;
}) => z.strictObject({ limit: …, cursor: …, sort: … });
```

`sortable` is a non-empty tuple and `defaultSort` is **required**. That is not ceremony: a list
with no deterministic order cannot be paged at all (decision F), so an endpoint that has not said
how it is ordered is an endpoint that cannot have this schema. Making the default a required
argument means that mistake is a type error at the point the route is declared, not a duplicated
row a client reports six months later.

`limit` defaults to `PAGE_LIMIT_DEFAULT` (20) and rejects above `PAGE_LIMIT_MAX` (100) per decision
G. `sort` is an optional string parsed by decision B's grammar into `readonly SortField[]`, which is
the schema's **output** type — a route handler receives
`[{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }]`, never a string it
has to parse again.

`cursor` is the same on the way in: an opaque string on the wire, a **decoded `CursorPosition`** on
the schema's output side. A handler that has to decode the cursor itself has to handle a failure the
boundary has already ruled out, and would write `if (!decoded.ok)` around a branch that cannot be
reached — so the transform does it once and a malformed cursor is a zod issue on the `cursor` path
like any other bad parameter.

`z.strictObject`, as everywhere in this package: `?limit=20&offset=40` is a client that has
misunderstood decision A, and saying so is cheaper than serving it page 1 and letting it paginate
in a circle.

### 4.2 Filters compose, they do not extend

```ts
export const listQuery = <…>(config: { sortable; defaultSort; filters?: z.ZodRawShape }) => …
```

An endpoint's filters are merged into the same strict object, so `?status=OPEN&limit=50&sort=-createdAt`
parses in one call and one error envelope. Three names are reserved — `limit`, `cursor`, `sort` — and
a filter that shadows one throws `PaginationError` at construction time. Construction happens at
import, so the failure is a boot failure of the API rather than a route that quietly ignores its
own filter.

### 4.3 The cursor carries a position, and is not a capability

```
base64url(JSON.stringify({ v: [<sort field values, in order>], id: '<primary key>' }))
```

Base64url so it survives a query string without escaping, and so it reads as opaque — a client that
can see `createdAt` in the cursor will eventually construct one, and then the encoding is a contract
we did not mean to make.

It is **not** signed (decision E), and this is the part worth arguing with. A cursor contains the
sort-field values and the id of a row the client was *just shown in the response body*. There is no
information in it the caller did not already have. Tampering with it produces either a decode
failure (`VALIDATION_FAILED`) or a keyset predicate positioned somewhere else in the same list — and
the list is still filtered and authorised by the route, which the cursor has no way to widen. What
signing would buy is integrity we do not need; what it would cost is a secret in a package the
browser bundle imports.

Two guards make the "no information" claim hold rather than merely sound true:

- **`decodeCursor` validates shape, and the caller validates arity.** A cursor whose `v` length does
  not match the sort spec it was handed to is rejected, so a cursor issued for `-createdAt` cannot
  be replayed against `priceCents` and land on a nonsense position.
- **A `null` or `undefined` sort value is refused at encode time.** Keyset paging over a nullable
  column needs `NULLS FIRST/LAST` agreement between the `ORDER BY` and the predicate, and getting it
  wrong loses exactly the rows whose value is null. Rather than encode that agreement into the seam,
  sortable fields must be non-nullable — and because a string allow-list cannot express that in
  TypeScript, the encoder throws on the first page rather than serving a wrong second page.

`Date` values serialise to ISO strings and stay strings. Prisma accepts an ISO string wherever it
accepts a `DateTime`, so nothing has to reconstruct the type, and no tag has to be carried to tell
a consumer which fields to revive.

### 4.4 `limit + 1`, not a count

```ts
export const fetchLimit = (limit: number): number => limit + 1;
```

A one-line function rather than a `+ 1` at nine call sites, because the failure mode of forgetting
it is `hasMore: false` on a list that has more — a last page that is silently truncated. `pageOf`
takes the over-fetched rows, trims to `limit`, sets `hasMore` from whether the extra row arrived,
and encodes `nextCursor` from the last **kept** row. `hasMore: false` and `nextCursor: null` are
therefore always in agreement, which they would not be if a caller computed either by hand.

`pageOf` reads the cursor values off the row using the sort spec's own field names, so the cursor
and the `ORDER BY` cannot disagree — they are derived from one source. That is expressible in the
type system: the row must be `{ id: string } & Record<F, CursorValue>`, so a sort field that is not
a property of the row is a compile error at the call site.

### 4.5 The keyset predicate, expanded once

For `sort=-createdAt` (plus decision F's `id asc`) and a position `{ v: [T], id: X }`, the rows
after that position are:

```
createdAt < T  OR  (createdAt = T AND id > X)
```

which generalises to a disjunction of `n` conjunctions for `n` sort fields — the lexicographic
expansion. `keysetPredicate(sort, position)` returns it as data:

```ts
{ or: [ { and: [ { field: 'createdAt', op: 'lt', value: T } ] },
        { and: [ { field: 'createdAt', op: 'eq', value: T },
                 { field: 'id',        op: 'gt', value: X } ] } ] }
```

A repository maps it in three lines, and this is the whole of what decision H asks of a consumer:

```ts
const OP = { lt: 'lt', gt: 'gt', eq: 'equals' } as const;
const where = {
  OR: predicate.or.map((g) => ({ AND: g.and.map((c) => ({ [c.field]: { [OP[c.op]]: c.value } })) })),
};
```

Sort fields are capped at **three** (before `id`). Each field added squares the predicate and needs
a matching composite index to stay `O(1)`; an endpoint that wants a fourth wants a different index,
which is a conversation, not a query parameter.

### 4.6 Failure is either the client's or the programmer's, and they are different types

Wire input fails through **zod**, at the route boundary, which the existing handler in
`apps/api/src/app.ts` already turns into `VALIDATION_FAILED` with per-path issues. A bad `limit`,
an unknown sort field, a malformed cursor: all of them, with no new error code and no change to the
envelope `W1-T01` froze.

Programmer errors throw `PaginationError extends Error` — never an `AppError`, for the same reason
`MoneyError` does not: a filter shadowing `limit`, an empty `sortable` tuple, a null sort value, a
row missing a sort field at runtime. These are defects, so `INTERNAL_ERROR` and a log line, not a
validation message handed to a user. Like `money.ts`, this module imports nothing from `errors.ts`,
which keeps the seam acyclic.

### 4.7 Module surface

| Export                                            | Behaviour                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `PAGE_LIMIT_DEFAULT` · `PAGE_LIMIT_MAX`           | `20` · `100`.                                                                                                 |
| `MAX_SORT_FIELDS`                                 | `3`, before the appended `id`.                                                                                |
| `RESERVED_QUERY_KEYS`                             | `['limit', 'cursor', 'sort']`.                                                                                |
| `paginationQuery({ sortable, defaultSort })`      | The `limit`/`cursor`/`sort` schema. Output `sort` is a parsed, `id`-terminated `SortField[]`; output `cursor` is a decoded `CursorPosition`. |
| `listQuery({ sortable, defaultSort, filters })`   | The above merged with per-endpoint filters, strict. Throws `PaginationError` on a reserved-key collision.      |
| `pageEnvelope(itemSchema)`                        | `z.strictObject({ items, page: PageInfoSchema })`.                                                            |
| `PageInfoSchema`                                  | `{ nextCursor: string \| null, hasMore: boolean }`.                                                            |
| `fetchLimit(limit)`                               | `limit + 1`.                                                                                                  |
| `pageOf(rows, { limit, sort })`                   | Trims, sets `hasMore`, encodes `nextCursor` from the last kept row. Frozen result.                            |
| `emptyPage()`                                     | `{ items: [], page: { nextCursor: null, hasMore: false } }`.                                                  |
| `encodeCursor(position)` · `decodeCursor(raw)`    | Base64url ↔ `{ v, id }`. `decodeCursor` returns a discriminated result, never throws on bad input.            |
| `keysetPredicate(sort, position)`                 | §4.5's disjunction. Throws `PaginationError` on an arity mismatch.                                            |
| `parseSort(raw, sortable, defaultSort)`           | Decision B's grammar. Used by the schema; exported because `W1-T04` asserts against it.                        |
| `PaginationError`                                 | Programmer error, per §4.6.                                                                                   |

## 5. State machine

None. A query convention has no lifecycle. `W1-T07` owns state machines.

## 6. API surface

No endpoint. This task defines the request and response *shape* every list endpoint composes:
`GET /providers/search`, `GET /jobs`, `GET /jobs/:id/quotes`, `GET /auctions/:id/bids`,
`GET /admin/ledger`, and the queues in `W8`/`W9`. Exported from `@marketplace/contracts`; appears in
OpenAPI as reusable parameter and response components once `W1-T03` generates them.

## 7. Permissions matrix

Not applicable — no route, no actor. Worth stating once because it is the tempting mistake: **the
cursor is not an authorisation boundary** (§4.3). A route that returns rows the caller may not see
returns them on page 1 too; paging is not what makes it safe, and nothing in this module should be
read as a check. Each slice's list endpoint applies its own filter and its own guard.

## 8. Error cases

| Condition                                               | Result                | Where                    |
| ------------------------------------------------------- | --------------------- | ------------------------ |
| `limit` above `PAGE_LIMIT_MAX`, or `0`, or not an integer | `VALIDATION_FAILED`   | zod, route boundary      |
| `sort` names a field outside the allow-list             | `VALIDATION_FAILED`   | zod, route boundary      |
| `sort` has more than `MAX_SORT_FIELDS` fields, an empty segment, or a duplicate field | `VALIDATION_FAILED` | zod, route boundary |
| `cursor` is not base64url, not JSON, or not `{ v, id }` | `VALIDATION_FAILED`   | zod, route boundary      |
| an unknown query parameter (`offset`, `page`)           | `VALIDATION_FAILED`   | zod, `strictObject`      |
| a filter key shadows a reserved key                     | `PaginationError`     | construction (boot)      |
| `sortable` is empty, or `defaultSort` is not in it      | `PaginationError`     | construction (boot)      |
| a sort value is `null`/`undefined` at encode time       | `PaginationError`     | `pageOf` / `encodeCursor`|
| a cursor's `v` arity does not match the sort spec       | `PaginationError`     | `keysetPredicate`        |

No new error code, and no change to the envelope `W1-T01` froze.

## 9. Acceptance criteria

Each is a test in `packages/contracts/tests/pagination.test.ts` unless stated otherwise.

1. **Given** no query parameters, **when** the schema parses `{}`, **then** `limit` is `20`, `cursor` is `undefined`, and `sort` is the parsed `defaultSort` with `{ field: 'id', direction: 'asc' }` appended.
2. **Given** `limit=100`, **then** it parses; **given** `limit=101`, `limit=0`, `limit=-1` or `limit=1.5`, **then** each fails, and the issue path is `limit` (decision G — rejected, not clamped).
3. **Given** `sort=-createdAt,priceCents`, **then** the output is `[{createdAt,desc},{priceCents,asc},{id,asc}]`.
4. **Given** `sort=secretColumn`, **then** it fails; **given** an empty segment (`sort=createdAt,`), a duplicate (`sort=createdAt,-createdAt`), or four fields, **then** each fails.
5. **Given** `sort=id` or `sort=-id`, **then** `id` appears exactly once and keeps the requested direction (decision F must not append a second, contradictory `id`).
6. **Given** `?offset=40` or `?page=2`, **then** parsing fails — decision A is enforced at the boundary, not documented in a comment.
7. **Given** filters `{ status: z.enum([...]) }`, **when** parsing `?status=OPEN&limit=5`, **then** both are present and typed; **given** an unknown filter value, **then** it fails with the issue path on the filter.
8. **Given** a filter named `limit`, `cursor` or `sort`, **when** `listQuery` is constructed, **then** it throws `PaginationError` naming the key.
9. **Given** `sortable: []` or a `defaultSort` outside `sortable`, **when** constructed, **then** it throws `PaginationError`.
10. **Given** a position `{ v: ['2026-01-01T00:00:00.000Z'], id: 'abc' }`, **when** `encodeCursor` then `decodeCursor`, **then** the position round-trips exactly and the encoded form is base64url (no `+`, `/` or `=`). **And** the same holds for an accented name, a name outside latin-1, a string containing a surrogate pair, a quote and a backslash, and values of one, two and three characters — the three base64 group lengths. (The codec is hand-rolled for the reason in §4.3; a hand-rolled base64 with no Unicode or padding coverage is the likeliest place for this change to be quietly wrong.)
11. **Given** `'not-a-cursor'`, `''`, base64url of non-JSON, and base64url of `{"v":1}`, **when** `decodeCursor`, **then** each returns a failure result rather than throwing.
12. **Given** a position whose `v` contains `null`, **when** `encodeCursor`, **then** it throws `PaginationError` naming the field index (§4.3).
13. **Given** 21 rows and `limit: 20`, **when** `pageOf`, **then** 20 items, `hasMore: true`, and `nextCursor` decodes to the 20th row's position — **not** the 21st.
14. **Given** 20 rows and `limit: 20`, **then** 20 items, `hasMore: false`, `nextCursor: null`.
15. **Given** `[]`, **then** the result equals `emptyPage()`; **and** the returned page is frozen.
16. **Given** a row missing a field the sort spec names, **when** `pageOf`, **then** it throws `PaginationError` naming the field.
17. **Given** `fetchLimit(20)`, **then** `21`.
18. **Given** `sort=[{createdAt,desc},{id,asc}]` and a position, **when** `keysetPredicate`, **then** exactly §4.5's structure — two groups, the first one clause, the second two.
19. **Given** a three-field sort plus `id`, **when** `keysetPredicate`, **then** four groups whose clause counts are `1,2,3,4`, every non-final clause is `eq`, and each final clause's `op` matches its field's direction (`lt` for desc, `gt` for asc).
20. **Given** a position whose `v` length disagrees with the sort spec, **when** `keysetPredicate`, **then** it throws `PaginationError`.
21. **Given** an item schema, **when** `pageEnvelope(item).safeParse`, **then** a well-formed page passes; **and** one with an extra top-level key, a missing `page`, or `nextCursor: undefined` (rather than `null`) fails.
22. **Given** a list of 7 rows, a `limit` of 3, and an in-memory table sorted by `(createdAt desc, id asc)`, **when** three successive pages are fetched by applying `keysetPredicate` as a filter, **then** the concatenation is exactly the 7 rows in order, with no repeat and no gap — **and** the same holds when a new row is inserted at the head between page 1 and page 2 (the property decision A exists for, asserted rather than argued).
23. **Given** a type-level fixture, **when** `tsc` runs, **then** a sort field that is not a property of the row is a compile error. The positive assertions go in the **existing** `tests/fixtures/valid/` project — `MEM-2026-09-10-05` records that each new fixture project is another cold compiler in a parallel turbo run, and one negative project is the whole additional cost. Both tests carry `{ timeout: 120_000 }` per `MEM-2026-09-09-02`.
24. **Given** the exported surface, **when** a consumer imports from `@marketplace/contracts`, **then** every export in §4.7 is reachable and `pnpm verify` is clean.

## 10. Open questions

```
ESCALATION — CLOSED 2026-09-10
Task:      W1-T02
Question:  Do decisions A-H in §2 stand as recorded?
Answer:    A) they stand. The operator reviewed all eight and accepted them on MVP grounds,
           including the two flagged below as worth an argument.
Blocked:   nothing
```

Both of the following were put to the operator explicitly and accepted. They are kept here not as
open questions but because each carries a condition under which it stops being the right answer,
and whoever hits that condition needs to find the reasoning rather than the conclusion:

**Decision E — an unsigned cursor.** The argument in §4.3 is that a cursor carries nothing the
client was not just shown. That holds for every list in the MVP as specced. It would stop holding
if a list endpoint ever sorted by a field it does not return in the item body — an internal risk
score, a moderation weight — because the cursor would then disclose that value. If such a list
appears, the answer is to keep the field out of the allow-list, not to start signing cursors; that
is a note for whoever writes `W9-T04`, and it is the accepted position rather than an oversight.

**Offset paging for the back office.** `W9-T04` and `W9-T05` may want page numbers and a total row
count, which decision A and decision D both refuse. That is a real product question about internal
tools, not a defect in this convention. Recorded here so that the answer, when it comes, is a
deliberate second shape with its own name — not `offset` quietly appearing beside `cursor` in a
schema that says it rejects it. This is the one question in this spec still genuinely open, and it
belongs to `W9`, not here.

**The three frozen numbers.** `PAGE_LIMIT_DEFAULT = 20`, `PAGE_LIMIT_MAX = 100` and
`MAX_SORT_FIELDS = 3` were accepted knowing they are being fixed before `W3-T05` has measured a geo
query. Each widens additively; none narrows without a consumer sweep. If `W3-T05` finds 100 rows of
radius search is the wrong page size, raising the cap is a one-line change to this module and no
change to any endpoint.
