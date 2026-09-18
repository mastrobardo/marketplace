/**
 * `GET /categories`, mocked — and, since `W3-T10`, the only thing here that is.
 *
 * The handler answers from `catalogue.ts` (built from the `packages/testing` factories) and
 * validates its own output against `packages/contracts`. That second part is what makes the mock
 * worth having: a handler that drifts from the contract fails `tests/mocks.test.ts` rather than
 * teaching a storefront task a shape the API will never send.
 *
 * **Search and the provider profile used to be here too, and are not any more.** `W3-T05` and
 * `W3-T07` made both endpoints real; `W3-T10` seeded the database they read, which is what the
 * deletion was actually waiting on. Until there was a demo world in Postgres, removing these two
 * handlers would have pointed `pnpm dev` at a correct endpoint over an empty table — a search page
 * that worked perfectly and showed nothing. The seeder is `apps/api/prisma/seed/demo-providers.ts`
 * and it seeds the same five providers this file used to answer with.
 *
 * `mocks/search.ts` and `mocks/provider.ts` survive the deletion of their handlers, with one caller
 * left: `tests/app-harness.tsx` stubs `ApiClient` from them for component tests. `W12-T11` split
 * them out precisely so the stub and the handler could not disagree about which providers match, in
 * what order, with what facet counts — and a stub that decided that for itself would put that
 * second definition straight back.
 *
 * `GET /categories` goes with `W3-T01`, which is blocked on `BD-07`. When it does, this directory
 * has no handlers left and should move to `tests/fixtures/` in one step.
 */
import { CategoryListSchema } from '@marketplace/contracts';
import { HttpResponse, http } from 'msw';
import { buildCatalogue } from './catalogue.js';

/** One world per page load, so two requests in a session agree with each other. */
const catalogue = buildCatalogue();

export const handlers = [
  http.get('*/categories', ({ request }) => {
    const locale = request.headers.get('accept-language') ?? 'es';
    // Parsed on the way out: `W12-T09` declared this shape in `packages/contracts`, so the mock is
    // checkable against it rather than being its only definition. A drift here fails a test instead
    // of reaching the header's search box.
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
];
