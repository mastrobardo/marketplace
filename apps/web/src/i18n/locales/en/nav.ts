import type { nav as spanish } from '../es/nav.js';
import type { Mirror } from '../mirror.js';

export const nav = {
  'nav.home': 'Home',
  'nav.skipToContent': 'Skip to content',
} satisfies Mirror<typeof spanish>;
