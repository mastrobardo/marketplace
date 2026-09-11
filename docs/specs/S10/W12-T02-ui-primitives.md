# W12-T02 — Seven primitives, and the states the product actually needs

Task: `W12-T02` · Slice: S10 · Owner: `agent-ui` · Issue: #202
Branch: `W12-T02-ui-primitives` · Run record: `W12-T02-ui-primitives.run.md`
Design: [ADR-012](../../adr/ADR-012-design-system-and-component-workbench.md) §1–§4 ·
Builds on [`W12-T01`](W12-T01-ui-package-and-route-rules.md)

---

## 1. Purpose

`packages/ui` builds, exports and holds the tokens, and contains no component. The next slice agent
that needs a button therefore still writes one, which is the exact failure ADR-012 was written to
prevent: thirteen agents, thirteen focus rings, and `W10-T05` buying WCAG compliance at the end, by
audit, which is the most expensive way there is.

Who suffers without it: every slice from `W2` on, and every user who tabs through a form. The
expensive half of an accessible control — focus management, the full keyboard model for a listbox,
correct ARIA relationships, live-region announcements, locale-aware collation for `ñ` — is bought
from React Aria Components rather than hand-rolled badly seven times.

The second purpose is the states. A component that ships only its happy path gets reimplemented by
the first agent who needs it disabled, and the reimplementation is where the focus ring dies. Each
primitive here ships **default, focus, disabled, loading, error and long-text** where the state is
meaningful for that control, and each of those states is a story — which `W12-T03` turns into a
test and `W12-T04` turns into an axe assertion.

**Long text is not decoration.** Spanish runs 15–20% longer than English (`agents/roles/agent-ui.md`),
and a fixed-width button is the most common way that surfaces. Every primitive has a long-text
story, and the suite fails if one is missing.

---

## 2. User stories

- **As a slice agent**, I want `<Button variant="primary" isPending>` to exist, so that I never
  decide for myself what a pending button looks like or announces.
- **As a user on a phone in a flooded kitchen**, I want every control reachable and legible with
  one thumb, so that the product works in the situation it is for.
- **As a keyboard or screen-reader user**, I want a select that behaves like a select — arrow keys,
  type-ahead, announced selection — so that the storefront is usable at all.
- **As a Spanish-speaking user**, I want *"Solicitar presupuesto sin compromiso"* to fit in the
  button, so that the interface does not look broken in its primary language.
- **As `agent-ui` in three months**, I want a component's states to be enumerated somewhere
  executable, so that a change that breaks the error state fails rather than ships.

## 3. State machine

None at the package level. The controls have internal interaction state (open/closed for Select,
Combobox, Dialog and Popover), and it is React Aria's, not ours — which is the point of §2 of
ADR-012. The stories enumerate the *visual* states; they are not a lifecycle.

## 4. API surface

No HTTP. The surface is `@marketplace/ui`'s public exports. Every component takes strings, numbers
and callbacks — **never a domain type** (ADR-012 §1: the day a `Job` type reaches the design system,
`agent-ui` becomes downstream of nine slices).

```ts
// Button — the only element in the system that may be pressed.
type ButtonVariant = 'primary' | 'secondary' | 'danger';
interface ButtonProps {
  variant?: ButtonVariant;          // default 'secondary'
  isPending?: boolean;              // renders the spinner and announces `pendingLabel`
  pendingLabel?: string;            // required when isPending may become true
  isDisabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onPress?: () => void;
  children: ReactNode;
}

// Field — label, description and error, in the order a screen reader should meet them.
// Rendered *inside* a React Aria field container so Label and FieldError find their context.
interface FieldProps {
  label: string;
  description?: string;
  errorMessage?: string;
  isRequired?: boolean;
  children: ReactNode;              // the control itself
}

interface TextInputProps extends Omit<FieldProps, 'children'> {
  type?: 'text' | 'email' | 'tel' | 'search' | 'password';
  value?: string; defaultValue?: string; onChange?: (value: string) => void;
  placeholder?: string; name?: string; isDisabled?: boolean; autoComplete?: string;
}

interface Option { id: string; label: string; isDisabled?: boolean }

interface SelectProps extends Omit<FieldProps, 'children'> {
  options: Option[]; placeholder?: string; name?: string; isDisabled?: boolean;
  selectedKey?: string | null; defaultSelectedKey?: string;
  onSelectionChange?: (key: string | null) => void;
}

interface ComboboxProps extends SelectProps {
  isLoading?: boolean;              // suggestions in flight — the `where` field's real state
  loadingLabel?: string;
  emptyLabel?: string;              // no match, which is not an error
  suggestionsLabel?: string;        // the name of the button that opens the list
  allowsCustomValue?: boolean;
  inputValue?: string; onInputChange?: (value: string) => void;
}

interface DialogProps {
  title: string; children: ReactNode; footer?: ReactNode;
  trigger?: ReactNode;              // uncontrolled: a DialogTrigger wraps it
  isOpen?: boolean; onOpenChange?: (isOpen: boolean) => void;   // controlled
  isDismissable?: boolean;          // default true
}

interface PopoverProps {
  trigger: ReactNode; children: ReactNode;
  placement?: 'top' | 'bottom' | 'start' | 'end';
  'aria-label': string;             // a popover with no name is unusable and axe says so
}
```

