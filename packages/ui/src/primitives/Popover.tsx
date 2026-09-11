import { type ReactElement, type ReactNode } from 'react';
import { Dialog as AriaDialog, DialogTrigger, Popover as AriaPopover } from 'react-aria-components';
import { cx } from '../internal/cx.js';
import styles from './Popover.module.css';

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  placement?: 'top' | 'bottom' | 'start' | 'end';
  /** A popover with no name announces itself as an empty dialog, and axe says so. */
  'aria-label': string;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
}

/**
 * Non-modal overlay anchored to its trigger — a filter panel, a bit of help, the map's legend.
 *
 * The content is a dialog on purpose: that is what gives React Aria somewhere to move focus, and it
 * is why Escape and a click outside behave the way a user expects rather than the way this
 * particular popover was written.
 */
export function Popover({
  trigger,
  children,
  placement = 'bottom',
  'aria-label': ariaLabel,
  isOpen,
  onOpenChange,
}: PopoverProps): ReactElement {
  return (
    <DialogTrigger
      {...(isOpen !== undefined ? { isOpen } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      {trigger}
      <AriaPopover className={cx(styles['popover'])} placement={placement}>
        <AriaDialog className={cx(styles['dialog'])} aria-label={ariaLabel}>
          {children}
        </AriaDialog>
      </AriaPopover>
    </DialogTrigger>
  );
}
