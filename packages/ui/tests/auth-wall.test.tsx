/**
 * `W12-T12` AC23..AC25 — `AuthWall`.
 *
 * The component's whole value is what it refuses to render. A boundary that ships a disabled button
 * is a boundary that reads as a bug, and one that ships a live link is a 404 with better manners.
 * Both assertions below exist so that the next person to "just add a CTA" fails a test.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AuthWall } from '../src/index.js';

describe('AC23 — a named region with a heading, a sentence, and nothing to press', () => {
  it('is a region whose accessible name is its title', () => {
    render(<AuthWall title="Contactar con Fontanería Gómez" description="Todavía no." />);

    const wall = screen.getByRole('region', { name: 'Contactar con Fontanería Gómez' });
    expect(within(wall).getByRole('heading').textContent).toBe('Contactar con Fontanería Gómez');
    expect(within(wall).getByText('Todavía no.')).toBeDefined();
  });

  it('renders no interactive element at all', () => {
    const { container } = render(<AuthWall title="Contactar" description="Todavía no." />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
    // Not a disabled control either: `aria-disabled` says "this would work if you were allowed",
    // which is a different and wrong statement about a feature that does not exist yet.
    expect(container.querySelectorAll('[disabled], [aria-disabled]')).toHaveLength(0);
  });

  it('takes a heading level, because a page decides its own outline', () => {
    render(<AuthWall title="Contactar" description="Todavía no." headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3 })).toBeDefined();
  });
});

describe('AC24 — the library holds no English', () => {
  it('defaults its own copy to Spanish', () => {
    render(<AuthWall title="Contactar" />);

    // `packages/ui` is domain-free but not language-free: ES is the primary locale, so a caller who
    // forgets a string gets Spanish rather than a leak of the library author's English.
    const wall = screen.getByRole('region', { name: 'Contactar' });
    expect(wall.textContent).toMatch(/todavía/i);
    expect(wall.textContent).not.toMatch(/[a-z]+ing\b|not (yet|open)/i);
  });
});

/**
 * `W2-T09` — the wall gains a door, and only where there is one.
 *
 * `W12-T12` was right that the component rendered nothing interactive: the form did not exist, and
 * a live link would have been a 404 with better manners. What changed is the condition, not the
 * principle — `W2-T09` built the form. A wall with no `action` still renders exactly what it
 * rendered before, which is what the provider profile's "contact this pro" wall still needs.
 */
describe('W2-T09 — an optional action, and nothing when it is absent', () => {
  it('renders a link to where the flow continues', () => {
    render(
      <AuthWall
        title="Date de alta como profesional"
        description="Crea tu cuenta para empezar."
        action={{ label: 'Crear cuenta', href: '/es/signup' }}
      />,
    );

    const wall = screen.getByRole('region', { name: 'Date de alta como profesional' });
    const link = within(wall).getByRole('link', { name: 'Crear cuenta' });
    expect(link.getAttribute('href')).toBe('/es/signup');
  });

  it('still renders nothing interactive without one', () => {
    const { container } = render(<AuthWall title="Contactar" description="Todavía no." />);

    expect(container.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
  });

  it('holds no copy of its own for the action', () => {
    // The design system has no strings. A default label here would be a Spanish literal in a
    // package that `boundaries.test.ts` keeps domain-free and copy-free.
    render(<AuthWall title="Contactar" action={{ label: 'Sign up', href: '/en/signup' }} />);

    expect(screen.getByRole('link').textContent).toBe('Sign up');
  });
});
