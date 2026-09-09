import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { App } from '../src/app/App.js';
import { changeLanguage, i18next, setupI18n } from '../src/i18n/index.js';
import { es } from '../src/i18n/locales/es/index.js';
import { en } from '../src/i18n/locales/en/index.js';

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
  it('renders the home page with exactly one h1', () => {
    render(<App initialEntries={['/']} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders the not-found page inside the shell, not instead of it', () => {
    render(<App initialEntries={['/definitely-not-a-route']} />);
    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('contentinfo')).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId('not-found')).toBeDefined();
  });

  it('exposes the landmarks the nightly axe run will look for', () => {
    render(<App initialEntries={['/']} />);
    for (const landmark of ['banner', 'navigation', 'main', 'contentinfo'] as const) {
      expect(screen.getByRole(landmark), `no ${landmark} landmark`).toBeDefined();
    }
  });
});

describe('AC5/AC6/AC13 — Spanish first, English on request', () => {
  it('starts in Spanish and says so in the document', () => {
    // The configured default, asserted directly — otherwise this test would also pass on a
    // leftover language from an earlier test.
    expect(i18next.options.lng).toBe('es');
    expect(i18next.options.fallbackLng).toEqual(['es']); // i18next normalises it to a list
    render(<App initialEntries={['/']} />);
    expect(document.documentElement.lang).toBe('es');
    expect(within(screen.getByRole('navigation')).getByText(es['nav.home'])).toBeDefined();
  });

  it('switches the whole shell to English', async () => {
    render(<App initialEntries={['/']} />);
    await changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    expect(within(screen.getByRole('navigation')).getByText(en['nav.home'])).toBeDefined();
  });

  it('ignores an unknown locale rather than blanking the ui', async () => {
    render(<App initialEntries={['/']} />);
    await changeLanguage('kl');
    expect(document.documentElement.lang).toBe('es');
    expect(within(screen.getByRole('navigation')).getByText(es['nav.home'])).toBeDefined();
  });
});
