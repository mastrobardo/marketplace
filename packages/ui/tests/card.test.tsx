/**
 * `Card` — ADR-012's patterns layer, second entry.
 *
 * The two assertions that matter are both about the link. A card whose whole surface is clickable
 * is either one tab stop or a trap, and the difference is invisible to everything except a keyboard
 * user; and a card that renders a link the application did not supply is a design system that has
 * opinions about routing.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Card } from '../src/index.js';

describe('AC14 — a linked card is one tab stop over the whole surface', () => {
  it('renders the title as the application’s own link, stretched across the card', () => {
    render(
      <Card
        headingLevel={3}
        title="Fontanería"
        description="Averías, grifos y calentadores"
        renderLink={({ className, children }) => (
          <a className={className} href="/es/search?what=fontaneria">
            {children}
          </a>
        )}
      />,
    );

    const heading = screen.getByRole('heading', { level: 3 });
    const link = within(heading).getByRole('link', { name: 'Fontanería' });
    expect(link.getAttribute('href')).toBe('/es/search?what=fontaneria');

    // Exactly one focusable element: the description is not a second stop, and the surface is not
    // a third. Anything else and the grid becomes twice as long to tab through as it looks.
    expect(screen.getAllByRole('link')).toHaveLength(1);

    // The stretch is what makes the surface clickable. It is a class the card hands out rather than
    // a wrapper the card renders, because the element itself belongs to the application.
    expect(link.className, 'the link was not given the stretch class').not.toBe('');
  });
});

describe('AC15 — an unlinked card is a heading and some text', () => {
  it('renders at the requested level and contains no link', () => {
    render(
      <Card headingLevel={2} eyebrow="1" title="Dinos qué necesitas" description="Elige el servicio" />,
    );

    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Dinos qué necesitas');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('1')).toBeDefined();
  });

  it('defaults to a level the caller did not have to think about, and still renders children', () => {
    render(
      <Card title="Pago protegido">
        <p>El dinero se libera cuando el trabajo está hecho.</p>
      </Card>,
    );

    expect(screen.getByRole('heading', { level: 3 })).toBeDefined();
    expect(screen.getByText('El dinero se libera cuando el trabajo está hecho.')).toBeDefined();
  });
});
