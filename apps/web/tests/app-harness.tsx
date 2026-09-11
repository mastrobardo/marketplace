import { render, type RenderResult } from '@testing-library/react';
import { type CategorySummary } from '@marketplace/contracts';
import { App } from '../src/app/App.js';
import { type ApiClient } from '../src/shared/api.js';
import { buildCatalogue } from '../../../apps/web/mocks/catalogue.js';

/**
 * Render the real `App` at a path, with the API stubbed.
 *
 * The categories come from `buildCatalogue()` — the same `packages/testing` factories the MSW
 * handlers use — rather than from a list written here. `W12-T08` spent a whole task establishing
 * that there is one source of test data; a component test that invents four plausible categories is
 * how the second one starts.
 */
export function categoriesFor(locale: string): CategorySummary[] {
  return buildCatalogue()
    .categories.filter((category) => category.isActive)
    .sort((a, b) => a.position - b.position)
    .map((category) => ({
      slug: category.slug,
      name: locale.startsWith('en') ? category.nameEn : category.nameEs,
      requiresLicence: category.requiresLicence,
    }));
}

export function stubApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return { getCategories: (locale) => Promise.resolve(categoriesFor(locale)), ...overrides };
}

export function renderApp(path: string, api: ApiClient = stubApi()): RenderResult {
  return render(<App initialEntries={[path]} api={api} />);
}
