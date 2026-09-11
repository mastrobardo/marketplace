import { type ReactElement, useMemo } from 'react';
import {
  Link,
  isRouteErrorResponse,
  useLoaderData,
  useRevalidator,
  useParams,
  useRouteError,
  useSearchParams,
} from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  EmptyState,
  Pagination,
  ResultRow,
  SearchBar,
  parseSearchQuery,
  serializeSearchQuery,
  type SearchQuery as SearchValuesQuery,
} from '@marketplace/ui';
import {
  SearchQuerySchema,
  type CategorySummary,
  type SearchResponse,
  type SearchResult,
} from '@marketplace/contracts';
import { isLocale, LOCALES } from '../i18n/index.js';
import { loadCategories } from '../shared/categories.js';
import { queryKeys, routeContext } from '../shared/query.js';
import { searchSchema, type Translate } from '../features/search/schema.js';
import { searchPath, useSearchSubmission } from '../features/search/navigation.js';
import { MissingFields } from '../features/search/MissingFields.js';
import { MapRegion } from '../features/search/MapRegion.js';
import { type TranslationKey } from '../i18n/locales/es.js';

/**
 * The results page — ADR-011 §2, and the third rendering of `W12-T07`'s one declaration.
 *
 * Everything built so far navigates here: the header's compact search, the home hero and all eight
 * category cards. Until this route existed every one of them landed on the 404, deliberately
 * (`W12-T09` §10 Q1) and for the last time.
 */
interface ResultsData {
  locale: string;
  /** Absent when the query had no `where` — the state, not an error. See the loader. */
  response: SearchResponse | null;
  query: SearchValuesQuery;
  categories: CategorySummary[];
}

/**
 * **A query with no `where` is a state to render, not a parse failure.**
 *
 * `SearchQuerySchema` requires `where`, because a radius search with no centre is not a search. But
 * every category card on the home page links here with `?what=<slug>` and nothing else, and a
 * visitor can delete the location from the header search at any time. So the missing field is the
 * *normal* path into this route, and a loader that parsed first would answer the M11 demo with a
 * 500. `W12-T10` wrote this hand-off into `TODO.md`; this is it.
 *
 * The order is therefore: filter the URL to declared fields, check the required ones, and only then
 * let the contract decide meaning.
 */
export async function loader({
  params,
  request,
  context,
}: LoaderFunctionArgs): Promise<ResultsData> {
  const lang = params['lang'] ?? '';
  if (!isLocale(lang)) return { locale: LOCALES[0], response: null, query: {}, categories: [] };

  const { queryClient, api } = context.get(routeContext);
  const categories = await loadCategories(context, lang);

  // `t` is not available in a loader, and the schema only needs labels for rendering — the parse
  // cares about field *names* and which values a closed field accepts. An identity translator is
  // honest about that rather than pulling i18next into the data layer.
  const identity: Translate = (key) => key;
  const schema = searchSchema(categories, identity);

  // A URL is untrusted input: a parameter nobody declared is dropped, and a value outside a closed
  // field's options goes with it — so `?what=nosuch` renders an empty service field rather than a
  // category that does not exist.
  const parsed = parseSearchQuery(schema, new URL(request.url).searchParams);

  if ((parsed['where'] ?? '') === '') {
    return { locale: lang, response: null, query: parsed, categories };
  }

  // `cursor` is not a schema field, so `parseSearchQuery` drops it; it is re-attached here from the
  // raw URL. `SearchQuerySchema` *decodes* a cursor rather than accepting any string, so a stale or
  // hand-edited one fails validation — and that failure is treated as "no cursor", not as an error.
  // A link shared after the data moved should degrade to a valid first page rather than become a
  // time bomb; the alternative makes every paged URL expire silently.
  const raw = new URL(request.url).searchParams.get('cursor');
  const withCursor = raw === null || raw === '' ? parsed : { ...parsed, cursor: raw };

  const sent = SearchQuerySchema.safeParse(withCursor).success ? withCursor : parsed;
  if (!SearchQuerySchema.safeParse(sent).success) {
    // Not the cursor, then: the query itself is one the contract refuses. That is the URL's fault
    // and the visitor can fix it in the rail, so it is this route's error rather than the shell's.
    throw new Response('Bad search', { status: 400 });
  }

  const response = await queryClient.ensureQueryData({
    queryKey: queryKeys.search(lang, serializeSearchQuery(sent)),
    queryFn: () => api.search(sent, lang),
  });

  return { locale: lang, response, query: parsed, categories };
}

