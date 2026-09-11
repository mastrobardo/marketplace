import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { type TranslationKey } from '../../i18n/locales/es.js';

/**
 * The sentence that goes with `missingRequiredFields`.
 *
 * `packages/ui` returns field *names* and refuses to return copy, because it does not know whether
 * it is showing Spanish (`W12-T07`). This is the other half: one alert, rendered wherever the bar
 * is, saying which answer is still needed.
 *
 * `role="alert"` rather than a label on the field. The submit is what failed, the submit button is
 * where the user's attention is, and a message attached to a control three fields up is one a
 * screen-reader user does not hear until they navigate back to it.
 */
const MESSAGES: Record<string, TranslationKey> = {
  where: 'search.where.required',
};

export function MissingFields({ missing }: { missing: string[] }): ReactElement | null {
  const { t } = useTranslation();
  // A required field with no message would otherwise render an empty alert, which announces
  // nothing and looks like a styling bug.
  const sentences = missing.map((name) => MESSAGES[name]).filter((key) => key !== undefined);
  if (sentences.length === 0) return null;

  return (
    <p className="mp-search-missing" role="alert">
      {sentences.map((key) => t(key)).join(' ')}
    </p>
  );
}
