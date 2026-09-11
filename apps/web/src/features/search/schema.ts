/**
 * The concrete search declaration — `what · where · when · mode`, ADR-011 §3.
 *
 * `packages/ui` holds the *shape* of a search declaration and deliberately not this: a domain type
 * in the design system makes `agent-ui` downstream of nine slices, and `boundaries.test.ts` AC15 is
 * that rule as a gate. `W12-T07`'s spec says where the instance goes — *"the discovery feature, a
 * folder this agent may not touch"* — and this is that folder.
 *
 * The options are **data**, not literals: categories arrive from `GET /categories` through the
 * loader, so adding a trade is a seed change rather than a front-end deploy. `when` and `mode` are
 * closed lists the product owns, and their ids match `SearchQuerySchema`'s enums exactly — the
 * contract is what rejects a mismatch, in `packages/contracts/tests/search.test.ts`.
 */
import { type Option, type SearchSchema } from '@marketplace/ui';
import { type CategorySummary } from '@marketplace/contracts';
import { type TranslationKey } from '../../i18n/locales/es.js';

export type Translate = (key: TranslationKey) => string;

/** `SearchUrgencySchema`'s four values, paired with the key that names each one. */
const WHEN: { id: string; key: TranslationKey }[] = [
  { id: 'urgente', key: 'search.when.urgente' },
  { id: 'hoy', key: 'search.when.hoy' },
  { id: 'semana', key: 'search.when.semana' },
  { id: 'flexible', key: 'search.when.flexible' },
];

/** `SearchModeSchema`'s two. */
const MODE: { id: string; key: TranslationKey }[] = [
  { id: 'quote', key: 'search.mode.quote' },
  { id: 'booking', key: 'search.mode.booking' },
];

const options = (rows: { id: string; key: TranslationKey }[], t: Translate): Option[] =>
  rows.map((row) => ({ id: row.id, label: t(row.key) }));

/**
 * Build the declaration for a locale and a category list.
 *
 * A function rather than a constant, because every label is translated and the categories are
 * loaded — a module-level constant would be built once, in whatever language happened to be active
 * at import, which is the i18n bug that only appears after a language switch.
 */
export function searchSchema(categories: CategorySummary[], t: Translate): SearchSchema {
  return {
    fields: [
      {
        kind: 'category',
        name: 'what',
        label: t('search.what.label'),
        placeholder: t('search.what.placeholder'),
        emptyLabel: t('search.what.empty'),
        options: categories.map((category) => ({ id: category.slug, label: category.name })),
      },
      {
        kind: 'place',
        name: 'where',
        label: t('search.where.label'),
        // Required, and the contract agrees: a radius search with no centre is not a search.
        isRequired: true,
        // Free text until `GET /places/suggest` exists (`W3-T06`) — a postcode typed into the box
        // is the only answer a visitor can give today, so refusing it would break the only path.
        allowsCustomValue: true,
        placeholder: t('search.where.placeholder'),
        emptyLabel: t('search.where.empty'),
        options: [],
      },
      {
        kind: 'choice',
        name: 'when',
        label: t('search.when.label'),
        placeholder: t('search.when.placeholder'),
        options: options(WHEN, t),
      },
      {
        kind: 'choice',
        name: 'mode',
        label: t('search.mode.label'),
        placeholder: t('search.mode.placeholder'),
        options: options(MODE, t),
      },
    ],
    renderings: {
      hero: { layout: 'row', prominence: 'primary' },
      // The header shows the service box until it is expanded: it is the field a visitor is most
      // likely to want to change, and the one whose value reads as a summary of the search.
      header: { layout: 'compact', collapseTo: 'what' },
      filters: { layout: 'stack', extra: [] },
    },
  };
}
