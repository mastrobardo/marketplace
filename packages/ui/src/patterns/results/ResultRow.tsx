import { type ReactElement, type ReactNode } from 'react';
import { cx } from '../../internal/cx.js';
import styles from './ResultRow.module.css';

export interface ResultRowProps {
  /** The page owns the outline, so it owns the level. */
  headingLevel?: 2 | 3 | 4;
  title: ReactNode;
  /**
   * The short facts that sit under the title — distance, city. Strings, already formatted: this
   * package does not know what a metre is in the reader's locale, and `Intl` lives in the app.
   */
  meta: ReactNode[];
  /** Short labels: the provider kind, a verification badge. */
  badges?: ReactNode[];
  /** The one fact that earns its own line — a rate, or "quote only". */
  detail?: ReactNode;
  /**
   * Wrap the title in a link and stretch it over the row. The application supplies the element for
   * the reason it does on `Card` (`W12-T10` §4.5): a bare `<a>` reloads the page in an SPA, an
   * `onPress` is a button pretending to be a link, and a result **is** a URL.
   */
  renderLink?: (props: { className: string; children: ReactNode }) => ReactNode;
  children?: ReactNode;
}

/**
 * One row in a list of results — ADR-012 §1's patterns layer.
 *
 * Everything it takes is a string, a node or a callback. It does not know what a provider is, which
 * is what keeps `agent-ui` from becoming downstream of nine slices (`boundaries.test.ts` AC15).
 */
export function ResultRow({
  headingLevel = 3,
  title,
  meta,
  badges = [],
  detail,
  renderLink,
  children,
}: ResultRowProps): ReactElement {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';

  return (
    <div className={cx(styles['row'], renderLink ? styles['linked'] : undefined)}>
      <div className={cx(styles['main'])}>
        <Heading className={cx(styles['title'])}>
          {renderLink ? renderLink({ className: styles['link'] ?? '', children: title }) : title}
        </Heading>

        {meta.length === 0 ? null : (
          <p className={cx(styles['meta'])}>
            {meta.map((entry, index) => (
              // The separator is decorative: a screen reader reading "·" between every fact is
              // noise, and the list already reads as one phrase.
              <span key={index}>
                {index > 0 ? <span aria-hidden="true"> · </span> : null}
                {entry}
              </span>
            ))}
          </p>
        )}

        {/* Spans, not a nested list. A row is itself an `<li>` in the results list, and a second
            list inside it makes "the items in this list" ambiguous to both a screen reader and a
            test — `getAllByRole('listitem')` returns the badges alongside the rows. Badges are two
            or three words; they read as a phrase, and the phrase is what a reader wants. */}
        {badges.length === 0 ? null : (
          <p className={cx(styles['badges'])}>
            {badges.map((badge, index) => (
              <span key={index} className={cx(styles['badge'])}>
                {badge}
              </span>
            ))}
          </p>
        )}
      </div>

      {detail === undefined ? null : <p className={cx(styles['detail'])}>{detail}</p>}
      {children}
    </div>
  );
}
