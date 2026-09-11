/**
 * `GET /search` and `GET /categories`, mocked — ADR-011 §4's "the storefront does not wait for them".
 *
 * The handlers answer from `catalogue.ts` (built from the `packages/testing` factories) and validate
 * their own output against `packages/contracts`. That second part is what makes these mocks worth
 * having: a handler that drifts from the contract fails `tests/mocks.test.ts` rather than teaching
 * five storefront tasks a shape the API will never send.
 *
 * `W3-T05` (`agent-discovery`) implements the real endpoint against the same schemas — `TODO.md` §6
 * has it as the geo-search API, and ADR-011 §4's table naming `W3-T04` is the id that is wrong
 * (`W12-T11` §10 Q1). When it lands, this file is deleted, not migrated.
 */
import { CategoryListSchema, SearchQuerySchema, errorEnvelope } from '@marketplace/contracts';
import { HttpResponse, http } from 'msw';
import { buildCatalogue } from './catalogue.js';
import { searchCatalogue } from './search.js';

/** One world per page load, so two requests in a session agree with each other. */
const catalogue = buildCatalogue();

export const handlers = [
  http.get('*/categories', ({ request }) => {
    const locale = request.headers.get('accept-language') ?? 'es';
    // Parsed on the way out, like the search handler: `W12-T09` declared this shape in
    // `packages/contracts`, so the mock is now checkable against it rather than being its only
    // definition. A drift here fails a test instead of reaching the header's search box.
    return HttpResponse.json(
      CategoryListSchema.parse({
        items: catalogue.categories
          .filter((category) => category.isActive)
          .sort((a, b) => a.position - b.position)
          .map((category) => ({
            slug: category.slug,
            name: locale.startsWith('en') ? category.nameEn : category.nameEs,
            requiresLicence: category.requiresLicence,
          })),
      }),
    );
  }),

  http.get('*/search', ({ request }) => {
    const url = new URL(request.url);
    const locale = request.headers.get('accept-language') ?? 'es';

    // The same parse the real endpoint performs. A mock that accepts what the API rejects is a mock
    // that teaches the storefront a lie, so this failure is a 400 envelope and not an empty list.
    // The parse stays *here* rather than inside `searchCatalogue`: only an HTTP handler has a status
    // code to answer with, and the typed client on the other side never has an unparsed query.
    const parsed = SearchQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return HttpResponse.json(
        errorEnvelope('VALIDATION_FAILED', 'The search query is not valid.', crypto.randomUUID(), {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        }),
        { status: 400 },
      );
    }

    return HttpResponse.json(searchCatalogue(parsed.data, locale));
  }),
];
