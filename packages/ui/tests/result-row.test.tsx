/**
 * The three patterns `W12-T11` adds — `ResultRow`, `Pagination`, `EmptyState`.
 *
 * Each assertion is about the thing that would be invisible if it were wrong: how many tab stops a
 * row has, whether a pager renders when there is nothing to page to, and whether an empty state's
 * action is reachable.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState, Pagination, ResultRow } from '../src/index.js';

describe('AC17 — a result row is one tab stop', () => {
  it('renders the application’s link, stretched, with the meta beside it', () => {
    render(
      <ResultRow
        title="Fontanería Gómez"
        meta={['1,2 km', 'Madrid']}
        badges={['PRO']}
        detail="42,00 € / h"
        renderLink={({ className, children }) => (
          <a className={className} href="/es/pro/abc">
            {children}
          </a>
        )}
      />,
    );

    const link = screen.getByRole('link', { name: 'Fontanería Gómez' });
    expect(link.getAttribute('href')).toBe('/es/pro/abc');
    // A row whose badges and meta are also focusable is a list twice as long to tab through as it
    // looks, and nothing about the rendering says so.
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(link.className, 'the link was not given the stretch class').not.toBe('');
    expect(screen.getByText('Madrid')).toBeDefined();
    expect(screen.getByText('42,00 € / h')).toBeDefined();
  });

  it('takes its heading level from the page, not from itself', () => {
    render(<ResultRow headingLevel={2} title="Manitas Rivas" meta={[]} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Manitas Rivas');
  });
});

describe('AC18 — a pager with nowhere to go renders nothing', () => {
  it('renders nothing at all when there is no more', () => {
    const { container } = render(
      <Pagination hasMore={false} label="Más resultados" nextLabel="Siguiente" />,
    );
    // Not a disabled button: a control that can never become enabled is furniture that reads as
    // broken. The absence is the correct rendering.
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a named navigation with the link the app supplied when there is', () => {
    render(
      <Pagination
        hasMore
        label="Más resultados"
        nextLabel="Siguiente"
        renderNext={({ className, children }) => (
          <a className={className} href="/es/search?cursor=2">
            {children}
          </a>
        )}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Más resultados' });
    expect(within(nav).getByRole('link', { name: 'Siguiente' }).getAttribute('href')).toBe(
      '/es/search?cursor=2',
    );
  });
});

describe('AC19 — an empty state is a heading, a sentence, and a way out', () => {
  it('renders its actions reachably', async () => {
    const onRetry = vi.fn();
    render(
      <EmptyState
        title="Sin resultados"
        description="Prueba a ampliar la zona."
        action={{ label: 'Reintentar', onPress: onRetry }}
      />,
    );

    expect(screen.getByRole('heading').textContent).toBe('Sin resultados');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('is also the error state — the same component with a retry', () => {
    render(<EmptyState title="Algo ha fallado" description="Inténtalo de nuevo." />);
    // No action passed, so no button. Two components differing by one prop would be two components
    // that drift, which is why ADR-012's `ErrorState` is delivered as a use of this one.
    expect(screen.queryByRole('button')).toBeNull();
  });
});
