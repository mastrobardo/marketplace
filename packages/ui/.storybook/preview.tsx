import { type Preview } from '@storybook/react-vite';
import { I18nProvider } from 'react-aria';
import { useEffect } from 'react';
import '../src/styles/tokens.css';
import './preview.css';

/**
 * Three toolbars, for the three axes this product is actually reviewed on.
 *
 * **Locale** is effective today and matters more than it looks: React Aria's own strings — a
 * select's "Select an item", a combobox's "Suggestions" — come from its bundled translations and
 * are chosen by this provider. Switching to `en-GB` in the toolbar is how you see what a user gets
 * when the application forgets to wrap its tree (`W12-T09`).
 *
 * **Theme** and **scheme** are the two attributes `W12-T05` made real: `[data-theme]` picks the
 * file a palette comes from, `[data-scheme]` overrides `prefers-color-scheme`. They are separate
 * because they are independent — `Por defecto/Oscuro` and `Alto contraste/Claro` are both things a
 * reviewer needs to look at, and one attribute carrying a pair would be a tuple in a string.
 *
 * `W12-T03` wired the theme toolbar before there was anything behind it, on the promise that T05
 * would be a stylesheet change. It very nearly was: what T05 adds here is the second axis, which
 * did not exist when there was only one theme to switch between.
 */
const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { expanded: true },

    // `W12-T04` of `W10-T05`, paid per pull request instead of as an audit at the end: axe runs
    // against every rendered story in the browser project and a violation **fails the build**, the
    // same as any other assertion. Set globally rather than per story, so a new component is
    // covered by existing it rather than by someone remembering.
    a11y: { test: 'error' },
  },

  globalTypes: {
    theme: {
      description: 'Tema — la paleta, la tipografía y los radios',
      toolbar: {
        title: 'Tema',
        icon: 'paintbrush',
        items: [
          { value: 'default', title: 'Por defecto' },
          { value: 'contrast', title: 'Alto contraste' },
        ],
        dynamicTitle: true,
      },
    },
    scheme: {
      description: 'Esquema — claro u oscuro',
      toolbar: {
        title: 'Esquema',
        icon: 'contrast',
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

  initialGlobals: { theme: 'default', scheme: 'light', locale: 'es-ES' },

  decorators: [
    (Story, context) => {
      const theme = String(context.globals['theme'] ?? 'default');
      const scheme = String(context.globals['scheme'] ?? 'light');
      const locale = String(context.globals['locale'] ?? 'es-ES');

      // The root carries them too: an overlay is portalled to `document.body`, outside the story's
      // own container, so a dialog styled from these attributes would otherwise miss the switch.
      useEffect(() => {
        document.documentElement.dataset['theme'] = theme;
        document.documentElement.dataset['scheme'] = scheme;
        document.documentElement.lang = locale;
      }, [theme, scheme, locale]);

      return (
        <I18nProvider locale={locale}>
          <div data-theme={theme} data-scheme={scheme} className="sb-story">
            <Story />
          </div>
        </I18nProvider>
      );
    },
  ],
};

export default preview;
