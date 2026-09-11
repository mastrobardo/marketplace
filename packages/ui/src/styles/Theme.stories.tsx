import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

/**
 * The themes, side by side — and the one assertion that cannot be made from a file.
 *
 * `tokens.test.ts` reads the four stylesheets and models the cascade: it knows which declaration
 * wins, follows `var()` and `light-dark()` to a literal, and measures the contrast of every pair in
 * every combination. That is a model. This story asks a real browser, which is the thing the model
 * is a model *of* — `getComputedStyle` on four panels that differ only by two attributes.
 *
 * ADR-012 §4 asks for a second theme *because* a theming system with one theme is untested. The
 * point of rendering all four at once is that the failure it is looking for — a "token" that was a
 * literal all along — is visible rather than argued: the panel that did not change is the bug.
 *
 * Axe runs over this like every other story (`W12-T04`), so every semantic foreground is rendered
 * on the background it is meant for. That makes the accessibility gate check both themes in both
 * schemes, which is cover `tokens.test.ts` cannot give — it measures the tokens, not what a
 * browser painted.
 */

type Theme = 'default' | 'contrast';
type Scheme = 'light' | 'dark';

const THEME_LABEL: Record<Theme, string> = {
  default: 'Por defecto',
  contrast: 'Alto contraste',
};

const SCHEME_LABEL: Record<Scheme, string> = { light: 'Claro', dark: 'Oscuro' };

/** Every combination the design system ships — the same four `tokens.test.ts` resolves. */
const COMBINATIONS: [Theme, Scheme][] = [
  ['default', 'light'],
  ['default', 'dark'],
  ['contrast', 'light'],
  ['contrast', 'dark'],
];

/** A role rendered in its own colour, on the surface it is meant for. */
const ROLES: { token: string; label: string }[] = [
  { token: '--mp-color-accent', label: 'Acento' },
  { token: '--mp-color-focus', label: 'Foco' },
  { token: '--mp-color-danger', label: 'Error' },
  { token: '--mp-color-success', label: 'Correcto' },
];

function Panel({ theme, scheme }: { theme: Theme; scheme: Scheme }) {
  const name = `${THEME_LABEL[theme]} · ${SCHEME_LABEL[scheme]}`;
  return (
    <section
      data-theme={theme}
      data-scheme={scheme}
      aria-label={name}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--mp-space-2)',
        minWidth: '13rem',
        padding: 'var(--mp-space-4)',
        background: 'var(--mp-color-bg)',
        color: 'var(--mp-color-text)',
        fontFamily: 'var(--mp-font-family)',
        fontSize: 'var(--mp-font-size-base)',
        lineHeight: 'var(--mp-font-line-height)',
        border: 'var(--mp-border-width) solid var(--mp-color-border)',
        borderRadius: 'var(--mp-radius-lg)',
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 'var(--mp-font-size-lg)',
          fontWeight: 'var(--mp-font-weight-bold)',
        }}
      >
        {name}
      </h3>

      <p
        style={{
          margin: 0,
          color: 'var(--mp-color-text-muted)',
          fontSize: 'var(--mp-font-size-sm)',
        }}
      >
        Texto atenuado sobre el fondo
      </p>

      <div
        style={{
          padding: 'var(--mp-space-2)',
          background: 'var(--mp-color-surface)',
          borderRadius: 'var(--mp-radius-md)',
          border: 'var(--mp-border-width) solid var(--mp-color-border)',
        }}
      >
        Superficie
      </div>

      <div
        style={{
          padding: 'var(--mp-space-2)',
          background: 'var(--mp-color-surface-muted)',
          borderRadius: 'var(--mp-radius-md)',
        }}
      >
        Superficie atenuada
      </div>

      <div
        style={{
          padding: 'var(--mp-space-2)',
          background: 'var(--mp-color-accent)',
          color: 'var(--mp-color-accent-contrast)',
          borderRadius: 'var(--mp-radius-md)',
          fontWeight: 'var(--mp-font-weight-bold)',
        }}
      >
        Acento con su contraste
      </div>

      <ul style={{ margin: 0, paddingInlineStart: 'var(--mp-space-4)' }}>
        {ROLES.map(({ token, label }) => (
          <li key={token} style={{ color: `var(${token})` }}>
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ThemeMatrix() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--mp-space-4)' }}>
      {COMBINATIONS.map(([theme, scheme]) => (
        <Panel key={`${theme}/${scheme}`} theme={theme} scheme={scheme} />
      ))}
    </div>
  );
}

const meta: Meta<typeof ThemeMatrix> = {
  title: 'Foundations/Themes',
  component: ThemeMatrix,
  // Four panels, each carrying its own theme and scheme: this story is about the attributes, so
  // the toolbars are deliberately not what drives it. Full width rather than centred.
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The swap, proven. Each panel differs from the default one by exactly the attributes on it — so
 * any property that comes back identical is a value that was never a token.
 */
export const Matrix: Story = {
  play: ({ canvasElement }) => {
    const panels = [...canvasElement.querySelectorAll<HTMLElement>('section[data-theme]')];
    expect(panels).toHaveLength(4);

    const seen = panels.map((panel) => {
      const computed = getComputedStyle(panel);
      return {
        background: computed.backgroundColor,
        color: computed.color,
        font: computed.fontFamily,
        radius: computed.borderTopLeftRadius,
        border: computed.borderTopWidth,
      };
    });

    const [defaultLight, defaultDark, contrastLight] = seen as [
      (typeof seen)[number],
      (typeof seen)[number],
      (typeof seen)[number],
    ];

    // The scheme swap: same theme, `data-scheme` alone, and `light-dark()` picks the other value.
    expect(defaultLight.background).not.toBe(defaultDark.background);
    expect(defaultLight.color).not.toBe(defaultDark.color);

    // The theme swap, on all four axes a theme owns — colour, type, radius, density. A theme that
    // only changed colour would pass the first of these and prove much less.
    expect(defaultLight.background).not.toBe(contrastLight.background);
    expect(defaultLight.font).not.toBe(contrastLight.font);
    expect(defaultLight.radius).not.toBe(contrastLight.radius);
    expect(defaultLight.border).not.toBe(contrastLight.border);

    // And no two combinations collapse into each other.
    expect(new Set(seen.map((panel) => panel.background)).size).toBe(4);
  },
};

/**
 * Spanish at length, in every theme — the case ADR-012 §5 asks every story to carry, and the one
 * that catches a fixed-width panel. ES runs ~20% longer than EN.
 */
export const LongText: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--mp-space-4)' }}>
      {COMBINATIONS.map(([theme, scheme]) => (
        <section
          key={`${theme}/${scheme}`}
          data-theme={theme}
          data-scheme={scheme}
          aria-label={`${THEME_LABEL[theme]} · ${SCHEME_LABEL[scheme]} — texto largo`}
          style={{
            maxWidth: '18rem',
            padding: 'var(--mp-space-4)',
            background: 'var(--mp-color-bg)',
            color: 'var(--mp-color-text)',
            fontFamily: 'var(--mp-font-family)',
            border: 'var(--mp-border-width) solid var(--mp-color-border)',
            borderRadius: 'var(--mp-radius-lg)',
          }}
        >
          <p style={{ margin: 0 }}>
            Solicita presupuestos a profesionales verificados de tu zona y compáralos sin
            compromiso: fontanería, electricidad, reformas integrales y mantenimiento urgente.
          </p>
        </section>
      ))}
    </div>
  ),
};
