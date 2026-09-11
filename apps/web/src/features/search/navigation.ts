/**
 * Where a submitted search goes, and what happens when it is not finished — once, for both
 * renderings of the bar.
 *
 * `SearchBar` deliberately does not enforce `isRequired`: it sets `validationBehavior="aria"`, which
 * reports the state to assistive technology and lets the form submit, because *"the sentence a user
 * reads is the application's to own"* (`W12-T07`). The application had not owned it — `W12-T09`'s
 * header navigated to `/es/search?` with an empty query string, which is a request
 * `SearchQuerySchema` rejects outright, since a radius search with no centre is not a search.
 *
 * `W12-T10` adds a second rendering of the same declaration to the same page. Two controls that
 * disagree about what "incomplete" means is precisely the drift `W12-T07` and `W12-T09` exist to
 * prevent, so the guard lives here and both call it.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  missingRequiredFields,
  serializeSearchQuery,
  type SearchQuery,
  type SearchSchema,
} from '@marketplace/ui';

export interface SearchSubmission {
  /** Hand this to `SearchBar`'s `onSubmit`. */
  submit: (query: SearchQuery) => void;
  /** The names of the required fields left empty, in schema order. Empty when the last submit went. */
  missing: string[];
}

/** `/:lang/search?what=…&where=…` — the URL segment is not translated (ADR-011 Amendment 1). */
export function searchPath(locale: string, query: SearchQuery): string {
  return `/${locale}/search?${serializeSearchQuery(query)}`;
}

export function useSearchSubmission(locale: string, schema: SearchSchema): SearchSubmission {
  const navigate = useNavigate();
  const [missing, setMissing] = useState<string[]>([]);

  const submit = useCallback(
    (query: SearchQuery): void => {
      // Data, not copy: `missingRequiredFields` returns field names and the caller renders the
      // sentence, because `packages/ui` does not know whether it is showing Spanish.
      const gaps = missingRequiredFields(schema, query);
      setMissing(gaps);
      if (gaps.length > 0) return;
      void navigate(searchPath(locale, query));
    },
    [locale, schema, navigate],
  );

  return { submit, missing };
}
