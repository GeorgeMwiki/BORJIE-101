import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook 10 config for @borjie/dynamic-sections.
 *
 * Stories cover each J1 seed section in three states (empty,
 * loading, populated) so the design QA pass can verify the empty-
 * state copy, the skeleton fallback, and the rendered output side-
 * by-side without spinning the full portal.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-links'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: (prop) =>
        prop.parent ? !/node_modules/.test(prop.parent.fileName) : true,
    },
  },
};

export default config;
