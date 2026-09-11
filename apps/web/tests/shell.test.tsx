import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { changeLanguage, i18next, setupI18n } from '../src/i18n/index.js';
import { es } from '../src/i18n/locales/es.js';
import { en } from '../src/i18n/locales/en.js';
import { renderApp } from './app-harness.js';

beforeEach(async () => {
  await setupI18n();
  // i18next is a module singleton, so the language survives between tests in this file. Each test
  // states its own starting point rather than depending on which test ran before it.
  await changeLanguage('es');
});

afterEach(() => {
  cleanup();
});

describe('AC1/AC2/AC3 — the shell holds every route', () => {
  it('renders the home page with exactly one h1', async () => {
    renderApp('/es');
    expect(await screen.findByRole('heading', { level: 1 })).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders the not-found page inside the shell, not instead of it', async () => {
    renderApp('/es/definitely-not-a-route');
    expect(await screen.findByTestId('not-found')).toBeDefined();
    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('contentinfo')).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('exposes the landmarks the nightly axe run will look for', async () => {
    renderApp('/es');
    // The banner, not `main`: `HydrateFallback` renders a `main` while the loader is in flight, so
    // waiting on that would assert against the loading state.
    await screen.findByRole('banner');
    for (const landmark of ['banner', 'navigation', 'main', 'contentinfo'] as const) {
      expect(screen.getAllByRole(landmark).length, `no ${landmark} landmark`).toBeGreaterThan(0);
    }
  });

  it('names every landmark that appears more than once', async () => {
    renderApp('/es');
    await screen.findByRole('banner');
    // Three navigations now — primary, legal, and the search landmark. Unnamed duplicates are the
    // axe rule `W12-T04` gates on, and they are indistinguishable to a screen-reader user.
    const names = screen.getAllByRole('navigation').map((nav) => nav.getAttribute('aria-label'));
    expect(names.every((name) => name !== null && name !== '')).toBe(true);
    expect(new Set(names).size, 'two navigations share a name').toBe(names.length);
  });
});

describe('AC5/AC6/AC13 — Spanish first, English on request', () => {
  it('starts in Spanish and says so in the document', async () => {
    expect(i18next.options.lng).toBe('es');
    expect(i18next.options.fallbackLng).toEqual(['es']); // i18next normalises it to a list
    renderApp('/es');
    await screen.findByRole('banner');
    expect(document.documentElement.lang).toBe('es');
    const nav = screen.getByRole('navigation', { name: es['nav.primary'] });
    expect(within(nav).getByText(es['nav.home'])).toBeDefined();
  });

  it('renders English when the URL says English', async () => {
    renderApp('/en');
    await screen.findByRole('banner');
    expect(document.documentElement.lang).toBe('en');
    const nav = screen.getByRole('navigation', { name: en['nav.primary'] });
    expect(within(nav).getByText(en['nav.home'])).toBeDefined();
  });

  it('ignores an unknown locale rather than blanking the ui', async () => {
    await changeLanguage('kl');
    expect(i18next.language).toBe('es');
  });
});
