import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  MAX_SORT_FIELDS,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  PageInfoSchema,
  PaginationError,
  RESERVED_QUERY_KEYS,
  decodeCursor,
  emptyPage,
  encodeCursor,
  fetchLimit,
  keysetPredicate,
  listQuery,
  pageEnvelope,
  pageOf,
  paginationQuery,
  parseSort,
  type CursorPosition,
  type KeysetPredicate,
  type Page,
  type SortField,
  type SortSpec,
} from '../src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));

const SORTABLE = ['createdAt', 'priceCents', 'rating'] as const;
type Sortable = (typeof SORTABLE)[number];

const query = paginationQuery({ sortable: SORTABLE, defaultSort: '-createdAt' });

/** The appended tiebreaker from decision F, written once so every expectation reads the same. */
const ID_ASC: SortField<'id'> = { field: 'id', direction: 'asc' };

const asc = <F extends string>(field: F): SortField<F> => ({ field, direction: 'asc' });
const desc = <F extends string>(field: F): SortField<F> => ({ field, direction: 'desc' });

describe('AC1 — the defaults are a whole, page-able request on their own', () => {
  it('fills in the limit and the default sort when the client sends nothing', () => {
    const parsed = query.parse({});
    expect(parsed.limit).toBe(PAGE_LIMIT_DEFAULT);
    expect(parsed.cursor).toBeUndefined();
    expect(parsed.sort).toEqual([desc('createdAt'), ID_ASC]);
  });
});

describe('AC2 — a limit above the maximum is refused, not quietly clamped', () => {
  it('accepts the maximum', () => {
    expect(query.parse({ limit: PAGE_LIMIT_MAX }).limit).toBe(PAGE_LIMIT_MAX);
  });

  // Decision G. Clamping is the tempting alternative and it is worse: the caller believes it
  // received the whole list, which surfaces as an empty state rather than as an error.
  it.each([PAGE_LIMIT_MAX + 1, 0, -1, 1.5])('refuses limit=%s on the limit path', (limit) => {
    const result = query.safeParse({ limit });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['limit']);
    }
  });

  it('accepts the string form a query string actually delivers', () => {
    expect(query.parse({ limit: '50' }).limit).toBe(50);
  });
});

describe('AC3/AC4/AC5 — the sort grammar, and the allow-list that makes it safe', () => {
  it('parses direction prefixes in order and appends the tiebreaker', () => {
    expect(query.parse({ sort: '-createdAt,priceCents' }).sort).toEqual([
      desc('createdAt'),
      asc('priceCents'),
      ID_ASC,
    ]);
  });

  it.each([
    ['a field outside the allow-list', 'secretColumn'],
    ['an empty segment', 'createdAt,'],
    ['a leading empty segment', ',createdAt'],
    ['a bare minus', '-'],
    ['the same field twice', 'createdAt,-createdAt'],
    ['more fields than MAX_SORT_FIELDS', 'createdAt,priceCents,rating,id'],
  ])('refuses %s', (_why, sort) => {
    expect(query.safeParse({ sort }).success).toBe(false);
  });

  // Decision F appends `id asc` — appending a *second* id would contradict the requested one and
  // the predicate in §4.5 would compare the same column twice with opposing operators.
  it('does not append a second id when the client sorted by id', () => {
    const sortableWithId = ['createdAt', 'id'] as const;
    const withId = paginationQuery({ sortable: sortableWithId, defaultSort: 'createdAt' });
    expect(withId.parse({ sort: '-id' }).sort).toEqual([desc('id')]);
    expect(withId.parse({ sort: 'id' }).sort).toEqual([asc('id')]);
  });

  it('exposes the same grammar for W1-T04 to assert against', () => {
    expect(parseSort('-createdAt', SORTABLE, '-createdAt')).toEqual([desc('createdAt'), ID_ASC]);
  });
});

describe('AC6 — offset paging is refused at the boundary, not deprecated in a comment', () => {
  it.each(['offset', 'page', 'skip'])('refuses the %s parameter', (key) => {
    expect(query.safeParse({ [key]: 40 }).success).toBe(false);
  });
});

