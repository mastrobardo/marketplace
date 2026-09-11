import { type ReactElement, type ReactNode } from 'react';
import { FieldError, Label, Text } from 'react-aria-components';
import { cx } from '../internal/cx.js';
import styles from './Field.module.css';

export interface FieldProps {
  label: string;
  description?: string;
  /** Present means invalid. The parent control is what carries `isInvalid`. */
  errorMessage?: string;
  isRequired?: boolean;
  /** The control itself. */
  children: ReactNode;
}

/**
 * Label, control, description, error — in the order assistive technology should meet them, which is
 * also the order they are read in.
 *
 * Rendered *inside* a React Aria field container (`TextField`, `Select`, `ComboBox`), because
 * `Label` and `FieldError` find their control through that context. That is what makes the label an
 * association rather than a paragraph that happens to sit above an input.
 */
export function Field({
  label,
  description,
  errorMessage,
  isRequired = false,
  children,
}: FieldProps): ReactElement {
  return (
    <div className={cx(styles['field'])}>
      <Label className={cx(styles['label'])}>
        {label}
        {isRequired ? (
          <span className={cx(styles['required'])} aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {description !== undefined ? (
        <Text slot="description" className={cx(styles['description'])}>
          {description}
        </Text>
      ) : null}
      {errorMessage !== undefined ? (
        <FieldError className={cx(styles['error'])}>{errorMessage}</FieldError>
      ) : null}
    </div>
  );
}
