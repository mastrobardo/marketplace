import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmptyState } from './EmptyState.js';

/**
 * ADR-012 §1 lists `EmptyState` and `ErrorState`. These stories are both, from one component: an
 * error is an empty state with a retry, and two components differing by one prop drift apart.
 */
const meta: Meta<typeof EmptyState> = {
  title: 'Patterns/EmptyState',
  component: EmptyState,
  args: {
    title: 'No hemos encontrado profesionales',
    description: 'Prueba a ampliar la zona o a quitar algún filtro.',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** The same component, with an action. This is `ErrorState`. */
export const Error: Story = {
  args: {
    title: 'Algo ha fallado',
    description: 'No hemos podido cargar los resultados. Vuelve a intentarlo en un momento.',
    action: { label: 'Reintentar', onPress: () => undefined },
  },
};

/** With the filters that produced nothing, so the reader knows what to loosen. */
export const WithFilters: Story = {
  args: {
    children: (
      <ul>
        <li>Servicio: Fontanería</li>
        <li>Dónde: 28013</li>
      </ul>
    ),
  },
};
