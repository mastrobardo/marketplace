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
 * (`W12-T11` §10 Q1).
 *
 * **`W3-T05` has landed, and this file did not go with it.** The original instruction here was
 * "deleted, not migrated", and it turned out to describe two things this repo cannot do yet:
 *
 * 1. Nothing seeds providers, addresses or categories. `auth-demo-users` is the only seeder and
 *    `W3-T01` is blocked on `BD-07`, so removing the search handler would point `pnpm dev` at a
 *    real endpoint over an empty table — a search page that works correctly and shows nothing.
 * 2. `tests/mocks.test.ts` AC14–AC16 are `W12-T08`'s criteria *about the contract*, asserted
 *    through this handler. Deleting the handler deletes them, which is a bigger decision than a
 *    ticket about an API endpoint gets to make on its own.
 *
 * So the retirement is one follow-up ticket, not this one — `W3-T10`: **a demo provider seeder, and
 * then the search handler and `search.ts` go.** The categories handler goes with `W3-T01`, which is
 * what finally empties this file. `GET /api/providers/:id` is `W3-T07` and is in the same position.
 */
import {
  CategoryListSchema,
  ProviderIdSchema,
  ProviderProfileSchema,
  SearchQuerySchema,
  errorEnvelope,
} from '@marketplace/contracts';
import { HttpResponse, http } from 'msw';
import { buildCatalogue } from './catalogue.js';
import { profileFromCatalogue } from './provider.js';
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

  /**
   * `GET /providers/:id` — `W12-T12`. Three answers, and the order is the contract's.
   *
   * A malformed id is a 400 before anything is looked up, because `:id` is `z.uuid()` in the route
   * and an endpoint that answers 404 for `not-a-uuid` teaches the storefront that the two are the
   * same thing. They are not: one is a request nobody should have sent, the other is a provider who
   * is gone, and only the second deserves "no longer listed" in front of a visitor.
   */
  http.get('*/providers/:id', ({ params, request }) => {
    const locale = request.headers.get('accept-language') ?? 'es';
    const id = ProviderIdSchema.safeParse(params['id']);

    if (!id.success) {
      return HttpResponse.json(
        errorEnvelope('VALIDATION_FAILED', 'The provider id is not a uuid.', crypto.randomUUID(), {
          issues: id.error.issues.map((issue) => ({
            path: 'id',
            message: issue.message,
          })),
        }),
        { status: 400 },
      );
    }

    const profile = profileFromCatalogue(id.data, locale);
    if (profile === undefined) {
      return HttpResponse.json(
        errorEnvelope('NOT_FOUND', 'No such provider.', crypto.randomUUID()),
        { status: 404 },
      );
    }

    // Parsed on the way out, like the other two: the strictness and the coarse-point refinement are
    // what make the projection's exclusions a test rather than a convention.
    return HttpResponse.json(ProviderProfileSchema.parse(profile));
  }),
];
