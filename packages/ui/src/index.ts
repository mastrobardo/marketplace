/**
 * The design system's single entry point.
 *
 * Two layers, per ADR-012: primitives here, patterns (`SearchBar`, `Card`, `ResultRow`,
 * `Pagination`, the map frame) when the pages that need them arrive. Nothing here knows a domain
 * type — a component takes strings, numbers and callbacks, which is what keeps `agent-ui` from
 * becoming downstream of nine slices. `tests/boundaries.test.ts` is the gate.
 *
 * Tokens are a stylesheet, not an export: `@marketplace/ui/tokens.css`.
 */
export { Button, type ButtonProps, type ButtonVariant } from './primitives/Button.js';
export { Field, type FieldProps } from './primitives/Field.js';
export { TextInput, type TextInputProps } from './primitives/TextInput.js';
export { Select, type Option, type SelectProps } from './primitives/Select.js';
export { Combobox, type ComboboxProps } from './primitives/Combobox.js';
export { Dialog, type DialogProps } from './primitives/Dialog.js';
export { Popover, type PopoverProps } from './primitives/Popover.js';
