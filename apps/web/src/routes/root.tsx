import { type ReactElement, useEffect, useMemo } from 'react';
import {
  Link,
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useRevalidator,
  useRouteError,
} from 'react-router';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { SearchBar } from '@marketplace/ui';
import { type CategorySummary } from '@marketplace/contracts';
import { LanguageSwitcher } from '../shared/LanguageSwitcher.js';
import { changeLanguage, isLocale, LOCALES } from '../i18n/index.js';
import { loadCategories } from '../shared/categories.js';
import { throwIfFaultRequested } from '../shared/fault.js';
import { queryKeys } from '../shared/query.js';
import {
  invalidateSession,
  loadSession,
  seedSession,
  type SessionUser,
} from '../shared/session.js';
import { apiFrom } from '../features/auth/actions.js';
import { searchSchema } from '../features/search/schema.js';
import { useSearchSubmission } from '../features/search/navigation.js';
import { MissingFields } from '../features/search/MissingFields.js';

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
  /** `null` is both "signed out" and "we could not find out" — see `shared/session.ts`. */
  session: SessionUser | null;
}

/**
 * ADR-011 R3: the loader owns the fetch. React Query is the cache underneath it — `ensureQueryData`
 * resolves from cache when it can and fetches when it cannot, so the component below renders warm
 * and never fetches on mount.
 *
 * The client arrives through the router's context (`getContext` in `App.tsx`), never from a module
 * singleton: R5/R6, and the reason is that on a Worker a module-scope cache is shared by every user.
 */
export async function loader({ params, context, request }: LoaderFunctionArgs): Promise<ShellData> {
  // A no-op in every build that does not set `VITE_ENABLE_FAULT_ROUTES` — the module is replaced at
  // resolve time, so there is nothing here to guard. `W12-T16` needs the 500 page to have a URL;
  // see `shared/fault.ts` for why it may not be a runtime check.
  throwIfFaultRequested(request);

  const lang = params['lang'] ?? '';
  // `/:lang` matches any single segment, so an unknown one would otherwise render the Spanish home
  // page at `/nope` — a soft 404 that returns 200 and is invisible to everything except a user.
  // Thrown, so it reaches `ErrorBoundary` as a real 404 rather than a redirect that hides the URL.
  if (!isLocale(lang)) throw new Response('Not found', { status: 404 });

  const locale: string = lang;

  // Categories enrich **one field** of the search box. They are not a precondition for the site, and
  // the degrade that says so now lives in `shared/categories.ts`, because `W12-T10`'s home page is
  // the second loader that needs the same list and the second copy of a rule is the one that gets
  // forgotten. What that rule is, and what it cost to learn, is written there.
  // Both degrade rather than throw, and both are awaited together: the header needs the session and
  // the search box needs the categories, and neither is a reason to fail the page.
  const [categories, session] = await Promise.all([
    loadCategories(context, locale),
    loadSession(context),
  ]);

  return { locale, categories, session };
}

/**
 * Sign out — the shell's own write, because the control is in the shell.
 *
 * A layout route may have an action, and this is what that is for: the header is rendered on every
 * page, so a sign-out posted to the page underneath would need an action on all of them. The
 * session query is invalidated here rather than in a component, and React Router revalidates this
 * loader immediately afterwards — which is what puts the two links back.
 */
export async function action({ request, context }: ActionFunctionArgs): Promise<null> {
  const form = await request.formData();
  if (form.get('intent') !== 'signout') return null;

  try {
    await apiFrom(context).signOut();
    // The API has said the session is over, so there is nothing to go and ask: seeding `null` makes
    // signing out one call too.
    seedSession(context, null);
  } catch {
    // A sign-out that failed has told us nothing — the cookie may be gone already, or not — so the
    // honest move is to ask rather than to assert either answer. Leaving a stale name in the header
    // is the worse of the two wrong answers, and re-reading resolves it in one request.
    await invalidateSession(context);
  }
  return null;
}

export function Component(): ReactElement {
  const { locale, categories, session } = useLoaderData<ShellData>();
  const { t } = useTranslation();

  // The loader put it in the cache; this reads it. Same key, so there is no second request — and
  // when `W3-T01` makes categories real, a background revalidation updates the box in place.
  const { data } = useQuery({
    queryKey: queryKeys.categories(locale),
    queryFn: () => categories,
    initialData: categories,
  });

  // `t` changes identity when the language does, which is exactly when the labels must be rebuilt.
  const schema = useMemo(() => searchSchema(data, t), [data, t]);

  // The URL is what decides the language, so i18next follows it rather than the other way round.
  // In an effect because it is a side effect on a module singleton — the known R6 debt `W12-T14`
  // owns — and doing it during render would mutate shared state while React is still deciding.
  useEffect(() => {
    void changeLanguage(locale);
  }, [locale]);

  // The search page does not exist until `W12-T11`. Wiring it now is deliberate: the alternative is
  // a disabled control that hides whether the schema, the query string and the router agree until
  // three tasks from here. `W12-T10` moved the destination — and the "you have not said where"
  // guard — into one hook, so the hero and this cannot disagree about either.
  const { submit, missing } = useSearchSubmission(locale, schema);

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
              schema={schema}
              label={t('search.label')}
              submitLabel={t('search.submit')}
              expandLabel={t('search.expand')}
              onSubmit={submit}
            />
            <MissingFields missing={missing} />
          </div>

          <nav className="mp-nav" aria-label={t('nav.primary')}>
            <Link to={`/${locale}`}>{t('nav.home')}</Link>
            {/* `W2-T09`: the door. `W2-T01` shipped the API and the header still had no way in, so
                a visitor could only register with `curl`. Rendered from the loader's session rather
                than from a fetch on mount, which is why it is right on first paint (R3). */}
            {/* `W2-T10`: the header stops offering what you already have. Signed in, the two
                doors are gone and the name is the way into the account area — where sign-out now
                lives, because it is a deliberate, rare act rather than a piece of navigation. */}
            {session === null ? (
              <>
                <Link to={`/${locale}/login`}>{t('nav.login')}</Link>
                <Link to={`/${locale}/signup`}>{t('nav.signup')}</Link>
              </>
            ) : (
              <Link className="mp-nav__account" to={`/${locale}/account`}>
                {session.name}
              </Link>
            )}
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

/**
 * What renders while the shell's loader is in flight.
 *
 * React Router warns without one ("No `HydrateFallback` element provided to render during initial
 * hydration") and then renders nothing, which is a blank page on a cold load rather than an error
 * anyone would notice. `role="status"` so the wait is announced instead of being a silent gap.
 */
export function HydrateFallback(): ReactElement {
  return (
    <div className="mp-shell">
      <main className="mp-main" id="main">
        <p role="status" data-testid="shell-loading" className="mp-lead">
          …
        </p>
      </main>
    </div>
  );
}
