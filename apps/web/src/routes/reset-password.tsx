import { type ReactElement } from 'react';
import { Link, useActionData, useNavigation, useParams } from 'react-router';
import type { ActionFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@marketplace/ui';
import { AuthField, FormAlert, useAuthForm } from '../features/auth/form.js';
import { ResetRequestSchema, type ResetRequestValues } from '../features/auth/schema.js';
import { apiFrom, failureMessage, localeOf } from '../features/auth/actions.js';
import { type TranslationKey } from '../i18n/locales/es.js';

/**
 * Ask for a reset link.
 *
 * `POST /request-password-reset` answers `200` whether or not the address has an account — it even
 * simulates the token generation and the lookup so the two take the same time. The UI must not be
 * the side that gives it away, so there is one panel and it names the address the user typed
 * without claiming anything about it.
 */
type ResetRequestResult =
  { kind: 'failed'; message: TranslationKey } | { kind: 'sent'; email: string };

export async function action({
  request,
  params,
  context,
}: ActionFunctionArgs): Promise<ResetRequestResult> {
  const form = await request.formData();
  const locale = localeOf(params);

  const parsed = ResetRequestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { kind: 'failed', message: 'auth.error.failed' };

  try {
    // `redirectTo` is where better-auth's own `/reset-password/:token` callback sends the browser
    // once it has checked the token — with `?token=…`, or `?error=INVALID_TOKEN`.
    await apiFrom(context).requestPasswordReset({
      email: parsed.data.email,
      redirectTo: `/${locale}/reset-password/set`,
    });
    return { kind: 'sent', email: parsed.data.email };
  } catch (error) {
    return { kind: 'failed', message: failureMessage(error) };
  }
}

export function Component(): ReactElement {
  const { t } = useTranslation();
  const params = useParams();
  const locale = params['lang'] ?? '';
  const result = useActionData<ResetRequestResult>();
  const navigation = useNavigation();
  const { form, onSubmit } = useAuthForm<ResetRequestValues>({
    schema: ResetRequestSchema,
    defaultValues: { email: '' },
  });

  return (
    <article data-testid="reset-password">
      <h1>{t('auth.reset.request.title')}</h1>

      {result?.kind === 'sent' ? (
        <section className="mp-section" data-testid="reset-sent" aria-labelledby="reset-sent-title">
          <h2 id="reset-sent-title">{t('auth.reset.request.sent.title')}</h2>
          <p className="mp-lead">{t('auth.reset.request.sent.body', { email: result.email })}</p>
          <p>{t('auth.inbox.spam')}</p>
        </section>
      ) : (
        <>
          <p className="mp-lead">{t('auth.reset.request.intro')}</p>

          <form className="mp-form" onSubmit={onSubmit} noValidate>
            <AuthField
              control={form.control}
              name="email"
              type="email"
              autoComplete="email"
              label={t('auth.field.email.label')}
            />

            {result?.kind === 'failed' ? <FormAlert>{t(result.message)}</FormAlert> : null}

            <Button
              type="submit"
              variant="primary"
              isPending={navigation.state === 'submitting'}
              pendingLabel={t('auth.pending')}
            >
              {t('auth.reset.request.submit')}
            </Button>
          </form>

          <p>
            <Link to={`/${locale}/login`}>{t('auth.signup.haveAccount')}</Link>
          </p>
        </>
      )}
    </article>
  );
}
