import { type ReactElement } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '../i18n/index.js';

export interface LanguageSwitcherProps {
  /** The language the current URL is in — the route parameter, not i18next's idea of it. */
  locale: string;
}

/**
 * Links, not a `<select>`, since `W12-T09` put the language in the URL.
 *
 * The old control called `changeLanguage` and left the address bar saying `/es` while the page
 * rendered English — so a reload or a shared link silently undid the switch. Now the language *is*
 * the first path segment, which means switching it is navigation, and navigation is a link: it
 * opens in a new tab, it can be copied, and it is in the history.
 *
 * **It keeps your place.** Only the first segment is replaced, so `/es/legal/terms?x=1` becomes
 * `/en/legal/terms?x=1`. Sending a reader back to the home page for changing language is a small
 * cruelty that is very easy to ship.
 *
 * A flag would be wrong for a different reason: flags are countries, and Spanish is not one country.
 */
export function LanguageSwitcher({ locale }: LanguageSwitcherProps): ReactElement {
  const { t } = useTranslation();
  const { pathname, search, hash } = useLocation();

  function pathIn(target: Locale): string {
    // `['', 'es', 'legal', 'terms']` — index 1 is the language, and the rest is where you were.
    const segments = pathname.split('/');
    segments[1] = target;
    return `${segments.join('/')}${search}${hash}`;
  }

  return (
    <div className="mp-language">
      <span className="mp-language__label" id="mp-language-label">
        {t('language.label')}
      </span>
      <ul className="mp-language__list" aria-labelledby="mp-language-label">
        {LOCALES.map((entry) => (
          <li key={entry}>
            <Link
              to={pathIn(entry)}
              hrefLang={entry}
              // The current language is still a link, not removed: a list that loses an item on
              // selection is disorienting, and `aria-current` is how a screen reader is told which
              // one is active without the visual cue doing all the work.
              aria-current={entry === locale ? 'true' : undefined}
              className={entry === locale ? 'is-current' : undefined}
            >
              {t(`language.${entry}`)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
