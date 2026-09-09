import type { notFound as spanish } from '../es/notFound.js';
import type { Mirror } from '../mirror.js';

export const notFound = {
  'notFound.title': 'Page not found',
  'notFound.body': 'The address you opened does not exist, or it has moved.',
  'notFound.back': 'Back to home',
} satisfies Mirror<typeof spanish>;
