/**
 * How every list endpoint is paged, sorted and filtered — the frozen seam.
 *
 * `W1-T02`. Nine endpoints in the MVP return a list; without this module each invents its own
 * answer, `W1-T03` generates nine client shapes instead of one, and the first long list is an
 * incident. The decisions are in `docs/specs/S1/W1-T02-list-conventions.md` §2 and changing them
 * from here costs an ADR (`agents/policies/contract-change.md`).
 *
 * Nothing in this file imports from `errors.ts`, for the reason `money.ts` does not: wire input
 * fails through zod at the route boundary, which the handler already renders as
 * `VALIDATION_FAILED`, and everything this module throws is a programming defect.
 */
import { z } from 'zod';

/** Rows per page when the client does not say. */
export const PAGE_LIMIT_DEFAULT = 20;

/** The most a client may ask for. Decision G: above this is rejected, never clamped. */
export const PAGE_LIMIT_MAX = 100;

/**
 * Sort fields a client may name, before the appended tiebreaker. Each field added squares the
 * keyset predicate (§4.5) and needs a matching composite index to stay `O(1)`; a fourth is a
 * conversation about an index, not a query parameter.
 */
export const MAX_SORT_FIELDS = 3;

/** Paging owns these three names, so an endpoint's filter may not reuse one. */
export const RESERVED_QUERY_KEYS = ['limit', 'cursor', 'sort'] as const;

/**
 * Decision F. Keyset paging is only correct over a *total* order, and every table in `W1-T05` has
 * exactly one column guaranteed unique — so this is appended to every sort, always.
 */
export const TIEBREAKER = 'id';

/** A defect in the caller: a bad convention, not a bad request. Reaches a client as a 500. */
export class PaginationError extends Error {
  override readonly name = 'PaginationError';
}

export type SortDirection = 'asc' | 'desc';

export type SortField<F extends string = string> = {
  readonly field: F;
  readonly direction: SortDirection;
};

/**
 * A parsed sort. `F | 'id'` rather than `F`, because decision F's tiebreaker is part of every
 * spec and a caller should not have to widen its own field union to hold it.
 */
export type SortSpec<F extends string = string> = readonly SortField<F | typeof TIEBREAKER>[];

/** What a cursor can carry. A `Date` is narrowed to its ISO string on the way in — see §4.3. */
export type CursorValue = string | number | boolean;

/** What a row may hold in a sortable column. Prisma hands back `Date` for a `DateTime`. */
export type SortableValue = CursorValue | Date;

/** The position of the last row of a page: its sort values in order, plus its primary key. */
export type CursorPosition = {
  readonly v: readonly CursorValue[];
  readonly id: string;
};

/** A row `pageOf` can build a cursor from: it carries a value for every field the sort names. */
export type CursorRow<F extends string> = { readonly id: string } & {
  readonly [K in F]: SortableValue;
};

export type PageInfo = {
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
};

export type Page<T> = {
  readonly items: readonly T[];
  readonly page: PageInfo;
};

export type KeysetOp = 'lt' | 'gt' | 'eq';

export type KeysetClause = {
  readonly field: string;
  readonly op: KeysetOp;
  readonly value: CursorValue;
};

/**
 * The lexicographic keyset comparison as data, not as SQL and not as Prisma (decision H): this
 * package is imported by the browser bundle. A repository maps it in three lines — see spec §4.5.
 */
