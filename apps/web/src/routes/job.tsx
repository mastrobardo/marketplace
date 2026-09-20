import { useState, type ReactElement } from 'react';
import { Link, redirect, useLoaderData, useNavigation, useSubmit } from 'react-router';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, EmptyState } from '@marketplace/ui';
import { type Job, type Quote } from '@marketplace/contracts';
import { localeOf } from '../features/auth/actions.js';
import { ApiError } from '../shared/api.js';
import { QUOTE_SORTS, cheapestOf, rankQuotes, type QuoteSort } from '../features/quotes/ranking.js';
import { queryKeys, routeContext } from '../shared/query.js';
import { loadSession } from '../shared/session.js';

/**
 * One job, and the quotes to choose between — `W4-T04` §3.2, §3.3.
 *
 * **The loader assembles the whole set rather than one page**, and that is the design rather than
 * laziness about paging: the ranking is *rating, then price* over every offer on the job, and a
 * ranking applied to the first twenty of forty quotes is not a worse comparison, it is a wrong one.
 * So it follows the cursor until the API says there is no more, bounded by `MAX_QUOTES`.
 *
 * Which is also the honest use of the cursor `W4-T04` added. The API needed one because the list is
 * written by **other people** in numbers the owner does not control; the screen needs the whole set
 * because it sorts. Those are the same requirement seen from two ends.
 */

/** The bound. Five pages of the contract's default, and a job that reaches it is pathological. */
const MAX_QUOTES = 100;

interface JobData {
  locale: string;
  job: Job;
  quotes: Quote[];
  /** True when the job has more quotes than this screen will load. Rendered, never hidden. */
  truncated: boolean;
}

export async function loader({ params, context }: LoaderFunctionArgs): Promise<JobData> {
  const locale = localeOf(params);

  const session = await loadSession(context);
  if (session === null) throw redirect(`/${locale}/login`);

  const id = params['id'] ?? '';
  const { queryClient, api } = context.get(routeContext);

  try {
    const [job, quotes] = await Promise.all([
      queryClient.ensureQueryData({ queryKey: queryKeys.job(id), queryFn: () => api.getJob(id) }),
      queryClient.ensureQueryData({
        queryKey: queryKeys.jobQuotes(id),
        queryFn: async () => {
          const collected: Quote[] = [];
          let cursor: string | undefined;

          // Bounded by `MAX_QUOTES` *and* by the page count, so a cursor the API kept handing back
          // unchanged would end this loop rather than spin it.
          while (collected.length < MAX_QUOTES) {
            const page = await api.getJobQuotes(id, cursor);
            collected.push(...page.items);
            if (!page.page.hasMore || page.page.nextCursor === null) break;
            cursor = page.page.nextCursor;
          }
          return collected;
        },
      }),
    ]);

    return {
      locale,
      job,
      quotes: quotes.slice(0, MAX_QUOTES),
      truncated: quotes.length > MAX_QUOTES,
    };
  } catch (error) {
    // Somebody else's job, or none — one answer, because the API gives one answer (`W4-T01` §3).
    if (error instanceof ApiError && error.status === 404) {
      throw new Response('Not found', { status: 404 });
    }
    throw error;
  }
}

/**
 * The decision, posted to the route that renders it.
 *
 * A route action rather than a handler calling the client directly: a write goes through the
 * router so that the loader re-runs afterwards and the screen shows the server's answer, not the
 * one it assumed. Both caches are invalidated — the quote list because a status changed, and the
 * job because `W4-T05` will make an award change it.
 */
export async function action({
  params,
  request,
  context,
}: ActionFunctionArgs): Promise<{ error: string } | null> {
  const form = await request.formData();
  const quoteId = String(form.get('quoteId') ?? '');
  const decision = String(form.get('decision') ?? '');
  if (decision !== 'accept' && decision !== 'reject') return { error: 'job.quotes.error' };

  const { queryClient, api } = context.get(routeContext);
  try {
    await api.decideQuote(quoteId, decision);
  } catch {
    // The message is a key, not a sentence: the component translates, and an action that returned
    // prose would be the one place in this app that decides what language somebody reads.
    return { error: 'job.quotes.error' };
  }

  const id = params['id'] ?? '';
  await queryClient.invalidateQueries({ queryKey: queryKeys.jobQuotes(id) });
  await queryClient.invalidateQueries({ queryKey: queryKeys.job(id) });
  return null;
}

function Rating({ quote, locale }: { quote: Quote; locale: string }): ReactElement {
  const { t } = useTranslation();
  const { ratingAvg, ratingCount } = quote.provider;

  // Null is "no reviews yet", which is not zero — the rule the search contract states at the
  // column, and the reason an unrated provider sorts last rather than bottom-of-the-scale.
  if (ratingAvg === null) return <span className="mp-meta">{t('job.quotes.unrated')}</span>;

  return (
    <span className="mp-meta">
      {t('job.quotes.rating', {
        rating: ratingAvg.toLocaleString(locale, { maximumFractionDigits: 1 }),
        count: ratingCount,
      })}
    </span>
  );
}

