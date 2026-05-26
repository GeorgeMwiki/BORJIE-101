import type { Config } from 'tailwindcss';
import baseConfig from '@borjie/design-system/tailwind.config';

/**
 * marketing — Borjie public marketing surface. Inherits the design-system
 * Tailwind base so the public site speaks the same earth-and-amber token
 * language as the rest of the platform (owner-web, admin-web, mobile).
 * No local palette overrides — palette flows from CSS variables in
 * src/app/globals.css.
 */
const config: Config = {
  ...baseConfig,
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/design-system/src/**/*.{ts,tsx}',
  ],
};

export default config;
