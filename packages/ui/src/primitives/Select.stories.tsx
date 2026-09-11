import type { Meta, StoryObj } from '@storybook/react-vite';
import { Select } from './Select.js';

const OPTIONS = [
  { id: 'fontaneria', label: 'Fontanería' },
  { id: 'electricidad', label: 'Electricidad' },
  { id: 'cerrajeria', label: 'Cerrajería' },
  { id: 'climatizacion', label: 'Climatización', isDisabled: true },
];

const meta: Meta<typeof Select> = {
  title: 'Primitives/Select',
  component: Select,
  args: { label: 'Servicio', options: OPTIONS, placeholder: 'Elige un servicio' },
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

export const Selected: Story = { args: { defaultSelectedKey: 'fontaneria' } };

export const Focused: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector('button')?.focus();
  },
};

export const Disabled: Story = { args: { isDisabled: true, defaultSelectedKey: 'fontaneria' } };

export const WithError: Story = { args: { errorMessage: 'Elige un servicio para continuar' } };

export const LongText: Story = {
  args: {
    label: '¿Qué tipo de profesional necesitas para esta intervención?',
    options: [
      { id: 'fontaneria', label: 'Fontanería y reparación de fugas de urgencia' },
      { id: 'electricidad', label: 'Electricidad, iluminación y cuadros eléctricos' },
      { id: 'reforma', label: 'Reforma integral de cocina, baño o vivienda completa' },
    ],
    defaultSelectedKey: 'reforma',
  },
};