### 4.1 Styling

One CSS Module per component, reading **component tokens only** (`--mp-button-*`, `--mp-field-*`),
which are added to `tokens.css` in this task. `W12-T05` formalises the three layers and the
`[data-theme]` swap; this task adds the component layer the layering will describe.

The package gains a second stylesheet export for the compiled CSS Modules output:

```jsonc
"./styles.css": "./dist/ui.css"   // component CSS; ./tokens.css stays source-served
```

### 4.2 What this task does not add to the exports map

No pattern components (`SearchBar`, `Card`, `ResultRow`, `Pagination`) — ADR-012's second layer is
built on these seven and belongs with the pages that need it (`W12-T09` onward).

## 5. Permissions matrix

Not applicable — no actor, no endpoint. The boundary this task does enforce is ADR-012's package
one, and it becomes testable for the first time here because `packages/ui` now has imports at all:
`packages/ui/src/**` may not import `@marketplace/contracts` (AC15).

## 6. Error cases

No runtime error codes. "Error" is a component state, and it is a criterion for every control that
can hold one:

| Control | Error shows as | Criterion |
|---|---|---|
| TextInput, Select, Combobox | `aria-invalid`, message linked by `aria-describedby`, `--mp-field-border-invalid` | AC6, AC8, AC10 |
| Button | the `danger` variant — a destructive action, not a validation failure | AC4 |
| Combobox, no match | `emptyLabel` in the listbox, **not** an error | AC10 |

---

## 7. Acceptance criteria

### Every primitive exists and is accessible

- **AC1** — Given `@marketplace/ui`, when its entry point is imported, then `Button`, `Field`,
  `TextInput`, `Select`, `Combobox`, `Dialog` and `Popover` are exported, along with their prop
  types.
- **AC2** — Given any of the three field controls rendered with `label`, when queried by that label
  text, then the control is found — i.e. the label is *associated*, not merely adjacent.
- **AC3** — Given any primitive, when rendered, then no element carries an inline colour and every
  declaration in its stylesheet reads a `--mp-` token.

### Button

- **AC4** — Given `<Button variant="danger">`, when rendered, then it is a `button` element with an
  accessible name and the danger component token applied.
- **AC5** — Given `<Button isPending pendingLabel="Guardando">`, when rendered, then it exposes
  `aria-disabled`, does not fire `onPress`, and `Guardando` is announced in a live region.
- **AC6** — Given `<Button isDisabled>`, when pressed, then `onPress` does not fire.

### Field, TextInput

- **AC7** — Given a `TextInput` with `description`, when rendered, then the description is linked by
  `aria-describedby` and reachable from the input.
- **AC8** — Given a `TextInput` with `errorMessage`, when rendered, then the input is `aria-invalid`
  and the message is linked by `aria-describedby`; and when `errorMessage` is absent, then the input
  is not `aria-invalid`.
- **AC9** — Given `<TextInput isRequired>`, when rendered, then the control is marked required for
  assistive technology.

### Select, Combobox

- **AC10** — Given a `Select`, when opened with the keyboard, then its options are a `listbox`,
  arrow keys move the focused option, and Enter selects it and closes the popover.
- **AC11** — Given a `Select` with `errorMessage`, when rendered, then the message is linked to the
  trigger by `aria-describedby` and the field carries `data-invalid`. **Not `aria-invalid`**: that
  attribute belongs on an input and a select's trigger is a button, so React Aria conveys the state
  the way the ARIA practices do — a linked message, plus the constraint on the hidden native select.
  Asserting the attribute we expected rather than the behaviour that exists is how a test starts
  lying.
