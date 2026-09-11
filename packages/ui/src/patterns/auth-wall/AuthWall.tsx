import { type ReactElement, type ReactNode, useId } from 'react';
import { cx } from '../../internal/cx.js';
import styles from './AuthWall.module.css';

export interface AuthWallProps {
  /** What the visitor was trying to do — "Contact X", "Sign up as a pro". Becomes the region's name. */
  title: ReactNode;
  /** Why it cannot happen yet. Spanish default, because a caller who forgets must not leak English. */
  description?: ReactNode;
  /** The page owns its outline; a wall inside a section is usually an `h2` and sometimes an `h3`. */
  headingLevel?: 2 | 3 | 4;
}

const PENDING_ES = 'Esta parte todavía no está disponible.';

/**
 * Where the product stops, said out loud.
 *
 * **It renders nothing interactive, deliberately.** The three ways to end a flow that does not exist
 * yet are a live control that 404s, a disabled control, and a sentence. The first is a bug with
 * extra steps. The second is worse than it looks: a disabled button says *"this would work if you
 * were allowed"*, which is a claim about permissions, when the truth is that the feature has not
 * been built — so a visitor reads a broken page instead of an honest one. The third is what
 * ADR-011 asks for: *"a real boundary the milestone can be demoed against, not an unfinished edge"*.
 *
 * A `region` rather than a `div` so the boundary is in the landmark list — a screen-reader user
 * should be able to find out where the page ends without reading all of it.
 *
 * `become-a-pro` and the provider profile are both call sites (`W12-T12` §4.5). The second is why
 * this is a component: one call site would have been a guess about the shape.
 */
export function AuthWall({ title, description, headingLevel = 2 }: AuthWallProps): ReactElement {
  const id = useId();
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';

  return (
    <section className={cx(styles['wall'])} aria-labelledby={id}>
      <Heading id={id} className={cx(styles['title'])}>
        {title}
      </Heading>
      <p className={cx(styles['description'])}>{description ?? PENDING_ES}</p>
    </section>
  );
}