describe('AC7/AC8/AC9 — filters compose into the same strict object', () => {
  const jobs = listQuery({
    sortable: SORTABLE,
    defaultSort: '-createdAt',
    filters: { status: z.enum(['OPEN', 'AWARDED']) },
  });

  it('parses paging and filters in one call', () => {
    const parsed = jobs.parse({ status: 'OPEN', limit: 5 });
    expect(parsed).toMatchObject({ status: 'OPEN', limit: 5 });
    expect(parsed.sort).toEqual([desc('createdAt'), ID_ASC]);
  });

  it('reports a bad filter value on the filter path', () => {
    const result = jobs.safeParse({ status: 'NOPE' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['status']);
    }
  });

  // A construction-time throw is a boot failure of the API, which is the point: a filter that
  // shadows `limit` would otherwise be silently unreachable behind the paging parameter.
  it.each(RESERVED_QUERY_KEYS)('refuses a filter named %s at construction', (key) => {
    expect(() =>
      listQuery({
        sortable: SORTABLE,
        defaultSort: '-createdAt',
        filters: { [key]: z.string() },
      }),
    ).toThrow(PaginationError);
  });

  it('refuses a sortable list that cannot produce a total order', () => {
    expect(() =>
      paginationQuery({ sortable: [] as unknown as readonly [string], defaultSort: 'createdAt' }),
    ).toThrow(PaginationError);
    expect(() => paginationQuery({ sortable: SORTABLE, defaultSort: 'nope' })).toThrow(
      PaginationError,
    );
  });
});

describe('AC10/AC11/AC12 — the cursor round-trips, and fails closed', () => {
  const position: CursorPosition = { v: ['2026-01-01T00:00:00.000Z'], id: 'abc' };

  it('round-trips a position through a url-safe encoding', () => {
    const encoded = encodeCursor(position);
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = decodeCursor(encoded);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.position).toEqual(position);
  });

  // `decodeCursor` is called on untrusted input inside a zod transform, so a throw there would
  // escape as a 500 instead of the VALIDATION_FAILED the boundary already knows how to render.
  it.each([
    ['not base64url at all', 'not-a-cursor!!'],
    ['empty', ''],
    ['base64url of non-JSON', Buffer.from('hello').toString('base64url')],
    ['base64url of the wrong shape', Buffer.from('{"v":1}').toString('base64url')],
    ['base64url of a JSON array', Buffer.from('[]').toString('base64url')],
  ])('returns a failure for %s rather than throwing', (_why, raw) => {
    expect(() => decodeCursor(raw)).not.toThrow();
    expect(decodeCursor(raw).ok).toBe(false);
  });

  // Beyond the spec's AC10, and the reason is in the source: the codec is hand-rolled, because
  // `Buffer` would break the web bundle and `btoa`/`TextEncoder` are globals the fixture projects
  // compile `src` without. A hand-rolled base64 with no Unicode and no padding coverage is the
  // part of this change most likely to be quietly wrong.
  it.each([
    ['ascii', 'Alvarez'],
    ['accents and tilde', 'Núñez Sánchez'],
    ['a name outside latin-1', '건축가 김'],
    ['an emoji, which is a surrogate pair', 'obra 🏗️ nueva'],
    ['a quote and a backslash', "O'Brien \\ Co"],
    ['one char, so the last base64 group is 1 byte', 'a'],
    ['two chars, so the last group is 2 bytes', 'ab'],
    ['three chars, so the last group is full', 'abc'],
  ])('round-trips %s through the codec', (_why, value) => {
    const encoded = encodeCursor({ v: [value, 42, true], id: 'row-1' });
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = decodeCursor(encoded);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.position).toEqual({ v: [value, 42, true], id: 'row-1' });
  });

  it('rejects a cursor the schema cannot decode', () => {
    expect(query.safeParse({ cursor: 'not-a-cursor!!' }).success).toBe(false);
  });

  // §4.3: a nullable sort column needs NULLS FIRST/LAST agreement between the ORDER BY and the
  // predicate. Refusing at encode time costs one broken first page instead of a wrong second one.
  it('refuses to encode a null sort value, naming the offending index', () => {
    expect(() => encodeCursor({ v: [null as unknown as string], id: 'abc' })).toThrow(
      PaginationError,
    );
    expect(() => encodeCursor({ v: [undefined as unknown as string], id: 'abc' })).toThrow(/\b0\b/);
  });
});