- **AC12** — Given a `Combobox` with `isLoading`, when opened, then `loadingLabel` is presented and
  no option is selectable; and given no match, then `emptyLabel` is presented and the field is
  **not** marked invalid.

### Dialog, Popover

- **AC13** — Given a `Dialog` with a trigger, when the trigger is pressed, then a `dialog` opens
  with its title as its accessible name and focus moves inside it; and when Escape is pressed, then
  it closes and focus returns to the trigger.
- **AC14** — Given a `Popover`, when its trigger is pressed, then the popover opens with the
  accessible name it was given.

### The rules that keep the system a system

- **AC15** — Given every file under `packages/ui/src`, when its imports are read, then none imports
  `@marketplace/contracts` or any `apps/*` path. *(ADR-012 §1: a component takes strings, numbers
  and callbacks.)*
- **AC16** — Given every primitive exported from the entry point, when the source tree is listed,
  then each has a `*.stories.tsx` beside it.
- **AC17** — Given every story file, when its exports are read, then it exports a `LongText` story
  — the Spanish-overflow case — and every story it exports renders without throwing, through
  `composeStories`.
- **AC18** — Given `packages/ui`'s stylesheets, when they are read, then there is more than one and
  none but `tokens.css` contains a colour literal. *(`W12-T01` left this assertion proving its own
  walker because the package had a single stylesheet; the guard comes back now that it means
  something.)*

## 8. Data

None.

## 9. Out of scope

- **The workbench.** `.storybook/`, the theme and locale toolbars, stories-as-browser-tests and the
  a11y addon are `W12-T03` and `W12-T04`. Stories here are written as CSF3 and exercised through
  `composeStories` in jsdom, so `W12-T03` wires a runner to stories that already pass rather than
  rewriting forty of them.
- **Token layering and the second theme** (`W12-T05`). Component tokens are added; they are not yet
  formally three layers.
- **Patterns** — `SearchBar`, `Card`, `ResultRow`, `EmptyState`, `Pagination`, the map frame. They
  compose these seven and land with the pages that need them.
- **Using any of this in `apps/web`.** The shell still ships its own `<select>` in
  `src/shared/LanguageSwitcher.tsx`. It is replaced by `Select` in `W12-T09`, with the header.
- **Date and number formatting.** React Aria brings the locale-aware machinery; the product's
  `es-ES` EUR display rules are a pattern-layer concern.

## 10. Open questions

### Q1 — the raw-element gate is not in this task

ADR-012 §1 says a feature slice "never ships a raw `<button>`, `<input>` or `<dialog>`", and that
"both are gates, not requests". The colour half is a gate today; the element half is not, and adding
it here would be scope creep into a ticket about components (L10). It is one `no-restricted-syntax`
rule over `src/features/**`, it belongs next to `W12-T01`'s route rules, and it cannot be switched
on before `src/shared/LanguageSwitcher.tsx` is converted — which is `W12-T09`. **Proposed as a
follow-up ticket to file against `W12-T09`**, not invented here.

### Q2 — `Combobox` filters locally, with a locale-aware matcher

React Aria filters only an *uncontrolled* collection, and a controlled one — which is what an async
suggestion list needs — is the caller's to filter. So the component filters with `useFilter`'s
locale-aware `contains` (`sensitivity: 'base'`), which matches *Cerrajería* for `cerrajeria` and
*València* for `valencia`. Filtering by `String.includes` in an ES-first product fails on the accent
every time, and the user concludes the city is not in the list.

**Known limitation, recorded rather than discovered.** When `W12-T07` backs the `where` field with
`GET /places/suggest`, the server's results arrive already filtered — and a server that does fuzzy
or typo-tolerant matching would return rows this local `contains` then drops. The fix is a prop that
turns local filtering off, added by the ticket that introduces the server call, not guessed at here.

### Q3 — React Aria's own strings are English, and this product is Spanish-first

Discovered while testing: a `Select` with no `placeholder` renders React Aria's built-in *"Select an
item"*, and a `ComboBox`'s listbox announces itself as *"Suggestions"*. Those come from React Aria's
bundled translations and are chosen by locale, which means the **application** must wrap its tree in
`<I18nProvider locale="es-ES">`. That is an `apps/web` change, it belongs with the public shell
(`W12-T09`), and it is invisible until someone opens a select without a placeholder — which is
exactly the kind of thing that ships. Every string this package renders itself is already a prop
with a Spanish default.

No `ESCALATION` blocks.
