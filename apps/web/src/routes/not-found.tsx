import { type ReactElement } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

/** Rendered inside the shell, deliberately: an unknown URL is not a broken application. */
export function Component(): ReactElement {
  const { t } = useTranslation();

  return (
    <div data-testid="not-found">
      <h1>{t('notFound.title')}</h1>
      <p className="mp-lead">{t('notFound.body')}</p>
      <Link to="/">{t('notFound.back')}</Link>
    </div>
  );
}
