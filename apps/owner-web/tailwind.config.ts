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
        // 13px (0.8125rem) — small body / metric secondary label
        'data':    ['0.8125rem', { lineHeight: '1.15rem' }],
        // 15px (0.9375rem) — between text-sm (14px) and text-base (16px)
        'body-md': ['0.9375rem', { lineHeight: '1.45rem' }],
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
        // Hairline accent rule used in sidebars / tab indicators.
        'hairline':    '2px',
        'rail':        '3px',
        // Status chip / nav-item glyph height.
        'chip':       '18px',
        // Document explorer viewport — viewport minus owner-shell chrome
        // (top bar + footer ~= 12rem).
        'viewport-fit': 'calc(100vh - 12rem)',
      },
      /**
       * Owner cockpit rail / accent widths — vertical indicator strokes
       * used in side navs and tab markers.
       */
      width: {
        ...(baseConfig.theme?.extend?.width ?? {}),
        'hairline':  '2px',
        'rail':      '3px',
      },
      /**
       * Owner cockpit min-widths — column floors for hot-table grids
       * (licences, sites, marketplace, treasury) that must not collapse.
       */
      minWidth: {
        ...(baseConfig.theme?.extend?.minWidth ?? {}),
        'column-sm': '220px',
        'column-md': '240px',
        'column-lg': '260px',
        'column-xl': '280px',
      },
      /**
       * Owner cockpit min-heights — panel floors so layout doesn't
       * collapse when content is sparse.
       */
      minHeight: {
        ...(baseConfig.theme?.extend?.minHeight ?? {}),
        // Auth shell — viewport minus top chrome (3rem).
        'shell':     'calc(100vh - 3rem)',
        // Tap-area floor for feedback textarea.
        'tap-area':  '96px',
        // Panel floor for empty-state surfaces (control tower etc.).
        'panel':     '480px',
      },
      /**
       * Owner cockpit letter-spacing — editorial micro-cap labels
       * above section headers / panel eyebrows. `eyebrow` (0.12em) is
       * the looser of the two — used inside the home-chat composer
       * subtitle rail where the chip text is already small.
       */
      letterSpacing: {
        ...(baseConfig.theme?.extend?.letterSpacing ?? {}),
        'eyebrow':         '0.12em',
        'eyebrow-wide':    '0.18em',
        // Auth / error / 404 caps — widest spacing for the cinematic
        // "Hitilafu · Something went wrong" eyebrow row.
        'eyebrow-x-wide':  '0.22em',
      },
    },
  },
};

export default config;
