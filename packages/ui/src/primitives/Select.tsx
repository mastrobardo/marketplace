import { type ReactElement } from 'react';
import {
  Button as AriaButton,
  type Key,
  ListBox,
  ListBoxItem,
  Popover as AriaPopover,
  Select as AriaSelect,
  SelectValue,
} from 'react-aria-components';
import { Field } from './Field.js';
import { cx } from '../internal/cx.js';
import styles from './Select.module.css';

export interface Option {
  id: string;
  label: string;
  isDisabled?: boolean;
}

export interface SelectProps {
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
}

/**
 * A single-choice control with the whole keyboard model React Aria ships: arrow keys, Home/End,
 * type-ahead, and selection announced. Hand-rolling that is how a `<div role="listbox">` ends up
 * unusable for the people who need the role most.
 */
export function Select({
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
}: SelectProps): ReactElement {
  return (
    <AriaSelect
      className={cx(styles['wrapper'])}
      isInvalid={errorMessage !== undefined}
      isRequired={isRequired}
      isDisabled={isDisabled}
      {...(placeholder !== undefined ? { placeholder } : {})}
      {...(name !== undefined ? { name } : {})}
      {...(selectedKey !== undefined ? { selectedKey } : {})}
      {...(defaultSelectedKey !== undefined ? { defaultSelectedKey } : {})}
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
        {/*
          No `aria-invalid` here on purpose: `aria-invalid` belongs on an input, and this trigger is
          a button. React Aria conveys the invalid state the way the ARIA practices do — the error
          message is linked to the trigger by `aria-describedby`, the wrapper carries `data-invalid`
          for styling, and the hidden native select carries the constraint for form validation.
        */}
        <AriaButton className={cx(styles['trigger'])}>
          <SelectValue className={cx(styles['value'])} />
          <span className={cx(styles['arrow'])} aria-hidden="true">
            ▾
          </span>
        </AriaButton>
      </Field>
      <AriaPopover className={cx(styles['popover'])}>
        <ListBox className={cx(styles['listbox'])} items={options}>
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
    </AriaSelect>
  );
}
