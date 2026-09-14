/**
 * "Check your email" — the one panel three pages share, and the place the mail gap is told honestly.
 *
 * Signup renders it because a new account and a duplicate must be indistinguishable (`W2-T09`
 * §1.1a). Login renders it for `403 EMAIL_NOT_VERIFIED`. The verify page renders it for a link that
 * has expired. All three offer a resend, and all three must report a resend that failed as a
 * failure — until `OPS-14` there is no mail provider in any deployed environment, and a success
 * message over an `ECONNREFUSED` is the specific lie this component exists to prevent.
 */
import { type ReactElement, type ReactNode, useId } from 'react';
import { Form, useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@marketplace/ui';
import { AuthField, useAuthForm } from './form.js';
import { ResendSchema, type ResendValues } from './schema.js';

export interface InboxPanelProps {
  /** The page decides which panel this is; the testid is how each page's own tests find it. */
  testId: string;
  title: string;
  body: string;
  /** The outcome of a resend, if one has happened. */
  status?: 'resent' | 'resend-failed' | undefined;
  /** The page owns its outline: the verify page *is* this panel, so there it is the `h1`. */
  headingLevel?: 1 | 2;
  /** The resend control: a button when the address is known, a field when it is not. */
  children?: ReactNode;
}

export function InboxPanel({
  testId,
  title,
  body,
  status,
  headingLevel = 2,
  children,
}: InboxPanelProps): ReactElement {
  const id = useId();
  const { t } = useTranslation();
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <section className="mp-section" data-testid={testId} aria-labelledby={id}>
      <Heading id={id}>{title}</Heading>
      <p className="mp-lead">{body}</p>
      <p>{t('auth.inbox.spam')}</p>
      {children}
      {/* `status` for the good news and `alert` for the bad: one is a confirmation the user asked
          for, the other is a correction to what they were about to believe. */}
      {status === 'resent' ? <p role="status">{t('auth.inbox.resent')}</p> : null}
      {status === 'resend-failed' ? <p role="alert">{t('auth.inbox.resendFailed')}</p> : null}
    </section>
  );
}

/**
 * Resend to an address the page already knows — after a signup, or after an unverified sign-in.
 *
 * A plain `<Form>` rather than RHF: there is nothing to validate. The address came from a form that
 * validated it a moment ago, and it travels hidden so that the user is not invited to edit it into
 * somebody else's.
 */
export function ResendButton({ email }: { email: string }): ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="resend" />
      <input type="hidden" name="email" value={email} />
      <Button
        type="submit"
        isPending={navigation.state === 'submitting'}
        pendingLabel={t('auth.pending')}
      >
        {t('auth.inbox.resend')}
      </Button>
    </Form>
  );
}

/**
 * Resend to an address the page does **not** know.
 *
 * This is the expired-link case: the token is gone and it never carried an address anywhere the
 * browser could see, so the only way to send another mail is to ask. Which is also why the verify
 * page cannot silently resend on arrival.
 */
export function ResendForm(): ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { form, onSubmit } = useAuthForm<ResendValues>({
    schema: ResendSchema,
    defaultValues: { email: '' },
    extra: { intent: 'resend' },
  });

  return (
    <form className="mp-form" onSubmit={onSubmit} noValidate>
      <AuthField
        control={form.control}
        name="email"
        type="email"
        autoComplete="email"
        label={t('auth.field.email.label')}
      />
      <Button
        type="submit"
        variant="primary"
        isPending={navigation.state === 'submitting'}
        pendingLabel={t('auth.pending')}
      >
        {t('auth.inbox.resend')}
      </Button>
    </form>
  );
}
