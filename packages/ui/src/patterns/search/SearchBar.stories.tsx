import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { SearchBar } from './SearchBar.js';
import { type SearchSchema } from './schema.js';

/**
 * The instance below is a fixture, not the product's. `what · where · when · mode` with real
 * categories belongs to the discovery feature (ADR-011 §3); what the workbench reviews is that one
 * declaration renders three ways and that each of them is usable.
 *
 * Every story here is also an axe assertion and a browser test — `W12-T03` and `W12-T04`.
 */
const SCHEMA: SearchSchema = {
  fields: [
    {
      kind: 'category',
      name: 'what',
      label: 'Servicio',
      isRequired: true,
      placeholder: '¿Qué necesitas?',
      options: [
        { id: 'fontaneria', label: 'Fontanería' },
        { id: 'electricidad', label: 'Electricidad' },
        { id: 'cerrajeria', label: 'Cerrajería' },
        { id: 'climatizacion', label: 'Climatización' },
      ],
    },
    {
      kind: 'place',
      name: 'where',
      label: 'Dónde',
      isRequired: true,
      allowsCustomValue: true,
      placeholder: 'Código postal o ciudad',
      emptyLabel: 'Escribe tu código postal',
      options: [
        { id: 'madrid-centro', label: 'Madrid — Centro' },
        { id: 'madrid-chamberi', label: 'Madrid — Chamberí' },
        { id: 'valencia', label: 'València' },
      ],
    },
    {
      kind: 'choice',
      name: 'when',
      label: 'Cuándo',
      placeholder: 'Cuando sea',
      options: [
        { id: 'urgente', label: 'Es una urgencia' },
        { id: 'hoy', label: 'Hoy' },
        { id: 'semana', label: 'Esta semana' },
      ],
    },
    {
      kind: 'choice',
      name: 'mode',
      label: 'Cómo',
      placeholder: 'Como prefieras',
      options: [
        { id: 'quote', label: 'Pedir presupuesto' },
        { id: 'booking', label: 'Reservar directamente' },
      ],
    },
  ],
  renderings: {
    hero: { layout: 'row', prominence: 'primary' },
    header: { layout: 'compact', collapseTo: 'what' },
    filters: {
      layout: 'stack',
      extra: [
        {
          kind: 'choice',
          name: 'valoracion',
          label: 'Valoración mínima',
          placeholder: 'Cualquiera',
          options: [
            { id: '4', label: '4 estrellas o más' },
            { id: '3', label: '3 estrellas o más' },
          ],
        },
        {
          kind: 'choice',
          name: 'verificado',
          label: 'Verificación',
          placeholder: 'Todos',
          options: [{ id: 'si', label: 'Solo profesionales verificados' }],
        },
      ],
    },
  },
};

const meta: Meta<typeof SearchBar> = {
  title: 'Patterns/SearchBar',
  component: SearchBar,
  args: {
    schema: SCHEMA,
    label: 'Buscar profesionales',
    submitLabel: 'Buscar',
    expandLabel: 'Más opciones de búsqueda',
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ width: '100%', maxWidth: '56rem' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The home page's control: every field, in a band of its own. */
export const Hero: Story = { args: { rendering: 'hero' } };

/** A search already answered — what the results page shows in its header. */
export const HeroAnswered: Story = {
  args: {
    rendering: 'hero',
    defaultValues: { what: 'fontaneria', where: 'Madrid — Centro', when: 'urgente' },
  },
};

/** The compact control: one field until it is asked for the rest. */
export const HeaderCollapsed: Story = {
  args: { rendering: 'header', defaultValues: { what: 'fontaneria' } },
};

/** The same control, expanded — the disclosure says which it is. */
export const HeaderExpanded: Story = {
  args: { rendering: 'header', defaultValues: { what: 'fontaneria' } },
  play: async ({ canvasElement }) => {
    // By accessible name, not by `[aria-expanded]`: a combobox's own ▾ trigger carries that
    // attribute too and is earlier in the tree — clicking it opened the suggestions instead, and
    // the story failed on an axe rule about the popover that opened.
    const expand = within(canvasElement).getByRole('button', {
      name: 'Más opciones de búsqueda',
    });

    // `.click()` rather than a pointer sequence: expanding grows the form under the pointer, and a
    // real `mouseup` lands on whichever control has moved into that spot.
    expand.click();
    await waitFor(() => expect(expand.getAttribute('aria-expanded')).toBe('true'));
    await waitFor(() =>
      expect(within(canvasElement).getByRole('combobox', { name: 'Dónde' })).toBeTruthy(),
    );
  },
};

/** The results rail: a stack, and the extras that exist only here. */
export const Filters: Story = {
  args: { rendering: 'filters', defaultValues: { what: 'fontaneria', valoracion: '4' } },
};

/** Errors are the application's sentences, reaching the field they belong to. */
export const WithErrors: Story = {
  args: {
    rendering: 'hero',
    errors: {
      what: 'Elige un servicio para continuar',
      where: 'Necesitamos saber dónde estás',
    },
  },
};

/** The search is in flight. The button announces it rather than going quiet. */
export const Pending: Story = {
  args: {
    rendering: 'hero',
    isPending: true,
    pendingLabel: 'Buscando profesionales…',
    defaultValues: { what: 'fontaneria', where: '28013' },
  },
};

/**
 * Suggestions are loading — the `where` field's real state once `/places/suggest` exists.
 *
 * The one story in this package that turns an axe rule off, and it is React Aria's rule to answer
 * rather than ours: `useComboBox` calls `ariaHideOutside` while the listbox is open, so the rest of
 * the form becomes `aria-hidden` while its controls are still tabbable — which is exactly what
 * `aria-hidden-focus` describes. It is not this component's markup, every open combobox in the
 * product has it, and hiding it globally would hide it everywhere. Issue #226; `W12-T04`'s gate
 * stays `error` for every other rule and every other story.
 */
export const SuggestionsLoading: Story = {
  parameters: {
    a11y: { config: { rules: [{ id: 'aria-hidden-focus', enabled: false }] } },
  },
  args: {
    rendering: 'hero',
    schema: {
      ...SCHEMA,
      fields: SCHEMA.fields.map((field) =>
        field.name === 'where'
          ? { ...field, isLoading: true, loadingLabel: 'Buscando ciudades…' }
          : field,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const where = within(canvasElement).getByRole('combobox', { name: 'Dónde' });
    await userEvent.type(where, 'mad');
    await waitFor(() => expect(where.getAttribute('aria-expanded')).toBe('true'));
  },
};

/** Spanish runs 15–20% longer than English, and a search bar is where that shows first. */
export const LongText: Story = {
  args: {
    rendering: 'hero',
    submitLabel: 'Buscar profesionales disponibles',
    schema: {
      ...SCHEMA,
      fields: SCHEMA.fields.map((field) =>
        field.name === 'what'
          ? {
              ...field,
              label: '¿Qué tipo de profesional necesitas para esta intervención?',
              options: [
                { id: 'fontaneria', label: 'Fontanería y reparación de fugas de urgencia' },
                { id: 'reforma', label: 'Reforma integral de cocina, baño o vivienda completa' },
              ],
            }
          : field,
      ),
    },
  },
};
