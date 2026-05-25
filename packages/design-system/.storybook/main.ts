import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook main configuration.
 * Auto-discovers any `*.stories.@(ts|tsx|mdx)` file under src/.
 *
 * Storybook 10 migration notes (Phase D11, 2026-05-17):
 *   - `@storybook/addon-essentials` was deprecated and merged into the
 *     storybook core in v9/v10 — its controls/actions/backgrounds/viewport
 *     features ship in the base install with no addon entry required.
 *   - `@storybook/addon-interactions` was likewise rolled into the core
 *     play-function pipeline; explicit registration is no longer needed.
 *   - The preview-frame architecture changed in Storybook 10 (new
 *     fully-isolated iframe + structured channel protocol); the legacy
 *     `parameters.actions.argTypesRegex` global registration was removed
 *     and lives in preview.ts as opt-in `fn()` spies per-story
 *     (imported from `storybook/test`).
 *   - The top-level `docs.autodocs` key was deprecated in favour of the
 *     per-story tag mechanism — `tags: ['autodocs']` in preview.ts now
 *     drives auto-generated docs pages.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-links'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
    },
  },
};

export default config;
