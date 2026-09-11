import { type ReactElement, useId } from 'react';
import { Link, isRouteErrorResponse, useLoaderData, useRevalidator, useRouteError } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AuthWall, EmptyState } from '@marketplace/ui';
import { ProviderIdSchema, type ProviderProfile } from '@marketplace/contracts';
import { isLocale, LOCALES } from '../i18n/index.js';
import { ApiError } from '../shared/api.js';
import { formatDistance, formatMonthYear, formatRate, formatRating } from '../shared/format.js';
import { queryKeys, routeContext } from '../shared/query.js';
import { searchPath } from '../features/search/navigation.js';

/**
 * The public provider profile — ADR-011 §2, and the last page of the M11 demo.
 *
 * Every row `W12-T11` renders links here, and until now every one of them landed on the 404. It was
 * the storefront's last deliberate intermediate 404.
 *
 * **What is missing from this page is the design, not an omission.** The ticket asked for a gallery,
 * badges and reviews; `PortfolioItem`, `Badge` and `Review` are in `TODO.md` §3's sketch and in no
 * migration. `W12-T08` froze the search contract under a rule — every field is a column that exists
 * — and this page keeps it. So the three absent sections are stated in words, the way the legal
 * slots and `become-a-pro` already are. A placeholder gallery would be a claim about supply that no
 * seeded row supports, and the demo would be showing a lie that looks like a feature.
 */
interface ProfileData {
  locale: string;
  profile: ProviderProfile;
}

/**
 * **A malformed id is not a request.**
 *
 * `:id` is a uuid — ADR-011 Amendment 3, because no slug column exists — and `ProviderIdSchema` is
 * the same check the endpoint applies, exported from the contract so the two cannot disagree. A
 * loader that skipped it would round-trip `/pro/undefined` to be told what it already knew, and
 * would then have to decide whether the 400 it got back is a 404 for the visitor. It is: a link
 * that cannot name a provider and a link naming one who is gone are one page.
 */
export async function loader({ params, context }: LoaderFunctionArgs): Promise<ProfileData> {
  const lang = params['lang'] ?? '';
  if (!isLocale(lang)) throw new Response('Not found', { status: 404 });

  const id = ProviderIdSchema.safeParse(params['id']);
  if (!id.success) throw new Response('Not found', { status: 404 });

  const { queryClient, api } = context.get(routeContext);

  try {
    const profile = await queryClient.ensureQueryData({
      queryKey: queryKeys.provider(lang, id.data),
      queryFn: () => api.getProvider(id.data, lang),
    });
    return { locale: lang, profile };
  } catch (error) {
    // Gone is an answer; everything else is a fault. Only the first gets a page with a way out —
    // the second belongs in the boundary below, where there is a retry.
    if (error instanceof ApiError && error.status === 404) {
      throw new Response('Not found', { status: 404 });
    }
    throw error;
  }
}

/**
 * A section whose whole content is "this is not here yet". Three of them, and each says which.
 *
 * A real `region` with a real name, not a `div`: the absence is part of the page's outline, so a
 * screen-reader user finds out that reviews exist as a concept and are not available, instead of
 * finding nothing and concluding the provider has none.
 *
 * The id comes from `useId` rather than from the title — a translated heading contains spaces, and
 * `aria-labelledby` pointing at an id that cannot exist is a section with no accessible name, which
 * is a section with no `region` role at all. It renders identically and is invisible to everything
 * except a screen reader and this test.
 */
function PendingSection({ title, body }: { title: string; body: string }): ReactElement {
  const id = useId();
  return (
    <section className="mp-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p className="mp-pending">{body}</p>
    </section>
  );
}

export function Component(): ReactElement {
  const { locale, profile } = useLoaderData<ProfileData>();
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  const rating =
    profile.ratingAvg === null
      ? t('provider.rating.none')
      : t('provider.rating.summary', {
          average: formatRating(profile.ratingAvg, language),
          count: profile.ratingCount,
        });

  const rate =
    profile.hourlyRateCents === null
      ? t('provider.rate.quote')
      : t('provider.rate.hourly', { rate: formatRate(profile.hourlyRateCents, language) });

  const area =
    profile.serviceRadiusMetres === null
      ? t('provider.area.unset')
      : t('provider.area.radius', {
          distance: formatDistance(profile.serviceRadiusMetres, language),
          city: profile.city,
        });

  return (
    <article data-testid="provider">
      <header className="mp-section">
        <h1>{profile.displayName}</h1>
        <p className="mp-lead">
          {t(`provider.kind.${profile.kind}`)} · {profile.city}, {profile.province}
        </p>
        <div className="mp-profile__facts">
          <p data-testid="provider-rating">{rating}</p>
          <p data-testid="provider-rate">{rate}</p>
          <p>
            {t('provider.memberSince', { date: formatMonthYear(profile.memberSince, language) })}
          </p>
        </div>
      </header>

      <section className="mp-section" aria-labelledby="provider-about">
        <h2 id="provider-about">{t('provider.about.title', { name: profile.displayName })}</h2>
        <p className={profile.bio === null ? 'mp-pending' : undefined}>
          {profile.bio ?? t('provider.about.pending')}
        </p>
      </section>

      <section className="mp-section" aria-labelledby="provider-services">
        <h2 id="provider-services">{t('provider.services.title')}</h2>
        {/* Each category is a search already started — the same affordance the home page's cards
            are, and the href is built by the serializer rather than concatenated, so a change to
            the query-string format reaches every link at once. */}
        <ul className="mp-chip-list" role="list" data-testid="provider-services">
          {profile.categories.map((category) => (
            <li key={category.slug}>
              <Link to={searchPath(locale, { what: category.slug })}>{category.name}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mp-section" aria-labelledby="provider-area">
        <h2 id="provider-area">{t('provider.area.title')}</h2>
        {/* No map. `W12-T12` §4.4: the published point is coarse, and one coarse pin for one named
            person is a better instrument for finding a house than a results map ever is. */}
        <p data-testid="provider-area">{area}</p>
      </section>

      <PendingSection title={t('provider.gallery.title')} body={t('provider.gallery.pending')} />
      <PendingSection title={t('provider.badges.title')} body={t('provider.badges.pending')} />
      <PendingSection title={t('provider.reviews.title')} body={t('provider.reviews.pending')} />

      {/* No wrapper: the wall is already a named region, which is what a test should ask for. */}
      <AuthWall
        title={t('provider.cta.title', { name: profile.displayName })}
        description={t('provider.cta.body')}
      />
    </article>
  );
}

/**
 * The route's own boundary, not the shell's — the rule `W12-T09` set and `W12-T11` followed.
 *
 * A 404 here is a *page*, because "this provider is gone" is an answer and the visitor's next move
 * is the search. Anything else is a fault with a retry. Both keep the header, which is where the
 * search that recovers from either one lives.
 */
export function ErrorBoundary(): ReactElement {
  const error = useRouteError();
  const { t, i18n } = useTranslation();
  const revalidator = useRevalidator();
  const locale = isLocale(i18n.language) ? i18n.language : LOCALES[0];

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div data-testid="provider-not-found">
        <EmptyState
          title={t('provider.notFound.title')}
          description={t('provider.notFound.body')}
        >
          <p>
            <Link to={`/${locale}/search`}>{t('provider.notFound.search')}</Link>
          </p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div data-testid="provider-error">
      <EmptyState
        title={t('error.title')}
        description={t('provider.error.body')}
        action={{
          label: t('error.retry'),
          onPress: () => {
            void revalidator.revalidate();
          },
        }}
      />
    </div>
  );
}
