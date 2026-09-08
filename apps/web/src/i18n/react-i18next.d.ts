import { type es } from './locales/es.js';

/**
 * Teaches `useTranslation()` our key set, so `t('nope')` is a compile error in every component
 * rather than a string rendered to a user. This is the frontend half of acceptance criterion 9.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof es };
    keySeparator: false;
    nsSeparator: false;
  }
}
