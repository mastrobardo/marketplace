import { type ReactElement, useState } from 'react';
import { useFilter } from 'react-aria';
import {
  Button as AriaButton,
  ComboBox as AriaComboBox,
  Input,
  type Key,
  ListBox,
  ListBoxItem,
  Popover as AriaPopover,
} from 'react-aria-components';
import { Field } from './Field.js';
import { type Option } from './Select.js';
import { cx } from '../internal/cx.js';
import styles from './Combobox.module.css';

export interface ComboboxProps {
  label: string;
  options: Option[];
  description?: string;
  errorMessage?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  placeholder?: string;
  name?: string;
  selectedKey?: string | null;
  defaultSelectedKey?: string;
  onSelectionChange?: (key: string | null) => void;
  /** Suggestions are in flight — the `where` field's real state once `GET /places/suggest` exists. */
  isLoading?: boolean;
  loadingLabel?: string;
  /** No match. Not an error: the field stays valid and says so. */
  emptyLabel?: string;
  /** The name of the button that opens the suggestions. */
  suggestionsLabel?: string;
  allowsCustomValue?: boolean;
  inputValue?: string;
  onInputChange?: (value: string) => void;
}

/**
 * Type-ahead over a list. Filtering is React Aria's locale-aware `contains`, which is the reason
 * this is not an `<input list>`: it matches *Cerrajería* when someone types `cerrajeria`, and
 * sorting and matching `ñ` correctly is most of what an ES-first product needs from a combobox.
 *
 * Every string it can show is a prop, including the name of its own button. The design system holds
 * no copy and has no i18n dependency — the application passes translated text in (ADR-012 §1).
 */
export function Combobox({
  label,
  options,
  description,
  errorMessage,
  isRequired = false,
  isDisabled = false,
  placeholder,
  name,
  selectedKey,
  defaultSelectedKey,
  onSelectionChange,
  isLoading = false,
  loadingLabel = 'Cargando…',
  emptyLabel = 'Sin resultados',
  suggestionsLabel = 'Mostrar sugerencias',
  allowsCustomValue = false,
  inputValue,
  onInputChange,
}: ComboboxProps): ReactElement {
  // Locale-aware `contains`: it matches *Cerrajería* when someone types `cerrajeria`, and *València*
  // when they type `valencia`. An ES-first product that filtered by `String.includes` would fail on
  // the accent every time, and the user would conclude the city is not in the list.
  const { contains } = useFilter({ sensitivity: 'base' });
  const [typed, setTyped] = useState('');
  const query = inputValue ?? typed;

  function handleInputChange(value: string): void {
    setTyped(value);
    onInputChange?.(value);
  }

  const visible = isLoading ? [] : options.filter((option) => contains(option.label, query));

  return (
    <AriaComboBox
      className={cx(styles['wrapper'])}
      items={visible}
      isInvalid={errorMessage !== undefined}
      isRequired={isRequired}
      isDisabled={isDisabled}
      allowsCustomValue={allowsCustomValue}
      // React Aria closes the menu when the collection is empty. That is the right default for a
      // plain autocomplete and wrong for both states this control has to show: "buscando…" and
      // "no encontramos esa ciudad" both happen with nothing to list.
      allowsEmptyCollection
      {...(name !== undefined ? { name } : {})}
      {...(selectedKey !== undefined ? { selectedKey } : {})}
      {...(defaultSelectedKey !== undefined ? { defaultSelectedKey } : {})}
      {...(inputValue !== undefined ? { inputValue } : {})}
      onInputChange={handleInputChange}
      {...(onSelectionChange
        ? {
            onSelectionChange: (key: Key | null) =>
              onSelectionChange(key === null ? null : String(key)),
          }
        : {})}
    >
      <Field
        label={label}
        isRequired={isRequired}
        {...(description !== undefined ? { description } : {})}
        {...(errorMessage !== undefined ? { errorMessage } : {})}
      >
        <div className={cx(styles['control'])}>
          <Input
            className={cx(styles['input'])}
            {...(placeholder !== undefined ? { placeholder } : {})}
          />
          <AriaButton className={cx(styles['trigger'])} aria-label={suggestionsLabel}>
            <span aria-hidden="true">▾</span>
          </AriaButton>
        </div>
      </Field>
      <AriaPopover className={cx(styles['popover'])}>
        <ListBox
          className={cx(styles['listbox'])}
          renderEmptyState={() => (
            <p className={cx(styles['empty'])} aria-live="polite">
              {isLoading ? loadingLabel : emptyLabel}
            </p>
          )}
        >
          {(option: Option) => (
            <ListBoxItem
              id={option.id}
              className={cx(styles['option'])}
              isDisabled={option.isDisabled ?? false}
            >
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </AriaPopover>
    </AriaComboBox>
  );
}
