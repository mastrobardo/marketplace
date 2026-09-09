import type { nav as spanish } from '../../../src/i18n/locales/es/nav.js';
import type { Mirror } from '../../../src/i18n/locales/mirror.js';

// Every key `es/nav.ts` defines, plus one it does not. A translator inventing a key is how the two
// catalogues drift apart without either being *missing* anything — `satisfies` on a direct object
// literal is what makes it an excess-property error instead of a shrug.
export const nav = {
  'nav.home': 'Home',
  'nav.skipToContent': 'Skip to content',
  'nav.invented': 'Nobody defined this in Spanish',
} satisfies Mirror<typeof spanish>;
