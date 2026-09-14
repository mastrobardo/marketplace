import type { Meta, StoryObj } from '@storybook/react-vite';
import { AuthWall } from './AuthWall.js';

/**
 * Two call sites, one component — `W12-T12` §4.5. The stories are both, because the thing worth
 * reviewing is that neither of them grew a button.
 */
const meta: Meta<typeof AuthWall> = {
  title: 'Patterns/AuthWall',
  component: AuthWall,
  args: {
    title: 'Contactar con Fontanería Gómez',
    description:
      'Las cuentas de cliente todavía no están abiertas, así que de momento no se puede contactar desde aquí.',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The provider profile's CTA — the visible edge of M11. */
export const ContactProvider: Story = {};

/** `become-a-pro`, which said this in a bare paragraph until this component existed. */
export const ProviderRegistration: Story = {
  args: {
    title: 'Date de alta como profesional',
    description: 'El registro de profesionales todavía no está abierto.',
  },
};

/**
 * `W2-T09` — the first wall with somewhere to go.
 *
 * The story is here so that the *difference* is reviewable: `ProviderRegistration` above is the same
 * wall before signup existed, and the two side by side are the whole argument for the prop being
 * optional.
 */
export const WithAction: Story = {
  args: {
    title: 'Date de alta como profesional',
    description:
      'Empieza creando tu cuenta. El alta como profesional se completa después y todavía no está abierta.',
    action: { label: 'Crea tu cuenta', href: '/es/signup' },
  },
};

/** Inside a section that already owns the `h2`. */
export const AsSubsection: Story = {
  args: { headingLevel: 3 },
};
