import { type ReactElement, useEffect } from 'react';
import {
  Link,
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useRouteError,
} from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { SearchBar, serializeSearchQuery, type SearchQuery } from '@marketplace/ui';
import { type CategorySummary } from '@marketplace/contracts';
import { LanguageSwitcher } from '../shared/LanguageSwitcher.js';
import { changeLanguage, isLocale, LOCALES } from '../i18n/index.js';
import { queryKeys, routeContext } from '../shared/query.js';
import { searchSchema } from '../features/search/schema.js';

/**
 * The shell every route renders into: skip link, banner, the compact search, navigation, main,
 * contentinfo — plus the 500 page, which is this route's `ErrorBoundary` so that an error anywhere
 * below still renders inside the shell rather than replacing the application with a blank screen.
 *
 * `W12-T09` adds the language segment. The shell is now mounted at `/:lang`, so the locale is a
 * route parameter rather than a setting — which is what makes a shared link open in the language it
 * was shared in. URL *segments* are not translated: `/es/search`, never `/es/buscar`.
 */
interface ShellData {
  locale: string;
  categories: CategorySummary[];
}

/**
 * ADR-011 R3: the loader owns the fetch. React Query is the cache underneath it — `ensureQueryData`
 * resolves from cache when it can and fetches when it cannot, so the component below renders warm
 * and never fetches on mount.
 *
 * The client arrives through the router's context (`getContext` in `App.tsx`), never from a module
 * singleton: R5/R6, and the reason is that on a Worker a module-scope cache is shared by every user.
 */
export async function loader({ params, context }: LoaderFunctionArgs): Promise<ShellData> {
  const lang = params['lang'] ?? '';
  // `/:lang` matches any single segment, so an unknown one would otherwise render the Spanish home
  // page at `/nope` — a soft 404 that returns 200 and is invisible to everything except a user.
  // Thrown, so it reaches `ErrorBoundary` as a real 404 rather than a redirect that hides the URL.
  if (!isLocale(lang)) throw new Response('Not found', { status: 404 });

  const locale: string = lang;
  const { queryClient, api } = context.get(routeContext);

  const categories = await queryClient.ensureQueryData({
    queryKey: queryKeys.categories(locale),
    queryFn: () => api.getCategories(locale),
  });

  return { locale, categories };
}

export function Component(): ReactElement {
  const { locale, categories } = useLoaderData<ShellData>();
  const { t } = useTranslation();
  const navigate = useNavigate();

  // The loader put it in the cache; this reads it. Same key, so there is no second request — and
  // when `W3-T01` makes categories real, a background revalidation updates the box in place.
  const { data } = useQuery({
    queryKey: queryKeys.categories(locale),
    queryFn: () => categories,
    initialData: categories,
  });

  // The URL is what decides the language, so i18next follows it rather than the other way round.
  // In an effect because it is a side effect on a module singleton — the known R6 debt `W12-T14`
  // owns — and doing it during render would mutate shared state while React is still deciding.
  useEffect(() => {
    void changeLanguage(locale);
  }, [locale]);

  function onSearch(query: SearchQuery): void {
    // The search page does not exist until `W12-T11`. Wiring it now is deliberate: the alternative
    // is a disabled control that hides whether the schema, the query string and the router agree
    // until three tasks from here.
    void navigate(`/${locale}/search?${serializeSearchQuery(query)}`);
  }

  return (
    <div className="mp-shell">
      <a className="mp-skip-link" href="#main">
        {t('nav.skipToContent')}
      </a>

      <header className="mp-header">
        <div className="mp-header__inner">
          <Link className="mp-brand" to={`/${locale}`}>
            {t('app.name')}
            <span className="mp-brand__tagline">{t('app.tagline')}</span>
          </Link>

          <div className="mp-header__search">
            <SearchBar
              rendering="header"
              schema={searchSchema(data, t)}
              label={t('search.label')}
              submitLabel={t('search.submit')}
              expandLabel={t('search.expand')}
              onSubmit={onSearch}
            />
          </div>

          <nav className="mp-nav" aria-label={t('nav.primary')}>
            <Link to={`/${locale}`}>{t('nav.home')}</Link>
            <LanguageSwitcher locale={locale} />
          </nav>
        </div>
      </header>

      <main className="mp-main" id="main">
        <Outlet />
      </main>

      <footer className="mp-footer">
        <div className="mp-footer__inner">
          <nav className="mp-footer__nav" aria-label={t('nav.legal')}>
            <Link to={`/${locale}/legal/terms`}>{t('legal.terms.title')}</Link>
            <Link to={`/${locale}/legal/privacy`}>{t('legal.privacy.title')}</Link>
            <Link to={`/${locale}/legal/cookies`}>{t('legal.cookies.title')}</Link>
          </nav>
          <p className="mp-footer__rights">
            © {new Date().getFullYear()} {t('app.name')} — {t('footer.rights')}
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * The 404 and the 500, which are the same boundary because they arrive the same way.
 *
 * It renders a bare document rather than the shell, and that is the point: this boundary exists for
 * errors the shell's *own* loader threw — an unknown language, a categories request that failed —
 * so re-rendering the shell would run the thing that just failed and produce a second error instead
 * of a page. A 404 from *below* the shell (an unknown path, an unknown legal document) is a
 * different case: the shell loaded fine, and `not-found.tsx` renders inside it.
 *
 * `status` is read rather than assumed so that the two are distinguishable — a 404 that says "we
 * could not load this page, try again" sends a visitor to retry a URL that will never exist.
 */
export function ErrorBoundary(): ReactElement {
  const error = useRouteError();
  const { t } = useTranslation();
  const { revalidate, state } = useRevalidator();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <div className="mp-shell">
      <main className="mp-main" id="main">
        <div
          data-testid={isNotFound ? 'not-found' : 'error-page'}
          data-status={isNotFound ? '404' : '500'}
        >
          <h1>{isNotFound ? t('notFound.title') : t('error.title')}</h1>
          <p className="mp-lead">{isNotFound ? t('notFound.body') : t('error.body')}</p>
          {/* Retry is offered only for the 500. Re-running a loader for a URL that does not exist
              produces the same 404 and reads as a broken button. */}
          {isNotFound ? null : (
            <button type="button" onClick={() => void revalidate()} disabled={state === 'loading'}>
              {t('error.retry')}
            </button>
          )}
          <a href={`/${LOCALES[0]}`}>{t('notFound.back')}</a>
        </div>
      </main>
    </div>
  );
}
