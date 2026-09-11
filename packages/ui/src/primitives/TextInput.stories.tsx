import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextInput } from './TextInput.js';

const meta: Meta<typeof TextInput> = {
  title: 'Primitives/TextInput',
  component: TextInput,
  args: { label: 'Código postal', placeholder: '28013' },
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

export const WithDescription: Story = { args: { description: 'Cinco dígitos' } };

export const Focused: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector('input')?.focus();
  },
};

export const Disabled: Story = { args: { isDisabled: true, defaultValue: '28013' } };

export const WithError: Story = {
  args: { defaultValue: '280', errorMessage: 'Un código postal español tiene cinco dígitos' },
};

export const LongText: Story = {
  args: {
    label: 'Dirección completa de la vivienda donde se realizará la intervención',
    description:
      'Incluye calle, número, piso y puerta. Solo la compartimos con el profesional que aceptes',
    defaultValue: 'Calle de la Independencia 14, 4.º izquierda, 28013 Madrid',
  },
};
