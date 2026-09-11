import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pagination, type PaginationProps } from './Pagination.js';

/**
 * Two states, and the second one is the interesting one: **nothing**.
 *
 * There is no page-number story because there can be no page numbers. `W1-T02` decision D removed
 * `total` from the page envelope, so there is no last page to count towards.
 */
const meta: Meta<typeof Pagination> = {
  title: 'Patterns/Pagination',
  component: Pagination,
  args: { label: 'Más resultados', nextLabel: 'Siguiente' },
};

export default meta;
type Story = StoryObj<typeof meta>;

const renderNext: NonNullable<PaginationProps['renderNext']> = ({ className, children }) => (
  <a className={className} href="/es/search?where=28013&cursor=next">
    {children}
  </a>
);

export const HasMore: Story = { args: { hasMore: true, renderNext } };

/** The last page renders nothing — not a disabled button, which reads as broken. */
export const LastPage: Story = { args: { hasMore: false, renderNext } };
