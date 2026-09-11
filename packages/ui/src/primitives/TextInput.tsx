import { type ReactElement } from 'react';
import { Input, TextField } from 'react-aria-components';
import { Field } from './Field.js';
import { cx } from '../internal/cx.js';
import styles from './TextInput.module.css';

export interface TextInputProps {
  label: string;
  description?: string;
  /** Present means invalid: the input is marked `aria-invalid` and the message is linked to it. */
  errorMessage?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  type?: 'text' | 'email' | 'tel' | 'search' | 'password';
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  name?: string;
  autoComplete?: string;
}

/** A single-line text field. Every user-visible string is a prop: the design system holds no copy. */
export function TextInput({
  label,
  description,
  errorMessage,
  isRequired = false,
  isDisabled = false,
  type = 'text',
  value,
  defaultValue,
  onChange,
  placeholder,
  name,
  autoComplete,
}: TextInputProps): ReactElement {
  return (
    <TextField
      className={cx(styles['wrapper'])}
      type={type}
      isInvalid={errorMessage !== undefined}
      isRequired={isRequired}
      isDisabled={isDisabled}
      {...(value !== undefined ? { value } : {})}
      {...(defaultValue !== undefined ? { defaultValue } : {})}
      {...(onChange ? { onChange } : {})}
      {...(name !== undefined ? { name } : {})}
    >
      <Field
        label={label}
        isRequired={isRequired}
        {...(description !== undefined ? { description } : {})}
        {...(errorMessage !== undefined ? { errorMessage } : {})}
      >
        <Input
          className={cx(styles['input'])}
          {...(placeholder !== undefined ? { placeholder } : {})}
          {...(autoComplete !== undefined ? { autoComplete } : {})}
        />
      </Field>
    </TextField>
  );
}
