import { type ReactElement } from 'react';
import { Link, useActionData, useNavigation, useParams, useSearchParams } from 'react-router';
import type { ActionFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@marketplace/ui';
import { AuthField, FormAlert, useAuthForm } from '../features/auth/form.js';
import { ResetSetSchema, type ResetSetValues } from '../features/auth/schema.js';
import { apiFrom, failureMessage } from '../features/auth/actions.js';
import { type TranslationKey } from '../i18n/locales/es.js';

/**
 * Set the new password.
 *
 * The token arrives as a **query parameter**, not as a path segment, and that is better-auth's
 * doing rather than a choice: its `GET /api/auth/reset-password/:token` consumes the path token,
 * checks it, and redirects here with `?token=…` or `?error=INVALID_TOKEN`. A second spelling in our
 * own path would be a second place to read the same value from.
 *
 * With no usable token the page renders a way out instead of a form. A form that cannot succeed is
 * worse than an explanation: the user types a password twice, presses the button, and is told
 * something went wrong — having learned nothing and lost the only thing they could have done.
 */
type ResetSetResult = { kind: 'failed'; message: TranslationKey } | { kind: 'done' };

export async function action({ request, context }: ActionFunctionArgs): Promise<ResetSetResult> {
  const form = await request.formData();
  const parsed = ResetSetSchema.safeParse(Object.fromEntries(form));
  const token = form.get('token');

  if (!parsed.success || typeof token !== 'string' || token === '') {
    return { kind: 'failed', message: 'auth.error.failed' };
  }

  try {
    await apiFrom(context).resetPassword({ token, newPassword: parsed.data.newPassword });
    return { kind: 'done' };
  } catch (error) {
    return { kind: 'failed', message: failureMessage(error) };
  }
}

export function Component(): ReactElement {
  const { t } = useTranslation();
  const params = useParams();
  const locale = params['lang'] ?? '';
  const [search] = useSearchParams();
  const result = useActionData<ResetSetResult>();
  const navigation = useNavigation();

  const token = search.get('token');
  const { form, onSubmit } = useAuthForm<ResetSetValues>({
    schema: ResetSetSchema,
    defaultValues: { newPassword: '', confirmPassword: '' },
    // The token travels with the values rather than in the URL the form posts to: it is a
    // single-use credential, and a `GET` would put it in history alongside the password.
    extra: { token: token ?? '' },
  });

  return (
    <article data-testid="reset-password-set">
      <h1>{t('auth.reset.set.title')}</h1>

      {result?.kind === 'done' ? (
        <section className="mp-section" data-testid="reset-done" aria-labelledby="reset-done-title">
          <h2 id="reset-done-title">{t('auth.reset.set.done.title')}</h2>
          <p className="mp-lead">{t('auth.reset.set.done.body')}</p>
          <p>
            <Link to={`/${locale}/login`}>{t('auth.reset.set.done.login')}</Link>
          </p>
        </section>
      ) : token === null || token === '' ? (
        <section
          className="mp-section"
          data-testid="reset-invalid"
          aria-labelledby="reset-invalid-title"
        >
          <h2 id="reset-invalid-title">{t('auth.reset.set.invalid.title')}</h2>
          <p className="mp-lead">{t('auth.reset.set.invalid.body')}</p>
          <p>
            <Link to={`/${locale}/reset-password`}>{t('auth.reset.set.invalid.again')}</Link>
          </p>
        </section>
      ) : (
        <form className="mp-form" onSubmit={onSubmit} noValidate>
          <AuthField
            control={form.control}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            label={t('auth.field.newPassword.label')}
            description={t('auth.field.password.hint')}
          />
          <AuthField
            control={form.control}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            label={t('auth.field.confirmPassword.label')}
          />

          {result?.kind === 'failed' ? <FormAlert>{t(result.message)}</FormAlert> : null}

          <Button
            type="submit"
            variant="primary"
            isPending={navigation.state === 'submitting'}
            pendingLabel={t('auth.pending')}
          >
            {t('auth.reset.set.submit')}
          </Button>
        </form>
      )}
    </article>
  );
}
