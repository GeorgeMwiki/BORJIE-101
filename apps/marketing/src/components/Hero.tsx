import Link from 'next/link';
import { ArrowRight, MapPin } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';

interface LogomarkProps {
  readonly size?: number;
  readonly className?: string;
}
function Logomark({ size = 24, className = '' }: LogomarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block rounded-md ${className}`}
      style={{
        width: size,
        height: size,
        background:
          'linear-gradient(135deg, oklch(0.58 0.12 65), oklch(0.78 0.16 75))',
      }}
    />
  );
}

/**
 * Hero — the headline surface.
 *
 * Mirrors the LitFin / Mercury / Linear 2026 hero rhythm:
 *   - Single pill kicker at the top.
 *   - One declarative seven-word headline (display-medium, clamp-sized).
 *   - One-sentence supporting subhead with concrete outcomes
 *     (royalty returns, gold-window hedge, audit chain).
 *   - Dual CTA: primary "Start free" + ghost "See it run".
 *   - Trustline of Tanzanian mining regions in mono-caption.
 *
 * Stats no longer sit inline — they live in the dedicated StatsBand
 * lower in the page so the hero reads as one calm declarative beat.
 */
export function Hero({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).hero;

  return (
    <section
      className="relative overflow-hidden"
      aria-labelledby="hero-headline"
    >
      <div className="hero-aurora" aria-hidden="true" />
      <div
        className="absolute inset-0 cinematic-grid opacity-40"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-7xl px-6 pb-20 pt-20 sm:pb-28 sm:pt-28 lg:px-8">
        <div className="mb-10 flex justify-center">
          <span className="group inline-flex items-center gap-2 rounded-full border border-border/80 bg-surface/60 px-3 py-1 text-xs font-medium text-neutral-400 backdrop-blur">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-signal-500" aria-hidden="true" />
            <span className="tracking-wide uppercase text-meta">
              {t.swahiliFirstBadge}
            </span>
            <span className="h-3 w-px bg-border" aria-hidden="true" />
            <span className="italic">{t.kicker}</span>
          </span>
        </div>

        <h1
          id="hero-headline"
          className="mx-auto max-w-5xl font-display text-hero font-medium tracking-tighter text-foreground text-balance text-center"
        >
          {t.headline.split(' ').slice(0, -2).join(' ')}{' '}
          <span className="relative inline-block">
            <span className="italic text-signal-500">
              {t.headline.split(' ').slice(-2).join(' ')}
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 500 16"
              preserveAspectRatio="none"
              className="absolute left-0 right-0 -bottom-2 h-2 w-full text-signal-500/70"
            >
              <path
                d="M2 10 Q125 2 250 8 T498 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </h1>

        <p className="mx-auto mt-8 max-w-prose-widest text-center text-lg leading-relaxed text-neutral-400 sm:text-xl">
          {t.sub}
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/pilot"
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-base ease-out hover:bg-signal-400 hover:shadow-lg active:scale-[0.98]"
          >
            {t.ctaPilot}
            <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/#brief"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-border px-6 text-sm font-semibold text-foreground transition-colors duration-fast hover:bg-surface-raised"
          >
            {t.ctaDemo}
          </Link>
        </div>

        <p className="mt-14 flex items-center justify-center gap-2 font-mono text-meta uppercase tracking-widest text-neutral-500">
          <Logomark size={10} className="text-signal-500" />
          <MapPin className="h-3 w-3 text-signal-500" />
          <span>{t.trustline}</span>
        </p>
      </div>
    </section>
  );
}
