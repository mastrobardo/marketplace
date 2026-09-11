import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.js';

/**
 * States, not props. A story per state the product actually has — which is also the list a reviewer
 * checks and, from `W12-T03`, the list the test runner walks with axe attached.
 */
const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Pedir presupuesto', variant: 'primary' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Secondary: Story = { args: { variant: 'secondary', children: 'Ver perfil' } };

/** Destructive. The one place `danger` belongs — not on a validation failure. */
export const Danger: Story = { args: { variant: 'danger', children: 'Cancelar reserva' } };

export const Focused: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector('button')?.focus();
  },
};

export const Disabled: Story = { args: { isDisabled: true } };

/** Pending announces itself. A disabled button tells a screen-reader user only that it stopped working. */
export const Pending: Story = {
  args: { isPending: true, pendingLabel: 'Enviando tu solicitud…' },
};

/** Spanish runs 15–20% longer than English, and this is where a fixed-width button breaks. */
export const LongText: Story = {
  args: { children: 'Solicitar presupuesto sin compromiso para reforma integral de cocina' },
};

/** A disclosure: the button says whether the thing it controls is open (`W12-T07`'s compact header). */
export const Disclosure: Story = {
  args: { isExpanded: false, children: 'Más opciones de búsqueda' },
};
