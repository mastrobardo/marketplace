import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { setupI18n } from './i18n/index.js';
import '@marketplace/ui/tokens.css';
import './styles/app.css';

const container = document.getElementById('root');
if (container === null) throw new Error('No #root element in index.html');

// i18n is awaited before the first render: a shell that flashes in the wrong language and then
// corrects itself is worse than one that appears a frame later.
await setupI18n();

// The MSW handlers live outside `src/` on purpose — they import the `packages/testing` factories,
// which `W1-T09`'s gate forbids any production module from touching.
//
// `VITE_ENABLE_MOCKS` is what makes a preview deploy reviewable. ADR-011 §4 says the storefront does
// not wait for its endpoints — but `W12-T08`'s `stripMocks` plugin removed them from *every*
// production-mode build, preview included, while `VITE_API_URL` pointed preview at a real API that
// has none of them yet. The result was a deployed storefront with neither. `onUnhandledRequest` is
// `'bypass'`, so with this on, MSW answers only the endpoints that do not exist and everything real
// goes straight through to the API.
//
// It is never set for the production release, so factory data cannot ship — `W12-T08` AC17 asserts
// that against the built bundle, and AC19 asserts the flag actually works.
if (import.meta.env.DEV || import.meta.env['VITE_ENABLE_MOCKS'] === 'true') {
  const { startMocks } = await import('../mocks/browser.js');
  await startMocks();
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
