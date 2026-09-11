import { type ReactElement, type ReactNode } from 'react';
import { cx } from '../../internal/cx.js';
import styles from './Card.module.css';

export interface CardProps {
  /**
   * Where this card sits in the page's outline. A card does not get to decide that — the page does,
   * and a component that hardcodes `h3` is one that produces a broken outline the first time it is
   * used somewhere else.
   */
  headingLevel?: 2 | 3 | 4;
  title: ReactNode;
  /**
   * Above the title: a step number, a badge, a count.
   *
   * It is announced, like any other content. A caller whose eyebrow is decorative — an ordinal that
   * the surrounding `<ol>` already announces as "item 2 of 3" — marks it so at the call site, with
   * an `aria-hidden` span. That decision needs to know what the eyebrow sits inside, and this
   * component does not.
   */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /**
   * Wrap the title in a link and stretch it over the whole surface.
   *
   * The application supplies the element, and this is the one design decision in the file. A `Card`
   * that took an `href` would render an `<a>` — correct, and a full page reload inside a
   * single-page application. A `Card` that took an `onPress` would be a button pretending to be a
   * link: no middle-click, no open-in-new-tab, no URL to copy, and a category card *is* a URL.
   * Handing out the class and letting the app bring its own `Link` is the only version that is both
   * domain-free and right. ADR-012 §1: this package may not know what a router is.
   *
   * The stretch is a `::after` overlay, so the whole card is clickable while the tab order has
   * exactly one stop in it.
   */
  renderLink?: (props: { className: string; children: ReactNode }) => ReactNode;
  children?: ReactNode;
}

/**
 * The surface three of the storefront's five home-page regions are made of, and the one the results
 * list and the landing pages will be made of after that — ADR-012 §1's patterns layer.
 */
export function Card({
  headingLevel = 3,
  title,
  eyebrow,
  description,
  renderLink,
  children,
}: CardProps): ReactElement {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';

  return (
    <div className={cx(styles['card'], renderLink ? styles['linked'] : undefined)}>
      {eyebrow === undefined ? null : (
        <p className={cx(styles['eyebrow'])}>{eyebrow}</p>
      )}
      <Heading className={cx(styles['title'])}>
        {renderLink ? renderLink({ className: styles['link'] ?? '', children: title }) : title}
      </Heading>
      {description === undefined ? null : (
        <p className={cx(styles['description'])}>{description}</p>
      )}
      {children}
    </div>
  );
}
