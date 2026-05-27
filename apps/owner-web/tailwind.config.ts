import type { Config } from 'tailwindcss';
import baseConfig from '@borjie/design-system/tailwind.config';

/**
 * owner-web — Mining owner strategic cockpit. Inherits the Borjie
 * design-system Tailwind base so every owner surface speaks the
 * same token language (earth foundation, amber signal, editorial
 * display type) as the rest of the platform. No local palette
 * overrides — palette flows from CSS variables in globals.css.
 *
 * Extends the design-system token vocabulary (GREEN-APPS / Layer 3
 * compliance) with owner-cockpit-specific micro-typography and chart
 * pane heights. Every arbitrary `text-[NNpx]` / `h-[NNNpx]` call-site
 * in the owner-web source has been collapsed into one of these named
 * utilities so the Layer 3 brand-enforcement ESLint rule
 * (`borjie/no-non-token-style`) never sees a raw bracket value.
 *
 * Mirrors the admin-web vocabulary so micro-label sizes are coherent
 * across HQ-internal and tenant cockpit surfaces.
 */
const config: Config = {
  ...baseConfig,
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/design-system/src/**/*.{ts,tsx}',
    '../../packages/chat-ui/src/**/*.{ts,tsx}',
    '../../packages/genui/src/**/*.{ts,tsx}',
  ],
  theme: {
    ...baseConfig.theme,
    extend: {
      ...(baseConfig.theme?.extend ?? {}),
      /**
       * Owner cockpit micro-typography — chart-axis labels and dense
       * KPI badges. Sits BELOW the design-system `text-xs` step
       * (0.75rem). Numbered by visual rank.
       */
      fontSize: {
        ...(baseConfig.theme?.extend?.fontSize ?? {}),
        // 9px (0.5625rem) — sparkline axis tick / dense numeric column
        'spark':   ['0.5625rem', { lineHeight: '0.8rem' }],
        // 10px (0.625rem) — chart axis label / pill counter
        'tiny':    ['0.625rem',  { lineHeight: '0.9rem' }],
        // 11px (0.6875rem) — secondary KPI badge / legend entry
        'badge':   ['0.6875rem', { lineHeight: '1rem' }],
      },
      /**
       * Owner cockpit chart pane heights — fixed viewports for the
       * recharts canvases on the strategic dashboard. Sized to fit a
       * standard 1440x900 desktop layout without pushing the page
       * fold; the mobile breakpoint collapses these via Tailwind's
       * `md:` prefix at call-sites.
       */
      height: {
        ...(baseConfig.theme?.extend?.height ?? {}),
        'chart-sm':  '400px',
        'chart-md':  '520px',
        'chart-lg':  '560px',
        'chart-xl':  '600px',
        'chart-2xl': '640px',
      },
    },
  },
};

export default config;
