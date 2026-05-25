import type { Config } from 'tailwindcss';

/**
 * Boss Nyumba — Tailwind config (Wave 29)
 *
 * Exposes the full token system as Tailwind classes: the 11-step
 * neutral ramp, the 11-step amber signal ramp, semantic chrome, and
 * motion/radius/shadow tokens. Every token reads `hsl(var(--*))` so
 * light/dark switching is automatic with the `.dark` class.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Foundation */
        background:           'hsl(var(--background))',
        foreground:           'hsl(var(--foreground))',
        surface: {
          DEFAULT:           'hsl(var(--surface))',
          foreground:        'hsl(var(--surface-foreground))',
          raised:            'hsl(var(--surface-raised))',
          sunken:            'hsl(var(--surface-sunken))',
        },
        popover: {
          DEFAULT:           'hsl(var(--popover))',
          foreground:        'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT:           'hsl(var(--card))',
          foreground:        'hsl(var(--card-foreground))',
        },

        /* shadcn compat */
        primary: {
          DEFAULT:           'hsl(var(--primary))',
          foreground:        'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:           'hsl(var(--secondary))',
          foreground:        'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT:           'hsl(var(--muted))',
          foreground:        'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:           'hsl(var(--accent))',
          foreground:        'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT:           'hsl(var(--destructive))',
          foreground:        'hsl(var(--destructive-foreground))',
        },
        border:              'hsl(var(--border))',
        input:               'hsl(var(--input))',
        ring:                'hsl(var(--ring))',

        /* Neutral ramp */
        neutral: {
          50:                'hsl(var(--neutral-50))',
          100:               'hsl(var(--neutral-100))',
          200:               'hsl(var(--neutral-200))',
          300:               'hsl(var(--neutral-300))',
          400:               'hsl(var(--neutral-400))',
          500:               'hsl(var(--neutral-500))',
          600:               'hsl(var(--neutral-600))',
          700:               'hsl(var(--neutral-700))',
          800:               'hsl(var(--neutral-800))',
          900:               'hsl(var(--neutral-900))',
          950:               'hsl(var(--neutral-950))',
        },

        /* Signal amber ramp — the one brand color */
        signal: {
          50:                'hsl(var(--signal-50))',
          100:               'hsl(var(--signal-100))',
          200:               'hsl(var(--signal-200))',
          300:               'hsl(var(--signal-300))',
          400:               'hsl(var(--signal-400))',
          500:               'hsl(var(--signal-500))',
          600:               'hsl(var(--signal-600))',
          700:               'hsl(var(--signal-700))',
          800:               'hsl(var(--signal-800))',
          900:               'hsl(var(--signal-900))',
          950:               'hsl(var(--signal-950))',
        },

        /* Semantic chrome (institutional, never alarmist) */
        success: {
          DEFAULT:           'hsl(var(--success))',
          foreground:        'hsl(var(--success-foreground))',
          subtle:            'hsl(var(--success-subtle))',
        },
        warning: {
          DEFAULT:           'hsl(var(--warning))',
          foreground:        'hsl(var(--warning-foreground))',
          subtle:            'hsl(var(--warning-subtle))',
        },
        danger: {
          DEFAULT:           'hsl(var(--danger))',
          foreground:        'hsl(var(--danger-foreground))',
          subtle:            'hsl(var(--danger-subtle))',
        },
        info: {
          DEFAULT:           'hsl(var(--info))',
          foreground:        'hsl(var(--info-foreground))',
          subtle:            'hsl(var(--info-subtle))',
        },

        /* Brand alias — keep `brand` referencing signal so existing
           `bg-brand-500` call-sites pick up the new palette without
           code changes. */
        brand: {
          50:                'hsl(var(--signal-50))',
          100:               'hsl(var(--signal-100))',
          200:               'hsl(var(--signal-200))',
          300:               'hsl(var(--signal-300))',
          400:               'hsl(var(--signal-400))',
          500:               'hsl(var(--signal-500))',
          600:               'hsl(var(--signal-600))',
          700:               'hsl(var(--signal-700))',
          800:               'hsl(var(--signal-800))',
          900:               'hsl(var(--signal-900))',
          950:               'hsl(var(--signal-950))',
        },
      },

      borderRadius: {
        sm:                  'var(--radius-sm)',
        DEFAULT:             'var(--radius)',
        md:                  'var(--radius-md)',
        lg:                  'var(--radius-lg)',
        xl:                  'var(--radius-xl)',
        '2xl':               'var(--radius-2xl)',
      },

      boxShadow: {
        xs:                  'var(--shadow-xs)',
        sm:                  'var(--shadow-sm)',
        DEFAULT:             'var(--shadow)',
        md:                  'var(--shadow-md)',
        lg:                  'var(--shadow-lg)',
        xl:                  'var(--shadow-xl)',
      },

      fontFamily: {
        display:             ['var(--font-display)', 'Fraunces', 'Georgia', 'serif'],
        sans:                ['var(--font-sans)', 'Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono:                ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        xs:                  ['0.75rem',  { lineHeight: '1rem' }],
        sm:                  ['0.875rem', { lineHeight: '1.25rem' }],
        base:                ['1rem',     { lineHeight: '1.5rem' }],
        lg:                  ['1.125rem', { lineHeight: '1.75rem' }],
        xl:                  ['1.25rem',  { lineHeight: '1.75rem' }],
        '2xl':               ['1.5rem',   { lineHeight: '2rem' }],
        '3xl':               ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
        '4xl':               ['2.25rem',  { lineHeight: '2.5rem',  letterSpacing: '-0.02em' }],
        '5xl':               ['3rem',     { lineHeight: '1.1',     letterSpacing: '-0.025em' }],
        '6xl':               ['3.75rem',  { lineHeight: '1.05',    letterSpacing: '-0.03em' }],
        '7xl':               ['4.5rem',   { lineHeight: '1',       letterSpacing: '-0.035em' }],
        '8xl':               ['6rem',     { lineHeight: '1',       letterSpacing: '-0.04em' }],
        '9xl':               ['8rem',     { lineHeight: '1',       letterSpacing: '-0.04em' }],
      },

      letterSpacing: {
        tighter:             '-0.04em',
        tight:               '-0.02em',
        normal:              '0',
        wide:                '0.02em',
        wider:               '0.04em',
        widest:              '0.1em',
      },

      transitionTimingFunction: {
        out:                 'var(--ease-out)',
        in:                  'var(--ease-in)',
        'in-out':            'var(--ease-in-out)',
        spring:              'var(--ease-spring)',
      },

      transitionDuration: {
        fast:                'var(--duration-fast)',
        base:                'var(--duration-base)',
        slow:                'var(--duration-slow)',
        slower:              'var(--duration-slower)',
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        'slide-out-right': {
          from: { transform: 'translateX(0)',    opacity: '1' },
          to:   { transform: 'translateX(100%)', opacity: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-signal': {
          '0%, 100%': { boxShadow: '0 0 0 0 hsl(var(--signal-500) / 0.5)' },
          '50%':       { boxShadow: '0 0 0 12px hsl(var(--signal-500) / 0)' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'cursor-blink': {
          '0%, 49%':   { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
      },

      animation: {
        'accordion-down':    'accordion-down 200ms var(--ease-out)',
        'accordion-up':      'accordion-up 200ms var(--ease-out)',
        'slide-in-right':    'slide-in-right 300ms var(--ease-out)',
        'slide-out-right':   'slide-out-right 250ms var(--ease-in)',
        'fade-in':           'fade-in 400ms var(--ease-out)',
        'fade-up':           'fade-up 400ms var(--ease-out)',
        'scale-in':          'scale-in 200ms var(--ease-out)',
        'pulse-signal':      'pulse-signal 2s var(--ease-out) infinite',
        'shimmer':           'shimmer 2s linear infinite',
        'cursor-blink':      'cursor-blink 1s step-end infinite',
      },
    },
  },
  plugins: [],
};

export default config;
