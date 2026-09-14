import { type ReactElement } from 'react';
import { Link, useActionData, useParams, useSearchParams } from 'react-router';
import type { ActionFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { InboxPanel, ResendForm } from '../features/auth/InboxPanel.js';
import { localeOf, resendVerification, type ResendOutcome } from '../features/auth/actions.js';

/**
 * Where the emailed link lands — `W2-T09` §4.6.
 *
 * The page never verifies anything itself. better-auth's `GET /api/auth/verify-email` consumes the
 * token and **redirects** here: with no query when it worked, and with `?error=<CODE>` when the
 * token was expired, already used, or for a user that no longer exists. So the state is in the URL,
 * and the page's job is to say which of the two happened without guessing.
 *
 * Verification signs the user in (`autoSignInAfterVerification`), which is why the verified state
 * offers a way onward rather than a login form.
 */
export async function action({
  request,
  params,
  context,
}: ActionFunctionArgs): Promise<ResendOutcome> {
  return resendVerification(context, localeOf(params), await request.formData());
}

export function Component(): ReactElement {
  const { t } = useTranslation();
  const params = useParams();
  const locale = params['lang'] ?? '';
  const [search] = useSearchParams();
  const result = useActionData<ResendOutcome>();

  // Any error code is the same story to a user: this link no longer works, ask for another. The
  // codes differ (`TOKEN_EXPIRED`, `INVALID_TOKEN`, `USER_NOT_FOUND`) and the difference is for the
  // logs — `USER_NOT_FOUND` in particular must not be rendered, because it answers "does this
  // address have an account" to anybody holding an old link.
  const failed = search.get('error') !== null;

  if (!failed) {
    return (
      <article data-testid="verify-verified">
        <h1>{t('auth.verify.verified.title')}</h1>
        <p className="mp-lead">{t('auth.verify.verified.body')}</p>
        <p>
          <Link to={`/${locale}`}>{t('auth.verify.verified.continue')}</Link>
        </p>
      </article>
    );
  }

  return (
    <article>
      <InboxPanel
        testId="verify-expired"
        headingLevel={1}
        title={t('auth.verify.expired.title')}
        body={t('auth.verify.expired.body')}
        status={
          result?.kind === 'resent' || result?.kind === 'resend-failed' ? result.kind : undefined
        }
      >
        <ResendForm />
      </InboxPanel>
    </article>
  );
}
