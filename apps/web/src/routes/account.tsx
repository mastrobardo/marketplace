import { type ReactElement } from 'react';
import { Form, redirect, useLoaderData, useNavigation } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AuthWall, Button } from '@marketplace/ui';
import { localeOf } from '../features/auth/actions.js';
import { loadSession, type SessionUser } from '../shared/session.js';

/**
 * The account page — `W2-T10` §4.
 *
 * The smallest honest version: who you are, the way out, and a named place for the thing that does
 * not exist yet. Operator, 2026-09-14: *"the name of the user and a button to open settings. this
 * will lead after to an 'improve subscription tier' page at minimum."*
 *
 * **Sign-out lives here rather than in the header.** A person signs out rarely and reaches for it
 * deliberately; a name that opens an account area is the affordance every other product has taught
 * them. The control posts to the *layout* route's action, which is where the shell's write already
 * was — this page adds a button, not a second way to end a session.
 */
export async function loader({ params, context }: LoaderFunctionArgs): Promise<SessionUser> {
  const session = await loadSession(context);

  /**
   * The one guard in the storefront, and it is not the permissions matrix — `W2-T03` owns that.
   * This is the narrower fact that this page has no content without a user: rendering an empty
   * shell and a "you are not signed in" sentence would be a worse version of the login page that
   * already exists.
   *
   * `loadSession` degrades an unreachable API to `null`, so a failure sends a signed-in person to
   * the login form. That is the safe direction: the alternative is an account page that renders
   * somebody's name from a stale cache while the session behind it is gone.
   */
  if (session === null) throw redirect(`/${localeOf(params)}/login`);

  return session;
}

export function Component(): ReactElement {
  const { t } = useTranslation();
  const session = useLoaderData<SessionUser>();
  const navigation = useNavigation();

  return (
    <article data-testid="account">
      <h1>
        {t('account.title')} — {session.name}
      </h1>

      <section className="mp-section" aria-labelledby="account-identity">
        <h2 id="account-identity">{t('account.email.label')}</h2>
        <p className="mp-lead">{session.email}</p>
      </section>

      {/* `W2-T10` §4. Tiers are `BD-16`/`BD-03` and `W5-T07`/`W5-T08` are both `[B]`: there is no
          tier in the schema, no price, and no decision about what a paid one buys. So this is the
          wall `W12-T12` argues for — a sentence, not a disabled button and not a link to nothing —
          and it is where the upgrade goes the day there is one. */}
      <AuthWall title={t('account.plan.title')} description={t('account.plan.body')} />

      {/* Posts to the layout route, which owns the session write — and lands on it, so signing
          out leaves you on the home page rather than on a page whose loader would immediately
          bounce you to the login form. */}
      <Form method="post" action=".." relative="path">
        <input type="hidden" name="intent" value="signout" />
        <Button
          type="submit"
          isPending={navigation.state === 'submitting'}
          pendingLabel={t('auth.pending')}
        >
          {t('account.signOut')}
        </Button>
      </Form>
    </article>
  );
}
