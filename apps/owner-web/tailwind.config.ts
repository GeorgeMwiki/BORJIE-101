import type { Config } from 'tailwindcss';
import baseConfig from '@borjie/design-system/tailwind.config';

/**
 * owner-web — Mining owner strategic cockpit. Inherits the Borjie
 * design-system Tailwind base so every owner surface speaks the
 * same token language (earth foundation, amber signal, editorial
 * display type) as the rest of the platform. No local palette
 * overrides — palette flows from CSS variables in globals.css.
 */
const config: Config = {
  ...baseConfig,
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/design-system/src/**/*.{ts,tsx}',
    '../../packages/chat-ui/src/**/*.{ts,tsx}',
    '../../packages/genui/src/**/*.{ts,tsx}',
  ],
};

export default config;
