import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { serializeSearchQuery, toSearchQuery } from '@marketplace/ui';
import { changeLanguage, setupI18n } from '../src/i18n/index.js';
import { es } from '../src/i18n/locales/es.js';
import { en } from '../src/i18n/locales/en.js';
import { searchSchema } from '../src/features/search/schema.js';
import { categoriesFor, renderApp, stubApi } from './app-harness.js';

beforeEach(async () => {
  await setupI18n();
  await changeLanguage('es');
});

afterEach(() => {
  cleanup();
});

/** The hero, found by its own landmark name — the header's is `search.label` and is not this one. */
const hero = (): HTMLElement => screen.getByRole('search', { name: es['search.hero.label'] });

const region = (name: string): HTMLElement => screen.getByRole('region', { name });

/**
 * The accessible name, the way assistive technology computes it: `aria-labelledby` followed to the
 * element it names, then `aria-label`. Comparing `textContent` instead would pass for a region that
 * has no name at all — every section's text is different, so the duplicate check would be vacuous.
 */
function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute('aria-labelledby') ?? '';
  const fromIds = labelledBy
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
  return fromIds || (element.getAttribute('aria-label') ?? '').trim();
}

describe('AC1..AC3 — the hero is the first thing on the page and it searches', () => {
  it('AC1 — renders the hero heading and a second search landmark, still with one h1', async () => {
    renderApp('/es');
    await screen.findByRole('banner');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es['home.title']);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(hero()).toBeDefined();
    // Two search landmarks: the header's compact control and this one.
    expect(screen.getAllByRole('search')).toHaveLength(2);
  });

  it('AC2 — submits to /:lang/search with the query the schema produced', async () => {
    const user = userEvent.setup();
    renderApp('/es');
    await screen.findByRole('banner');

    const where = await within(hero()).findByRole('combobox', { name: es['search.where.label'] });
    await user.type(where, '28013');
    // React Aria hides the rest of the page while a listbox is open (issue #226), so the submit
    // button is unreachable by role until the list is dismissed. Escape is what a user presses too.
    await user.keyboard('{Escape}');
    await user.click(within(hero()).getByRole('button', { name: es['search.submit'] }));

    // Until `W12-T11` this asserted the 404 — the deliberate intermediate state argued in that
    // task's §10 Q1. The page exists now, so the assertion is the real landing.
    await waitFor(() => {
      expect(screen.getByTestId('results')).toBeDefined();
    });
  });

  it('AC3 — refuses to search with no location, and says which field is missing', async () => {
    const user = userEvent.setup();
    renderApp('/es');
    await screen.findByRole('banner');

    await user.click(within(hero()).getByRole('button', { name: es['search.submit'] }));

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toContain(es['search.where.required']);
    // Still on the home page: a search with no centre is not a search, and sending it would be a
    // 400 from the API dressed up as a results page.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es['home.title']);
  });
});

describe('AC4..AC6 — category cards are pre-filled searches', () => {
  it('AC4 — renders one card per active category, in position order', async () => {
    renderApp('/es');
    await screen.findByRole('banner');

    const expected = categoriesFor('es');
    expect(expected.length, 'the seeded catalogue has no categories').toBeGreaterThan(0);

    const links = await waitFor(() =>
      within(region(es['home.categories.title'])).getAllByRole('link'),
    );
    expect(links.map((link) => link.textContent)).toEqual(expected.map((row) => row.name));
  });

  it('AC5 — links to the search URL the search bar itself would have produced', async () => {
    renderApp('/es');
    await screen.findByRole('banner');

    const categories = categoriesFor('es');
    const schema = searchSchema(categories, (key) => es[key]);
    const links = await waitFor(() =>
      within(region(es['home.categories.title'])).getAllByRole('link'),
    );

    // Built from the same two pure functions the page uses, not from a literal. A hand-written
    // `?what=${slug}` here would pass while the card and the bar disagreed about encoding — the
    // test would be a second definition of the query string, which is what W12-T07 exists to stop.
    for (const [index, category] of categories.entries()) {
      const query = serializeSearchQuery(toSearchQuery(schema, { what: category.slug }));
      expect(links[index]?.getAttribute('href')).toBe(`/es/search?${query}`);
    }
  });

  it('AC6 — shows the English names on the English page', async () => {
    renderApp('/en');
    await screen.findByRole('banner');
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en['home.title']);
    });

    const links = within(region(en['home.categories.title'])).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(
      categoriesFor('en').map((row) => row.name),
    );
  });
});