describe('AC13/AC14/AC15/AC16/AC17 — the over-fetched row is what says there is more', () => {
  type Row = { id: string; createdAt: string };
  const sort: SortSpec<'createdAt'> = [desc('createdAt'), ID_ASC];
  const rows = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `row-${String(i).padStart(2, '0')}`,
      createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));

  it('trims the extra row and points the cursor at the last kept one', () => {
    const all = rows(21);
    const page = pageOf(all, { limit: 20, sort });
    expect(page.items).toHaveLength(20);
    expect(page.page.hasMore).toBe(true);
    const decoded = decodeCursor(page.page.nextCursor ?? '');
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.position).toEqual({ v: [all[19]!.createdAt], id: all[19]!.id });
    }
  });

  it('reports no more when the extra row did not arrive', () => {
    const page = pageOf(rows(20), { limit: 20, sort });
    expect(page.items).toHaveLength(20);
    expect(page.page).toEqual({ nextCursor: null, hasMore: false });
  });

  it('returns a frozen empty page for no rows', () => {
    const page = pageOf([] as Row[], { limit: 20, sort });
    expect(page).toEqual(emptyPage());
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.page)).toBe(true);
  });

  it('throws when a row does not carry a field the sort names', () => {
    // Two rows for a limit of one, so there *is* a next page: with nothing over-fetched there is
    // no cursor to build and therefore nothing for the missing field to break.
    const broken = [{ id: 'a' }, { id: 'b' }] as unknown as Row[];
    expect(() => pageOf(broken, { limit: 1, sort })).toThrow(/createdAt/);
  });

  it('over-fetches by exactly one', () => {
    expect(fetchLimit(20)).toBe(21);
  });
});

describe('AC18/AC19/AC20 — the lexicographic expansion, written once', () => {
  it('expands a single descending field plus the tiebreaker', () => {
    const predicate = keysetPredicate([desc('createdAt'), ID_ASC], {
      v: ['2026-01-01T00:00:00.000Z'],
      id: 'abc',
    });
    const expected: KeysetPredicate = {
      or: [
        { and: [{ field: 'createdAt', op: 'lt', value: '2026-01-01T00:00:00.000Z' }] },
        {
          and: [
            { field: 'createdAt', op: 'eq', value: '2026-01-01T00:00:00.000Z' },
            { field: 'id', op: 'gt', value: 'abc' },
          ],
        },
      ],
    };
    expect(predicate).toEqual(expected);
  });

  it('keeps every prefix an equality and every final clause directional', () => {
    const sort = [desc('rating'), asc('priceCents'), desc('createdAt'), ID_ASC];
    const predicate = keysetPredicate(sort, { v: [5, 100, '2026-01-01'], id: 'abc' });

    expect(predicate.or.map((group) => group.and.length)).toEqual([1, 2, 3, 4]);
    predicate.or.forEach((group, index) => {
      const final = group.and[group.and.length - 1]!;
      expect(group.and.slice(0, -1).every((clause) => clause.op === 'eq')).toBe(true);
      expect(final.field).toBe(sort[index]!.field);
      expect(final.op).toBe(sort[index]!.direction === 'desc' ? 'lt' : 'gt');
    });
  });

  it('refuses a position whose arity disagrees with the sort spec', () => {
    expect(() => keysetPredicate([desc('createdAt'), ID_ASC], { v: [], id: 'abc' })).toThrow(
      PaginationError,
    );
  });
});

describe('AC21 — the response envelope is as strict as the request', () => {
  const envelope = pageEnvelope(z.strictObject({ id: z.string() }));

  it('accepts a well-formed page', () => {
    expect(
      envelope.safeParse({ items: [{ id: 'a' }], page: { nextCursor: null, hasMore: false } })
        .success,
    ).toBe(true);
  });

  it.each([
    ['an extra top-level key', { items: [], page: { nextCursor: null, hasMore: false }, total: 3 }],
    ['a missing page', { items: [] }],
    ['an undefined nextCursor instead of null', { items: [], page: { hasMore: false } }],
  ])('refuses %s', (_why, body) => {
    expect(envelope.safeParse(body).success).toBe(false);
  });

  it('exports the page info shape on its own, for W1-T03 to reuse', () => {
    expect(PageInfoSchema.safeParse({ nextCursor: 'x', hasMore: true }).success).toBe(true);
  });
});

/**
 * AC22. Decisions A and F are claims about what a *client* sees across successive requests, and
 * neither is provable from one call. This walks a real table three pages deep, then inserts a row
 * at the head mid-walk — which is the exact scenario offset paging gets wrong and the reason
 * decision A exists.
 */
