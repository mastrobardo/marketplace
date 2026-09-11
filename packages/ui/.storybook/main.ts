import { type StorybookConfig } from '@storybook/react-vite';

/**
 * The workbench (ADR-012 §5). Storybook is not documentation here — it is where the components are
 * reviewed by a human or an agent who should not have to check out a branch and start a dev server
 * (`TODO.md` §9: every PR gets a URL; reviewers click, they don't imagine). `W12-T06` deploys it.
 *
 * `@storybook/addon-vitest` is the only addon that changes what CI does: it turns every story into
 * a Vitest browser test in the runner this repo already has, rather than adding a second harness.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-vitest'],
  framework: { name: '@storybook/react-vite', options: {} },

  // Storybook phones home on every `dev`, `build` and test run. This repo is personal
  // (`docs/board/IDENTITY.md`) and most of these runs are an agent's, not a person's — an outbound
  // call nobody chose, from a machine and from CI, is not a default worth keeping.
  core: { disableTelemetry: true },
};

export default config;