const FILTER_LABELS: Record<string, TranslationKey> = {
  what: 'results.filter.what',
  where: 'results.filter.where',
  when: 'results.filter.when',
  mode: 'results.filter.mode',
};

/** Metres to something a person reads. `Intl` so that es-ES gets "1,2 km" and en gets "1.2 km". */
function formatDistance(metres: number, locale: string): string {
  const kilometres = metres / 1000;
  return kilometres >= 1
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(kilometres)} km`
    : `${new Intl.NumberFormat(locale).format(metres)} m`;
}

/**
 * Integer cents to currency (`W1-T06`). es-ES puts the euro after the number and uses a decimal
 * comma; a hard-coded `€${cents / 100}` is wrong in the product's first language.
 */
function formatRate(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export function Component(): ReactElement {
  const { locale, response, query, categories } = useLoaderData<ResultsData>();
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();

  const { data } = useQuery({
    queryKey: queryKeys.categories(locale),
    queryFn: () => categories,
    initialData: categories,
  });

  const schema = useMemo(() => searchSchema(data, t), [data, t]);
  const { submit, missing } = useSearchSubmission(locale, schema);

  // Re-seeded from the URL on every navigation: `defaultValues` is initial state, so without a key
  // the rail would keep whatever the visitor last typed after a facet changed the query.
  const railKey = params.toString();

  const rail = (
    <SearchBar
      key={railKey}
      rendering="filters"
      schema={schema}
      label={t('search.filters.label')}
      submitLabel={t('search.submit')}
      defaultValues={query}
      onSubmit={submit}
    />
  );

  const hrefFor = (next: SearchValuesQuery): string => searchPath(locale, next);

  if (response === null) {
    return (
      <>
        <h1>{t('results.needWhere.title')}</h1>
        <div className="mp-results" data-testid="needs-where">
          <div className="mp-results__rail">
            {rail}
            <MissingFields missing={missing} />
          </div>
          <p className="mp-lead">{t('results.needWhere.body')}</p>
        </div>
      </>
    );
  }

  const { items, page, facets } = response;

  return (
    <>
      <h1>{t('results.title')}</h1>

      <div className="mp-results" data-testid="results">
        <div className="mp-results__rail">
          {rail}
          <MissingFields missing={missing} />

          <section aria-labelledby="results-facets" className="mp-facets">
            <h2 id="results-facets">{t('results.facets.title')}</h2>
            <ul className="mp-facets__list" role="list">
              {facets.categories.map((facet) => (
                <li key={facet.slug}>
                  {/* Interactive because `what` is in the contract. A facet changes the filter set,
                      so the cursor is dropped: carrying it would page into the middle of a list the
                      visitor has not seen the start of. */}
                  <Link to={hrefFor({ ...query, what: facet.slug })}>
                    {facet.name} <span className="mp-facets__count">{facet.count}</span>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Counts, not controls. There is no `kind` in `SearchQuerySchema`, and widening the
                frozen seam is `agent-contracts`' change — spec §10 Q2 files it rather than
                smuggling it in. A control that cannot filter is worse than a number. */}
            {facets.kinds.length === 0 ? null : (
              <>
                <h3>{t('results.facets.kinds')}</h3>
                <ul className="mp-facets__list" role="list">
                  {facets.kinds.map((facet) => (
                    <li key={facet.kind}>
                      {t(`results.kind.${facet.kind}` as TranslationKey)}{' '}
                      <span className="mp-facets__count">{facet.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <div className="mp-results__main">
          <p role="status" className="mp-results__count">
            {t('results.showing', { count: items.length })}
          </p>

          {items.length === 0 ? (
            <div data-testid="results-empty">
              <EmptyState title={t('results.empty.title')} description={t('results.empty.body')}>
                <p>{t('results.empty.filters')}</p>
                <ul>
                  {Object.entries(query).map(([name, value]) => (
                    <li key={name}>
                      {FILTER_LABELS[name] === undefined ? name : t(FILTER_LABELS[name])}: {value}
                    </li>
                  ))}
                </ul>
                <Link to={searchPath(locale, { where: query['where'] ?? '' })}>
                  {t('results.empty.clear')}
                </Link>
              </EmptyState>
            </div>
          ) : (
            <>
              <section aria-labelledby="results-list">
                <h2 id="results-list" className="mp-visually-hidden">
                  {t('results.title')}
                </h2>
                <ul className="mp-results__list" role="list">
                  {items.map((item: SearchResult) => (
                    <li key={item.id}>
                      <ResultRow
                        title={item.displayName}
                        meta={[
                          formatDistance(item.distanceMetres, i18n.language),
                          item.city,
                          item.ratingAvg === null
                            ? t('results.unrated')
                            : t('results.rating', {
                                average: item.ratingAvg.toFixed(1),
                                count: item.ratingCount,
                              }),
                        ]}
                        badges={[t(`results.kind.${item.kind}` as TranslationKey)]}
                        detail={
                          item.hourlyRateCents === null
                            ? t('results.quoteOnly')
                            : t('results.perHour', {
                                rate: formatRate(item.hourlyRateCents, i18n.language),
                              })
                        }
                        renderLink={({ className, children }) => (
                          // `W12-T12` builds the profile. Until then this is the last deliberate
                          // 404 in the storefront.
                          <Link className={className} to={`/${locale}/pro/${item.id}`}>
                            {children}
                          </Link>
                        )}
                      />
                    </li>
                  ))}
                </ul>
              </section>

              <Pagination
                hasMore={page.hasMore}
                label={t('results.more')}
                nextLabel={t('results.next')}
                renderNext={({ className, children }) => (
                  <Link
                    className={className}
                    to={`${hrefFor(query)}${page.nextCursor === null ? '' : `&cursor=${encodeURIComponent(page.nextCursor)}`}`}
                  >
                    {children}
                  </Link>
                )}
              />
            </>
          )}

          <MapRegion
            points={items.map((item: SearchResult) => ({
              id: item.id,
              label: item.displayName,
              point: item.point,
            }))}
          />
        </div>
      </div>
    </>
  );
}

/**
 * A failed search is this route's error, not the shell's.
 *
 * At the root it would cost the visitor the header, the footer and — worse here — the filter rail,
 * which is the only way to fix a query that failed. The boundary belongs at the level that actually
 * failed (`W12-T09`), and the level that failed is the list.
 */
export function ErrorBoundary(): ReactElement {
  const error = useRouteError();
  const { t } = useTranslation();
  const { revalidate } = useRevalidator();
  const { lang } = useParams();
  const locale = isLocale(lang ?? '') ? (lang as string) : LOCALES[0];
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  // The rail is rebuilt with **no categories**. A boundary has no loader data, and re-fetching the
  // category list from an error state would be the same bare `await` on a backlog endpoint that
  // took the whole storefront down in `W12-T09`. `what` is optional; the other three fields need no
  // endpoint. The rail degrades exactly as the shell's search does.
  const schema = useMemo(() => searchSchema([], t), [t]);
  const { submit, missing } = useSearchSubmission(locale, schema);

  return (
    <>
      <h1>{t('error.title')}</h1>
      <div
        className="mp-results"
        data-testid="results-error"
        data-status={isNotFound ? '404' : '500'}
      >
        <div className="mp-results__rail">
          <SearchBar
            rendering="filters"
            schema={schema}
            label={t('search.filters.label')}
            submitLabel={t('search.submit')}
            onSubmit={submit}
          />
          <MissingFields missing={missing} />
        </div>
        <div className="mp-results__main">
          <EmptyState
            title={t('error.title')}
            description={t('results.error.body')}
            action={{ label: t('error.retry'), onPress: () => void revalidate() }}
          />
        </div>
      </div>
    </>
  );
}
