# W12-T07 — The search bar as a declarative schema

Task: `W12-T07` · Slice: S10 · Owner: `agent-ui` · Issue: #207
Branch: `W12-T07-search-schema` · Run record: `W12-T07-search-schema.run.md`
Design: [ADR-011](../../adr/ADR-011-web-application-architecture.md) §3, §4 ·
Builds on [`W12-T02`](W12-T02-ui-primitives.md), [`W12-T03`](W12-T03-storybook-workbench.md),
[`W12-T05`](W12-T05-token-layers-and-themes.md)

---

## 1. Purpose

ADR-011 §3 makes a claim the repo has not yet had to honour: *"The home hero, the compact control in
the header, and the results filter rail are three renderings of **one** declaration. The alternative
— three hand-built forms — guarantees they drift, and the drift is invisible until a filter exists
in one place and not the others."*

Three tasks are about to build those three surfaces — `W12-T09` the header, `W12-T10` the hero,
`W12-T11` the filter rail — and they are three different pull requests. Whichever lands first sets
the shape; the other two copy it and then diverge, because nothing stops them. This task is the
thing that stops them: one declaration, one renderer, and the query string produced by a function
rather than by whichever page is doing the navigating.

The second half is the reason the task sits *before* the pages rather than among them. ADR-011 §3
consequence 1: **the schema produces the query**, and the query is the search API's input. Which
makes this the artefact `W12-T08` files with `agent-contracts` and `W3-T04` implements against — a
UI that *defines* the endpoint's input instead of guessing at it a milestone later.

Who suffers without it: every storefront task from `W12-T09` on, which each invent a form; then
`agent-discovery`, handed an endpoint shape derived from whichever of the three forms someone
happened to screenshot.

## 2. User stories

- **As a visitor**, I want the search I started in the hero to still be there in the header on the
  results page, so that refining a search is not retyping it.
- **As a visitor who shares a link**, I want the search to be in the URL, so that what my neighbour
  opens is the search I ran, not the home page.
- **As `agent-discovery`**, I want the search bar's output to be a declared shape rather than a form
  I have to reverse-engineer, so that `GET /search` is built against its real caller.
- **As a slice agent adding a filter**, I want to add one descriptor and get it in all three
  renderings, so that "it is in the rail but not the hero" is not a bug that can be written.
- **As `agent-ui`**, I want the query-string functions to be pure and DOM-free, so that the loader
  that parses a search on a Worker is the same code that serialises it in the browser (ADR-011 R4).

## 3. State machine

None — the search bar is a value bag, controlled or uncontrolled like any field. The one piece of
genuine UI state belongs to a single rendering:

| Rendering | State | Values | Default |
|---|---|---|---|
| `header` | disclosure | `collapsed` · `expanded` | `collapsed` |
| `hero`, `filters` | — | none | — |

Collapsed shows one field — the one `renderings.header.collapseTo` names — plus the submit control.
Expanded shows all of them. It is `useState` in the component, not a prop, because no page needs to
read it and a page that does can render `hero` instead.

## 4. API surface

### 4.1 The files

| File | Holds |
|---|---|
| `src/patterns/search/schema.ts` | `SearchField`, `SearchSchema`, `SearchRendering`, `fieldsFor` |
| `src/patterns/search/query.ts` | `SearchValues`, `SearchQuery`, `toSearchQuery`, `serializeSearchQuery`, `parseSearchQuery`, `missingRequiredFields` |
| `src/patterns/search/SearchBar.tsx` | the one renderer, three renderings |
| `src/patterns/search/SearchBar.module.css` | layout per rendering; reads component + semantic tokens only |
| `src/styles/components.css` | `--mp-search-*`, added to the component layer |
| `src/index.ts` | the pattern's exports — the package's first non-primitive |

`patterns/` is ADR-012's second layer, named in `src/index.ts`'s own header since `W12-T02`
(*"primitives here, patterns (`SearchBar`, …) when the pages that need them arrive"*). This is that
arrival.

### 4.2 The descriptors

