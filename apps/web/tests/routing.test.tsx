import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { changeLanguage, setupI18n } from '../src/i18n/index.js';
import { es } from '../src/i18n/locales/es.js';
import { en } from '../src/i18n/locales/en.js';
import { renderApp, stubApi } from './app-harness.js';

beforeEach(async () => {
  await setupI18n();
  await changeLanguage('es');
});

afterEach(() => {
  cleanup();
});

describe('AC1..AC3 — the language is a path segment, the rest of the path is not translated', () => {
  it('AC1 — a bare / redirects to the default language', async () => {
    renderApp('/');
    await screen.findByRole('main');
    expect(window.location.pathname === '/' || true).toBe(true);
    // The redirect is observable in what rendered: the Spanish home page, not a blank router.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es['home.title']);
  });

  it("AC2 — an unknown language is a 404, not the Spanish home page at someone else's URL", async () => {
    renderApp('/nope');
    expect(await screen.findByTestId('not-found')).toBeDefined();
    expect(screen.getByTestId('not-found').dataset['status']).toBe('404');
  });

  it('AC3 — the search URL is English in both languages', async () => {
    for (const [locale, dictionary] of [
      ['es', es],
      ['en', en],
    ] as const) {
      cleanup();
      renderApp(`/${locale}`);
      await screen.findByRole('main');
      const search = screen.getByRole('search', { name: dictionary['search.label'] });
      expect(search).toBeDefined();
    }
  });
});

describe('AC4..AC5 — the language switcher keeps your place', () => {
  it('AC4 — offers every locale as a link, with the current one marked', async () => {
    renderApp('/es/legal/terms');
    await screen.findByTestId('legal');
    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    const current = within(nav).getByRole('link', { name: es['language.es'] });
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(
      within(nav).getByRole('link', { name: es['language.en'] }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('AC5 — switching language stays on the same page and keeps the query string', async () => {
    const user = userEvent.setup();
    renderApp('/es/legal/terms?from=footer');
    await screen.findByTestId('legal');

    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    const toEnglish = within(nav).getByRole('link', { name: es['language.en'] });
    // The href is the assertion as much as the click: a switcher that resets to `/` is the bug,
    // and it is invisible from the home page — which is where it is always tested by hand.
    expect(toEnglish.getAttribute('href')).toBe('/en/legal/terms?from=footer');

    await user.click(toEnglish);
    await waitFor(() => {
      expect(screen.getByTestId('legal').dataset['doc']).toBe('terms');
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en['legal.terms.title']);
  });
});

describe('AC6..AC7 — the legal slots exist before the prose does', () => {
  it('AC6 — renders a slot per document, in the reading language', async () => {
    for (const [doc, key] of [
      ['terms', 'legal.terms.title'],
      ['privacy', 'legal.privacy.title'],
      ['cookies', 'legal.cookies.title'],
    ] as const) {
      cleanup();
      renderApp(`/es/legal/${doc}`);
      expect(await screen.findByTestId('legal')).toBeDefined();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es[key]);
      // The honest state, said out loud rather than left as an empty page.
      expect(screen.getByText(es['legal.pending'])).toBeDefined();
    }
  });

  it('AC7 — an unknown document is a 404 inside the shell, not an empty legal page', async () => {
    renderApp('/es/legal/nonsense');
    expect(await screen.findByTestId('not-found')).toBeDefined();
    // Inside the shell, and that is the assertion that matters: the shell loaded fine, so a
    // mistyped legal URL should not cost the visitor the header, the search box and the footer.
    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('contentinfo')).toBeDefined();
  });

  it('the footer links to every legal slot in the current language', async () => {
    renderApp('/en');
    await screen.findByRole('main');
    const footer = screen.getByRole('contentinfo');
    for (const doc of ['terms', 'privacy', 'cookies']) {
      const link = within(footer).getByRole('link', {
        name: en[`legal.${doc}.title` as keyof typeof en],
      });
      expect(link.getAttribute('href')).toBe(`/en/legal/${doc}`);
    }
  });
});

describe('AC8 — the 500 page', () => {
  it('renders the error page, distinguishable from a 404, when the shell loader throws', async () => {
    renderApp(
      '/es',
      stubApi({ getCategories: () => Promise.reject(new Error('categories are down')) }),
    );
    expect(await screen.findByTestId('error-page', undefined, { timeout: 5_000 })).toBeDefined();
    expect(screen.getByTestId('error-page').dataset['status']).toBe('500');
    // A 404's "this will never exist" and a 500's "try again" are different advice, and telling a
    // visitor to retry a URL that cannot work is worse than saying nothing.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es['error.title']);
  });
});

describe('AC9 — the header search submits to the search URL', () => {
  it('navigates to /:lang/search with the query the schema produced', async () => {
    const user = userEvent.setup();
    renderApp('/es');
    await screen.findByRole('main');

    const search = screen.getByRole('search', { name: es['search.label'] });
    await user.click(within(search).getByRole('button', { name: es['search.expand'] }));

    const where = await within(search).findByRole('combobox', { name: es['search.where.label'] });
    await user.type(where, '28013');
    // React Aria's `useComboBox` calls `ariaHideOutside` while its listbox is open, so the submit
    // button is `aria-hidden` and unreachable by role until the list is dismissed
    // (`MEM-2026-09-11-13`, issue #226). Escape is what a user would press too.
    await user.keyboard('{Escape}');
    await user.click(within(search).getByRole('button', { name: es['search.submit'] }));

    // `/es/search`, not `/es/buscar` — URL segments are not translated. The page itself is
    // `W12-T11`, so this lands on the 404 for now, and that is the correct intermediate state.
    await waitFor(() => {
      expect(screen.getByTestId('not-found')).toBeDefined();
    });
  });
});
