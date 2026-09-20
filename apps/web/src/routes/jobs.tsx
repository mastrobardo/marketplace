import { type ReactElement } from 'react';
import { Link, redirect, useLoaderData } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@marketplace/ui';
import { type Job } from '@marketplace/contracts';
import { localeOf } from '../features/auth/actions.js';
import { queryKeys, routeContext } from '../shared/query.js';
import { loadSession } from '../shared/session.js';

/**
 * The client's own jobs — `W4-T04` §3.2.
 *
 * **This is `W4`'s page, not `W12`'s, and the precedent is `W2`'s.** ADR-011 gives `agent-ui` the
 * *storefront*: the public, indexable pages a visitor reaches without an account. An authenticated
 * area over a slice's own data belongs to the slice that owns the data, which is what `W2-T09`
 * did with `/account`. This is the list a client reaches their quotes through.
 *
 * **There is no way to create a job from here**, and the absence is deliberate rather than
 * unfinished: the posting form is `W4-T01`'s tail and this ticket did not take it on. What the
 * empty state says is therefore true — *once you post one* — and it does not offer a button that
 * goes nowhere.
 */
interface JobsData {
  locale: string;
  jobs: Job[];
}

export async function loader({ params, context }: LoaderFunctionArgs): Promise<JobsData> {
  const locale = localeOf(params);

  // The same guard `/account` uses, and for the same reason: this page has no content without a
  // user, so an empty shell with "you are not signed in" would be a worse login page than the one
  // that exists.
  const session = await loadSession(context);
  if (session === null) throw redirect(`/${locale}/login`);

  const { queryClient, api } = context.get(routeContext);
  const jobs = await queryClient.ensureQueryData({
    queryKey: queryKeys.myJobs(),
    queryFn: () => api.getMyJobs(),
  });

  return { locale, jobs };
}

export function Component(): ReactElement {
  const { t } = useTranslation();
  const { locale, jobs } = useLoaderData<JobsData>();

  if (jobs.length === 0) {
    return (
      <article data-testid="jobs">
        <h1>{t('jobs.title')}</h1>
        <EmptyState title={t('jobs.empty.title')} description={t('jobs.empty.body')} />
      </article>
    );
  }

  return (
    <article data-testid="jobs">
      <h1>{t('jobs.title')}</h1>
      <ul className="mp-list">
        {jobs.map((job) => (
          <li key={job.id} className="mp-section">
            <h2>
              <Link to={`/${locale}/jobs/${job.id}`}>{job.title ?? t('jobs.untitled')}</Link>
            </h2>
            {/* The status is a translated word, never the enum: `OPEN` is not Spanish. */}
            <p className="mp-meta">{t(`jobs.status.${job.status}`)}</p>
          </li>
        ))}
      </ul>
    </article>
  );
}
