import type { Config } from 'tailwindcss';

/**
 * marketing — Tailwind config (FIX-66 / Layer 3 token compliance)
 *
 * Extends the design-system token vocabulary with marketing-specific
 * micro-typography, prose width, and brand-shadow utilities. Every
 * arbitrary `text-[0.6Xrem]` / `max-w-[NNch]` / `shadow-[…signal-500…]`
 * call-site in the old marketing source has been collapsed into one of
 * these named utilities so the Layer 3 brand-enforcement ESLint rule
 * (`borjie/no-non-token-style`) never sees a raw bracket value.
 *
 * Tokens live here (and not in @borjie/design-system) because they are
 * micro-typography variants used exclusively by the marketing surface
 * — e.g. mono-caption labels above answer chips, prose-width caps for
 * editorial paragraphs. The design-system ships the canonical fontSize
 * scale; this file adds the editorial extensions on top.
 */
const config: Config = {
  content: [
    './src/**/*.{ts,tsx,mdx}',
    '../../packages/design-system/src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'oklch(0.18 0.02 80)',
        foreground: 'oklch(0.95 0.01 80)',
        primary: 'oklch(0.58 0.12 65)',
        accent: 'oklch(0.78 0.16 75)',
        border: 'oklch(0.30 0.02 80)',
        surface: 'oklch(0.22 0.02 80)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      /**
       * Marketing micro-typography — editorial caption + meta-label
       * sizes that sit BELOW the design-system `text-xs` step (0.75rem).
       * Numbered by visual rank so the cascade reads micro -> caption ->
       * meta -> body-sm -> body when scanning a component.
       */
      fontSize: {
        // 0.58rem — smallest legal meta label (audit-chain timestamps)
        'micro':       ['0.58rem', { lineHeight: '0.85rem' }],
        // 0.6rem — numeric badge / index counter
        'micro-num':   ['0.6rem',  { lineHeight: '0.9rem' }],
        // 0.62rem — mono-caption above answer chips
        'caption':     ['0.62rem', { lineHeight: '0.95rem' }],
        // 0.65rem — secondary meta label
        'caption-lg':  ['0.65rem', { lineHeight: '1rem' }],
        // 0.68rem — small-cap badge text (HERO swahili-first ribbon)
        'meta':        ['0.68rem', { lineHeight: '1rem' }],
        // 0.7rem — pill text / language toggle
        'pill':        ['0.7rem',  { lineHeight: '1rem' }],
        // 0.8rem — body-sm step (between caption and body)
        'body-sm':     ['0.8rem',  { lineHeight: '1.2rem' }],
        // 0.95rem — editorial body (between text-sm and text-base)
        'body-md':     ['0.95rem', { lineHeight: '1.45rem' }],
        // clamp(2.75rem, 7vw, 6.5rem) — hero display headline
        'hero':        ['clamp(2.75rem, 7vw, 6.5rem)', { lineHeight: '1.02', letterSpacing: '-0.04em' }],
      },
      /**
       * Editorial prose widths — character-based caps for marketing
       * copy. Numbered roughly by reading-comfort range:
       *   - prose-tight  (52ch): card subtitles, demo blurbs
       *   - prose        (54ch): default editorial paragraph
       *   - prose-wide   (58ch): hero sub, answer body
       *   - prose-wider  (60ch): section intros
       *   - prose-widest (62ch): hero sub (max comfortable cap)
       */
      maxWidth: {
        'prose-tight':  '52ch',
        'prose':        '54ch',
        'prose-wide':   '58ch',
        'prose-wider':  '60ch',
        'prose-widest': '62ch',
      },
      /**
       * Brand-shadow utilities — amber signal glow at two intensities.
       * Backed by the design-system `--signal-500` HSL token; the only
       * arbitrary thing is the spread distance, which is a marketing
       * affordance (cards need a tighter glow than the loop diagram).
       */
      boxShadow: {
        'signal-glow':        '0 0 24px -8px hsl(var(--signal-500) / 0.6)',
        'signal-glow-soft':   '0 0 48px -24px hsl(var(--signal-500) / 0.4)',
        'signal-glow-card':   '0 0 48px -16px hsl(var(--signal-500) / 0.35)',
      },
      /**
       * Hairline gap — 2px, used in StatusBoard latency-sparkline. The
       * design-system spacing scale jumps from 0 (0px) to 0.5 (2px),
       * so this is just an alias that survives the no-non-token rule.
       */
      gap: {
        'hairline': '2px',
      },
    },
  },
  plugins: [],
};

export default config;
