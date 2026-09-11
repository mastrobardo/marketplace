import { type Option } from '../../primitives/Select.js';

/**
 * The declaration behind all three search surfaces — ADR-011 §3.
 *
 * What this file deliberately does **not** hold is the instance. There is no `'what' | 'where'`
 * union here and no `Urgency[]`: a field's `name` is a string and its options arrive as data, so
 * that a second vertical is a different declaration rather than a change to the design system
 * (ADR-011 §3, third consequence). `tests/boundaries.test.ts` AC15 is the same rule as a gate — a
 * domain type imported here makes `agent-ui` downstream of nine slices.
 */

export type SearchRendering = 'hero' | 'header' | 'filters';

interface SearchFieldBase {
  /** The query-string key, and the key in the values bag. */
  name: string;
  /** Already translated: the design system holds no copy. */
  label: string;
  isRequired?: boolean;
  placeholder?: string;
  description?: string;
}

/** A closed list the product owns — the service being searched for. */
export interface CategoryField extends SearchFieldBase {
  kind: 'category';
  options: Option[];
  /** Suggestions are in flight. */
  isLoading?: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
}

/**
 * Where the work is. Open by default, because until `GET /places/suggest` exists (`W3-T06`,
 * wired by `W12-T09`) a postcode typed into the box is the only answer a user can give.
 */
export interface PlaceField extends SearchFieldBase {
  kind: 'place';
  options: Option[];
  allowsCustomValue?: boolean;
  isLoading?: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
}

/** One of n — urgency, mode, and whatever the filter rail adds. */
export interface ChoiceField extends SearchFieldBase {
  kind: 'choice';
  options: Option[];
}

export type SearchField = CategoryField | PlaceField | ChoiceField;

export interface SearchSchema {
  fields: SearchField[];
  renderings: {
    hero: { layout: 'row'; prominence: 'primary' };
    /** `collapseTo` names the one field the compact control shows before it is expanded. */
    header: { layout: 'compact'; collapseTo: string };
    /** Fields that exist only in the rail: too many for a hero, too useful to omit. */
    filters: { layout: 'stack'; extra: SearchField[] };
  };
}

/**
 * Which fields a rendering is made of — the hero and the header share the declaration, the rail
 * adds its extras. This is the function that makes "a filter exists in one place and not the
 * others" unwritable: a new descriptor appears in every rendering or in none.
 */
export function fieldsFor(schema: SearchSchema, rendering: SearchRendering): SearchField[] {
  return rendering === 'filters'
    ? [...schema.fields, ...schema.renderings.filters.extra]
    : [...schema.fields];
}

/**
 * The field the compact header shows while collapsed. A `collapseTo` that names nothing falls back
 * to the first field rather than rendering an empty search box — a typo in a declaration should
 * cost a reviewer a raised eyebrow, not a user their search.
 */
export function collapsedField(schema: SearchSchema): SearchField | undefined {
  const named = schema.fields.find((field) => field.name === schema.renderings.header.collapseTo);
  return named ?? schema.fields[0];
}

/** Whether a value is one this field would accept back out of a URL. */
export function accepts(field: SearchField, value: string): boolean {
  if (field.kind === 'place' && field.allowsCustomValue === true) return value.length > 0;
  return field.options.some((option) => option.id === value);
}
