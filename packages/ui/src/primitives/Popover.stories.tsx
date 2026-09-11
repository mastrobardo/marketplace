import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.js';
import { Popover } from './Popover.js';

const meta: Meta<typeof Popover> = {
  title: 'Primitives/Popover',
  component: Popover,
  args: {
    'aria-label': 'Filtros de búsqueda',
    trigger: <Button>Filtros</Button>,
    children: <p>Precio, distancia y valoración.</p>,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector('button')?.click();
  },
};

export const Top: Story = { args: { placement: 'top' } };

export const LongText: Story = {
  args: {
    'aria-label': 'Cómo calculamos la distancia hasta el profesional',
    trigger: <Button>¿Cómo se calcula la distancia?</Button>,
    children: (
      <p>
        Usamos el código postal de la vivienda y la zona de trabajo declarada por cada profesional.
        La distancia es orientativa y puede variar según el tráfico y la disponibilidad del día.
      </p>
    ),
  },
};
