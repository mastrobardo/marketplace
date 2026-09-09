import type { app as spanish } from '../es/app.js';
import type { Mirror } from '../mirror.js';

export const app = {
  'app.name': 'Marketplace',
  'app.tagline': 'Renovations, home maintenance and emergencies',
} satisfies Mirror<typeof spanish>;
