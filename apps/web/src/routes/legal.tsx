import { type ReactElement } from 'react';
import { useParams } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { useTranslation } from 'react-i18next';
import { type TranslationKey } from '../i18n/locales/es.js';
import { Component as NotFound } from './not-found.js';

/**
 * The legal slots — terms, privacy, cookies.
 *
 * The *content* is `W10-T07` and marked `[H]`: it is lawyer-drafted, and an agent writing a privacy
 * policy is a compliance incident with good intentions. So this route ships the slot, the heading,
 * the URL and the place the prose goes, and says plainly that the document is not published yet.
 *
 * A visibly pending document is the honest state. The alternative — omitting the routes until the
 * text exists — means the footer links 404 and nobody notices the gap until launch.
 */
const DOCUMENTS: Record<string, TranslationKey> = {
  terms: 'legal.terms.title',
  privacy: 'legal.privacy.title',
  cookies: 'legal.cookies.title',
};

/**
 * Validating the parameter here rather than in the component is not a style preference: a `throw`
 * during render is a React error that unmounts the tree, while a `throw` from a loader is a route
 * error response the router renders a 404 for. The first one loses the shell; the second is the
 * shell doing its job.
 */
export function loader({ params }: LoaderFunctionArgs): null {
  if (!Object.hasOwn(DOCUMENTS, params['doc'] ?? '')) {
    throw new Response('Not found', { status: 404 });
  }
  return null;
}

export function Component(): ReactElement {
  const { doc } = useParams();
  const { t } = useTranslation();
  // The loader has already rejected anything else, so this is a lookup and not a decision.
  const title = DOCUMENTS[doc ?? ''] ?? 'legal.terms.title';

  return (
    <article data-testid="legal" data-doc={doc}>
      <h1>{t(title)}</h1>
      <p className="mp-lead">{t('legal.pending')}</p>
    </article>
  );
}

/**
 * A 404 for an unknown document, rendered **here** rather than at the root.
 *
 * Without this the thrown 404 travels to the shell's own boundary, which replaces the whole
 * document — so `/es/legal/nonsense` would lose the header, the search box and the footer for a
 * mistyped path, even though the shell loaded perfectly. The boundary belongs at the level that
 * actually failed; this one renders inside the shell's outlet, exactly like the catch-all route.
 */
export { NotFound as ErrorBoundary };
