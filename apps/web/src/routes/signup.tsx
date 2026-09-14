import { type ReactElement } from 'react';
import { Link, useActionData, useNavigation, useParams } from 'react-router';
import type { ActionFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@marketplace/ui';
import { AuthField, FormAlert, useAuthForm } from '../features/auth/form.js';
import { InboxPanel, ResendButton } from '../features/auth/InboxPanel.js';
import { SignUpSchema, type SignUpValues } from '../features/auth/schema.js';
import {
  apiFrom,
  failureMessage,
  isResend,
  localeOf,
  resendVerification,
  type ResendOutcome,
} from '../features/auth/actions.js';
import { type TranslationKey } from '../i18n/locales/es.js';

/**
 * Signup — and the page that is least allowed to be helpful.
 *
 * `W2-T01` §4.5 answers a duplicate signup with a synthetic `200`: a user object with `roles: null`
 * and no row written, so that the endpoint cannot be asked which addresses are registered. This page
 * has **one** success state, and it is the same for a new account and for an address that already
 * has one. `api.ts`'s `signUp` returns nothing, so the branch is not merely unwritten — there is
 * nothing here to branch *on*.
 *
 * Everyone who signs up is a `CLIENT` (operator, 2026-09-14; `ADR-005` Q1). There is no role
 * question, and there could not be one: `W2-T01` made `roles` `input: false` so that a sign-up body
 * cannot set it. Becoming a professional is `W2-T05`, reached from `become-a-pro`.
 */
type SignUpResult = { kind: 'failed'; message: TranslationKey } | { kind: 'sent'; email: string };

export async function action({
  request,
  params,
  context,
}: ActionFunctionArgs): Promise<SignUpResult | ResendOutcome> {
  const form = await request.formData();
  const locale = localeOf(params);

  if (isResend(form)) return resendVerification(context, locale, form);

  const parsed = SignUpSchema.safeParse(Object.fromEntries(form));
  // The form validated these already; a body that gets here failed a rule the browser enforces, so
  // it is a bad request rather than a user's mistake and it gets the generic sentence.
  if (!parsed.success) return { kind: 'failed', message: 'auth.error.failed' };

  try {
    // Relative, and in *this* language: the emailed link resolves against `BETTER_AUTH_URL` — which
    // is the web origin, not the API's — and lands the user back on the page in the language they
    // signed up in (`W2-T09` §4.4).
    await apiFrom(context).signUp({ ...parsed.data, callbackURL: `/${locale}/verify-email` });
    return { kind: 'sent', email: parsed.data.email };
  } catch (error) {
    return { kind: 'failed', message: failureMessage(error) };
  }
}

export function Component(): ReactElement {
  const { t } = useTranslation();
  const params = useParams();
  const locale = params['lang'] ?? '';
  const result = useActionData<SignUpResult | ResendOutcome>();
  const navigation = useNavigation();
  const { form, onSubmit } = useAuthForm<SignUpValues>({
    schema: SignUpSchema,
    defaultValues: { name: '', email: '', password: '' },
  });

  const sent = result !== undefined && 'email' in result ? result : undefined;

  return (
    <article data-testid="signup">
      <h1>{t('auth.signup.title')}</h1>

      {sent === undefined ? (
        <>
          <p className="mp-lead">{t('auth.signup.intro')}</p>

          <form className="mp-form" onSubmit={onSubmit} noValidate>
            <AuthField
              control={form.control}
              name="name"
              autoComplete="name"
              label={t('auth.field.name.label')}
            />
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
              // `new-password`, so a password manager offers to generate one rather than filling in
              // the one this person uses everywhere else.
              autoComplete="new-password"
              label={t('auth.field.password.label')}
              description={t('auth.field.password.hint')}
            />

            {result?.kind === 'failed' ? <FormAlert>{t(result.message)}</FormAlert> : null}

            <Button
              type="submit"
              variant="primary"
              isPending={navigation.state === 'submitting'}
              pendingLabel={t('auth.pending')}
            >
              {t('auth.signup.submit')}
            </Button>
          </form>

          <p>
            <Link to={`/${locale}/login`}>{t('auth.signup.haveAccount')}</Link>
          </p>
        </>
      ) : (
        <InboxPanel
          testId="inbox-panel"
          title={t('auth.inbox.title')}
          body={t('auth.inbox.body', { email: sent.email })}
          status={sent.kind === 'sent' ? undefined : sent.kind}
        >
          <ResendButton email={sent.email} />
        </InboxPanel>
      )}
    </article>
  );
}
