import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card, type CardProps } from './Card.js';

/**
 * States, not props — and for this component the states are *what it is standing in for*: a
 * category card that is a link, a numbered step that is not, and a trust point that is neither.
 *
 * From `W12-T04` this list is also the axe run. It is the only automated a11y coverage `Card` has:
 * the page it is composed into is not a story (`W12-T09` §9, `W12-T16`).
 */
const meta: Meta<typeof Card> = {
  title: 'Patterns/Card',
  component: Card,
  args: {
    title: 'Fontanería',
    description: 'Averías, grifos, calentadores y desatascos.',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** A trust point: a heading and a sentence, nothing to press. */
export const Default: Story = {};

/**
 * A category card. The link is the application's — here a plain `<a>`, in the storefront a React
 * Router `Link` — and the card stretches it over the whole surface.
 */
const renderLink: NonNullable<CardProps['renderLink']> = ({ className, children }) => (
  <a className={className} href="/es/search?what=fontaneria">
    {children}
  </a>
);

export const Linked: Story = { args: { renderLink } };

/** Focus lands on the card, not on two words inside it. */
export const LinkedFocused: Story = {
  args: { renderLink },
  play: ({ canvasElement }) => {
    canvasElement.querySelector('a')?.focus();
  },
};

/**
 * A how-it-works step. The ordinal is marked decorative **by the caller**, because only the caller
 * knows it sits inside an `<ol>` that already announces "item 2 of 3".
 */
export const Numbered: Story = {
  args: {
    eyebrow: <span aria-hidden="true">2</span>,
    title: 'Compara profesionales',
    description: 'Mira perfiles, valoraciones y presupuestos antes de decidir.',
  },
};

/** The page owns the outline, so the level is a prop. */
export const AtHeadingLevelTwo: Story = { args: { headingLevel: 2 } };

/** Spanish runs long, and a grid of cards is where a fixed height would break first. */
export const LongText: Story = {
  args: {
    title: 'Instalación y mantenimiento de calderas de gas y calentadores',
    description:
      'Revisión anual, puesta en marcha, sustitución de piezas y certificado de la instalación cuando el oficio lo exige.',
  },
};

/** Arbitrary content still renders, under the description. */
export const WithChildren: Story = {
  args: {
    title: 'Pago protegido',
    children: <p>El importe se libera al profesional cuando el trabajo está hecho, no antes.</p>,
  },
};