```ts
export type SearchRendering = 'hero' | 'header' | 'filters';

interface SearchFieldBase {
  /** The query-string key, and the values-bag key. */
  name: string;
  /** Already translated. The design system holds no copy. */
  label: string;
  isRequired?: boolean;
  placeholder?: string;
  description?: string;
}

export interface CategoryField extends SearchFieldBase { kind: 'category'; options: Option[]; … }
export interface PlaceField    extends SearchFieldBase { kind: 'place'; options: Option[]; allowsCustomValue?: boolean; … }
export interface ChoiceField   extends SearchFieldBase { kind: 'choice'; options: Option[] }
export type SearchField = CategoryField | PlaceField | ChoiceField;

export interface SearchSchema {
  fields: SearchField[];
  renderings: {
    hero: { layout: 'row'; prominence: 'primary' };
    header: { layout: 'compact'; collapseTo: string };
    filters: { layout: 'stack'; extra: SearchField[] };
  };
}
```

Three deliberate differences from ADR-011 §3's sketch, all in the same direction — the sketch is
*this product's instance* of the shape, and the shape is what `packages/ui` may hold:

1. **`name` is a `string`, not `'what' | 'where' | 'when' | 'mode'`.** The ADR's own third
   consequence is that *"a second vertical is a different schema"*; a union of our four field names
   compiled into the design system makes the second vertical a change to `packages/ui`.
2. **`options` on every field, supplied by the caller.** `Urgency[]` and `JobMode[]` are domain
   types from `packages/contracts`, and `tests/boundaries.test.ts` AC15 forbids that import here.
   They arrive as `Option[]` — the same `{ id, label }` the `Select` and `Combobox` already take.
3. **`geolocate` is not in this task.** It is a browser permission prompt and a `GET
   /places/suggest` call, neither of which belongs to a pure renderer. `W12-T09` owns it; the
   `place` descriptor is where it will attach.

### 4.3 The pure function, and the query string

```ts
export type SearchValues = Readonly<Record<string, string | null>>;
export type SearchQuery  = Readonly<Record<string, string>>;

export function toSearchQuery(schema: SearchSchema, values: SearchValues): SearchQuery;
export function serializeSearchQuery(query: SearchQuery): string;
export function parseSearchQuery(schema: SearchSchema, input: string | URLSearchParams): SearchQuery;
export function missingRequiredFields(schema: SearchSchema, query: SearchQuery): string[];
```

`toSearchQuery` is the function ADR-011 names. It is total and it is a filter: a name the schema
does not declare is dropped, `null` and `''` are dropped rather than serialised empty, values are
trimmed, and the result is ordered by the schema — `fields` then `renderings.filters.extra` — so
that two identical searches produce one identical URL and one cache key.

`parseSearchQuery` is the same filter from the other side, and it is the reason the schema is passed
in: a value for a `category` or a `choice` field is kept only if it is one of that field's options.
A `place` field with `allowsCustomValue` keeps free text, which is what a postcode is before
`/places/suggest` exists.

**`SearchQuery` here is a record, not the zod type.** `packages/contracts` will hold
`SearchQuerySchema` (`W12-T08`), and `packages/ui` may not import it — AC15, the gate that keeps the
design system from becoming downstream of nine slices. So this layer produces the structurally
correct thing and the application validates it at the seam:
`SearchQuerySchema.parse(toSearchQuery(schema, values))`. The run record carries the proposal.

Nothing in `query.ts` touches `window`, `document` or `location`: ADR-011 R4 puts the state in the
URL, and R1 means a loader on a Worker parses it with this same function.

### 4.4 The three renderings

One component, one `rendering` prop. What differs is layout and which fields are visible:

| Rendering | Fields shown | Submit | Layout |
|---|---|---|---|
| `hero` | all of `fields` | primary, labelled | row, wrapping to a stack under 40rem |
| `header` | `collapseTo` only until expanded | primary, icon-width label | compact row |
| `filters` | `fields` + `renderings.filters.extra` | secondary | stack |

The element is `<form role="search">` with an accessible name from the `label` prop, so the three
renderings are three search landmarks a screen-reader user can jump to — and so two of them on one
page (`W12-T11`: header and rail) are distinguishable, which is what the unnamed-landmark axe rule
is about. `onSubmit` receives the `SearchQuery`, not the event: the component never navigates.

`category` and `place` render as `Combobox`, `choice` as `Select`. No new primitive.

### 4.5 What it still does not do

No `fetch`, no router import, no navigation, no copy, no domain type. The strings it shows are
props, including the submit label and the header's expand label.

## 5. Permissions matrix

Not applicable — the storefront search is public (ADR-011 §2, all of M11).

## 6. Error cases

