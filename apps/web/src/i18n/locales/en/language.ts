import type { language as spanish } from '../es/language.js';
import type { Mirror } from '../mirror.js';

export const language = {
  'language.label': 'Language',
  'language.es': 'Español',
  'language.en': 'English',
} satisfies Mirror<typeof spanish>;
