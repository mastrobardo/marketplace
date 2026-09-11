import { type ReactElement, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { cx } from '../internal/cx.js';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  /** `danger` is for a destructive action, not for a validation failure. */
  variant?: ButtonVariant;
  /** Work is in flight: the press is refused and `pendingLabel` is announced. */
  isPending?: boolean;
  /** What a screen reader should hear while pending. Required in practice whenever `isPending` can become true. */
  pendingLabel?: string;
  isDisabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onPress?: () => void;
  children: ReactNode;
}

/**
 * The only element in this system that may be pressed.
 *
 * Pending is a first-class state rather than "disable it and hope": a disabled button announces
 * nothing, so a user who cannot see the spinner is told only that the control stopped working.
 * React Aria refuses the press; the live region says why.
 */
export function Button({
  variant = 'secondary',
  isPending = false,
  pendingLabel,
  isDisabled = false,
  type = 'button',
  onPress,
  children,
}: ButtonProps): ReactElement {
  return (
    <AriaButton
      className={cx(styles['button'], styles[variant])}
      type={type}
      isDisabled={isDisabled}
      isPending={isPending}
      {...(onPress ? { onPress } : {})}
    >
      <span className={cx(styles['label'])}>{children}</span>
      {isPending && pendingLabel !== undefined ? (
        <span className={cx(styles['pending'])} aria-live="polite">
          <span className={cx(styles['spinner'])} aria-hidden="true" />
          {pendingLabel}
        </span>
      ) : null}
    </AriaButton>
  );
}
