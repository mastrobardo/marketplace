import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { setupI18n } from './i18n/index.js';
import './styles/tokens.css';
import './styles/app.css';

const container = document.getElementById('root');
if (container === null) throw new Error('No #root element in index.html');

// i18n is awaited before the first render: a shell that flashes in the wrong language and then
// corrects itself is worse than one that appears a frame later.
await setupI18n();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
