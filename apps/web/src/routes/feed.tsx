import { useMemo, useState, type ReactElement } from 'react';
import { Link, redirect, useLoaderData } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@marketplace/ui';
import { type JobFeedItem } from '@marketplace/contracts';
import { localeOf } from '../features/auth/actions.js';
import { ApiError } from '../shared/api.js';
import {
  FEED_SORTS,
  NO_FILTERS,
  filterFeed,
  sortFeed,
  tradesIn,
  type FeedFilters,
  type FeedSort,
} from '../features/jobs/feed.js';
import { queryKeys, routeContext } from '../shared/query.js';
import { loadSession } from '../shared/session.js';

/**
 * The market, as a professional reads it — `W4-T07` §3.2, §3.3.
 *
 * **This slice's page, not `W12`'s** (`MEM-2026-09-20-31`): ADR-011 gives `agent-ui` the storefront —
 * the public, indexable pages a visitor reaches without an account — and an authenticated area over
 * one slice's own shapes is built by the slice that owns them, which is what `W2-T09` did with
 * `/account` and `W4-T04` with `/jobs`.
 *
 * **The loader assembles the whole bounded set rather than one page**, for `job.tsx`'s reason: the API
 * pages because the list is written by strangers in numbers nobody controls, and the screen assembles
 * because it sorts and filters (§2.6). Those are the same requirement seen from two ends. What it
 * cannot do is filter a job it has not loaded, so the bound is rendered rather than hidden.
 *
 * **There is no quote form here.** `POST /api/jobs/:id/quotes` exists and a provider-side form does
 * not; this ticket did not take it (spec §6). A row that offered a button going nowhere would be the
 * empty promise this repo keeps refusing.
 */

/** The bound. Five pages of the contract's default, and a feed reaching it is rendered as truncated. */
const MAX_FEED_JOBS = 100;

interface FeedData {
  locale: string;
  jobs: JobFeedItem[];
  /** True when the market holds more than this screen will load. Rendered, never hidden. */
  truncated: boolean;
  /**
   * Set when the API refused because the profile cannot be served (§2.7).
   *
   * A `409` is not an error on this page — it is the most likely first visit, by somebody whose signup
   * is half finished — so it is loader *data* and the component renders it as what to fix.
   */
  blocked: boolean;
}

export async function loader({ params, context }: LoaderFunctionArgs): Promise<FeedData> {
  const locale = localeOf(params);

  // The guard `/account` established: this page has no content without a user, so an empty shell
  // saying "you are not signed in" would be a worse login page than the one that exists.
  const session = await loadSession(context);
  if (session === null) throw redirect(`/${locale}/login`);

  const { queryClient, api } = context.get(routeContext);

  try {
    const collected = await queryClient.ensureQueryData({
      queryKey: queryKeys.jobFeed(),
      queryFn: async () => {
        const jobs: JobFeedItem[] = [];
        let cursor: string | undefined;

        // Bounded by `MAX_FEED_JOBS` *and* by the cursor going null, so an API that kept handing back
        // the same cursor would end this loop rather than spin it.
        while (jobs.length < MAX_FEED_JOBS) {
          const page = await api.getJobFeed(cursor);
          jobs.push(...page.items);
          if (!page.page.hasMore || page.page.nextCursor === null) break;
          cursor = page.page.nextCursor;
        }
        return jobs;
      },
    });

    return {
      locale,
      jobs: collected.slice(0, MAX_FEED_JOBS),
      truncated: collected.length > MAX_FEED_JOBS,
      blocked: false,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { locale, jobs: [], truncated: false, blocked: true };
    }
    throw error;
  }
}

/**
 * What the job asks for, and whether this provider lists it.
 *
 * The label that replaced a gate (§2.2). It makes no claim about verification, because nothing in this
 * schema knows one — `W8` is unbuilt, and a badge here would be an invention.
 */
