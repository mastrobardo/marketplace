import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A placeholder with a real structure. It exists to prove the shell renders a route; `W12-T10`
 * replaces it with the hero search, category cards and the rest of the storefront home page.
 */
export function Component(): ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <h1>{t('home.title')}</h1>
      <p className="mp-lead">{t('home.intro')}</p>
    </>
  );
}
