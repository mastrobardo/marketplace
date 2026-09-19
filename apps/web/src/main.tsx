import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { setupI18n } from './i18n/index.js';
import '@marketplace/ui/tokens.css';
// The component layer. Ordered between the tokens it reads and the shell's own layout classes, so
// that a page's `.mp-*` rule wins a same-specificity collision with a design-system update.
// Its absence is why every React Aria control rendered as a raw browser widget from `W12-T01`
// until `W2-T09` noticed — `ui-package.test.ts` AC3 is what can see it now (`W12-T20`).
import '@marketplace/ui/styles.css';
import './styles/app.css';

const container = document.getElementById('root');
if (container === null) throw new Error('No #root element in index.html');

// i18n is awaited before the first render: a shell that flashes in the wrong language and then
// corrects itself is worse than one that appears a frame later.
await setupI18n();

/**
 * **There is no mock layer any more** — `W3-T01`.
 *
 * `GET /categories` was the last endpoint the storefront did not have, and this file used to start
 * an MSW worker so a dev server and a preview deploy had something to answer it. All three of the
 * storefront's endpoints are real now, `W0-T28` routes `/api/*` to the API through one origin, and
 * `shared/categories.ts` degrades to an empty list if a call fails — so a missing endpoint is a
 * quiet empty grid rather than the 500 page, which is the rule `W12-T09` learned the expensive way.
 *
 * `tests/mocks.test.ts` asserts the absence in both directions: nothing named `mocks/` survives, and
 * no build carries msw even with the old `VITE_ENABLE_MOCKS` flag set.
 */
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
