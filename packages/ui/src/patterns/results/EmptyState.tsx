import { type ReactElement, type ReactNode } from 'react';
import { Button } from '../../primitives/Button.js';
import { cx } from '../../internal/cx.js';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** A button. Its absence is what makes this a plain empty state rather than an error. */
  action?: { label: string; onPress: () => void };
  /** Anything else the caller needs under the description — a link back, the active filters. */
  children?: ReactNode;
}

/**
 * Nothing here, and what to do about it.
 *
 * ADR-012 §1 lists `EmptyState` **and** `ErrorState`. This is both. An error state is an empty state
 * with a retry, and two components differing by one prop are two components that drift — one gains
 * a heading level, the other does not; one wraps in a landmark, the other forgets. The caller
 * decides which it is by passing an action or not.
 */
export function EmptyState({
  title,
  description,
  action,
  children,
}: EmptyStateProps): ReactElement {
  return (
    <div className={cx(styles['empty'])}>
      <h2 className={cx(styles['title'])}>{title}</h2>
      {description === undefined ? null : (
        <p className={cx(styles['description'])}>{description}</p>
      )}
      {children}
      {action === undefined ? null : (
        <p className={cx(styles['action'])}>
          <Button variant="primary" onPress={action.onPress}>
            {action.label}
          </Button>
        </p>
      )}
    </div>
  );
}