export type KeysetPredicate = {
  readonly or: readonly { readonly and: readonly KeysetClause[] }[];
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The cursor codec
// ─────────────────────────────────────────────────────────────────────────────────────────────

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * `JSON.stringify` with every non-ASCII code unit escaped as `\uXXXX`.
 *
 * The point is that the payload is pure ASCII before it is base64'd, which is what lets the codec
 * below be a few lines of `charCodeAt` instead of a UTF-8 encoder. `Buffer` is not an option — the
 * web app imports this package — and `btoa`/`TextEncoder` are globals the fixture projects compile
 * `src` without (`types: []`), which is the check that keeps this package runtime-agnostic.
 * JSON's escapes are per UTF-16 code unit, so a surrogate pair survives as two escapes and
 * `JSON.parse` puts it back together.
 */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Unpadded, so there is no `=` to escape in a query string. */
function toBase64Url(ascii: string): string {
  let out = '';
  for (let i = 0; i < ascii.length; i += 3) {
    const a = ascii.charCodeAt(i);
    const b = i + 1 < ascii.length ? ascii.charCodeAt(i + 1) : undefined;
    const c = i + 2 < ascii.length ? ascii.charCodeAt(i + 2) : undefined;
    out += BASE64URL[a >> 2] ?? '';
    out += BASE64URL[((a & 0x03) << 4) | (b === undefined ? 0 : b >> 4)] ?? '';
    if (b !== undefined) out += BASE64URL[((b & 0x0f) << 2) | (c === undefined ? 0 : c >> 6)] ?? '';
    if (c !== undefined) out += BASE64URL[c & 0x3f] ?? '';
  }
  return out;
}

/** `undefined` for anything outside the alphabet — which is most of what a tampered cursor is. */
function fromBase64Url(encoded: string): string | undefined {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const char of encoded) {
    const index = BASE64URL.indexOf(char);
    if (index < 0) return undefined;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * The payload is validated with a schema like everything else that arrives from outside, so a
 * cursor carrying `{"v": 1}` is a decode failure rather than a position with a garbage arity.
 */
const CursorPayloadSchema = z.strictObject({
  v: z.array(z.union([z.string(), z.number(), z.boolean()])),
  id: z.string().min(1),
});

export type CursorDecode =
  | { readonly ok: true; readonly position: CursorPosition }
  | { readonly ok: false; readonly reason: string };

/**
 * Encode a position. Throws on a `null`/`undefined` sort value: keyset paging over a nullable
 * column needs `NULLS FIRST/LAST` agreement between the `ORDER BY` and the predicate, and getting
 * it wrong loses exactly the rows whose value is null. Sortable columns are non-nullable, and a
 * string allow-list cannot say so in TypeScript — so this is where that constraint is enforced,
 * on the first page rather than in a silently wrong second one (§4.3).
 */
export function encodeCursor(position: CursorPosition): string {
  position.v.forEach((value, index) => {
    if (value === null || value === undefined) {
      throw new PaginationError(
        `Cursor sort value at index ${String(index)} is ${String(value)}; sortable fields must be non-nullable.`,
      );
    }
  });
  if (position.id === '') {
    throw new PaginationError('Cursor id is empty; the tiebreaker must identify a row.');
  }
  return toBase64Url(asciiJson({ v: [...position.v], id: position.id }));
}

/**
 * Decode a cursor. **Never throws** — it is called from inside a zod transform on untrusted input,
 * and a throw there escapes `safeParse` as a 500 instead of the `VALIDATION_FAILED` the boundary
 * already knows how to render.
 */
export function decodeCursor(raw: string): CursorDecode {
  const ascii = fromBase64Url(raw);
  if (ascii === undefined) return { ok: false, reason: 'not base64url' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(ascii);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }

  const payload = CursorPayloadSchema.safeParse(parsed);
  if (!payload.success) return { ok: false, reason: 'not a cursor position' };

  return {
    ok: true,
    position: Object.freeze({ v: Object.freeze(payload.data.v), id: payload.data.id }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The sort grammar
// ─────────────────────────────────────────────────────────────────────────────────────────────

type SortAttempt =
  { readonly ok: true; readonly sort: SortSpec } | { readonly ok: false; readonly reason: string };

function trySort(
  raw: string | undefined,
  sortable: readonly string[],
  defaultSort: string,
): SortAttempt {
  // An absent or blank `?sort=` is a client that did not express a preference, not one that
  // expressed an empty one. `sort=createdAt,` is different, and fails below.
  const source = raw === undefined || raw.trim() === '' ? defaultSort : raw;
  const segments = source.split(',');

  if (segments.length > MAX_SORT_FIELDS) {
    return {
      ok: false,
      reason: `at most ${String(MAX_SORT_FIELDS)} sort fields, got ${String(segments.length)}`,
    };
  }

  const fields: SortField[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    const trimmed = segment.trim();
    const direction: SortDirection = trimmed.startsWith('-') ? 'desc' : 'asc';
    const field = direction === 'desc' ? trimmed.slice(1) : trimmed;

    if (field === '') return { ok: false, reason: 'a sort segment named no field' };
    if (!sortable.includes(field)) {
      return {
        ok: false,
        reason: `"${field}" is not sortable here; allowed: ${sortable.join(', ')}`,
      };
    }
    if (seen.has(field)) return { ok: false, reason: `"${field}" appears twice` };

    seen.add(field);
    fields.push({ field, direction });
  }

  // Decision F — but only once: a client that sorted by `id` explicitly already has a total order,
  // and a second `id` would have the predicate compare one column with opposing operators.
  if (!seen.has(TIEBREAKER)) fields.push({ field: TIEBREAKER, direction: 'asc' });

  return { ok: true, sort: Object.freeze(fields) };
}

/**
 * Decision B's grammar: `-createdAt,priceCents`. Exported because `W1-T04`'s harness asserts
 * against it directly; the schemas below use the same function.
 *
 * Throws `PaginationError` on anything invalid — which is correct for a caller that built the
 * string itself, and is why the schema path uses the non-throwing form internally.
 */
export function parseSort<const F extends readonly [string, ...string[]]>(
  raw: string | undefined,
  sortable: F,
  defaultSort: string,
): SortSpec<F[number]> {
  const attempt = trySort(raw, sortable, defaultSort);
  if (!attempt.ok) throw new PaginationError(`Invalid sort: ${attempt.reason}`);
  return attempt.sort as SortSpec<F[number]>;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The request schemas
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Both guards fire at construction, which happens at import — so an endpoint declared wrong is a
 * boot failure of the API rather than a route that pages an undefined order.
 */
function assertSortable(sortable: readonly string[], defaultSort: string): void {
  if (sortable.length === 0) {
    throw new PaginationError('sortable is empty: a list with no defined order cannot be paged.');
  }
  if (new Set(sortable).size !== sortable.length) {
    throw new PaginationError(`sortable names a field twice: ${sortable.join(', ')}`);
  }
  const attempt = trySort(defaultSort, sortable, defaultSort);
  if (!attempt.ok) {
    throw new PaginationError(`Invalid defaultSort "${defaultSort}": ${attempt.reason}`);
  }
}

/**
 * `limit` is coerced because a query string delivers `'50'`, not `50`. It is `.default`ed rather
 * than optional so a handler never has to decide what "no limit" means.
 */
const limitSchema = z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT);

function paginationShape<const F extends readonly [string, ...string[]]>(config: {
  readonly sortable: F;
  readonly defaultSort: string;
}) {
  assertSortable(config.sortable, config.defaultSort);

  return {
    limit: limitSchema,

    // The output is the decoded position, not the string: a handler that has to decode a cursor
    // itself has to handle a failure the boundary has already ruled out. `ctx.addIssue` rather
    // than a throw, so the failure arrives as a zod issue on the `cursor` path.
    cursor: z
      .string()
      .transform((raw, ctx): CursorPosition => {
        const decoded = decodeCursor(raw);
        if (!decoded.ok) {
          ctx.addIssue({ code: 'custom', message: `Invalid cursor: ${decoded.reason}` });
          return z.NEVER;
        }
        return decoded.position;
      })
      .optional(),

    // Parsed once, here. A handler receives `[{ field, direction }, …]`, never a string it has to
    // parse again — which is how two endpoints end up disagreeing about the same syntax.
    sort: z
      .string()
      .optional()
      .transform((raw, ctx): SortSpec<F[number]> => {
        const attempt = trySort(raw, config.sortable, config.defaultSort);
        if (!attempt.ok) {
          ctx.addIssue({ code: 'custom', message: `Invalid sort: ${attempt.reason}` });
          return z.NEVER;
        }
        return attempt.sort as SortSpec<F[number]>;
      }),
  };
}

/**
 * The paging half of a list request. `defaultSort` is required on purpose: a list with no
 * deterministic order cannot be paged at all, so an endpoint that has not said how it is ordered
 * should not compile.
 *
 * `strictObject`, so `?offset=40` is a rejected request rather than a silently ignored parameter
 * that pages in a circle.
 */
export function paginationQuery<const F extends readonly [string, ...string[]]>(config: {
  readonly sortable: F;
  readonly defaultSort: string;
}) {
  return z.strictObject(paginationShape(config));
}

/**
 * The paging half merged with an endpoint's own filters, so one parse produces one error envelope.
 * Decision C: filters are flat and typed per endpoint, not a query language.
 */
export function listQuery<
  const F extends readonly [string, ...string[]],
  S extends z.ZodRawShape = Record<never, never>,
>(config: { readonly sortable: F; readonly defaultSort: string; readonly filters?: S }) {
  const filters = config.filters ?? ({} as S);

  for (const key of Object.keys(filters)) {
    if ((RESERVED_QUERY_KEYS as readonly string[]).includes(key)) {
      throw new PaginationError(
        `Filter "${key}" shadows a reserved paging parameter (${RESERVED_QUERY_KEYS.join(', ')}).`,
      );
    }
  }

  return z.strictObject({ ...paginationShape(config), ...filters });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The response
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Decision D: `hasMore` and a cursor, no `total`. A count over a radius query costs the query. */
export const PageInfoSchema = z.strictObject({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

/** The response shape every list endpoint returns, and `W1-T03` generates one component for. */
export function pageEnvelope<S extends z.ZodType>(item: S) {
  return z.strictObject({ items: z.array(item), page: PageInfoSchema });
}

function freezePage<T>(items: readonly T[], nextCursor: string | null, hasMore: boolean): Page<T> {
  return Object.freeze({
    items: Object.freeze(items),
    page: Object.freeze({ nextCursor, hasMore }),
  });
}

export function emptyPage<T>(): Page<T> {
  return freezePage<T>([], null, false);
}

/** Ask the database for one more row than the page needs. See `pageOf`. */
export function fetchLimit(limit: number): number {
  return limit + 1;
}

function positionOf<F extends string>(row: CursorRow<F>, sort: SortSpec<F>): CursorPosition {
  const values = sort.slice(0, -1).map((field): CursorValue => {
    const value = (row as Record<string, unknown>)[field.field];

    if (value === undefined || value === null) {
      throw new PaginationError(
        `Row carries no value for the sort field "${field.field}"; a cursor cannot be built from it.`,
      );
    }
    // Prisma returns `Date` for a `DateTime` column. ISO strings compare in the same order and
    // Prisma accepts one wherever it accepts a `Date`, so nothing downstream has to revive a type.
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    throw new PaginationError(
      `Sort field "${field.field}" holds a ${typeof value}, which cannot go in a cursor.`,
    );
  });

  return { v: values, id: row.id };
}

/**
 * Turn `fetchLimit(limit)` rows into a page.
 *
 * The over-fetched row is the whole mechanism: its presence is `hasMore`, and it is dropped rather
 * than returned. Doing this here rather than at each call site means `hasMore` and `nextCursor`
 * cannot disagree — the failure mode of a hand-written `+ 1` is a last page that is silently
 * truncated, which nobody reports because it looks like the end of the list.
 *
 * The cursor values are read off the row using the sort spec's own field names, so the cursor and
 * the `ORDER BY` are derived from one source and cannot drift apart.
 */
export function pageOf<F extends string, T extends CursorRow<F>>(
  rows: readonly T[],
  request: { readonly limit: number; readonly sort: SortSpec<F> },
): Page<T> {
  const { limit, sort } = request;

  if (!Number.isInteger(limit) || limit < 1) {
    throw new PaginationError(`Page limit must be a positive integer, got ${String(limit)}.`);
  }

  const last = sort[sort.length - 1];
  if (last === undefined || last.field !== TIEBREAKER) {
    throw new PaginationError(
      `A sort spec must end with the "${TIEBREAKER}" tiebreaker, or paging is not over a total order.`,
    );
  }

  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const tail = hasMore ? items[items.length - 1] : undefined;

  return freezePage(
    items,
    tail === undefined ? null : encodeCursor(positionOf(tail, sort)),
    hasMore,
  );
}

/**
 * The rows strictly after `position`, in the order `sort` describes.
 *
 * For `(createdAt desc, id asc)` this is `createdAt < T OR (createdAt = T AND id > X)`, which
 * generalises to a disjunction of `n` conjunctions for `n` sort fields. It is written once, here,
 * because it is the part every list endpoint would otherwise get subtly wrong — and a subtly wrong
 * keyset predicate does not error, it just skips rows.
 */
export function keysetPredicate<F extends string>(
  sort: SortSpec<F>,
  position: CursorPosition,
): KeysetPredicate {
  const values: readonly CursorValue[] = [...position.v, position.id];

  if (sort.length !== values.length) {
    throw new PaginationError(
      `Cursor holds ${String(position.v.length)} sort value(s) plus an id, but the sort names ${String(sort.length)} field(s). The cursor was issued for a different sort.`,
    );
  }

  const or = sort.map((field, index) => ({
    and: Object.freeze(
      sort.slice(0, index + 1).map((prefix, i): KeysetClause => {
        const value = values[i];
        if (value === undefined) {
          throw new PaginationError(`Cursor has no value for sort field "${prefix.field}".`);
        }
        return {
          field: prefix.field,
          op: i < index ? 'eq' : prefix.direction === 'desc' ? 'lt' : 'gt',
          value,
        };
      }),
    ),
  }));

  return Object.freeze({ or: Object.freeze(or) });
}
