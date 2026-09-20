import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchQuerySchema, type SearchResponse } from '@marketplace/contracts';
import { changeLanguage, setupI18n } from '../src/i18n/index.js';
import es from '../src/i18n/locales/es.json';
import en from '../src/i18n/locales/en.json';
import { renderApp, searchFor, stubApi } from './app-harness.js';

beforeEach(async () => {
  await setupI18n();
  await changeLanguage('es');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const region = (name: string): HTMLElement => screen.getByRole('region', { name });

/** The rail is the third rendering of the one declaration; the header's is `search.label`. */
const rail = (): HTMLElement => screen.getByRole('search', { name: es['search.filters.label'] });

const MADRID = '/es/search?where=28013';

describe('AC1..AC2 — a search with no location is a question, not a failure', () => {
  it('AC1 — asks where, and never calls the endpoint', async () => {
    const search = vi.fn();
    renderApp('/es/search?what=fontaneria', stubApi({ search }));

    expect(await screen.findByTestId('needs-where')).toBeDefined();
    // The whole point of the hand-off. `where` is required by `SearchQuerySchema`, so a loader that
    // parses first answers a category card with a 500.
    expect(
      search,
      'the endpoint was called for a query that cannot be valid',
    ).not.toHaveBeenCalled();
    expect(screen.getByRole('banner'), 'the shell was lost').toBeDefined();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('AC2 — runs the search once a location is supplied, keeping the category', async () => {
    const user = userEvent.setup();
    renderApp('/es/search?what=fontaneria');
    await screen.findByTestId('needs-where');

    const where = await within(rail()).findByRole('combobox', { name: es['search.where.label'] });
    await user.type(where, '28013');
    await user.keyboard('{Escape}');
    await user.click(within(rail()).getByRole('button', { name: es['search.submit'] }));

    await waitFor(() => {
      expect(screen.queryByTestId('needs-where')).toBeNull();
    });
    const rows = within(region(es['results.title'])).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('AC3..AC5 — the list, and what a row says', () => {
  it('AC3 — one row per match, nearest first', async () => {
    renderApp(MADRID);
    await screen.findByTestId('results');

    const expected = searchFor(SearchQuerySchema.parse({ where: '28013' }), 'es');
    const names = within(region(es['results.title']))
      .getAllByRole('listitem')
      .map((row) => within(row).getByRole('link').textContent);

    // Built from the same function the page's API stub answers with, so the assertion is "the page
    // renders what the endpoint returned", not "the page renders five names I typed here".
    expect(names).toEqual(expected.items.map((item) => item.displayName));
    const distances = expected.items.map((item) => item.distanceMetres);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('AC4 — links to the profile, and formats money and distance for the locale', async () => {
    renderApp(MADRID);
    await screen.findByTestId('results');

    const expected = searchFor(SearchQuerySchema.parse({ where: '28013' }), 'es');
    const rows = within(region(es['results.title'])).getAllByRole('listitem');

    const priced = expected.items.findIndex((item) => item.hourlyRateCents !== null);
    const quoteOnly = expected.items.findIndex((item) => item.hourlyRateCents === null);
    expect(priced, 'the catalogue has no priced provider').toBeGreaterThanOrEqual(0);
    expect(quoteOnly, 'the catalogue has no quote-only provider').toBeGreaterThanOrEqual(0);

    expect(
      within(rows[0] as HTMLElement)
        .getByRole('link')
        .getAttribute('href'),
    ).toBe(`/es/pro/${expected.items[0]?.id ?? ''}`);

    // es-ES puts the euro after the number and uses a decimal comma. A hard-coded `€${c / 100}` is
    // wrong in the product's first language.
    const rate = expected.items[priced]?.hourlyRateCents ?? 0;
    const formatted = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR',
    }).format(rate / 100);
    expect((rows[priced] as HTMLElement).textContent).toContain(formatted);

    // Null is a meaning, not a missing value: quote-only, never €0.
    expect((rows[quoteOnly] as HTMLElement).textContent).toContain(es['results.quoteOnly']);
    expect((rows[quoteOnly] as HTMLElement).textContent).not.toContain('0,00');
  });

  it('AC5 — category facets carry the count within the matched set', async () => {
    renderApp(MADRID);
    await screen.findByTestId('results');

    const expected = searchFor(SearchQuerySchema.parse({ where: '28013' }), 'es');
    const facets = region(es['results.facets.title']);
    for (const facet of expected.facets.categories) {
      const link = within(facets).getByRole('link', { name: new RegExp(facet.name) });
      expect(link.textContent, `${facet.name} count`).toContain(String(facet.count));
    }
  });
});

describe('AC6..AC8 — refining and paging, within what W1-T02 allows', () => {
  it('AC6 — a category facet sets `what` and drops the cursor', async () => {
    renderApp(`${MADRID}&cursor=whatever`);
    await screen.findByTestId('results');

    const facets = region(es['results.facets.title']);
    const first = within(facets).getAllByRole('link')[0] as HTMLElement;
    const href = first.getAttribute('href') ?? '';

    expect(href).toContain('what=');
    expect(href).toContain('where=28013');
    // A cursor is a position in the *previous* ordering. Carrying it into a changed filter set pages
    // into the middle of a list the visitor has not seen the start of.
    expect(href, 'the cursor survived a filter change').not.toContain('cursor=');
  });

  it('AC7 — Next carries the next cursor, and is absent when there is no more', async () => {
    const withMore: SearchResponse = {
      ...searchFor(SearchQuerySchema.parse({ where: '28013' }), 'es'),
      page: { nextCursor: 'CURSOR-2', hasMore: true },
    };
    renderApp(MADRID, stubApi({ search: () => Promise.resolve(withMore) }));
    await screen.findByTestId('results');

    const next = screen.getByRole('link', { name: es['results.next'] });
    expect(next.getAttribute('href')).toContain('cursor=CURSOR-2');
    expect(next.getAttribute('href')).toContain('where=28013');

    cleanup();
    renderApp(MADRID);
    await screen.findByTestId('results');
    expect(screen.queryByRole('link', { name: es['results.next'] })).toBeNull();
  });

  it('AC8 — says how many are shown and never how many exist', async () => {
    renderApp(MADRID);
    await screen.findByTestId('results');

    const expected = searchFor(SearchQuerySchema.parse({ where: '28013' }), 'es');
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(String(expected.items.length));
    // `W1-T02` decision D: no `total`, because a count over a radius query costs the query. A page
    // that renders "20 of 340" is a page that asked for a number the contract refuses to produce.
    expect(status.textContent).not.toMatch(/\bde\s+\d|\bof\s+\d|\/\s*\d/);
  });
});

describe('AC9..AC11 — nothing found, something broken, something stale', () => {
  it('AC9 — an empty result names the filters and offers a way to widen', async () => {
    const empty: SearchResponse = {
      items: [],
      page: { nextCursor: null, hasMore: false },
      facets: { categories: [], kinds: [] },
    };
    renderApp(
      '/es/search?where=28013&what=fontaneria',
      stubApi({ search: () => Promise.resolve(empty) }),
    );

    const state = await screen.findByTestId('results-empty');
    expect(state.textContent).toContain(es['results.empty.title']);
    // The filters that produced nothing, so the visitor knows what to loosen.
    expect(state.textContent).toContain('28013');
    expect(within(state).getByRole('link', { name: es['results.empty.clear'] })).toBeDefined();
  });

  it('AC10 — a failing search is an error inside the shell, with a retry and a usable rail', async () => {
    renderApp(MADRID, stubApi({ search: () => Promise.reject(new Error('search is down')) }));

    const state = await screen.findByTestId('results-error', undefined, { timeout: 5_000 });
    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('contentinfo')).toBeDefined();
    expect(within(state).getByRole('button', { name: es['error.retry'] })).toBeDefined();
    // The rail is how a visitor fixes a query that failed; losing it makes the error terminal.
    expect(rail()).toBeDefined();
  });

  it('AC11 — an undecodable cursor is the first page, not an error', async () => {
    const search = vi.fn((query) => Promise.resolve(searchFor(query, 'es')));
    renderApp(`${MADRID}&cursor=not-a-real-cursor`, stubApi({ search }));

    await screen.findByTestId('results');
    expect(screen.queryByTestId('results-error')).toBeNull();
    // Dropped before the request: a shared link that has gone stale still returns a useful search.
    expect(search.mock.calls[0]?.[0]).not.toHaveProperty('cursor');
  });
});

describe('AC12..AC16 — one declaration, one map-free page, one outline', () => {
  it('AC12 — the rail renders every field the declaration has', async () => {
    renderApp(MADRID);
    await screen.findByTestId('results');

    // The same four the hero and the header render — ADR-011 §3's third rendering.
    //
    // Asserted through each field's *control* and its accessible name, not through label text: a
    // `choice` renders a React Aria Select (a button) and a `category`/`place` renders a Combobox,
    // so "is there a label node saying this" is both weaker and, for the Select, not how the name
    // is exposed. What matters is that a visitor can reach a control called "Dónde".
    // Substring, not exact: a React Aria Select's trigger is named by its label *and* its current
    // value ("Cuándo Cuando sea"), which is correct for a screen reader and would fail an equality
    // check that only ever saw a Combobox.
    const named = (label: string): number => {
      const name = new RegExp(label);
      return (
        within(rail()).queryAllByRole('combobox', { name }).length +
        within(rail()).queryAllByRole('button', { name }).length
      );
    };

    for (const label of [
      es['search.what.label'],
      es['search.where.label'],
      es['search.when.label'],
      es['search.mode.label'],
    ]) {
      expect(named(label), `${label} is missing from the rail`).toBeGreaterThan(0);
    }
  });

  it('AC13 — the page is complete with the map never loading', async () => {
    renderApp(MADRID);
    await screen.findByTestId('results');

    // `R9`: the list is the page. Nothing here awaits the map chunk, and that is the assertion.
    expect(region(es['results.title'])).toBeDefined();
    expect(region(es['results.facets.title'])).toBeDefined();
    expect(screen.queryByTestId('results-error')).toBeNull();
    expect(screen.getByTestId('map-region')).toBeDefined();
  });

  it('AC15 — one h1, and every repeated landmark uniquely named', async () => {
    renderApp(MADRID);
    await screen.findByTestId('results');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const role of ['region', 'search', 'navigation'] as const) {
      const names = screen.getAllByRole(role).map((element) => {
        const labelledBy = element.getAttribute('aria-labelledby') ?? '';
        const fromIds = labelledBy
          .split(' ')
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        return fromIds || (element.getAttribute('aria-label') ?? '').trim();
      });
      expect(
        names.filter((name) => name === ''),
        `an unnamed ${role}`,
      ).toEqual([]);
      expect(new Set(names).size, `two ${role} landmarks share a name`).toBe(names.length);
    }
  });

  it('AC16 — the count is announced, so refining is not a silent change', async () => {
    renderApp(MADRID);
    await screen.findByTestId('results');
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('AC3/AC5 in English — the page translates with the route', async () => {
    renderApp('/en/search?where=28013');
    await screen.findByTestId('results');
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en['results.title']);
    });
  });
});
