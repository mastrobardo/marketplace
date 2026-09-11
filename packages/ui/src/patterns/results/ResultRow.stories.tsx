import type { Meta, StoryObj } from '@storybook/react-vite';
import { ResultRow, type ResultRowProps } from './ResultRow.js';

/** States, not props — and from `W12-T04` this list is also the axe run. */
const meta: Meta<typeof ResultRow> = {
  title: 'Patterns/ResultRow',
  component: ResultRow,
  args: {
    title: 'Fontanería Gómez',
    meta: ['1,2 km', 'Madrid'],
    detail: '42,00 € / h',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const renderLink: NonNullable<ResultRowProps['renderLink']> = ({ className, children }) => (
  <a className={className} href="/es/pro/example">
    {children}
  </a>
);

export const Default: Story = { args: { renderLink } };

export const WithBadges: Story = { args: { renderLink, badges: ['PRO', 'Licencia verificada'] } };

/** Quote-only. The contract's null rate is a meaning, not a missing value — never "0,00 €". */
export const QuoteOnly: Story = {
  args: { renderLink, title: 'Electricidad Nadal', detail: 'Sólo presupuesto' },
};

/** Unrated: the cold-start case, and why search does not sort by rating (`W12-T08` Q4). */
export const Unrated: Story = {
  args: { renderLink, title: 'Manitas Rivas', meta: ['2,1 km', 'Madrid', 'Sin valoraciones'] },
};

export const Focused: Story = {
  args: { renderLink },
  play: ({ canvasElement }) => {
    canvasElement.querySelector('a')?.focus();
  },
};

/** Spanish runs long, and a row is where a name and a rate fight for the same line. */
export const LongName: Story = {
  args: {
    renderLink,
    title: 'Instalaciones y Mantenimiento Integral de Calderas Hermanos Rodríguez S.L.',
    badges: ['PRO'],
  },
};

/** No link: the row still renders, as it would in a static listing. */
export const Unlinked: Story = {};