describe('AC7..AC8 — a missing endpoint removes a section, never the page', () => {
  const withoutCategories = (): ReturnType<typeof stubApi> =>
    stubApi({ getCategories: () => Promise.reject(new Error('categories are down')) });

  it('AC7 — renders every other region when the categories request fails', async () => {
    renderApp('/es', withoutCategories());
    await screen.findByRole('banner', undefined, { timeout: 5_000 });

    expect(screen.queryByTestId('error-page'), 'a missing list took the page down').toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es['home.title']);
    for (const name of [es['home.how.title'], es['home.trust.title'], es['home.pro.title']]) {
      expect(region(name), `${name} is missing`).toBeDefined();
    }
    // A heading over an empty grid is worse than no heading.
    expect(screen.queryByRole('region', { name: es['home.categories.title'] })).toBeNull();
  });

  it('AC8 — treats an empty list the same as a failed request', async () => {
    renderApp('/es', stubApi({ getCategories: () => Promise.resolve([]) }));
    await screen.findByRole('banner');

    expect(screen.queryByRole('region', { name: es['home.categories.title'] })).toBeNull();
    expect(region(es['home.how.title'])).toBeDefined();
  });
});

describe('AC9..AC11 — the rest of the page, and the way out of it', () => {
  it('AC9 — how it works has three steps and the trust strip has three points', async () => {
    renderApp('/es');
    await screen.findByRole('banner');

    for (const name of [es['home.how.title'], es['home.trust.title']]) {
      expect(within(region(name)).getAllByRole('heading', { level: 3 })).toHaveLength(3);
    }
  });

  it('AC10 — names every landmark that appears more than once', async () => {
    renderApp('/es');
    await screen.findByRole('banner');
    await waitFor(() => {
      expect(screen.getAllByRole('region').length).toBeGreaterThan(1);
    });

    for (const role of ['region', 'search', 'navigation'] as const) {
      const names = screen.getAllByRole(role).map(accessibleName);
      expect(names.length, `no ${role} landmarks to check`).toBeGreaterThan(0);
      expect(
        names.filter((name) => name === ''),
        `an unnamed ${role} landmark`,
      ).toEqual([]);
      expect(new Set(names).size, `two ${role} landmarks share a name`).toBe(names.length);
    }
  });

  it('AC11 — the supply CTA links to become-a-pro in the reading language', async () => {
    renderApp('/en');
    await screen.findByRole('banner');
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en['home.title']);
    });

    const cta = within(region(en['home.pro.title'])).getByRole('link', {
      name: en['home.pro.cta'],
    });
    expect(cta.getAttribute('href')).toBe('/en/become-a-pro');
  });
});

describe('AC12..AC13 — the supply-side landing, and where it stops', () => {
  it('AC12 — renders inside the shell and says registration is not open', async () => {
    renderApp('/es/become-a-pro');
    expect(await screen.findByTestId('become-a-pro')).toBeDefined();

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('contentinfo')).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es['pro.title']);
    // The edge of M11, stated rather than hidden behind a link to nothing.
    expect(screen.getByText(es['pro.pending'])).toBeDefined();
  });

  it('AC26 — states it through the shared AuthWall, not its own paragraph', async () => {
    renderApp('/es/become-a-pro');
    await screen.findByTestId('become-a-pro');

    // `W12-T12` §4.5: two call sites is what makes this a component rather than a guess. The
    // assertion is the region, because that is the part a bare `<p>` did not have.
    const wall = screen.getByRole('region', { name: es['pro.title'] });
    expect(wall.textContent).toContain(es['pro.pending']);
    expect(within(wall).queryByRole('button')).toBeNull();

    /**
     * **Changed by `W2-T09`, deliberately.** This assertion used to be `queryByRole('link')` →
     * `null`, and it was right: there was no signup page, so any link here would have been a 404
     * with better manners. `W2-T09` built the form, which is the premise the old assertion rested
     * on rather than the principle — and the principle is unchanged, so what replaces it is the
     * same statement about the *rest* of the wall: the link goes to the page that exists, and the
     * pro upgrade (`W2-T05`), which still does not, is still a sentence rather than a control.
     */
    const link = within(wall).getByRole('link', { name: es['auth.signup.title'] });
    expect(link.getAttribute('href')).toBe('/es/signup');
    expect(within(wall).getAllByRole('link')).toHaveLength(1);
  });

  it('AC13 — renders in English at /en/become-a-pro', async () => {
    renderApp('/en/become-a-pro');
    await screen.findByTestId('become-a-pro');
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en['pro.title']);
    });
  });
});
