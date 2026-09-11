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
