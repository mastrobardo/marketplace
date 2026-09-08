import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A placeholder with a real structure. It exists to prove the shell renders a route; `W3` onward
 * replaces it with search and discovery.
 */
export function HomePage(): ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <h1>{t('home.title')}</h1>
      <p className="mp-lead">{t('home.intro')}</p>
    </>
  );
}
