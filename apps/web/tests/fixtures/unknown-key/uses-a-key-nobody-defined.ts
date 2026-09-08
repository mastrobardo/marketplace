import { t } from '../../../src/i18n/index.js';

// NOTE: no suppression comment may appear above the next line. A comment *starting* with the
// characters `@ts-` + `expect-error` is a directive even when the rest of it is prose, and it
// would silence the very error this fixture exists to produce.
export const nonsense: string = t('this.key.does.not.exist');