| Case | Behaviour |
|---|---|
| Query string names a field the schema does not declare | dropped by `parseSearchQuery` |
| Query string carries a value outside a closed field's options | dropped; the field renders empty |
| Same key repeated (`?what=a&what=b`) | first wins — a single-value schema, deterministically |
| Required field empty on submit | `onSubmit` still fires; `missingRequiredFields` names them, the app supplies the message |
| `errors` prop names a field | rendered as that field's `errorMessage`; the field is `aria-invalid` and described by it |
| `collapseTo` names a field that does not exist | the header rendering falls back to the first field rather than rendering nothing |

Validation returns data, never copy. The design system does not own the sentence "elige un
servicio", and `W12-T09` owns where it is stored.

## 7. Acceptance criteria

| # | Criterion | Test |
|---|---|---|
| AC1 | The package exports the pattern, its types and its four functions | `search-schema.test.ts` |
| AC2 | `toSearchQuery` drops unknown names, `null`, `''` and whitespace-only values | `search-schema.test.ts` |
| AC3 | `toSearchQuery` orders keys by the schema, not by the values object | `search-schema.test.ts` |
| AC4 | `serializeSearchQuery` round-trips through `parseSearchQuery` unchanged | `search-schema.test.ts` |
| AC5 | `parseSearchQuery` keeps only declared names, and only permitted values | `search-schema.test.ts` |
| AC6 | `allowsCustomValue` keeps free text on a `place` field | `search-schema.test.ts` |
| AC7 | `missingRequiredFields` names every empty required field, in schema order | `search-schema.test.ts` |
| AC8 | `query.ts` and `schema.ts` reference no browser global (R4, a Worker parses the URL) | `search-schema.test.ts` |
| AC9 | `hero` renders every field; `filters` renders the extras too; `header` renders one until expanded | `search-bar.test.tsx` |
| AC10 | Submitting hands `onSubmit` the query the pure function would have produced | `search-bar.test.tsx` |
| AC11 | Each rendering is a named `search` landmark; `errors` reach the field as `aria-invalid` + description | `search-bar.test.tsx` |
| AC12 | Every exported *component* has a story file beside it — patterns included | `boundaries.test.ts` |
| AC13 | The pattern's stylesheet names no colour and reads only `--mp-*` | `boundaries.test.ts` (existing, widened by the new file) |
| AC14 | Every rendering and state is a story, so it is an axe assertion | `SearchBar.stories.tsx` |

## 8. Data

No database, no migration, no Prisma model. The contract this task implies — `SearchQuery` and
`SearchResult` as zod schemas — is `W12-T08`'s request to `agent-contracts`; the run record carries
the proposed shape so that task starts from a written artefact rather than from a reading of this
component.

## 9. Out of scope

- The instance. `what · where · when · mode` with real categories is `W12-T09`/`W12-T10`, and
  ADR-011 §3 puts it in the discovery feature — a folder this agent may not touch.
- `geolocate`, `/places/suggest` autocomplete, and recent-search history.
- Navigation. `onSubmit` hands over a query; who calls `navigate('/buscar?…')` is the page's
  business.
- The zod schemas and the MSW handlers — `W12-T08`, filed with `agent-contracts`.
- Multi-value fields (`?what=a&what=b`). First-wins is a decision this spec takes, not a limitation
  it hides: nothing in ADR-011 §3's four fields is multi-select, and a facet rail that needs one
  (`W12-T11`) adds a `kind` rather than changing what a key means.

## 10. Open questions

### Q1 — why does `packages/ui` define a `SearchQuery` at all, when `W12-T08` is about to freeze one?

Because the alternatives are worse in a way the boundary gate already knows about. Importing
`packages/contracts` here is an AC15 failure by design — the design system stops being reusable the
moment it knows what a category is. Waiting for T08 would put the contract request before the thing
that defines it, which is exactly the inversion ADR-011 §3 consequence 1 set out to avoid.

So: this layer's `SearchQuery` is the *structure* (a record of declared keys to strings), the
contract's is the *meaning* (which keys, which values, parsed), and the application composes them at
the seam. They cannot silently diverge because the component's output is checked by
`SearchQuerySchema.parse` in the one place the two meet, on `W12-T08`'s branch.

### Q2 — three renderings in one component, or three components sharing a hook?

Three components would each be reviewable on their own and would not carry a `rendering` prop that
half the component ignores. But drift is the failure this task exists to prevent, and three files is
three places to add a field to. The prop is the smaller cost, and the layout differences are CSS —
`SearchBar.module.css` has one class per rendering and the JSX differs only in what `header`
collapses. If a fourth rendering ever needs a different *structure* rather than a different layout,
that is the point to split, and the pure functions are already the part worth sharing.
