import type { Config } from 'tailwindcss';
import baseConfig from '@borjie/design-system/tailwind.config';

/**
 * admin-web — HQ-internal surface. Inherits the Borjie
 * base Tailwind config; no local color overrides. All palette flows
 * from the design-system CSS variables loaded via globals.css.
 */
const config: Config = {
  ...baseConfig,
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/design-system/src/**/*.{ts,tsx}',
  ],
};

export default config;