describe('AC22 — three pages, no repeat and no gap, even under insert', () => {
  type Row = { id: string; createdAt: string };
  const sort: SortSpec<'createdAt'> = [desc('createdAt'), ID_ASC];

  const table: Row[] = Array.from({ length: 7 }, (_, i) => ({
    id: `row-${String(i)}`,
    createdAt: `2026-01-0${String(i + 1)}T00:00:00.000Z`,
  }));

  /** The three lines a repository writes (spec §4.5), against an array instead of Postgres. */
  const matches = (row: Row, predicate: KeysetPredicate): boolean =>
    predicate.or.some((group) =>
      group.and.every((clause) => {
        const value = row[clause.field as keyof Row];
        if (clause.op === 'eq') return value === clause.value;
        if (clause.op === 'lt') return value < (clause.value as string);
        return value > (clause.value as string);
      }),
    );

  const ordered = (rows: readonly Row[]): Row[] =>
    [...rows].sort((a, b) =>
      a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
    );

  const walk = (rows: readonly Row[], limit: number, cursor: string | null): Page<Row> => {
    let candidates = ordered(rows);
    if (cursor !== null) {
      const decoded = decodeCursor(cursor);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        const predicate = keysetPredicate(sort, decoded.position);
        candidates = candidates.filter((row) => matches(row, predicate));
      }
    }
    return pageOf(candidates.slice(0, fetchLimit(limit)), { limit, sort });
  };

  it('returns every row exactly once', () => {
    const seen: Row[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 3; i += 1) {
      const page = walk(table, 3, cursor);
      seen.push(...page.items);
      cursor = page.page.nextCursor;
    }
    expect(seen.map((row) => row.id)).toEqual(ordered(table).map((row) => row.id));
    expect(cursor).toBeNull();
  });

  it('does not repeat or drop a row when one is inserted at the head mid-walk', () => {
    const first = walk(table, 3, null);
    const grown = [...table, { id: 'row-new', createdAt: '2026-01-09T00:00:00.000Z' }];
    const second = walk(grown, 3, first.page.nextCursor);

    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size, `a row was served twice: ${ids.join(', ')}`).toBe(ids.length);
    // The inserted row sorts above the cursor, so it is correctly absent — what matters is that
    // its arrival did not shift the window and hide the row that should follow.
    expect(ids).toEqual(
      ordered(table)
        .slice(0, 6)
        .map((row) => row.id),
    );
  });
});

/**
 * AC23. `MEM-2026-09-10-05`: every fixture project is another cold `tsc` in a parallel turbo run,
 * so the positive assertions go into the existing `valid` project — which costs no new process —
 * and only the negative case needs one of its own. The local binary and the options-object
 * timeout are both required (`MEM-2026-09-09-02`).
 */
const tsc = fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url));

function typecheckFixture(name: string): { ok: boolean; output: string } {
  try {
    execFileSync(tsc, ['-p', `tests/fixtures/${name}/tsconfig.json`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: '' };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('AC23 — a sort field the row does not have is a compile error', () => {
  it('compiles the fixture that pages a matching row', { timeout: 120_000 }, () => {
    const result = typecheckFixture('valid');
    expect(result.ok, `the valid fixture did not compile:\n${result.output}`).toBe(true);
  });

  it('refuses a sort field absent from the row', { timeout: 120_000 }, () => {
    const result = typecheckFixture('pagination-unsortable-row');
    expect(result.ok, 'pageOf accepted a row missing its sort field').toBe(false);
  });
});

describe('AC24 — the surface is reachable from the package root', () => {
  it('exports every name the spec lists', () => {
    const surface = {
      PAGE_LIMIT_DEFAULT,
      PAGE_LIMIT_MAX,
      MAX_SORT_FIELDS,
      RESERVED_QUERY_KEYS,
      paginationQuery,
      listQuery,
      pageEnvelope,
      PageInfoSchema,
      fetchLimit,
      pageOf,
      emptyPage,
      encodeCursor,
      decodeCursor,
      keysetPredicate,
      parseSort,
      PaginationError,
    };
    for (const [name, value] of Object.entries(surface)) {
      expect(value, `${name} is not exported`).toBeDefined();
    }
    expect(MAX_SORT_FIELDS).toBe(3);
    expect([...RESERVED_QUERY_KEYS]).toEqual(['limit', 'cursor', 'sort']);
  });

  it('keeps a Sortable field name usable as a type', () => {
    const field: Sortable = 'createdAt';
    expect(SORTABLE).toContain(field);
  });
});
