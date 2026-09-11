/**
 * The workbench's wiring, asserted rather than assumed.
 *
 * Every criterion here is about a thing that is *configured* — a project, a decorator, a CI step —
 * and configuration is exactly where this repo has been bitten before: the `database` job names its
 * suites by hand, so a new test file is skipped and the run still goes green
 * (`memory/repo/gotchas.md`). A workbench whose browser project is not run, or whose CI job has no
 * browser to run it in, fails the same way: silently, and in the direction that looks like success.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { type Decorator, type Preview } from '@storybook/react-vite';
import preview from '../.storybook/preview.js';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('AC1/AC2 — one command runs both projects', () => {
  const config = read('../vitest.config.ts');

  it('declares a jsdom project and a browser project', () => {
    expect(config).toContain("name: 'unit'");
    expect(config).toContain("environment: 'jsdom'");
    expect(config).toContain("name: 'storybook'");
  });

  it('points the browser project at a real Chromium through Playwright', () => {
    expect(config).toContain('provider: playwright()');
    expect(config).toContain("browser: 'chromium'");
    expect(config).toContain('enabled: true');
  });

  it('runs the stories through the Storybook plugin rather than a second harness', () => {
    expect(config).toContain('storybookTest(');
  });
});

describe('AC4/AC5 — the toolbars reach the story', () => {
  const decorator = (preview.decorators as Decorator[])[0];

  function renderWith(globals: Record<string, string>): void {
    function Decorated() {
      return decorator?.(() => <p>historia</p>, { globals } as unknown as Parameters<Decorator>[1]);
    }
    render(<Decorated />);
  }

  it('offers all three toolbars, Spanish first', () => {
    const globalTypes = preview.globalTypes as Record<string, { toolbar?: { items: unknown[] } }>;
    expect(Object.keys(globalTypes)).toEqual(expect.arrayContaining(['theme', 'scheme', 'locale']));
    expect((preview as Preview).initialGlobals).toMatchObject({
      locale: 'es-ES',
      theme: 'default',
      scheme: 'light',
    });
  });

  it('names the themes that exist, and only those', () => {
    // `W12-T05` ships two. A toolbar offering a third would be a toolbar offering a theme with no
    // file behind it, which looks like a broken palette rather than a missing one.
    const globalTypes = preview.globalTypes as Record<
      string,
      { toolbar?: { items: { value: string }[] } }
    >;
    expect(globalTypes['theme']?.toolbar?.items.map((item) => item.value)).toEqual([
      'default',
      'contrast',
    ]);
    expect(globalTypes['scheme']?.toolbar?.items.map((item) => item.value)).toEqual([
      'light',
      'dark',
    ]);
  });

  it('applies the locale to the document, so React Aria speaks it too', () => {
    renderWith({ theme: 'default', scheme: 'light', locale: 'en-GB' });
    expect(screen.getByText('historia')).toBeDefined();
    expect(document.documentElement.lang).toBe('en-GB');
  });

  it('applies both attributes to the story container and to the root', () => {
    // Two axes, independently: `W12-T05` made `[data-theme]` pick the palette file and
    // `[data-scheme]` override `prefers-color-scheme`, so a reviewer can look at
    // `Alto contraste/Claro` — which is neither toolbar's default.
    renderWith({ theme: 'contrast', scheme: 'dark', locale: 'es-ES' });
    expect(document.querySelector('[data-theme="contrast"][data-scheme="dark"]')).not.toBeNull();
    // The root too: an overlay is portalled to `document.body`, outside the story's container.
    expect(document.documentElement.dataset['theme']).toBe('contrast');
    expect(document.documentElement.dataset['scheme']).toBe('dark');
  });
});

describe('W12-T04 — an axe violation fails the build, and stays that way', () => {
  it('runs axe against every story at error severity', () => {
    const parameters = preview.parameters as { a11y?: { test?: string } };

    // `'error'` is the whole ticket. The addon also accepts `'todo'` (report, do not fail) and
    // `'off'`, and the pressure to reach for one of them arrives on the first pull request that is
    // blocked by a contrast ratio at 17:00. Pinning it here means that decision has to be taken in
    // the open, by editing an assertion, rather than by quietly changing a string.
    expect(parameters.a11y?.test).toBe('error');
  });

  it('loads the addon that provides it', () => {
    expect(read('../.storybook/main.ts')).toContain('@storybook/addon-a11y');
  });
});

describe('AC6/AC7 — the workbench is quiet, and it builds', () => {
  it('does not phone home', () => {
    expect(read('../.storybook/main.ts')).toContain('disableTelemetry: true');
  });

  it('has a build script whose output is not committed', () => {
    const manifest = JSON.parse(read('../package.json')) as { scripts: Record<string, string> };
    expect(manifest.scripts['build:storybook']).toContain('storybook build');
    expect(read('../../../.gitignore')).toContain('storybook-static/');
  });
});

describe('AC8 — CI has a browser to run the stories in', () => {
  it('installs Chromium in the job that runs the tests', () => {
    // Reading `agent-devops`' workflow from here is deliberate: the assertion belongs next to the
    // thing that needs it. If the step is ever dropped, this fails in `packages/ui`, which is where
    // someone can act on it — rather than the story tests quietly not running at all.
    const ci = read('../../../.github/workflows/ci.yml');
    const unit = ci.slice(ci.indexOf('  unit:'), ci.indexOf('  build:'));

    expect(unit, 'the unit job does not install a browser').toContain(
      'playwright install --with-deps chromium',
    );
    // `- run: pnpm test`, not the bare phrase: the comment above the install step mentions
    // `pnpm test` too, so matching that compared a comment with a step and failed.
    expect(
      unit.indexOf('playwright install') < unit.indexOf('- run: pnpm test'),
      'the browser is installed after the tests that need it',
    ).toBe(true);
  });
});