function Coverage({ item, locale }: { item: JobFeedItem; locale: string }): ReactElement | null {
  const { t } = useTranslation();
  if (item.coverage.length === 0) return null;

  return (
    <>
      <p className="mp-meta">{t('feed.needs')}</p>
      <ul className="mp-meta">
        {item.coverage.map((entry) => (
          <li key={entry.slug}>
            {locale.startsWith('en') ? entry.nameEn : entry.nameEs}
            {' — '}
            {entry.listedByProvider ? t('feed.coverage.listed') : t('feed.coverage.notListed')}
            {entry.requiresLicence ? ` · ${t('feed.coverage.licence')}` : ''}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The client's budget, when they gave one. Absent is the common case (`W4-T01`). */
function Budget({ range }: { range: string | null }): ReactElement | null {
  const { t } = useTranslation();
  if (range === null) return null;
  return <p className="mp-meta">{t('feed.budget', { range })}</p>;
}

export function Component(): ReactElement {
  const { t } = useTranslation();
  const { locale, jobs, truncated, blocked } = useLoaderData<FeedData>();

  // Presentation state, and the only state on this page: how the provider is reading.
  const [sort, setSort] = useState<FeedSort>('newest');
  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);

  const trades = useMemo(() => tradesIn(jobs), [jobs]);
  const shown = useMemo(() => sortFeed(filterFeed(jobs, filters), sort), [jobs, filters, sort]);

  const km = (metres: number): string =>
    (metres / 1000).toLocaleString(locale, { maximumFractionDigits: 1 });

  const money = (cents: number): string =>
    (cents / 100).toLocaleString(locale, { style: 'currency', currency: 'EUR' });

  const budgetOf = (item: JobFeedItem): string | null => {
    const { minCents, maxCents } = item.budget;
    if (minCents === null && maxCents === null) return null;
    if (minCents === null) return t('feed.budget.upTo', { max: money(maxCents as number) });
    if (maxCents === null) return t('feed.budget.from', { min: money(minCents) });
    return `${money(minCents)} – ${money(maxCents)}`;
  };

  if (blocked) {
    return (
      <article data-testid="feed">
        <h1>{t('feed.title')}</h1>
        <div data-testid="feed-blocked">
          <EmptyState title={t('feed.blocked.title')} description={t('feed.blocked.body')} />
          <p>
            <Link to={`/${locale}/account`}>{t('feed.blocked.link')}</Link>
          </p>
        </div>
      </article>
    );
  }

  return (
    <article data-testid="feed">
      <h1>{t('feed.title')}</h1>
      <p className="mp-lead">{t('feed.intro')}</p>

      {/* The market is empty. A different sentence from "your filters emptied it" (§3.3), and the
          controls are not rendered at all: there is nothing to filter. */}
      {jobs.length === 0 ? (
        <div data-testid="feed-empty-market">
          <EmptyState
            title={t('feed.empty.market.title')}
            description={t('feed.empty.market.body')}
          />
        </div>
      ) : (
        <>
          <section className="mp-section" aria-labelledby="feed-controls">
            {/* Its own name, not the sort's: a section labelled "Ordenar por" and a control labelled
                the same thing are two things with one accessible name. */}
            <h2 id="feed-controls" className="mp-visually-hidden">
              {t('feed.filters.title')}
            </h2>

            <label htmlFor="feed-sort">{t('feed.sort.label')}</label>
            <select
              id="feed-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as FeedSort)}
            >
              {FEED_SORTS.map((option) => (
                <option key={option} value={option}>
                  {t(`feed.sort.${option}`)}
                </option>
              ))}
            </select>

            <label htmlFor="feed-trade">{t('feed.trade.label')}</label>
            <select
              id="feed-trade"
              value={filters.trade}
              onChange={(event) => setFilters({ ...filters, trade: event.target.value })}
            >
              <option value="all">{t('feed.trade.all')}</option>
              {trades.map((trade) => (
                <option key={trade.slug} value={trade.slug}>
                  {locale.startsWith('en') ? trade.nameEn : trade.nameEs}
                </option>
              ))}
            </select>

            {/* The charter's "licence gating", as a switch the professional flips (§2.2). */}
            <label htmlFor="feed-hide-licence">
              <input
                id="feed-hide-licence"
                type="checkbox"
                checked={filters.hideLicenceGaps}
                onChange={(event) =>
                  setFilters({ ...filters, hideLicenceGaps: event.target.checked })
                }
              />{' '}
              {t('feed.filter.licence')}
            </label>

            <label htmlFor="feed-hide-quoted">
              <input
                id="feed-hide-quoted"
                type="checkbox"
                checked={filters.hideQuoted}
                onChange={(event) => setFilters({ ...filters, hideQuoted: event.target.checked })}
              />{' '}
              {t('feed.filter.quoted')}
            </label>
          </section>

          <p className="mp-meta" data-testid="feed-count">
            {t('feed.count', { count: shown.length })}
          </p>
          {truncated ? (
            <p className="mp-meta">{t('feed.truncated', { count: MAX_FEED_JOBS })}</p>
          ) : null}

          {/* The filters emptied it. The controls above are still rendered, so it can be undone. */}
          {shown.length === 0 ? (
            <div data-testid="feed-empty-filtered">
              <EmptyState
                title={t('feed.empty.filtered.title')}
                description={t('feed.empty.filtered.body')}
              />
            </div>
          ) : (
            <ul className="mp-list" data-testid="feed-list">
              {shown.map((item) => (
                <li key={item.id} className="mp-section" data-testid={`feed-job-${item.id}`}>
                  <h2>{item.title ?? t('jobs.untitled')}</h2>
                  <p className="mp-meta">
                    {item.location.city}
                    {' · '}
                    {t('feed.distance', { km: km(item.distanceMetres) })}
                    {item.urgency === null ? '' : ` · ${t(`search.when.${item.urgency}`)}`}
                  </p>
                  {item.description === null ? null : <p>{item.description}</p>}
                  <Budget range={budgetOf(item)} />
                  <Coverage item={item} locale={locale} />
                  {item.myQuote === null ? null : (
                    <p data-testid={`feed-quoted-${item.id}`}>
                      {/* A quote that is no longer active freed the slot, and saying so is the whole
                          reason `myQuote.status` runs through `quoteStatusOf` (§2.8). */}
                      {item.myQuote.status === 'PENDING' || item.myQuote.status === 'ACCEPTED'
                        ? t('feed.quoted')
                        : t('feed.quoted.again')}
                    </p>
                  )}
                  <p className="mp-meta">
                    {t('feed.published', {
                      date: new Date(item.publishedAt).toLocaleDateString(locale),
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}
