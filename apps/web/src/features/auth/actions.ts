/**
 * What the five actions share.
 *
 * Each page owns its own `action` — that is the route contract, and a shared dispatcher would put
 * five flows behind one `switch` nobody can read. What is shared is the small set of decisions that
 * must be the *same* on every page: which failures are distinguishable, which are not, and what a
 * resend does.
 */
import { type Params, type RouterContextProvider } from 'react-router';
import { ApiError, type ApiClient } from '../../shared/api.js';
import { routeContext } from '../../shared/query.js';
import { isLocale, LOCALES } from '../../i18n/index.js';
import { type TranslationKey } from '../../i18n/index.js';
import { ResendSchema } from './schema.js';

export function apiFrom(context: Readonly<RouterContextProvider>): ApiClient {
  return context.get(routeContext).api;
}

/**
 * The language the action is answering in.
 *
 * The shell's loader has already thrown a 404 for a segment that is not a language, so by the time
 * an action runs this is a formality — but an action can be reached by a `POST` to any URL, and
 * falling back to the default locale is better than building `/undefined/verify-email` into an
 * email somebody has to click.
 */
export function localeOf(params: Params): string {
  const lang = params['lang'];
  return lang !== undefined && isLocale(lang) ? lang : LOCALES[0];
}

/**
 * A failure, as one sentence.
 *
 * Only two outcomes are distinguishable, and neither of them says anything about the account: *we
 * could not reach the service* (no response at all — retrying is the right advice) and *that did
 * not work* (the server answered and refused). Everything the server might have meant by refusing
 * stays where `W2-T01` put it.
 */
export function failureMessage(
  error: unknown,
  /** What a *refusal* reads as on this page. Login's is its own sentence; nothing else has one. */
  refused: TranslationKey = 'auth.error.failed',
): TranslationKey {
  if (!(error instanceof ApiError)) return 'auth.error.failed';
  if (error.status === undefined) return 'auth.error.unreachable';
  return error.status === 401 ? refused : 'auth.error.failed';
}

/**
 * The one refusal the API makes distinguishable on purpose — `W2-T09` §1.1b.
 *
 * Both halves are checked. A bare `403` is also what an origin check or a rejected callback URL
 * produces, and rendering "check your inbox" for one of those would be telling a user to wait for
 * an email nobody tried to send.
 */
export function isUnverified(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 403 && error.message === 'EMAIL_NOT_VERIFIED'
  );
}

export type ResendOutcome =
  | { kind: 'resent'; email: string }
  | { kind: 'resend-failed'; email: string }
  | { kind: 'resend-invalid' };

/**
 * Resend a verification mail. Three pages need it — signup, login and the verify page — and it must
 * behave identically on all three.
 *
 * **The failure is not swallowed.** `POST /send-verification-email` answers `200` for an address it
 * cannot find and for one that is already verified (it is constant-time floored, deliberately), so
 * a success panel really does mean *we asked the API to send*. It throws when the *send* throws,
 * which is `ECONNREFUSED 127.0.0.1:1025` in every deployed environment until `OPS-14` — and that is
 * the case the user has to be told about, because the account is already stranded and an inbox that
 * will stay empty is not something to send them to wait beside.
 */
export async function resendVerification(
  context: Readonly<RouterContextProvider>,
  locale: string,
  form: FormData,
): Promise<ResendOutcome> {
  const parsed = ResendSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { kind: 'resend-invalid' };

  const { email } = parsed.data;
  try {
    await apiFrom(context).resendVerification({
      email,
      callbackURL: `/${locale}/verify-email`,
    });
    return { kind: 'resent', email };
  } catch {
    return { kind: 'resend-failed', email };
  }
}

/** Whether this submit was the resend control rather than the form's own button. */
export function isResend(form: FormData): boolean {
  return form.get('intent') === 'resend';
}