/**
 * What the job asked for, and whether this provider lists it.
 *
 * `W4-T03` built coverage to be *shown* and to enforce nothing — *"Nothing enforces, but stated
 * clearly"* — and this is the screen that shows it. It makes no claim about verification, because
 * nothing in the schema knows one: `W8` is unbuilt, and a badge here would be an invention.
 */
function Coverage({ quote }: { quote: Quote }): ReactElement | null {
  const { t } = useTranslation();
  if (quote.coverage.length === 0) return null;

  return (
    <ul className="mp-meta">
      {quote.coverage.map((entry) => (
        <li key={entry.slug}>
          {entry.nameEs}
          {' — '}
          {entry.listedByProvider
            ? t('job.quotes.coverage.listed')
            : t('job.quotes.coverage.notListed')}
          {entry.requiresLicence ? ` · ${t('job.quotes.coverage.licence')}` : ''}
        </li>
      ))}
    </ul>
  );
}

export function Component(): ReactElement {
  const { t } = useTranslation();
  const { locale, job, quotes, truncated } = useLoaderData<JobData>();
  const navigation = useNavigation();
  const submit = useSubmit();

  // Presentation state, and the only state on this page: which order the client is reading in.
  const [sort, setSort] = useState<QuoteSort>('recommended');
  // Which quote the confirmation dialog is asking about. `null` is "no dialog open".
  const [confirming, setConfirming] = useState<Quote | null>(null);

  const ranked = rankQuotes(quotes, sort);
  const cheapest = cheapestOf(ranked);
  const busy = navigation.state !== 'idle';

  const money = (cents: number): string =>
    (cents / 100).toLocaleString(locale, { style: 'currency', currency: 'EUR' });

  const decide = (quote: Quote, decision: 'accept' | 'reject'): void => {
    setConfirming(null);
    void submit({ quoteId: quote.id, decision }, { method: 'post' });
  };

  return (
    <article data-testid="job">
      <p>
        <Link to={`/${locale}/jobs`}>{t('job.back')}</Link>
      </p>
      <h1>{job.title ?? t('jobs.untitled')}</h1>

      <section className="mp-section" aria-labelledby="job-quotes">
        <h2 id="job-quotes">{t('job.quotes.title')}</h2>

        {quotes.length === 0 ? (
          <EmptyState
            title={t('job.quotes.empty.title')}
            description={t('job.quotes.empty.body')}
          />
        ) : (
          <>
            <p className="mp-meta">{t('job.quotes.count', { count: quotes.length })}</p>

            {/* A real label and a real control: re-sorting is the client's, per the slice rule. */}
            <label htmlFor="quote-sort">{t('job.quotes.sort.label')}</label>
            <select
              id="quote-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as QuoteSort)}
            >
              {QUOTE_SORTS.map((option) => (
                <option key={option} value={option}>
                  {t(`job.quotes.sort.${option}`)}
                </option>
              ))}
            </select>

            <ul className="mp-list" data-testid="quote-list">
              {ranked.map((quote) => (
                <li key={quote.id} className="mp-section" data-testid={`quote-${quote.id}`}>
                  <h3>
                    <Link to={`/${locale}/pro/${quote.provider.id}`}>
                      {quote.provider.displayName}
                    </Link>
                  </h3>
                  <p className="mp-lead">{money(quote.amountCents)}</p>
                  {/* The cheapest is marked whatever the sort — it is never allowed to be buried. */}
                  {quote.id === cheapest ? (
                    <p data-testid="cheapest">{t('job.quotes.cheapest')}</p>
                  ) : null}
                  <Rating quote={quote} locale={locale} />
                  {quote.breakdown === null ? null : <p>{quote.breakdown}</p>}
                  <Coverage quote={quote} />

                  {quote.status === 'PENDING' ? (
                    <p>
                      {/* Accepting asks first: there is no undo until `W4-T05` builds one. */}
                      <Button onPress={() => setConfirming(quote)} isDisabled={busy}>
                        {t('job.quotes.accept')}
                      </Button>{' '}
                      <Button
                        variant="secondary"
                        onPress={() => decide(quote, 'reject')}
                        isDisabled={busy}
                      >
                        {t('job.quotes.reject')}
                      </Button>
                    </p>
                  ) : (
                    // No control at all, rather than a disabled one that fails at the API: an
                    // expired or answered quote is not something the client can act on.
                    <p data-testid={`quote-state-${quote.id}`}>
                      {t(`job.quotes.status.${quote.status}`)}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            {truncated ? <p className="mp-meta">{t('job.quotes.more')}</p> : null}
          </>
        )}
      </section>

      {confirming === null ? null : (
        <Dialog
          title={t('job.quotes.confirm.title')}
          isOpen
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          footer={
            <>
              <Button variant="secondary" onPress={() => setConfirming(null)}>
                {t('job.quotes.confirm.cancel')}
              </Button>{' '}
              <Button onPress={() => decide(confirming, 'accept')}>
                {t('job.quotes.confirm.accept')}
              </Button>
            </>
          }
        >
          {t('job.quotes.confirm.body', {
            provider: confirming.provider.displayName,
            amount: money(confirming.amountCents),
          })}
        </Dialog>
      )}
    </article>
  );
}
