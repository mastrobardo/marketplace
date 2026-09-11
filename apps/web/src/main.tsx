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
// which `W1-T09`'s gate forbids any production module from touching. `import.meta.env.DEV` is the
// literal `false` in a production build, so Rollup drops this branch and the import with it
// (`W12-T08` AC17 asserts that against the built bundle).
if (import.meta.env.DEV) {
  const { startMocks } = await import('../mocks/browser.js');
  await startMocks();
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
