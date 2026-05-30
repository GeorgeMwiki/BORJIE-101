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
    // chat-ui ships as compiled JS in dist/. Tailwind must scan it so
    // the LitFinWidget FAB classes (fixed bottom-6 right-6 z-50, h-14,
    // w-14, bg-gradient-to-br, etc.) survive into the generated CSS.
    // Without this, the floating chat bubble renders as a static-flow
    // 0-px <button> at the bottom of the page (the user's "missing
    // widget" report). Including the JS dist alongside the .tsx source
    // covers both dev (next/dynamic pulls dist/) and watch rebuilds.
    '../../packages/chat-ui/dist/**/*.{js,mjs}',
    '../../packages/chat-ui/src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // LitFin IGNITION palette — copper-on-cream. Keep these
        // synchronised with packages/design-system/src/styles/globals.css —
        // the marketing-local Tailwind config overrides arbitrary-value
        // call-sites, while the design-system HSL CSS vars cascade
        // everywhere else. Values mirror LitFin reference oklch points.
        background: 'oklch(0.98 0.012 80)',      /* warm cream (40 40% 98%) */
        foreground: 'oklch(0.20 0.020 40)',      /* deep warm charcoal (30 14% 12%) */
        primary:    'oklch(0.60 0.140 45)',      /* IGNITION copper-mid (24 58% 48%) */
        accent:     'oklch(0.75 0.150 60)',      /* copper-bright (36 86% 64%) */
        border:     'oklch(0.89 0.012 50)',      /* warm hairline (30 10% 89%) */
        surface:    'oklch(1 0 0)',              /* pure white card */
      },
      fontFamily: {
        // LitFin parity: Inter for body, Syne for display headings. Both
        // are loaded via next/font/google in apps/marketing/src/app/layout.tsx
        // and exposed through the --font-sans-override / --font-display-override
        // CSS variables consumed by the design-system globals.css.
        sans: ['var(--font-sans-override)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-display-override)', 'Syne', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      /**
       * Marketing micro-typography — editorial caption + meta-label
       * sizes that sit BELOW the design-system `text-xs` step (0.75rem).
       * Numbered by visual rank so the cascade reads micro -> caption ->
       * meta -> body-sm -> body when scanning a component.
       */
      fontSize: {
        // 0.5625rem (9px) — sparkline tick / status board axis label.
        // Mirrors the owner-web `text-spark` token so the cockpit and
        // marketing surfaces speak one micro-typography vocabulary.
        'spark':       ['0.5625rem', { lineHeight: '0.8rem' }],
        // 0.58rem — smallest legal meta label (audit-chain timestamps)
        'micro':       ['0.58rem', { lineHeight: '0.85rem' }],
        // 0.6rem — numeric badge / index counter
        'micro-num':   ['0.6rem',  { lineHeight: '0.9rem' }],
        // 0.625rem (10px) — chart axis label / footer caption (mirrors
        // owner-web `text-tiny`)
        'tiny':        ['0.625rem', { lineHeight: '0.9rem' }],
        // 0.62rem — mono-caption above answer chips
        'caption':     ['0.62rem', { lineHeight: '0.95rem' }],
        // 0.65rem — secondary meta label
        'caption-lg':  ['0.65rem', { lineHeight: '1rem' }],
        // 0.68rem — small-cap badge text (HERO swahili-first ribbon)
        'meta':        ['0.68rem', { lineHeight: '1rem' }],
        // 0.6875rem (11px) — secondary KPI badge / legend entry
        // (mirrors owner-web `text-badge`)
        'badge':       ['0.6875rem', { lineHeight: '1rem' }],
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
       * Marketing hairline strokes — 2px accents used in StatusBoard
       * sparkline, ProblemSolution divider, and Hero pulse rail. The
       * design-system spacing scale jumps from 0 → 2px (0.5), so these
       * named utilities simply expose the same dimension without the
       * arbitrary-bracket syntax the lint rule rejects.
       */
      height: {
        'hairline': '2px',
        // Skeleton-bar heights inside MeshGradient (loading visualisation
        // — fractions of the canvas height). Mirrors `width: skel-*`.
        'skel-40':  '40%',
        'skel-50':  '50%',
        'skel-60':  '60%',
        'skel-70':  '70%',
      },
      width: {
        'hairline': '2px',
        // Skeleton-bar widths inside MeshGradient (status-board loading
        // visualisation). Each step is a fraction of the canvas width.
        'skel-40':  '40%',
        'skel-50':  '50%',
        'skel-60':  '60%',
        'skel-70':  '70%',
        // Nav search command-bar canvas (720px desktop).
        'cmd':      '720px',
      },
      /**
       * Marketing min/max viewport floors. Numbered tokens line up with
       * the editorial layout grid (hero, dialog modal, container).
       */
      minHeight: {
        // Stat band — minimum row height so KPI numbers don't jitter.
        'stat':  '5rem',
        // Hero shell — almost full viewport so the gold aurora fills.
        'hero':  '88vh',
      },
      maxHeight: {
        // Dialog modal — 80vh viewport cap to keep chrome above the fold.
        'dialog': '80vh',
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
        // Editorial wide canvas — Footer + Nav layout cap.
        'container':    '1440px',
        // Generic message bubble cap (CTA / Pricing benefit summaries).
        'bubble':       '85%',
      },
      /**
       * Marketing border-radius — editorial card chrome (28px) and
       * footer panel (32px). Tailwind's `rounded-3xl` is 24px, which
       * is slightly tighter than the LitFin reference; these two named
       * tokens line up exactly with the Figma source.
       */
      borderRadius: {
        'card-lg': '28px',
        'panel':   '32px',
      },
      /**
       * Marketing line-heights — hero display headline tightness. Same
       * 1.02 multiplier as the `text-hero` step but exposed as a named
       * utility for nested headings that share the cinematic feel.
       */
      lineHeight: {
        'display': '1.02',
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
        // Editorial drop-shadows that lift floating chrome (Footer panel,
        // Nav command bar, Hero card) off the navy canvas. The navy
        // base is the same `oklch(0.16 0.025 260)` used in the marketing
        // colour table — three intensities by component depth.
        'lift-soft':          '0 24px 70px -20px oklch(0.16 0.025 260 / 0.6)',
        'lift-medium':        '0 24px 80px -20px oklch(0.16 0.025 260 / 0.7)',
        'lift-hero':          '0 28px 80px oklch(0.16 0.025 260 / 0.45)',
      },
      /**
       * Marketing letter-spacing — editorial micro-cap labels above
       * section headers. `eyebrow-x-wide` (0.22em) is the widest step,
       * used for cinematic eyebrow rows on error / 404 / hero
       * subtitles. Mirrors the owner-web vocabulary.
       */
      letterSpacing: {
        'eyebrow-x-wide': '0.22em',
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
