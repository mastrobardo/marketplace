import { accepts, fieldsFor, type SearchField, type SearchSchema } from './schema.js';

/**
 * The schema produces the query — ADR-011 §3, first consequence — and the query is the URL.
 *
 * Everything here is pure, total and free of browser globals on purpose. R4 puts the state of a
 * search in the query string, and R1 means the code that reads it may be running in a loader on a
 * Worker with no `window` in sight (`W12-T14` flips that switch). `tests/search-schema.test.ts`
 * asserts the absence rather than trusting it.
 *
 * `SearchQuery` here is the *structure*: declared keys, string values. The *meaning* — which keys, ...
 * which values, parsed — is `SearchQuerySchema` in `packages/contracts`, which this package may not
 * import (AC15). The application composes them where the two meet:
 * `SearchQuerySchema.parse(toSearchQuery(schema, values))`. See `W12-T08`.
 */

/** What the controls hold. `null` is "not answered", the same as absent. */
export type SearchValues = Readonly<Record<string, string | null>>;

/** What goes in the URL, and what the search endpoint receives. */
export type SearchQuery = Readonly<Record<string, string>>;

/** Every field a schema declares, rail extras included — the rail's filters are in the URL too. */
function allFields(schema: SearchSchema): SearchField[] {
  return fieldsFor(schema, 'filters');
}

/**
 * The pure function. It is a filter as much as a mapping: a name the schema does not declare is
 * dropped, an unanswered field is absent rather than empty, and the keys come out in schema order
 * so that two identical searches produce one identical URL — and one cache key.
 */
export function toSearchQuery(schema: SearchSchema, values: SearchValues): SearchQuery {
  const query: Record<string, string> = {};
  for (const field of allFields(schema)) {
    const value = values[field.name];
    if (value === null || value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed === '') continue;
    query[field.name] = trimmed;
  }
  return query;
}

/**
 * `?what=fontaneria&where=28013`. `URLSearchParams` handles the encoding, including the accents
 * half this product's categories are spelled with.
 */
export function serializeSearchQuery(query: SearchQuery): string {
  return new URLSearchParams(Object.entries(query)).toString();
}

/**
 * The same filter from the other side, which is why it needs the schema: a URL is untrusted input.
 * A parameter nobody declared is dropped, and a value outside a closed field's options is dropped
 * with it — a hand-edited `?what=nosuch` renders an empty field, never a category that does not
 * exist. A repeated key takes its first value: nothing in ADR-011 §3's fields is multi-select, and
 * "first wins" is a decision rather than whatever the URL library happened to do.
 */
export function parseSearchQuery(
  schema: SearchSchema,
  input: string | URLSearchParams,
): SearchQuery {
  const params = typeof input === 'string' ? new URLSearchParams(input.replace(/^\?/, '')) : input;
  const query: Record<string, string> = {};
  for (const field of allFields(schema)) {
    const raw = params.get(field.name);
    if (raw === null) continue;
    const value = raw.trim();
    if (value === '' || !accepts(field, value)) continue;
    query[field.name] = value;
  }
  return query;
}

/**
 * Validation returns data, never copy: the names of the required fields left empty, in schema
 * order. The sentence a user reads is the application's to own — this package does not know
 * whether it is showing Spanish.
 */
export function missingRequiredFields(schema: SearchSchema, query: SearchQuery): string[] {
  return allFields(schema)
    .filter((field) => field.isRequired === true)
    .filter((field) => (query[field.name] ?? '') === '')
    .map((field) => field.name);
}
