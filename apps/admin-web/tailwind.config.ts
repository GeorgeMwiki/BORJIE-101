import type { Config } from 'tailwindcss';
import baseConfig from '@borjie/design-system/tailwind.config';

/**
 * admin-web — HQ-internal surface. Inherits the Borjie
 * base Tailwind config; no local color overrides. All palette flows
 * from the design-system CSS variables loaded via globals.css.
 *
 * Extends the design-system token vocabulary (GREEN-APPS / Layer 3
 * compliance) with admin-console-specific micro-typography, prose-width
 * caps, fixed-rail widths, and pane-height tokens. Every arbitrary
 * `text-[0.6Xrem]` / `w-[NNNpx]` / `max-w-[NNch]` / `min-h-[NNvh]`
 * call-site in the admin-web source has been collapsed into one of
 * these named utilities so the Layer 3 brand-enforcement ESLint rule
 * (`borjie/no-non-token-style`) never sees a raw bracket value.
 *
 * Mirrors the marketing surface's caption / meta vocabulary (added in
 * FIX-66) and adds admin-console-specific layout tokens (jarvis pane
 * heights, audit-trail rail widths, ask-page thread rails).
 */
const config: Config = {
  ...baseConfig,
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/design-system/src/**/*.{ts,tsx}',
  ],
  theme: {
    ...baseConfig.theme,
    extend: {
      ...(baseConfig.theme?.extend ?? {}),
      /**
       * Admin micro-typography — editorial caption + meta-label sizes
       * that sit BELOW the design-system `text-xs` step (0.75rem).
       * Mirrors the marketing scale so the cross-surface vocabulary
       * stays consistent. Numbered by visual rank: micro -> caption ->
       * caption-lg -> meta -> tiny when scanning a component.
       */
      fontSize: {
        ...(baseConfig.theme?.extend?.fontSize ?? {}),
        // 0.6rem — numeric badge / index counter
        'micro-num':   ['0.6rem',   { lineHeight: '0.9rem' }],
        // 0.62rem — mono-caption above answer chips / SLO label
        'caption':     ['0.62rem',  { lineHeight: '0.95rem' }],
        // 0.65rem — secondary meta label (audit-trail timestamps)
        'caption-lg':  ['0.65rem',  { lineHeight: '1rem' }],
        // 0.68rem — small-cap badge text (status pills)
        'meta':        ['0.68rem',  { lineHeight: '1rem' }],
        // 10px (0.625rem) — mission-eval numeric column
        'tiny':        ['0.625rem', { lineHeight: '0.9rem' }],
      },
      /**
       * Admin-console layout widths — fixed-rail thread navigators and
       * pinned side panels in the Ask console. Numbered roughly by
       * width-rank: thread-narrow (280px) -> thread-medium (320px) ->
       * thread-wide (360px) -> dialog-md (28rem / 448px).
       */
      width: {
        ...(baseConfig.theme?.extend?.width ?? {}),
        'thread-narrow':  '280px',
        'thread-medium': '320px',
        'thread-wide':    '360px',
        'dialog-md':      '28rem',
      },
      /**
       * Admin-console max-width caps — character-based for prose,
       * rem-based for truncated metadata rails.
       */
      maxWidth: {
        ...(baseConfig.theme?.extend?.maxWidth ?? {}),
        'meta-rail':     '14rem',  // truncated filename / model chip
        'truncate-sm':   '18ch',   // single-line meta column
        'truncate-md':   '24ch',   // two-column meta cell
        'prose-md':      '66ch',   // editorial paragraph cap
        'modal-cap':     '90vw',   // mobile-safe modal width cap
      },
      /**
       * Admin-console min-width / min-height escapes — paneled console
       * shells need a guaranteed minimum so the layout doesn't collapse
       * when content is sparse.
       */
      minWidth: {
        ...(baseConfig.theme?.extend?.minWidth ?? {}),
        'thumb':  '64px',  // thumb / status-pill min-width
      },
      minHeight: {
        ...(baseConfig.theme?.extend?.minHeight ?? {}),
        'console-pane': '60vh',  // Jarvis console viewport floor
      },
    },
  },
};

export default config;
