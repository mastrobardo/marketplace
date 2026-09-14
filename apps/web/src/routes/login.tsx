import { type ReactElement } from 'react';
import { Link, redirect, useActionData, useNavigation, useParams } from 'react-router';
import type { ActionFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@marketplace/ui';
import { AuthField, FormAlert, useAuthForm } from '../features/auth/form.js';
import { InboxPanel, ResendButton } from '../features/auth/InboxPanel.js';
import { LoginSchema, type LoginValues } from '../features/auth/schema.js';
import {
  apiFrom,
  failureMessage,
  isResend,
  isUnverified,
  localeOf,
  resendVerification,
  type ResendOutcome,
} from '../features/auth/actions.js';
import { invalidateSession } from '../shared/session.js';
import { type TranslationKey } from '../i18n/locales/es.js';

/**
 * Sign in — one message for every refusal, and exactly one exception.
 *
 * `W2-T01` §4.5 makes a wrong password, an unknown address, a suspended account and a soft-deleted
 * one **byte-identical**: the same `401`, the same code, the same sentence. The page cannot tell
 * them apart, and that is the design rather than a limitation of it.
 *
 * The exception is `403 EMAIL_NOT_VERIFIED`, which better-auth throws *after* checking the
 * password — so it tells the person who typed the right password something they already know.
 * "Check your inbox" and "you are locked out" are different situations with different actions, and
 * a user who cannot tell them apart tries the password again forever.
 */
type LoginResult =
  { kind: 'failed'; message: TranslationKey } | { kind: 'unverified'; email: string };

export async function action({
  request,
  params,
  context,
}: ActionFunctionArgs): Promise<LoginResult | ResendOutcome | Response> {
  const form = await request.formData();
  const locale = localeOf(params);

  if (isResend(form)) return resendVerification(context, locale, form);

  const parsed = LoginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { kind: 'failed', message: 'auth.login.refused' };

  try {
    await apiFrom(context).signIn(parsed.data);
    // React Query's whole job on a write. Without it the shell's loader answers from a 60-second
    // cache and the header still says "log in" to somebody who just did.
    await invalidateSession(context);
    return redirect(`/${locale}`);
  } catch (error) {
    if (isUnverified(error)) return { kind: 'unverified', email: parsed.data.email };
    // `failureMessage` maps a `401` — every refusal — onto this page's single sentence, and leaves
    // a network failure and a server error saying what they are.
    return { kind: 'failed', message: failureMessage(error, 'auth.login.refused') };
  }
}

export function Component(): ReactElement {
  const { t } = useTranslation();
  const params = useParams();
  const locale = params['lang'] ?? '';
  const result = useActionData<LoginResult | ResendOutcome>();
  const navigation = useNavigation();
  const { form, onSubmit } = useAuthForm<LoginValues>({
    schema: LoginSchema,
    defaultValues: { email: '', password: '' },
  });

  const unverified = result !== undefined && 'email' in result ? result : undefined;

  return (
    <article data-testid="login">
      <h1>{t('auth.login.title')}</h1>

      {unverified === undefined ? (
        <>
          <form className="mp-form" onSubmit={onSubmit} noValidate>
            <AuthField
              control={form.control}
              name="email"
              type="email"
              autoComplete="email"
              label={t('auth.field.email.label')}
            />
            <AuthField
              control={form.control}
              name="password"
              type="password"
              autoComplete="current-password"
              label={t('auth.field.password.label')}
            />

            {result?.kind === 'failed' ? <FormAlert>{t(result.message)}</FormAlert> : null}

            <Button
              type="submit"
              variant="primary"
              isPending={navigation.state === 'submitting'}
              pendingLabel={t('auth.pending')}
            >
              {t('auth.login.submit')}
            </Button>
          </form>

          <p>
            <Link to={`/${locale}/reset-password`}>{t('auth.login.forgot')}</Link>
          </p>
          <p>
            <Link to={`/${locale}/signup`}>{t('auth.login.noAccount')}</Link>
          </p>
        </>
      ) : (
        <InboxPanel
          testId="inbox-panel"
          title={t('auth.inbox.title')}
          body={t('auth.inbox.body', { email: unverified.email })}
          status={unverified.kind === 'unverified' ? undefined : unverified.kind}
        >
          <ResendButton email={unverified.email} />
        </InboxPanel>
      )}
    </article>
  );
}
