import { type ChangeEvent, type ReactElement, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage, LOCALES } from '../i18n/index.js';

/** A labelled `<select>`, not a flag: flags are countries, and Spanish is not one country. */
export function LanguageSwitcher(): ReactElement {
  const { t, i18n } = useTranslation();
  const id = useId();

  function onChange(event: ChangeEvent<HTMLSelectElement>): void {
    void changeLanguage(event.target.value);
  }

  return (
    <div className="mp-language">
      <label htmlFor={id}>{t('language.label')}</label>
      <select id={id} value={i18n.language} onChange={onChange}>
        {LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {t(`language.${locale}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
