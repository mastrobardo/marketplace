import { type Preview } from '@storybook/react-vite';
import { I18nProvider } from 'react-aria';
import { useEffect } from 'react';
import '../src/styles/tokens.css';
import './preview.css';

/**
 * Two toolbars, for the two axes this product is actually reviewed on.
 *
 * **Locale** is effective today and matters more than it looks: React Aria's own strings — a
 * select's "Select an item", a combobox's "Suggestions" — come from its bundled translations and
 * are chosen by this provider. Switching to `en-GB` in the toolbar is how you see what a user gets
 * when the application forgets to wrap its tree (`W12-T09`).
 *
 * **Theme** sets `[data-theme]` on the root and on the story container. `tokens.css` still switches
 * on `prefers-color-scheme` alone, so the toggle changes nothing visible **until `W12-T05`** makes a
 * theme a file and ships a second one. It is wired now so that T05 is a stylesheet change and not a
 * workbench change — and so that this comment is the only place the gap exists.
 */
const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { expanded: true },

    // `W12-T05` of `W10-T05`, paid per pull request instead of as an audit at the end: axe runs
    // against every rendered story in the browser project and a violation **fails the build**, the
    // same as any other assertion. Set globally rather than per story, so a new component is
    // covered by existing it rather than by someone remembering.
    a11y: { test: 'error' },
  },

  globalTypes: {
    theme: {
      description: 'Tema — claro u oscuro',
      toolbar: {
        title: 'Tema',
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Claro' },
          { value: 'dark', title: 'Oscuro' },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'Idioma — ES primero, siempre',
      toolbar: {
        title: 'Idioma',
        icon: 'globe',
        items: [
          { value: 'es-ES', title: 'Español' },
          { value: 'en-GB', title: 'English' },
        ],
        dynamicTitle: true,
      },
    },
  },

  initialGlobals: { theme: 'light', locale: 'es-ES' },

  decorators: [
    (Story, context) => {
      const theme = String(context.globals['theme'] ?? 'light');
      const locale = String(context.globals['locale'] ?? 'es-ES');

      // The root carries it too: an overlay is portalled to `document.body`, outside the story's
      // own container, so a dialog styled from `[data-theme]` would otherwise miss the switch.
      useEffect(() => {
        document.documentElement.dataset['theme'] = theme;
        document.documentElement.lang = locale;
      }, [theme, locale]);

      return (
        <I18nProvider locale={locale}>
          <div data-theme={theme} className="sb-story">
            <Story />
          </div>
        </I18nProvider>
      );
    },
  ],
};

export default preview;
