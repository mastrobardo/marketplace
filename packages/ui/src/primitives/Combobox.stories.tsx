import type { Meta, StoryObj } from '@storybook/react-vite';
import { Combobox } from './Combobox.js';

const CIUDADES = [
  { id: 'madrid', label: 'Madrid' },
  { id: 'barcelona', label: 'Barcelona' },
  { id: 'valencia', label: 'València' },
  { id: 'a-coruna', label: 'A Coruña' },
];

const meta: Meta<typeof Combobox> = {
  title: 'Primitives/Combobox',
  component: Combobox,
  args: { label: 'Dónde', options: CIUDADES, placeholder: 'Ciudad o código postal' },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '24rem' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Focused: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector('input')?.focus();
  },
};

/** Suggestions in flight. This is the `where` field's real state once `GET /places/suggest` exists. */
export const Loading: Story = {
  args: { isLoading: true, loadingLabel: 'Buscando ciudades…' },
};

/** No match is not a failure, and the field does not go red over it. */
export const Empty: Story = {
  args: { options: [], emptyLabel: 'No encontramos esa ciudad' },
};

export const Disabled: Story = { args: { isDisabled: true, defaultSelectedKey: 'madrid' } };

export const WithError: Story = { args: { errorMessage: 'Elige una ciudad de la lista' } };

export const LongText: Story = {
  args: {
    label: '¿En qué ciudad o municipio se encuentra la vivienda?',
    options: [
      { id: 'madrid', label: 'Madrid — Comunidad de Madrid' },
      { id: 'sant-cugat', label: 'Sant Cugat del Vallès — Barcelona, Catalunya' },
      { id: 'santiago', label: 'Santiago de Compostela — A Coruña, Galicia' },
    ],
    suggestionsLabel: 'Mostrar todas las ciudades disponibles',
  },
};
