import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextField, Input } from 'react-aria-components';
import { Field } from './Field.js';

/**
 * `Field` is never rendered alone in the product — it lives inside a React Aria field container,
 * which is what makes its `Label` an association rather than a nearby paragraph. The stories say so
 * by wrapping it in the smallest container that makes it real.
 */
const meta: Meta<typeof Field> = {
  title: 'Primitives/Field',
  component: Field,
  args: { label: 'Código postal', children: <Input /> },
  decorators: [
    (Story) => (
      <TextField isInvalid={false} style={{ maxWidth: '24rem' }}>
        <Story />
      </TextField>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithDescription: Story = { args: { description: 'Cinco dígitos, por ejemplo 28013' } };

export const Required: Story = { args: { isRequired: true } };

export const WithError: Story = {
  args: { errorMessage: 'Introduce un código postal español válido' },
  decorators: [
    (Story) => (
      <TextField isInvalid style={{ maxWidth: '24rem' }}>
        <Story />
      </TextField>
    ),
  ],
};

export const LongText: Story = {
  args: {
    label: 'Código postal de la vivienda donde se realizará la intervención',
    description:
      'Lo usamos para encontrar profesionales que trabajen en tu zona y calcular desplazamientos',
  },
};
