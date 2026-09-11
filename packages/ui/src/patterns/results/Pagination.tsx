import { type ReactElement, type ReactNode } from 'react';
import { cx } from '../../internal/cx.js';
import styles from './Pagination.module.css';

export interface PaginationProps {
  /** Whether a next page exists. When false this component renders **nothing**. */
  hasMore: boolean;
  /** Names the navigation landmark — a page may hold more than one. */
  label: string;
  nextLabel: string;
  /** The application's link to the next page. Absent renders nothing, like `hasMore: false`. */
  renderNext?: (props: { className: string; children: ReactNode }) => ReactNode;
}

/**
 * A keyset pager, which is to say: **Next, or nothing.**
 *
 * There are no page numbers here and there cannot be. `W1-T02` decision D removed `total` from the
 * page envelope — *"a count over a radius query costs the query"* — so there is no last page to
 * count towards. And there is no "Previous": reversing a keyset page needs a backwards cursor the
 * contract does not issue, so a Previous control would either lie or re-run the first page. The
 * browser's Back button does the real thing, because the cursor is in the URL (`R4`).
 *
 * When there is no next page it renders nothing rather than a disabled control. A button that can
 * never become enabled is furniture that reads as broken.
 */
export function Pagination({
  hasMore,
  label,
  nextLabel,
  renderNext,
}: PaginationProps): ReactElement | null {
  if (!hasMore || renderNext === undefined) return null;

  return (
    <nav className={cx(styles['pagination'])} aria-label={label}>
      {renderNext({ className: styles['next'] ?? '', children: nextLabel })}
    </nav>
  );
}
