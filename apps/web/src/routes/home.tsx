import { type ReactElement, useMemo } from 'react';
import { Link, useLoaderData } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, SearchBar, toSearchQuery } from '@marketplace/ui';
import { type CategorySummary } from '@marketplace/contracts';
import { isLocale, LOCALES } from '../i18n/index.js';
import { loadCategories } from '../shared/categories.js';
import { queryKeys } from '../shared/query.js';
import { searchSchema } from '../features/search/schema.js';
import { searchPath, useSearchSubmission } from '../features/search/navigation.js';
import { MissingFields } from '../features/search/MissingFields.js';
import { type TranslationKey } from '../i18n/locales/es.js';

/**
 * The storefront's front door — ADR-011 §1: one large search over the schema, category cards as
 * pre-filled searches, how it works, a trust strip, a supply-side call to action.
 *
 * It is the only route in M11 a stranger reaches without a link, which is why it is the only one
 * that has to answer *what is this*, *what can I ask for* and *why would I trust it* before it is
 * allowed to ask for anything.
 *
 * Five `<section>`s, each named by its own heading, so the page is a short list of landmarks a
 * screen reader can jump between rather than one undifferentiated `main`.
 */
interface HomeData {
  locale: string;
  categories: CategorySummary[];
}

/**
 * Its own loader on the key the shell already used — R3 holds by construction, and React Query
 * answers from a warm cache, so the second call costs no second request. The alternative,
 * `useRouteLoaderData('shell')`, couples every child page to the shell's loader shape for data the
 * shell happens to have today.
 */
export async function loader({ params, context }: LoaderFunctionArgs): Promise<HomeData> {
  const lang = params['lang'] ?? '';
  // The shell's loader is what rejects an unknown language, and it runs in parallel with this one.
  // Checking here too is not a second guard — it is not fetching a category list for `/nope` while
  // the parent is busy throwing a 404 over it.
  if (!isLocale(lang)) return { locale: LOCALES[0], categories: [] };

  return { locale: lang, categories: await loadCategories(context, lang) };
}

/** The three how-it-works steps and the three trust points, as data rather than as markup. */
const STEPS: { key: string; title: TranslationKey; body: TranslationKey }[] = [
  { key: 'search', title: 'home.how.search.title', body: 'home.how.search.body' },
  { key: 'compare', title: 'home.how.compare.title', body: 'home.how.compare.body' },
  { key: 'hire', title: 'home.how.hire.title', body: 'home.how.hire.body' },
];

const TRUST: { key: string; title: TranslationKey; body: TranslationKey }[] = [
  { key: 'verified', title: 'home.trust.verified.title', body: 'home.trust.verified.body' },
  { key: 'reviews', title: 'home.trust.reviews.title', body: 'home.trust.reviews.body' },
  { key: 'payment', title: 'home.trust.payment.title', body: 'home.trust.payment.body' },
];

export function Component(): ReactElement {
  const { locale, categories } = useLoaderData<HomeData>();
  const { t } = useTranslation();

  // The loader put it in the cache; this reads it. Same key, so no second request — and when
  // `W3-T01` makes categories real, a background revalidation updates the grid in place.
  const { data } = useQuery({
    queryKey: queryKeys.categories(locale),
    queryFn: () => categories,
    initialData: categories,
  });

  // `t` changes identity when the language does, which is exactly when the labels must be rebuilt.
  const schema = useMemo(() => searchSchema(data, t), [data, t]);
  const { submit, missing } = useSearchSubmission(locale, schema);

  return (
    <>
      <section className="mp-hero" aria-labelledby="home-hero">
        <h1 id="home-hero">{t('home.title')}</h1>
        <p className="mp-lead">{t('home.intro')}</p>
        {/* Its own landmark name: the shell's header already puts a `role="search"` on every page,
            and two landmarks of one role sharing a name is an axe failure — and, more to the point,
            a screen-reader user hearing "search" twice with no way to tell which is which. */}
        <SearchBar
          rendering="hero"
          schema={schema}
          label={t('search.hero.label')}
          submitLabel={t('search.submit')}
          onSubmit={submit}
        />
        <MissingFields missing={missing} />
      </section>

      {/* Absent, not empty. A heading reading "Todos los servicios" above nothing is worse than no
          heading, and it is what a naive `.map()` produces the day `GET /categories` is down. */}
      {data.length === 0 ? null : (
        <section className="mp-section" aria-labelledby="home-categories">
          <h2 id="home-categories">{t('home.categories.title')}</h2>
          <p className="mp-lead">{t('home.categories.intro')}</p>
          <ul className="mp-card-grid" role="list">
            {data.map((category) => (
              <li key={category.slug}>
                <Card
                  title={category.name}
                  renderLink={({ className, children }) => (
                    <Link
                      className={className}
                      // The same two pure functions the search bar submits through. A hand-written
                      // `?what=${slug}` would be a second definition of the query string — the drift
                      // `W12-T07` exists to prevent — and would encode `fontanería` wrongly.
                      to={searchPath(locale, toSearchQuery(schema, { what: category.slug }))}
                    >
                      {children}
                    </Link>
                  )}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mp-section" aria-labelledby="home-how">
        <h2 id="home-how">{t('home.how.title')}</h2>
        {/* `role="list"` because `list-style: none` strips list semantics in Safari, and an
            ordered list that does not announce its order is the one thing this region needs. */}
        <ol className="mp-card-grid" role="list">
          {STEPS.map((step, index) => (
            <li key={step.key}>
              <Card
                // Decorative: the list already announces "item 2 of 3", and the number is here so
                // that a sighted reader gets the ordering the missing marker would have given them.
                eyebrow={<span aria-hidden="true">{index + 1}</span>}
                title={t(step.title)}
                description={t(step.body)}
              />
            </li>
          ))}
        </ol>
      </section>

      <section className="mp-section" aria-labelledby="home-trust">
        <h2 id="home-trust">{t('home.trust.title')}</h2>
        <ul className="mp-card-grid" role="list">
          {TRUST.map((point) => (
            <li key={point.key}>
              <Card title={t(point.title)} description={t(point.body)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="mp-section mp-cta" aria-labelledby="home-pro">
        <h2 id="home-pro">{t('home.pro.title')}</h2>
        <p className="mp-lead">{t('home.pro.body')}</p>
        <Link className="mp-cta__link" to={`/${locale}/become-a-pro`}>
          {t('home.pro.cta')}
        </Link>
      </section>
    </>
  );
}
