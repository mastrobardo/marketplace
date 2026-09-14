import { createTransport, type Transporter } from 'nodemailer';

import { type Config } from '../config.js';

/**
 * The two messages `W2-T01` sends. Both are transactional and neither is marketing, which is why
 * there is no template engine here and no unsubscribe footer.
 *
 * An interface rather than a concrete class so a test can assert *that* a link was sent and to
 * whom without an SMTP server — and so `OPS-14` swapping Mailpit for Resend is a change to
 * `createMailer`, not to `auth.ts`.
 */
export interface Mailer {
  sendVerification(message: { to: string; url: string }): Promise<void>;
  sendPasswordReset(message: { to: string; url: string }): Promise<void>;
}

/**
 * Deliberately plain text, and deliberately short.
 *
 * A verification email is read by a human for about two seconds and by a spam filter for rather
 * longer. HTML, images and tracking pixels all cost deliverability on a domain with no sending
 * reputation, which is every domain we will have on the day `OPS-14` lands.
 *
 * i18n is not here: `app_user.locale` exists and `W12`'s translations exist, but wiring a locale
 * through better-auth's callbacks is its own decision about where message catalogues live for a
 * service with no React in it. Spanish-first is the product (`R1`), so this being English is a
 * known gap — recorded in the run record rather than half-solved here.
 */
function verificationBody(url: string): string {
  return [
    'Confirm your email address to finish setting up your account:',
    '',
    url,
    '',
    'The link works once and expires in an hour.',
    'If you did not create an account, you can ignore this message.',
  ].join('\n');
}

function passwordResetBody(url: string): string {
  return [
    'Use this link to set a new password:',
    '',
    url,
    '',
    'The link works once and expires in an hour.',
    // Not "if you did not request this, ignore it" — a reset request someone did not make is worth
    // a moment's attention, and the honest instruction is that doing nothing keeps them safe.
    'If you did not request a reset, your password has not changed and no action is needed.',
  ].join('\n');
}

export interface CreateMailerOptions {
  config: Config;
  /** Tests inject a stub; nothing else should. */
  transporter?: Transporter;
}

export function createMailer({ config, transporter }: CreateMailerOptions): Mailer {
  const transport =
    transporter ??
    createTransport({
      host: config.MAIL_SMTP_HOST,
      port: config.MAIL_SMTP_PORT,
      // Mailpit speaks plain SMTP on 1025 and has no certificate. `OPS-14` will set a real host,
      // where `secure` follows the port in nodemailer's own default (465 ⇒ TLS, else STARTTLS).
      secure: config.MAIL_SMTP_PORT === 465,
    });

  return {
    async sendVerification({ to, url }) {
      await transport.sendMail({
        from: config.MAIL_FROM,
        to,
        subject: 'Confirm your email address',
        text: verificationBody(url),
      });
    },

    async sendPasswordReset({ to, url }) {
      await transport.sendMail({
        from: config.MAIL_FROM,
        to,
        subject: 'Set a new password',
        text: passwordResetBody(url),
      });
    },
  };
}
