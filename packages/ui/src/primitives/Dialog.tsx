import { type ReactElement, type ReactNode } from 'react';
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components';
import { cx } from '../internal/cx.js';
import styles from './Dialog.module.css';

export interface DialogProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Uncontrolled: React Aria opens it and returns focus to this element on close. */
  trigger?: ReactNode;
  /** Controlled. Pass both, or neither. */
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  /** Escape and a click on the scrim close it. Off only for a decision that must be made. */
  isDismissable?: boolean;
}

/**
 * A modal. Focus moves in on open, is trapped while open, and returns to whatever opened it — the
 * part everyone forgets, and the part that makes a dialog unusable by keyboard when it is missing.
 *
 * `title` is the dialog's accessible name, not decoration: an unnamed dialog announces itself as
 * "dialog" and nothing else.
 */
export function Dialog({
  title,
  children,
  footer,
  trigger,
  isOpen,
  onOpenChange,
  isDismissable = true,
}: DialogProps): ReactElement {
  const overlay = (
    <ModalOverlay
      className={cx(styles['overlay'])}
      isDismissable={isDismissable}
      {...(isOpen !== undefined ? { isOpen } : {})}
      {...(trigger === undefined && onOpenChange ? { onOpenChange } : {})}
    >
      <Modal className={cx(styles['modal'])}>
        <AriaDialog className={cx(styles['dialog'])}>
          <Heading slot="title" className={cx(styles['title'])}>
            {title}
          </Heading>
          <div className={cx(styles['body'])}>{children}</div>
          {footer !== undefined ? <div className={cx(styles['footer'])}>{footer}</div> : null}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );

  if (trigger === undefined) return overlay;

  return (
    <DialogTrigger {...(onOpenChange ? { onOpenChange } : {})}>
      {trigger}
      {overlay}
    </DialogTrigger>
  );
}
