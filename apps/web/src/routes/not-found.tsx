import { type ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { isLocale, LOCALES } from '../i18n/index.js';

/**
 * Rendered inside the shell, deliberately: an unknown URL is not a broken application.
 *
 * This is the 404 for a path *below* a valid language — the shell loaded, so the visitor keeps the
 * header, the search box and a way out. An unknown *language* never gets here: its 404 comes from
 * the shell's own `ErrorBoundary`, because the shell is what failed to load.
 */
export function Component(): ReactElement {
  const { t } = useTranslation();
  const { lang } = useParams();
  // "Back to home" has to mean the home page in the language you are reading.
  const locale = lang !== undefined && isLocale(lang) ? lang : LOCALES[0];

  return (
    <div data-testid="not-found">
      <h1>{t('notFound.title')}</h1>
      <p className="mp-lead">{t('notFound.body')}</p>
      <Link to={`/${locale}`}>{t('notFound.back')}</Link>
    </div>
  );
}
